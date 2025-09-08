// components/Chat.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { PREFERENCES_STORAGE_KEY } from "@/lib/preferences";
import { AgentAction, emitAction } from "@/lib/agentActions";
import { postJsonWithRetry } from "@/lib/net";
import type { Plan } from "@/lib/schemas";          // executor plan (your existing type)
import type { Itinerary, Leg } from "@/lib/leg"; // NEW: itinerary for UI
import { formatDistanceWithUnit } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };

export default function Chat() {
  const [open, setOpen] = useState(false); // 👈 FAB -> takeover
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  // Executor draft (pause-for-user) — existing
  const [draftPlan, setDraftPlan] = useState<Plan | null>(null);
  const [draftPlanId, setDraftPlanId] = useState<string | null>(null);

  // NEW: authoritative itinerary coming back from /api/chat
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const [netStatus, setNetStatus] = useState<null | { phase: "sending" | "retrying"; attempt?: number }>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open, itinerary, draftPlan]); // scroll when itinerary/draft appears

  async function callChatApi(payload: any) {
    setNetStatus({ phase: "sending" });
    try {
      // 3 total attempts: 15s per attempt, exp backoff (0.8s, 1.6s)
      const data = await postJsonWithRetry<typeof payload, any>("/api/chat", payload, {
        timeoutMs: 100000,
        retries: 2,
        baseDelayMs: 800,
      });
      setNetStatus(null);
      return data;
    } catch (e) {
      setNetStatus(null);
      throw e;
    }
  }

  async function send() {
    const content = input.trim();
    if (!content || sending) return;
    setInput("");
    setSending(true);

    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);

    try {
      let preferences: any = undefined;
      try {
        const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
        if (raw) preferences = JSON.parse(raw);
      } catch {}

      const data = await callChatApi({ messages: next, preferences });

      setMessages((m) => [...m, { role: "assistant", content: data.reply || "(no reply)" }]);

      // Draft executor plan (pause-for-user) — existing behavior
      if (data?.draftPlan) {
        setDraftPlan(data.draftPlan as Plan);
        setDraftPlanId(data.planId || null);
      } else {
        setDraftPlan(null);
        setDraftPlanId(null);
      }

      // NEW: Store itinerary for the "Draft Plan" panel (Day 1..N)
      if (Array.isArray(data.plan)) {
        const sorted: Itinerary = data.plan
          .slice()
          .sort((a: Leg, b: Leg) => (a.day ?? 0) - (b.day ?? 0));
        setItinerary(sorted);
      } else {
        setItinerary(null);
      }

      // Map actions
      if (Array.isArray(data.actions)) {
        for (const a of data.actions as AgentAction[]) emitAction(a);
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Network is slow; I tried a few times and couldn’t reach the server. Please try again." },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function approveDraft() {
    if (!draftPlanId && !draftPlan) return;
    setSending(true);
    try {
      let preferences: any = undefined;
      try {
        const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
        if (raw) preferences = JSON.parse(raw);
      } catch {}

      const data = await callChatApi({
        messages,
        preferences,
        approve: true,
        planId: draftPlanId,
        plan: draftPlan,
      });

      setMessages((m) => [...m, { role: "assistant", content: data.reply || "(no reply)" }]);

      // When an approved run returns, also refresh itinerary if present
      if (Array.isArray(data.plan)) {
        const sorted: Itinerary = data.plan
          .slice()
          .sort((a: Leg, b: Leg) => (a.day ?? 0) - (b.day ?? 0));
        setItinerary(sorted);
      }

      if (Array.isArray(data.actions)) {
        for (const a of data.actions as AgentAction[]) emitAction(a);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Approval failed after retries—please try again." }]);
    } finally {
      setDraftPlan(null);
      setDraftPlanId(null);
      setSending(false);
    }
  }

  // --- Collapsed: Floating Action Button (bottom-right)
  if (!open) {
    return (
      <div className="fixed right-4 bottom-4 z-[11000]">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open chat"
          className="h-20 w-20 rounded-full bg-emerald-600 hover:bg-emerald-500 shadow-2xl border-4 border-emerald-700/50 grid place-items-center text-black text-4xl"
          title="Open Camino Chat"
        >
          💬
        </button>
      </div>
    );
  }

  // --- Takeover: full-screen on mobile; right drawer on desktop
  return (
    <div className="fixed inset-0 z-[11000]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />

      <div className="absolute inset-0 md:inset-y-0 md:right-0 md:inset-x-auto md:w-[min(640px,100vw)] bg-[#0f0f0f] border-l border-neutral-800 shadow-2xl flex flex-col">

        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <div className="font-medium">Camino Chat</div>
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg px-3 py-1.5 border border-neutral-700 hover:bg-neutral-900"
          >
            Close
          </button>
        </div>

        {/* messages + itinerary + draft */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-sm text-neutral-400">
              Ask anything Camino: stages, albergues, packing, food, logistics.
            </div>
          )}

          {/* NEW: Draft Itinerary panel (authoritative plan from server) */}
          {itinerary && (
            <div className="rounded-xl p-3 bg-neutral-900/70 border border-neutral-800">
              <div className="text-sm font-semibold mb-2">Draft Plan</div>
              <div className="grid gap-2">
                {itinerary.map((leg) => (
                  <div key={leg.day} className="flex items-start justify-between gap-3">
                    <div className="text-sm leading-tight">
                      <div className="font-medium">
                        Day {leg.day} — {leg.from} → {leg.to}
                      </div>
                      <div className="opacity-80 text-xs">
                        {formatDistanceWithUnit(leg.km)}
                        {leg.ascentM ? ` · +${leg.ascentM} m` : ""}
                      </div>
                      {leg.notes ? (
                        <div className="mt-1 text-xs opacity-80">
                          {Array.isArray(leg.notes) ? (
                            <ul className="list-disc pl-4">
                              {leg.notes.map((n, i) => <li key={i}>{n}</li>)}
                            </ul>
                          ) : (
                            <p>{leg.notes}</p>
                          )}
                        </div>
                      ) : null}
                    </div>
                    <button
                      className="shrink-0 rounded-md px-2 py-1 text-xs border border-neutral-700 hover:bg-neutral-800"
                      onClick={() => emitAction({ type: "focus", lat: leg.toLat, lon: leg.toLon, zoom: 13 } as AgentAction)}
                      title="Center map on this day"
                    >
                      Focus
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chat messages */}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`rounded-xl p-3 ${m.role === "user" ? "bg-neutral-800/80" : "bg-neutral-900/80"}`}
            >
              <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">{m.role}</div>
              <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
            </div>
          ))}

          {/* Network status */}
          {netStatus && (
            <div className="rounded-md border border-yellow-700/40 bg-yellow-900/20 px-2 py-1 text-xs text-yellow-300">
              {netStatus.phase === "sending"
                ? "Sending…"
                : `Retrying${typeof netStatus.attempt === "number" ? ` (attempt ${netStatus.attempt + 1})` : "…"}`
              }
            </div>
          )}

          {/* Existing DRAFT (executor) approval box, unchanged */}
          {draftPlan && (
            <div className="rounded-xl p-3 bg-amber-900/20 border border-amber-700/40">
              <div className="text-xs uppercase tracking-wide text-amber-400 mb-1">Draft plan</div>
              <div className="text-sm opacity-80 mb-2">
                Review and approve to run {draftPlan.steps.length} step{draftPlan.steps.length > 1 ? "s" : ""}.
              </div>

              <div className="text-xs mb-3 space-y-1">
                {draftPlan.steps.slice(0, 3).map((s, i) => {
                  let friendly: string = (s.tool as string);
                  const args: any = s.args || {};

                  if (s.tool === "map.focus" && args.label) {
                    friendly = `focus: ${args.label}`;
                  } else if (s.tool === "map.drawRoute" && args.meta && (args.meta.startName || args.meta.endName)) {
                    friendly = `route: ${args.meta.startName ?? "?"} → ${args.meta.endName ?? "?"}`;
                  }
                  return (
                    <div key={s.id} className="opacity-70">
                      <span className="font-mono">{i + 1}.</span> <span>{friendly}</span>
                      {s.pauseForUser && <span className="ml-2 text-amber-400">(pause)</span>}
                      {s.why && <div className="text-[11px] opacity-60">{s.why}</div>}
                    </div>
                  );
                })}
                {draftPlan.steps.length > 3 && (
                  <div className="opacity-50">…and {draftPlan.steps.length - 3} more</div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={approveDraft}
                  className="rounded-lg px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60"
                  disabled={sending}
                >
                  {sending ? "Running…" : "Approve & Run"}
                </button>
                <button
                  onClick={() => { setDraftPlan(null); setDraftPlanId(null); }}
                  className="rounded-lg px-3 py-1.5 border border-neutral-700 hover:bg-neutral-900"
                  disabled={sending}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="p-3 border-t border-neutral-800"
        >
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-xl bg-neutral-900 border border-neutral-700 px-3 py-3 outline-none focus:ring-2 focus:ring-emerald-500/60"
              placeholder="e.g., 5-day Camino from Sarria with seafood stops"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              type="submit"
              disabled={sending}
              className="rounded-xl px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
