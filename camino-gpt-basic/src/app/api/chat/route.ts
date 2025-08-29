import { AgentAction } from "@/lib/agentActions";
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

        // 👇 NEW: naive route intent detection (last user message only)
        const lastUser =
            [...messages].reverse().find((m: any) => m.role === "user")?.content ?? "";
        const wantsRoute =
            /\b(route|stages?|itinerar|plan|walk from|walk to|day\s*\d)\b/i.test(lastUser) ||
            /\bfrom\s+\w+.*\bto\s+\w+/.test(lastUser);

        // 👇 NEW: optional actions + tool summary
        let actions: AgentAction[] = [];
        let toolSummary = "";

        if (wantsRoute) {
            const daysRequested =
                Number(lastUser.match(/\b(\d{1,2})\s*-?\s*day(s)?\b/i)?.[1] ?? "") || null;

            const route = planStagesStub(preferences, daysRequested);

            // GeoJSON uses [lon, lat]
            const geojson = {
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: route.coords.map(([lat, lon]) => [lon, lat]),
                },
                properties: { name: route.name, source: "stub" },
            };

            actions.push({ type: "drawRoute", geojson });
            // markers: one per coordinate (start → … → finish)
            const markers = route.coords.map(([lat, lon], i) => ({
                lat, lon,
                title: i === 0 ? "Start" : i === route.coords.length - 1 ? "Finish" : undefined,
                subtitle: i > 0 ? `Day ${i}` : undefined,
            }));
            actions.push({ type: "drawMarkers", markers });

            // (optional) focus camera on the start
            console.log("route : ", route.coords)
            actions.push({ type: "focus", lat: route.coords[0][0], lon: route.coords[0][1], zoom: 12 });
            toolSummary = route.summary;
        }

        // ✅ If preferences exist, add them into the system message
        const prefsLine = preferences
            ? "\n\nUser Preferences: " + compactPrefs(preferences)
            : "";
        const SYSTEM_WITH_PREFS = SYSTEM + prefsLine;
        // 👇 NEW: gently hint the model to incorporate the tool output

        const assistantNudge = toolSummary
            ? `\n\nROUTE SUMMARY (tool): ${toolSummary}`
            : "";

        const response = await openai.responses.create({
            model: MODEL,
            input: [
                { role: "system", content: SYSTEM_WITH_PREFS + assistantNudge },
                ...messages,
            ],
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
        if (!text) {
            text =
                "I couldn’t generate a reply. Try rephrasing or asking a Camino-specific question.";
        }

        // 👇 NEW: return actions along with the reply
        return Response.json({ reply: text, actions });
    } catch (err: any) {
        const status = err?.status ?? 500;
        if (status === 429) {
            const retryAfter = err?.response?.headers?.get?.("retry-after");
            const hint = retryAfter ? ` Try again in ~${retryAfter}s.` : "";
            return Response.json(
                {
                    error:
                        "We hit the model’s quota/rate limit. Check plan/billing or limits in your OpenAI dashboard." +
                        hint,
                },
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

function planStagesStub(preferences: any, daysRequested: number | null) {
    const days = Math.max(1, Math.min(30, daysRequested ?? 3)); // default 3, clamp 1–30
    const start: [number, number] = [42.8806, -8.5449]; // [lat, lon] Santiago
    const stepLat = 0.012, stepLon = -0.06;             // tiny shift per day

    const coords: [number, number][] = Array.from(
        { length: days + 1 },
        (_, i) => [start[0] + i * stepLat, start[1] + i * stepLon]
    );

    const name = `${days}-day demo route near Santiago`;
    const summary = `Planned a ${days}-day demo with ${days} legs.`
        + (preferences?.budget ? ` Budget: ${preferences.budget}.` : "")
        + (preferences?.routeStyle ? ` Style: ${preferences.routeStyle}.` : "");

    return { name, coords, summary };
}
