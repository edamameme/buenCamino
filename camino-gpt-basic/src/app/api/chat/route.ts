import { NextRequest } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const SYSTEM = `You are Camino GPT — answer only about the Camino de Santiago.
Be concise and practical. Use town names, stages, distances, logistics, albergues, food, and safety.
If asked about non-Camino topics, gently redirect back to Camino.`;

export async function POST(req: NextRequest) {
  try {
    const { messages = [], preferences } = await req.json();

    // ✅ If preferences exist, add them into the system message
    const prefsLine = preferences
      ? "\n\nUser Preferences: " + compactPrefs(preferences)
      : "";
    const SYSTEM_WITH_PREFS = SYSTEM + prefsLine;

    const response = await openai.responses.create({
      model: MODEL,
      input: [{ role: "system", content: SYSTEM_WITH_PREFS }, ...messages],
    });

    // ✅ Prefer the SDK’s convenience field
    let text = (response as any).output_text as string | undefined;
    // Fallback: walk the output blocks
    if (!text) {
      text =
        response.output
          ?.map((b: any) =>
            (b.content ?? [])
              .map((c: any) => c?.text?.value)
              .filter(Boolean)
              .join("\n")
          )
          .filter(Boolean)
          .join("\n") ?? "";
    }

    // Final safeguard
    if (!text) text = "I couldn’t generate a reply. Try rephrasing or asking a Camino-specific question.";

    return Response.json({ reply: text });
  } catch (err: any) {
    const status = err?.status ?? 500;
    if (status === 429) {
      const retryAfter = err?.response?.headers?.get?.("retry-after");
      const hint = retryAfter ? ` Try again in ~${retryAfter}s.` : "";
      return Response.json(
        { error: "We hit the model’s quota/rate limit. Check plan/billing or limits in your OpenAI dashboard." + hint },
        { status }
      );
    }
    console.error("Chat route error:", err);
    return Response.json({ error: err?.message ?? "Unknown error" }, { status });
  }
}

function compactPrefs(p: any): string {
  const parts: string[] = [];
  if (p.unitSystem) parts.push(`Use ${p.unitSystem}.`);
  if (p.routeStyle) parts.push(`Favor ${p.routeStyle} routing.`);
  if (p.targetStageKm) parts.push(`Aim for ~${p.targetStageKm}${p.unitSystem === "miles" ? " miles" : " km"} stages.`);
  if (p.budget) parts.push(`Budget ${p.budget}.`);
  if (Array.isArray(p.albergueKinds) && p.albergueKinds.length) parts.push(`Stays: ${p.albergueKinds.join(", ")}.`);
  if (p.quietDormsPreferred) parts.push("Prefer quiet dorms.");
  if (p.privateRoomPreferred) parts.push("Prefer private rooms.");
  if (Array.isArray(p.dietary) && p.dietary.length && !p.dietary.includes("none")) parts.push(`Dietary: ${p.dietary.join(", ")}.`);
  if (Array.isArray(p.languageHelp) && p.languageHelp.length) parts.push(`Language help: ${p.languageHelp.join(" + ")}.`);
  if (p.otherNotes) parts.push(`Other: ${String(p.otherNotes)}`);
  return parts.join(" ");
}
