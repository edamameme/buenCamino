// components/Chat.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { PREFERENCES_STORAGE_KEY } from "@/lib/preferences";
import { AgentAction, emitAction } from "@/lib/agentActions";

type Msg = { role: "user" | "assistant"; content: string };

export default function Chat() {
    const [open, setOpen] = useState(false); // 👈 FAB -> takeover
    const [messages, setMessages] = useState<Msg[]>([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    }, [messages, open]);

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
            } catch { }

            const res = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: next, preferences }),
            });
            console.log("Sending payload:", { messages: next, preferences });

            const data = await res.json();
            console.log("[/api/chat] incoming:", data);

            setMessages((m) => [...m, { role: "assistant", content: data.reply || "(no reply)" }]);
            if (Array.isArray(data.actions)) {
                for (const a of data.actions as AgentAction[]) emitAction(a);
            }
        } catch {
            setMessages((m) => [
                ...m,
                { role: "assistant", content: "Sorry—something went wrong contacting the model." },
            ]);
        } finally {
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

                {/* messages */}
                <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                    {messages.length === 0 && (
                        <div className="text-sm text-neutral-400">
                            Ask anything Camino: stages, albergues, packing, food, logistics.
                        </div>
                    )}
                    {messages.map((m, i) => (
                        <div
                            key={i}
                            className={`rounded-xl p-3 ${m.role === "user" ? "bg-neutral-800/80" : "bg-neutral-900/80"}`}
                        >
                            <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">{m.role}</div>
                            <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                        </div>
                    ))}
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
                            onKeyDown={(e) => (e.key === "Enter" && !e.shiftKey ? send() : undefined)}
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
