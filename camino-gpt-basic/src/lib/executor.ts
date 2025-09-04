// lib/executor.ts
import { PlanSchema, type Plan, type PlanStepT } from "@/lib/schemas";
import { runTool, type ToolKey, type ToolContext } from "@/lib/toolRegistry";

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
    /** Start from this step index (for resume flows). Default 0. */
    startIndex?: number;
    /** Skip steps whose id is in this set (idempotency). */
    alreadyExecuted?: Set<string>;
    /** Stop at this many steps even if plan has more. Defaults to plan.budget?.maxSteps or all. */
    hardMaxSteps?: number;
    /** Timeout per tool call. Default 10s. */
    timeoutMs?: number;
    /** Retries per tool call. Default 1 retry (total 2 attempts). */
    maxRetries?: number;
    /** if true, stop before pause steps; if false, ignore pauseForUser and keep going. */
    honorPause?: boolean; // default true
    prependClear?: boolean; // NEW: default true

};

export type ExecuteResult = {
    /** Collected UI actions to pass to emitAction on the client. */
    actions: any[];
    /** Index of the last step we attempted (+1 means next index to run). */
    nextIndex: number;
    /** True if we hit a step with pauseForUser before execution. */
    paused: boolean;
    /** Per-step logs */
    logs: StepLog[];
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

/**
 * Execute plan steps deterministically, honoring pauseForUser, timeouts, retries, and budgets.
 * - Does NOT emit actions. It only returns them.
 * - Idempotent-friendly: pass alreadyExecuted set of step IDs to skip.
 */
export async function executePlan(opts: ExecuteOptions): Promise<ExecuteResult> {
    const {
        plan,
        ctx,
        startIndex = 0,
        alreadyExecuted,
        timeoutMs = 10_000,
        maxRetries = 1,
        honorPause = true, // NEW default
        prependClear = true,
    } = opts;

    const budgetedMax = plan.budget?.maxSteps ?? plan.steps.length;
    const hardMax = Math.min(
        typeof opts.hardMaxSteps === "number" ? opts.hardMaxSteps : plan.steps.length,
        plan.steps.length,
        budgetedMax
    );

    const actions: any[] = [];
    const logs: StepLog[] = [];

    // Respect or ignore pause depending on honorPause
    const pauseIdx = honorPause ? findPauseIndex(plan, startIndex) : -1;
    const finalStopExclusive = pauseIdx >= 0 ? pauseIdx : plan.steps.length;
    const stopAt = Math.min(finalStopExclusive, startIndex + hardMax);
    if (prependClear && startIndex === 0) {
        actions.push({ type: "clearRoute" });
    }
    let i = startIndex;
    for (; i < stopAt; i++) {
        const step = plan.steps[i];
        if (alreadyExecuted?.has(step.id)) {
            logs.push({ idx: i, id: step.id, tool: step.tool, status: "skipped", latencyMs: 0 });
            continue;
        }

        const toolName = step.tool as ToolKey;
        let attempt = 0;
        let success = false;
        let errorMsg: string | undefined;
        const t0 = Date.now();

        while (attempt <= maxRetries && !success) {
            try {
                const res = await withTimeout(runTool(toolName, step.args, ctx), timeoutMs);
                if (Array.isArray(res.uiActions)) actions.push(...res.uiActions);
                success = true;
                logs.push({ idx: i, id: step.id, tool: step.tool, status: "ok", latencyMs: Date.now() - t0 });
            } catch (e: any) {
                errorMsg = e?.message ?? String(e);
                attempt++;
                if (attempt > maxRetries) {
                    logs.push({
                        idx: i, id: step.id, tool: step.tool, status: "error",
                        latencyMs: Date.now() - t0, errorCode: errorMsg,
                    });
                    return { actions, nextIndex: i, paused: false, logs };
                }
            }
        }
    }

    return {
        actions,
        nextIndex: i,
        paused: honorPause && pauseIdx >= 0 && i === pauseIdx, // only “paused” if we honored pause
        logs,
    };
}