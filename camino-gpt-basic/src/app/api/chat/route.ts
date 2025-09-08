// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import crypto from "node:crypto";

import { buildPlan } from "@/lib/planner";
import { validatePlan, executePlan } from "@/lib/executor";
import type { ToolContext } from "@/lib/toolRegistry";
import { recordPlan, appendSteps, getPlan } from "@/lib/obs";
import type { Itinerary } from "@/lib/leg";
import { formatDistanceWithUnit } from "@/lib/utils";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const now = () => Date.now();

/** Fast fallback for timeouts / bad model minutes */
const DEMO_ITINERARY: Itinerary = [
    { day: 1, from: "Sarria", to: "Portomarín", km: 22, toLat: 42.7812, toLon: -7.4143 },
    //   { day: 2, from: "Portomarín", to: "Palas de Rei", km: 25, lat: 42.8741, lon: -7.8687 },
    //   { day: 3, from: "Palas de Rei", to: "Melide", km: 15, lat: 42.9142, lon: -8.0129 },
    //   { day: 4, from: "Melide", to: "Arzúa", km: 14, lat: 42.9290, lon: -8.1585 },
    { day: 2, from: "Arzúa", to: "Santiago de Compostela", km: 39, toLat: 42.8806, toLon: -8.5449 },
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

/** — helpers to unify markers + expose a single itinerary to the client — */

type Marker = { lat: number; lon: number; title?: string; subtitle?: string };

function coalesceMarkers(actions: any[] | undefined | null): Marker[] | null {
    if (!Array.isArray(actions)) return null;
    const lists: Marker[][] = [];
    for (const a of actions) {
        if (a && a.type === "drawMarkers" && Array.isArray(a.markers)) {
            lists.push(a.markers as Marker[]);
        }
    }
    if (lists.length === 0) return null;

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

function itineraryFromMarkers(markers: Marker[]): Itinerary {
    return markers.map((m, i) => ({
        day: i + 1,
        from: i === 0 ? "Start" : (markers[i - 1]?.title ?? "Previous"),
        to: m.title ?? `Overnight ${i + 1}`,
        toLat: m.lat,
        toLon: m.lon,
        km: undefined,
        ascentM: undefined,
        notes: undefined,
    }));
}

function markersFromItinerary(plan: Itinerary): { type: "drawMarkers"; replace: true; markers: Marker[] } {
    const markers: Marker[] = [];
    
    // Add Day 0 starting marker if we have starting coordinates
    console.log ("FROMLAT ", plan[0]);
    if (plan.length > 0 && plan[0].fromLat !== undefined && plan[0].fromLon !== undefined) {
        markers.push({
            lat: plan[0].fromLat,
            lon: plan[0].fromLon,
            title: plan[0].from,
            subtitle: "Day 0 · Start",
        });
    }
    
    // Add destination markers for each day
    for (const leg of plan) {
        markers.push({
            lat: leg.toLat,
            lon: leg.toLon,
            title: leg.to,
            subtitle: `Day ${leg.day}${leg.km ? ` · ${formatDistanceWithUnit(leg.km, "")}` : ""}`,
        });
    }
    
    return {
        type: "drawMarkers",
        replace: true as const,
        markers,
    };
}

export async function POST(req: NextRequest) {
    try {
        const { messages, preferences, approve, plan: planFromClient, planId: resumePlanId } = await req.json();
        const reqStart = now();

        if (!Array.isArray(messages)) {
            return ok({ reply: "Missing or invalid messages array." });
        }

        let planId: string = resumePlanId ?? crypto.randomUUID();
        let execPlan: any;

        console.log(`[api.chat] start planId=${planId} msgs=${messages.length}`);
        const msgChars = messages.reduce((n: number, m: any) => n + (m?.content?.length ?? 0), 0);
        const prefChars = preferences ? JSON.stringify(preferences).length : 0;
        console.log(`[planner] input planId=${planId} msgChars=${msgChars} prefChars=${prefChars}`);

        // 1) Build or resume the executor plan
        if (approve && (resumePlanId || planFromClient)) {
            const rec = resumePlanId ? getPlan(resumePlanId) : undefined;
            execPlan = rec?.plan ?? planFromClient;
            planId = resumePlanId ?? planId;

            try {
                execPlan = validatePlan(execPlan);
            } catch {
                return ok({ planId, reply: "The approved plan was invalid or expired. Please ask again to rebuild." });
            }
        } else {
            const tPlanner = now();
            const ac = new AbortController();

            try {
                const built = await withTimeout(
                    buildPlan({
                        openai,
                        model: MODEL,
                        messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
                        preferences,
                        signal: ac.signal, // ← true upstream abort if we time out
                    }),
                    20_000, // increased timeout for planner
                    "planner"
                );
                console.log(`[planner] ok planId=${planId} ms=${now() - tPlanner}`);
                execPlan = validatePlan(built);
                recordPlan(planId, { plan: execPlan, model: MODEL, createdAt: Date.now(), steps: [] });
            } catch (e: any) {
                try { ac.abort(); } catch { }
                console.warn(`[planner] error planId=${planId} ms=${now() - tPlanner} err=${String(e)}`);

                // ⛑️ Fast fallback: return pins + a usable plan immediately
                const plan = DEMO_ITINERARY;
                return ok({
                    planId,
                    reply: "I generated a quick draft plan to keep things moving. You can refine it with another prompt.",
                    plan,
                    actions: [markersFromItinerary(plan)],
                });
            }
        }

        // 2) If planner wants a pause, return draft without executing
        const hasPause = Array.isArray(execPlan?.steps) && execPlan.steps.some((s: any) => s.pauseForUser);
        if (hasPause && !approve) {
            console.log(`[planner] paused planId=${planId}`);
            return ok({ planId, draftPlan: execPlan, reply: "I prepared a draft plan. Review and approve to run." });
        }

        // 3) Execute deterministically
        console.log(`[debug] About to execute plan with ${execPlan?.steps?.length || 0} steps:`, 
                   execPlan?.steps?.map((s: any) => s.tool) || []);
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

        // ✅ Prefer tool-produced itinerary (executor result), not the plan
        let itinerary: Itinerary | null = (result.itinerary as Itinerary) ?? null;
        console.log(`[debug] result.itinerary:`, result.itinerary);
        console.log(`[debug] itinerary after cast:`, itinerary);

        // Helper: does every leg have coords?
        const hasCoords = (it: Itinerary | null) =>
            Array.isArray(it) && it.length > 0 && it.every(d => typeof d?.toLat === "number" && typeof d?.toLon === "number");

        // Merge any markers the executor produced
        const mergedMarkers = coalesceMarkers(result.actions);
        console.log(`[debug] mergedMarkers:`, mergedMarkers);

        // If we either have no itinerary or it's missing coords, try marker-derived itinerary
        if (!itinerary || !hasCoords(itinerary)) {
            if (mergedMarkers && mergedMarkers.length >= 2) {
                const inferred = itineraryFromMarkers(mergedMarkers);
                console.log(`[debug] inferred itinerary from markers:`, inferred);
                
                // Only use marker-derived itinerary if we have no proper itinerary at all
                // Don't override a valid multi-day itinerary with a bad marker-derived one
                if (!itinerary) {
                    itinerary = inferred;
                } else if (!hasCoords(itinerary)) {
                    // We have an itinerary structure but missing coords
                    // Only fill coords if the inferred one looks reasonable (different destinations)
                    const hasVariedDestinations = inferred.length > 1 && 
                        new Set(inferred.map(leg => leg.to)).size > 1;
                    
                    if (hasVariedDestinations && inferred.length === itinerary.length) {
                        itinerary = itinerary.map((leg, i) => ({
                            ...leg,
                            toLat: inferred[i].toLat,
                            toLon: inferred[i].toLon,
                        }));
                    }
                    // If inferred doesn't look good, keep original without overriding
                }
            }
        }

        // Fallback B: demo itinerary (dev safety net)
        if (!itinerary) {
            console.log("[debug] Fallback B triggered - using demo itinerary");
            itinerary = DEMO_ITINERARY;
        } else {
            console.log(`[debug] Using itinerary with ${itinerary.length} legs`);
        }

        // Only synthesize a single drawMarkers from itinerary if it has coords;
        // otherwise keep existing actions' markers (so we don't emit invalid markers).
        let actionsOut: any[] = [];
        if (hasCoords(itinerary)) {
            const singleMarkersAction = markersFromItinerary(itinerary);
            const otherActions = Array.isArray(result.actions)
                ? result.actions.filter((a: any) => a?.type !== "drawMarkers")
                : [];
            actionsOut = [...otherActions, singleMarkersAction];
        } else {
            actionsOut = Array.isArray(result.actions) ? result.actions : [];
        }

        const reply =
            actionsOut.length > 0
                ? "Plotted map updates and listed your draft plan."
                : result.paused
                    ? "Plan is paused for your approval."
                    : "Completed your request.";

        console.log(`[api.chat] done planId=${planId} ms=${now() - reqStart}`);

        return ok({
            planId,
            reply,
            plan: itinerary,      // expose Itinerary to the client
            actions: actionsOut,  // exactly one drawMarkers with replace:true when we have coords
        });

    } catch (e: any) {
        console.error("/api/chat error:", e?.message ?? e);
        return ok({
            reply: "Sorry—something went wrong while planning or executing. If it keeps happening, try a simpler request.",
        });
    }
}
