// lib/obs.ts
import type { Plan } from "@/lib/schemas";
import type { StepLog } from "@/lib/executor";

export type PlanRecord = {
  plan: Plan;
  model: string;
  createdAt: number;       // epoch ms
  steps: StepLog[];        // execution logs (append-only)
};

// In-memory store (per server instance). Replace with Supabase later.
const store = new Map<string, PlanRecord>();

export function recordPlan(planId: string, rec: PlanRecord) {
  store.set(planId, { ...rec, steps: rec.steps ?? [] });
}

export function appendSteps(planId: string, logs: StepLog[]) {
  const rec = store.get(planId);
  if (!rec) return;
  rec.steps.push(...logs);
}

export function getPlan(planId: string): PlanRecord | undefined {
  return store.get(planId);
}

// optional: lightweight list for manual QA (do NOT expose in prod)
export function listRecent(limit = 20): Array<{ planId: string; createdAt: number; model: string }> {
  return Array.from(store.entries())
    .map(([planId, r]) => ({ planId, createdAt: r.createdAt, model: r.model }))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}
