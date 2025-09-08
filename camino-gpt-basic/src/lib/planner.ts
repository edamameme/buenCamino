// lib/planner.ts
import OpenAI from "openai";
import { PlanSchema, type Plan } from "@/lib/schemas";
import type { CaminoPreferences } from "@/lib/preferences";

/** ─────────────────────────────────────────────────────────────────────────────
 *  Strict JSON schema the model must follow (broad args to avoid over-constraining).
 *  This matches your Plan shape and keeps "args" open; PlanSchema will still validate.
 *  ──────────────────────────────────────────────────────────────────────────── */
const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["steps"],
  properties: {
    steps: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "tool", "args"],
        properties: {
          id: { type: "string", minLength: 1 },
          tool: {
            type: "string",
            enum: [
              "map.focus",
              "map.drawRoute",
              "map.addMarkers",
              "rag.search",
              "places.search",
              "elevation.profile",
              "export.gpx",
            ],
          },
          args: { type: "object", additionalProperties: false }, // keep open; PlanSchema will enforce details
          why: { type: "string" },
          pauseForUser: { type: "boolean" },
        },
      },
    },
    specialist: {
      type: "string",
      enum: ["navigator", "concierge", "safety", "logistics"],
    },
    budget: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxSteps: { type: "number" },
        maxTokens: { type: "number" },
      },
    },
  },
} as const;

/** Comprehensive planner instructions for multi-day Camino route generation */
const SYSTEM = [
  "You are the planner for a Camino map+chat agent. Do NOT hardcode a fixed list of towns. Build stages dynamically from the user's request.",
  "",
  "GOALS:",
  "- Start/end can vary (default Sarria → Santiago if unspecified)",
  "- Create MULTI-DAY stages unless the user explicitly asks for a single day", 
  "- Respect user intent if they specify: number of days (N), target km per day, or must-visit towns",
  "- IMPORTANT: N days = N-1 stages/legs (e.g. 5 days = 4 walking stages between 5 towns)",
  "",
  "TOOL USAGE (order and rules):",
  "1) map.focus near the start location",
  "2) map.drawRoute with start/end strings and stages array:",
  "   - If user gives N days → split into N-1 distance-balanced stages (~115km Sarria-Santiago ÷ (N-1))",
  "   - If user gives targetStageKm → chunk by distance with ±20% tolerance",
  "   - If user gives anchor towns → use anchors as breakpoints, fill gaps by distance",
  "3) map.addMarkers with markers array (lat/lon required), one per overnight stop",
  "",
  "STAGE GENERATION:",
  "- Work from candidate towns along the Camino Frances route in Galicia, Spain",
  "- Each stage must have proper from/to town names: {'from': 'TownA', 'to': 'TownB', 'distanceKm': XX.X}",
  "- Use real town names: 'Sarria', 'Portomarín', 'Palas de Rei', 'Melide', 'Arzúa', 'Santiago'", 
  "- NEVER use generic stage names like 'stage': '1' or 'stage': '2' - always use town names",
  "- Distances should be rounded to one decimal place (e.g., 22.3 km, 22.0 km becomes 22 km)",
  "",
  "QUALITY CONSTRAINTS:",
  "- Avoid extremely short (<10 km) or long (>40 km) stages unless user requests it",
  "- All towns must be in Galicia, Spain (lat ~42.5-43.5, lon ~-9.0 to -6.5)",
  "- Preserve must-visit towns as stage boundaries when specified",
  "",
  "EXAMPLE for '5-day Sarria to Santiago':",
  '{"steps":[',
  '  {"id":"s1","tool":"map.focus","args":{"location":"Sarria","zoom":12}},',
  '  {"id":"s2","tool":"map.drawRoute","args":{',
  '    "start":"Sarria","end":"Santiago",',
  '    "stages":[',
  '      {"from":"Sarria","to":"Portomarín","distanceKm":22.2},',
  '      {"from":"Portomarín","to":"Palas de Rei","distanceKm":24.8},', 
  '      {"from":"Palas de Rei","to":"Melide","distanceKm":15.2},',
  '      {"from":"Melide","to":"Arzúa","distanceKm":14.1},',
  '      {"from":"Arzúa","to":"Santiago","distanceKm":39.2}',
  '    ]',
  '  }},',
  '  {"id":"s3","tool":"map.addMarkers","args":{',
  '    "markers":[',
  '      {"lat":42.8075,"lon":-7.6153,"title":"Portomarín","subtitle":"Day 1 · 22.2 km"},',
  '      {"lat":42.8741,"lon":-7.8687,"title":"Palas de Rei","subtitle":"Day 2 · 24.8 km"},',
  '      {"lat":42.9142,"lon":-8.0129,"title":"Melide","subtitle":"Day 3 · 15.2 km"},',
  '      {"lat":42.9290,"lon":-8.1585,"title":"Arzúa","subtitle":"Day 4 · 14.1 km"},',
  '      {"lat":42.8806,"lon":-8.5449,"title":"Santiago","subtitle":"Day 5 · 39.2 km"}',
  '    ]',
  '  }}',
  '],"budget":"$"}',
  "",
  "Output ONLY valid JSON matching this structure. No prose, no markdown, no explanations.",
].join("\n");

/** Keep the ‘DEV’ rules concise; the schema below is the real contract */
const DEV = [
  "STRICT OUTPUT RULES:",
  "- Return ONLY JSON matching the Plan schema.",
  "- Canonical tool names only (exact strings).",
  "- args must be an object; do not include extraneous top-level fields.",
].join("\n");

const OUTPUT_EXAMPLE = [
  "Return ONLY a JSON object with this exact shape (no code fences, no extra wrappers):",
  '{"steps":[{"id":"s1","tool":"map.focus","args":{"center":[-8.5449,42.8806],"zoom":12},"why":"focus Santiago","pauseForUser":false}],"specialist":"navigator"}',
  "Use keys exactly: steps, id, tool, args, why, pauseForUser, specialist, budget.",
  'Do not rename keys. Do not wrap in {"plan":...}.',
].join("\n");

/** Normalize pause flags as you already did (keep first, drop rest) */
function normalizePauses(plan: Plan, mode: "first" | "none" | "keep" = "first"): Plan {
  if (mode === "keep") return plan;
  if (mode === "none") return { ...plan, steps: plan.steps.map((s) => ({ ...s, pauseForUser: false })) };
  let seen = false;
  return {
    ...plan,
    steps: plan.steps.map((s) => {
      if (s.pauseForUser && !seen) {
        seen = true;
        return s;
      }
      return { ...s, pauseForUser: false };
    }),
  };
}

/** Small helper: keep the user input tiny for latency */
type ChatMsg = { role: "user" | "assistant"; content: string };
function compactPayload(messages: ChatMsg[], preferences?: CaminoPreferences): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  // Include the literal word "json" so Responses honors json_object mode.
  const payload = { mode: "json", ask: lastUser, preferences: preferences ?? {} };
  return JSON.stringify(payload).slice(0, 3000);
}

/** Main entry: one fast, predictable call using Responses + strict schema */
export async function buildPlan(opts: {
  openai: OpenAI;
  model: string;
  messages: ChatMsg[];
  preferences?: CaminoPreferences;
  /** Optional: pass AbortSignal from route.ts so upstream request is truly cancelled on timeout */
  signal?: AbortSignal;
}) {
  const { openai, model, messages, preferences, signal } = opts;

  // Per-call client options so this request won't auto-retry or exceed our server guard
  const client = openai.withOptions({
    maxRetries: 0,          // do not stretch the 12s server budget
    timeout: 19_500,        // slightly under the 20s guard
    // Note: signal not supported in withOptions, would need to pass to individual calls
  });

  const res = await client.responses.create({
    model,
    instructions: `${SYSTEM}\n\n${DEV}\n\n${OUTPUT_EXAMPLE}`,
    input: [{ role: "user", content: compactPayload(messages, preferences) }],
    temperature: 0.2,
    max_output_tokens: 2000, // increased to handle full JSON responses
    text: { format: { type: "json_object" } }, // ← only enforce valid JSON, not full schema

    // text: {
    //   format: {
    //   type: "json_schema",
    //   name: "Plan",
    //   schema: PLAN_JSON_SCHEMA,
    //   strict: false,
    //   }
    // },
  });

  // Parse once (no repair loop needed with strict schema)
  const raw = (res as any).output_text as string;
  if (!raw || typeof raw !== "string") {
    throw new Error("Planner returned empty output");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.log('failed json parse: ', raw)
    throw new Error("Planner returned non-JSON output");
  }

  console.log(`[planner] raw output: ${raw}`);
//   console.log(`[planner] parsed : ${parsed}`);
  const ok = PlanSchema.safeParse(parsed);
  if (!ok.success) {
    // Even with strict schema, keep a clear error for route.ts to handle gracefully
    throw new Error(`Planner JSON failed validation: ${ok.error.toString()}`);
  }

  // Keep your existing pause policy
  return normalizePauses(ok.data, "first");
}

/** Export prompts for tests/debugging if desired */
export const plannerPrompts = { SYSTEM, DEV };
