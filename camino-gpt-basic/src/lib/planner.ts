// lib/planner.ts
import OpenAI from "openai";
import { PlanSchema, type Plan } from "@/lib/schemas";
import type { CaminoPreferences } from "@/lib/preferences";

/** Tight, auditable prompts */
const SYSTEM = `You are Camino GPT — a planning agent for the Camino de Santiago.
- Output ONLY a JSON object conforming to the Plan schema (no prose, no markdown).
- Prefer safe, incremental steps. Use pauseForUser for multi-day or impactful actions.
- Use user preferences (units, route style, target km/day, budget tier, albergue kinds, notes).
- Available tools: map.focus, map.drawRoute, map.addMarkers, rag.search, places.search, elevation.profile, export.gpx.`;

const DEV = `Plan Schema (conceptual):
type Plan = {
  steps: Array<{ id: string; tool: "map.focus"|"map.drawRoute"|"map.addMarkers"|"rag.search"|"places.search"|"elevation.profile"|"export.gpx"; args: Record<string,unknown>; why?: string; pauseForUser?: boolean }>;
  specialist?: "navigator"|"concierge"|"safety"|"logistics";
  budget?: { maxSteps?: number; maxTokens?: number };
}

STRICT OUTPUT RULES:
- Return ONLY JSON (no markdown).
- Use canonical arg shapes:
  - map.focus: { "lat": number, "lon": number, "zoom"?: number, "label"?: string }
    Do NOT use "location".
  - map.drawRoute: { "geojson": { "type": "LineString", "coordinates": [[lon,lat], ...] }, "meta"?: { "startName"?: string, "endName"?: string } }
    Do NOT use "start", "end", or "distance" in args.
  - map.addMarkers: { "markers": [{ "lat": number, "lon": number, "title"?: string, "subtitle"?: string }] }
  - rag.search: { "query": string, "topK"?: number }
  - elevation.profile: { "coords": Array<[number,number]> } // [lon,lat]
  - export.gpx: { "name": string, "segments": Array<Array<[number,number]>> } // [lon,lat]
  - places.search: { "q": string, "near"?: [number,number], "kind"?: "albergue"|"cafe"|"grocery" }
- Include human-readable names ONLY in "label" (focus) or "meta" (drawRoute), or in "why".
- NEVER put "pauseForUser" in the "tool" field. "pauseForUser" is a boolean on each step.
- Use pauseForUser for multi-day/impactful actions.
STRICT: Return ONLY JSON matching the Plan.`;
/** Parse & validate the model output once centrally */

function tryParsePlan(json: string): { ok: true; plan: Plan } | { ok: false; error: string } {
    try {
        const obj = JSON.parse(json);
        const parsed = PlanSchema.safeParse(obj);
        if (!parsed.success) return { ok: false, error: parsed.error.toString() };
        return { ok: true, plan: parsed.data };
    } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) };
    }
}

type ChatMsg = { role: "user" | "assistant"; content: string };

export async function buildPlan(opts: {
    openai: OpenAI;
    model: string;
    messages: ChatMsg[];
    preferences?: CaminoPreferences;
}) {
    const { openai, model, messages, preferences } = opts;

    const prefNote = preferences
        ? `User Preferences:\n${JSON.stringify(preferences, null, 2)}`
        : "User Preferences: none provided";

    // First attempt
    const c1 = await openai.chat.completions.create({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" as any }, // JSON mode if supported by the model
        messages: [
            { role: "system", content: SYSTEM },
            { role: "system", content: DEV },
            ...messages,
            { role: "system", content: prefNote },
            { role: "system", content: "Return ONLY valid JSON for Plan. No markdown or commentary." },
        ],
    });

    const raw1 = c1.choices?.[0]?.message?.content ?? "{}";
    try {
        const obj1 = JSON.parse(raw1);
        const repaired1 = repairPlanLike(obj1);
        if (repaired1) return normalizePauses(repaired1, "first");
    } catch { }
    const parsed1 = PlanSchema.safeParse(JSON.parse(raw1));
    if (parsed1.success) return normalizePauses(parsed1.data, "first");

    // One repair attempt (feed back the error + the invalid JSON)
    const c2 = await openai.chat.completions.create({
        model,
        temperature: 0,
        response_format: { type: "json_object" as any },
        messages: [
            { role: "system", content: SYSTEM },
            { role: "system", content: DEV },
            { role: "system", content: prefNote },
            { role: "system", content: "Your previous JSON was invalid. Repair it to satisfy the schema. Output JSON only." },
            { role: "user", content: `Invalid JSON:\n${raw1}\n\nErrors:\n${parsed.error}` },
        ],
    });

    const raw2 = c2.choices?.[0]?.message?.content ?? "{}";
    try {
        const obj2 = JSON.parse(raw2);
        const repaired2 = repairPlanLike(obj2);
        if (repaired2) return normalizePauses(repaired2, "first");
    } catch { }
    const parsed2 = PlanSchema.safeParse(JSON.parse(raw2));
    if (parsed2.success) return normalizePauses(parsed2.data, "first");
    throw new Error(`Planner returned invalid Plan after repair: ${parsed.error}`);
}
// Convert common model slips into valid Plan when possible.
function repairPlanLike(obj: any): Plan | null {
    if (!obj || typeof obj !== "object" || !Array.isArray(obj.steps)) return null;

    const allowed = new Set((ToolName as any)._def.values as string[]); // zod enum values
    const fixed: any[] = [];

    for (let i = 0; i < obj.steps.length; i++) {
        const raw = obj.steps[i] ?? {};
        let { id, tool, args, why, pauseForUser } = raw;

        // Ensure id
        if (typeof id !== "string" || !id) id = `step-${i + 1}`;

        // ✨ If the model wrote pauseForUser into the tool field, repair it.
        if (tool === "pauseForUser") {
            pauseForUser = true;
            tool = raw.action ?? raw.type ?? raw.name ?? undefined;
        }

        // Normalize aliases → canonical tool names
        if (typeof tool === "string") {
            const t = tool.trim();
            const alias: Record<string, string> = {
                focus: "map.focus",
                mapFocus: "map.focus",
                drawRoute: "map.drawRoute",
                mapDrawRoute: "map.drawRoute",
                addMarkers: "map.addMarkers",
                mapAddMarkers: "map.addMarkers",
                elevationProfile: "elevation.profile",
                exportGpx: "export.gpx",
                places: "places.search",
                search: raw?.args?.query ? "rag.search" : "places.search",
            };
            tool = alias[t] ?? t;
        }

        // Coerce pause string → boolean
        if (typeof pauseForUser === "string") {
            pauseForUser = ["true", "yes", "pause"].includes(pauseForUser.toLowerCase());
        }

        if (!args || typeof args !== "object") args = {};

        // If still unknown tool and this step is only a pause, drop it gracefully.
        if (!allowed.has(tool as string)) {
            if (pauseForUser && !tool) continue;
        }

        fixed.push({ id, tool, args, why, pauseForUser });
    }

    const candidate = { ...obj, steps: fixed };
    const parsed = PlanSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
}

// lib/planner.ts (add near other helpers)
function normalizePauses(plan: Plan, mode: "first" | "none" | "keep" = "first"): Plan {
    if (mode === "keep") return plan;
    if (mode === "none") {
        return { ...plan, steps: plan.steps.map(s => ({ ...s, pauseForUser: false })) };
    }
    // mode === "first": keep the first true, drop the rest
    let seen = false;
    return {
        ...plan,
        steps: plan.steps.map(s => {
            if (s.pauseForUser && !seen) {
                seen = true;
                return s;
            }
            return { ...s, pauseForUser: false };
        }),
    };
}


/** Export the prompts for inspection/testing if desired */
export const plannerPrompts = { SYSTEM, DEV };
