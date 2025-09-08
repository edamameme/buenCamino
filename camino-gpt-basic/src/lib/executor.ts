// lib/executor.ts
import { PlanSchema, type Plan, type PlanStepT } from "@/lib/schemas";
import { runTool, type ToolKey, type ToolContext } from "@/lib/toolRegistry";

/** NEW: simple itinerary type */
type ItinDay = { day: number; from?: string; to?: string; distanceKm?: number; note?: string };

/** Per-step execution log for observability / debugging */
export type StepLog = {
  idx: number;
  id: string;
  tool: string;
  status: "ok" | "error" | "skipped";
  latencyMs: number;
  errorCode?: string;
};

export type ExecuteOptions = {
  plan: Plan;
  ctx: ToolContext;
  startIndex?: number;
  alreadyExecuted?: Set<string>;
  hardMaxSteps?: number;
  timeoutMs?: number;
  maxRetries?: number;
  honorPause?: boolean; // default true
  prependClear?: boolean; // default true
};

export type ExecuteResult = {
  actions: any[];
  nextIndex: number;
  paused: boolean;
  logs: StepLog[];
  /** NEW: optional itinerary collected from tools or plan */
  itinerary?: ItinDay[] | null;
};

/** Validate a raw plan shape and return a typed Plan (throws on invalid). */
export function validatePlan(plan: unknown): Plan {
  const parsed = PlanSchema.safeParse(plan);
  if (!parsed.success) throw new Error(parsed.error.toString());
  return parsed.data;
}

/** Returns true if any step at or after startIndex is marked pauseForUser. */
export function planHasPause(plan: Plan, startIndex = 0) {
  return plan.steps.slice(startIndex).some((s) => s.pauseForUser);
}

/** Find the index of the first paused step at or after startIndex (or -1). */
export function findPauseIndex(plan: Plan, startIndex = 0) {
  const idx = plan.steps.slice(startIndex).findIndex((s) => s.pauseForUser);
  return idx < 0 ? -1 : startIndex + idx;
}

/** Internal: timeout wrapper for tool promises */
async function withTimeout<T>(p: Promise<T>, ms: number) {
  return await Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

/** NEW: extract itinerary from a drawRoute step’s args if present */
function extractItineraryFromPlan(plan: Plan): ItinDay[] | null {
  const step = plan.steps.find((s) => s.tool === "map.drawRoute");
  if (!step || !step.args) return null;
  const a: any = step.args;

  // Accept either stages: [{stage:"A to B", distance?}] OR [{from,to,distanceKm?}]
  if (Array.isArray(a.stages) && a.stages.length) {
    const itinerary = [];
    let previousTo: string | undefined;

    for (let i = 0; i < a.stages.length; i++) {
      const st = a.stages[i];
      let from: string | undefined;
      let to: string | undefined;

      // Parse from stage string format first
      if (typeof st.stage === "string" && st.stage.includes(" to ")) {
        const [f, t] = st.stage.split(" to ");
        from = (f || "").trim();
        to = (t || "").trim();
      } else {
        // Use explicit from/to properties
        from = st.from;
        to = st.to;
      }

      // Apply fallbacks and chaining logic
      if (!from) {
        if (i === 0) {
          from = a.start; // First stage: use plan start
        } else {
          from = previousTo; // Chain from previous stage's destination
        }
      }

      if (!to) {
        if (i === a.stages.length - 1) {
          to = a.end; // Last stage: use plan end
        }
        // For non-last stages without explicit 'to', we can't infer it
      }

      const distanceKm =
        typeof st.distanceKm === "number" ? st.distanceKm :
        typeof st.distance === "number" ? st.distance : undefined;

      itinerary.push({ 
        day: i + 1, 
        from: from || "Unknown", 
        to: to || "Unknown", 
        distanceKm 
      });

      previousTo = to; // Track for next stage's chaining
    }

    return itinerary;
  }

  // fallback if start/end only
  if (a.start || a.end) return [{ day: 1, from: a.start, to: a.end }];
  return null;
}

/**
 * Execute plan steps deterministically, honoring pauseForUser, timeouts, retries, and budgets.
 */
export async function executePlan(opts: ExecuteOptions): Promise<ExecuteResult> {
  const {
    plan,
    ctx,
    startIndex = 0,
    alreadyExecuted,
    timeoutMs = 10_000,
    maxRetries = 1,
    honorPause = true,
    prependClear = true,
  } = opts;

  const hardMax = Math.min(
    typeof opts.hardMaxSteps === "number" ? opts.hardMaxSteps : plan.steps.length,
    plan.steps.length
  );

  const actions: any[] = [];
  const logs: StepLog[] = [];
  let itinerary: ItinDay[] | null = null; // NEW

  const pauseIdx = honorPause ? findPauseIndex(plan, startIndex) : -1;
  const finalStopExclusive = pauseIdx >= 0 ? pauseIdx : plan.steps.length;
  const stopAt = Math.min(finalStopExclusive, startIndex + hardMax);
  console.log(`[debug] Executor: honorPause=${honorPause}, pauseIdx=${pauseIdx}, stopAt=${stopAt}, planLength=${plan.steps.length}`);

  if (prependClear && startIndex === 0) actions.push({ type: "clearRoute" });

  let i = startIndex;
  for (; i < stopAt; i++) {
    const step = plan.steps[i];
    console.log(`[debug] Executing step ${i}: ${step.tool} (id: ${step.id})`);
    
    if (alreadyExecuted?.has(step.id)) {
      console.log(`[debug] Step ${i} already executed, skipping`);
      logs.push({ idx: i, id: step.id, tool: step.tool, status: "skipped", latencyMs: 0 });
      continue;
    }

    const toolName = step.tool as ToolKey;
    let attempt = 0;
    let success = false;
    let errorMsg: string | undefined;
    const t0 = Date.now();

    console.log(`[debug] Starting tool execution: ${toolName} with args:`, JSON.stringify(step.args, null, 2));
    while (attempt <= maxRetries && !success) {
      try {
        console.log(`[debug] Tool ${toolName} attempt ${attempt + 1}`);
        // Expect tools may return { uiActions, itinerary? }
        const res: any = await withTimeout(runTool(toolName, step.args, ctx), timeoutMs);
        console.log(`[debug] Tool ${toolName} returned:`, { 
          hasUiActions: Array.isArray(res?.uiActions), 
          hasItinerary: Array.isArray(res?.itinerary),
          itineraryLength: res?.itinerary?.length,
          fullResult: res.toString()
        });

        if (Array.isArray(res?.uiActions)) {
          console.log(`[debug] Adding ${res.uiActions.length} UI actions`);
          actions.push(...res.uiActions);
        }
        if (Array.isArray(res?.itinerary)) {
          console.log(`[debug] Setting itinerary with ${res.itinerary.length} legs`);
          itinerary = res.itinerary; // NEW: prefer tool-provided
        }

        success = true;
        console.log(`[debug] Tool ${toolName} completed successfully`);
        logs.push({ idx: i, id: step.id, tool: step.tool, status: "ok", latencyMs: Date.now() - t0 });
      } catch (e: any) {
        errorMsg = e?.message ?? String(e);
        console.log(`[debug] Tool ${toolName} failed, attempt ${attempt + 1}:`, errorMsg);
        attempt++;
        if (attempt > maxRetries) {
          console.log(`[debug] Tool ${toolName} failed permanently, stopping executor`);
          logs.push({
            idx: i, id: step.id, tool: step.tool, status: "error",
            latencyMs: Date.now() - t0, errorCode: errorMsg,
          });
          return { actions, nextIndex: i, paused: false, logs, itinerary };
        }
      }
    }
  }

  console.log(`[debug] Executor finished. Final state:`, {
    executedSteps: i,
    totalActions: actions.length,
    hasItinerary: !!itinerary,
    itineraryLength: itinerary?.length
  });

  // If no tool produced one, try to derive from the plan once
  if (!itinerary) {
    console.log(`[debug] No itinerary from tools, trying to extract from plan`);
    itinerary = extractItineraryFromPlan(plan);
    console.log(`[debug] Extracted itinerary:`, { hasItinerary: !!itinerary, length: itinerary?.length });
    if (itinerary) {
      console.log(`[debug] Extracted itinerary details:`, itinerary.map(leg => ({ day: leg.day, from: leg.from, to: leg.to, km: leg.distanceKm })));
    }
  }

  return {
    actions,
    nextIndex: i,
    paused: honorPause && pauseIdx >= 0 && i === pauseIdx,
    logs,
    itinerary, // NEW
  };
}
