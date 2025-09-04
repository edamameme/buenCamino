// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import crypto from "node:crypto";

import { buildPlan } from "@/lib/planner";
import { validatePlan, executePlan, type StepLog } from "@/lib/executor";
import type { ToolContext } from "@/lib/toolRegistry";
import { recordPlan, appendSteps, getPlan } from "@/lib/obs";
import type { Itinerary } from "@/lib/itinerary"; // ← ensure this is a type import

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const now = () => Date.now();

// ⚠️ rename to avoid shadowing the executor "plan" below
const DEMO_ITINERARY: Itinerary = [
    { day: 1, from: "Sarria", to: "Portomarín", km: 22, lat: 42.7812, lon: -7.4143 },
    { day: 2, from: "Portomarín", to: "Palas de Rei", km: 25, lat: 42.8741, lon: -7.8687 },
    { day: 3, from: "Palas de Rei", to: "Melide", km: 15, lat: 42.9142, lon: -8.0129 },
    { day: 4, from: "Melide", to: "Arzúa", km: 14, lat: 42.9290, lon: -8.1585 },
    { day: 5, from: "Arzúa", to: "Santiago de Compostela", km: 39, lat: 42.8806, lon: -8.5449 },
];

function ok<T>(body: T) {
    return NextResponse.json(body);
}

async function withTimeout<T>(p: Promise<T>, ms: number, label = "op"): Promise<T> {
    return await Promise.race([
        p,
        new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ]);
}

// --- helpers to unify markers + expose a single itinerary to the client ---

type Marker = { lat: number; lon: number; title?: string; subtitle?: string };

// Combine multiple drawMarkers actions into one ordered marker list
function coalesceMarkers(actions: any[] | undefined | null): Marker[] | null {
    if (!Array.isArray(actions)) return null;
    const lists: Marker[][] = [];
    for (const a of actions) {
        if (a && a.type === "drawMarkers" && Array.isArray(a.markers)) {
            lists.push(a.markers as Marker[]);
        }
    }
    if (lists.length === 0) return null;

    // Prefer the last, but also merge to guard against chunked streams
    const seen = new Set<string>();
    const merged: Marker[] = [];
    for (const list of lists) {
        for (const m of list) {
            const key = `${m.lat.toFixed(4)},${m.lon.toFixed(4)}`;
            if (!seen.has(key)) {
                merged.push(m);
                seen.add(key);
            }
        }
    }
    return merged;
}

// Very light inference: build an Itinerary from markers when no explicit plan exists.
// We use previous title as "from", current as "to".
function itineraryFromMarkers(markers: Marker[]): Itinerary {
    return markers.map((m, i) => ({
        day: i + 1,
        from: i === 0 ? "Start" : (markers[i - 1]?.title ?? "Previous"),
        to: m.title ?? `Overnight ${i + 1}`,
        lat: m.lat,
        lon: m.lon,
        // Optional: parse km from subtitle like "Day N · 23 km"
        km: undefined,
        ascentM: undefined,
        notes: undefined,
    }));
}

// Build a single authoritative drawMarkers action from itinerary
function markersFromItinerary(plan: Itinerary): { type: "drawMarkers"; replace: true; markers: Marker[] } {
    return {
        type: "drawMarkers",
        replace: true as const,
        markers: plan.map((leg) => ({
            lat: leg.lat,
            lon: leg.lon,
            title: leg.to,
            subtitle: `Day ${leg.day}${leg.km ? ` · ${leg.km} km` : ""}`,
        })),
    };
}

export async function POST(req: NextRequest) {
    try {
        const {
            messages,
            preferences,
            approve,
            plan: planFromClient,
            planId: resumePlanId,
        } = await req.json();
        const reqStart = now();

        if (!Array.isArray(messages)) {
            return ok({ reply: "Missing or invalid messages array." });
        }

        // 1) Build or resume a plan (this is the *executor* plan with steps)
        let planId: string = resumePlanId ?? crypto.randomUUID();
        let execPlan: any;

        if (approve && (resumePlanId || planFromClient)) {
            const rec = resumePlanId ? getPlan(resumePlanId) : undefined;
            execPlan = rec?.plan ?? planFromClient;
            planId = resumePlanId ?? planId;

            try {
                execPlan = validatePlan(execPlan);
            } catch {
                return ok({
                    planId,
                    reply: "The approved plan was invalid or expired. Please ask again to rebuild.",
                });
            }
        } else {
            const tPlanner = now();

            const built = await withTimeout(
                buildPlan({
                    openai,
                    model: MODEL,
                    messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
                    preferences,
                }),
                12_000, // 30s planning cap 
                "planner"
            );
            try {
                console.log(`[planner] ok planId=${planId} ms=${now() - tPlanner}`);
                execPlan = validatePlan(built);
            } catch (e) {

                return ok({
                    planId,
                    reply: "I drafted a plan but validation failed. Please try rephrasing your ask.",
                });
            }
            console.log(`[api.chat] start planId=${planId} msgs=${Array.isArray(messages) ? messages.length : 0}`);
            const msgChars = Array.isArray(messages)
                ? messages.reduce((n: number, m: any) => n + (m?.content?.length ?? 0), 0)
                : 0;
            const prefChars = preferences ? JSON.stringify(preferences).length : 0;
            console.log(`[planner] input planId=${planId} msgChars=${msgChars} prefChars=${prefChars}`);

            recordPlan(planId, { plan: execPlan, model: MODEL, createdAt: Date.now(), steps: [] });
        }

        // 2) If planner wants a pause, return draft without executing
        const hasPause = Array.isArray(execPlan?.steps) && execPlan.steps.some((s: any) => s.pauseForUser);
        if (hasPause && !approve) {
            return ok({
                planId,
                draftPlan: execPlan,
                reply: "I prepared a draft plan. Review and approve to run.",
            });
        }

        // 3) Execute deterministically
        const ctx: ToolContext = {};
        const tExec = now();

        const result = await executePlan({
            plan: execPlan,
            ctx,
            timeoutMs: 10_000,
            maxRetries: 1,
            startIndex: 0,
            honorPause: !approve,
            prependClear: true,
        });
        console.log(
            `[executor] ok planId=${planId} ms=${now() - tExec} actions=${Array.isArray(result.actions) ? result.actions.length : 0} paused=${!!result.paused}`
        );
        appendSteps(planId, result.logs);

        // 4) Build an Itinerary for the client + a single authoritative drawMarkers
        // Preferred source of truth: if your planner already produces an itinerary, pluck it here.
        // Example: const itinerary: Itinerary | undefined = execPlan?.itinerary;
        let itinerary: Itinerary | null = (execPlan?.itinerary as Itinerary) ?? null;

        // Fallback A: infer from any drawMarkers the executor produced
        if (!itinerary) {
            const mergedMarkers = coalesceMarkers(result.actions);
            if (mergedMarkers && mergedMarkers.length >= 2) {
                itinerary = itineraryFromMarkers(mergedMarkers);
            }
        }

        // Fallback B: use demo itinerary if still none (dev mode)
        if (!itinerary) {
            itinerary = DEMO_ITINERARY;
        }

        // Coalesce to a single drawMarkers with replace:true, built from the itinerary
        const singleMarkersAction = markersFromItinerary(itinerary);

        // Preserve any non-marker actions (e.g., drawRoute, focus, clearRoute)
        const otherActions = Array.isArray(result.actions)
            ? result.actions.filter((a: any) => a?.type !== "drawMarkers")
            : [];

        const actionsOut = [...otherActions, singleMarkersAction];

        // 5) Reply string
        const reply =
            actionsOut.length > 0
                ? "Plotted map updates and listed your draft plan."
                : result.paused
                    ? "Plan is paused for your approval."
                    : "Completed your request.";

        return ok({
            planId,
            reply,
            plan: itinerary,     // <- 👈 expose Itinerary to the client
            actions: actionsOut, // <- 👈 exactly one drawMarkers with replace:true
        });
    } catch (e: any) {
        console.error("/api/chat error:", e?.message ?? e);
        return ok({
            reply: "Sorry—something went wrong while planning or executing. If it keeps happening, try a simpler request.",
        });
    }
}
