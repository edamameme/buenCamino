"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

// Lazy-load the map on the client (MapLibre needs the browser)
const Map = dynamic(() => import("@/components/Map"), { ssr: false });

type Msg = { role: "user" | "assistant"; content: string };

export default function HomePage() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "¡Buen Camino! Ask about a stage or an albergue." },
  ]);
  const [input, setInput] = useState("");

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setTimeout(() => {
      // inside send()
      (async () => {
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message: text }),
          });
          const data = (await res.json()) as { reply?: string };
          setMessages((prev) => [...prev, { role: "assistant", content: data.reply ?? "(no reply)" }]);
        } catch (e: any) {
          setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${e?.message ?? e}` }]);
        }
      })();
    }, 200);
  };

  return (
    <main style={{ position: "relative", height: "100dvh", width: "100dvw" }}>
      <Map />

      {/* Chat dock */}
      <div
        style={{
          position: "absolute",
          right: 16,
          bottom: 16,
          width: 360,
          maxWidth: "95vw",
          background: "#151515",
          border: "1px solid #262626",
          borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 12, fontWeight: 600 }}>Camino GPT</div>

        <div
          style={{
            padding: 12,
            gap: 8,
            display: "flex",
            flexDirection: "column",
            overflow: "auto",
            maxHeight: 360,
          }}
        >
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                background: m.role === "user" ? "#1e1e1e" : "#0f0f0f",
                border: "1px solid #2a2a2a",
                borderRadius: 8,
                padding: "8px 10px",
                whiteSpace: "pre-wrap",
                fontSize: 14,
              }}
            >
              <span style={{ color: "#bdbdbd", fontWeight: 600, marginRight: 8 }}>
                {m.role === "user" ? "You" : "Guide"}
              </span>
              {m.content}
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid #262626" }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about stages, albergues, tips…"
            style={{
              flex: 1,
              background: "#0f0f0f",
              color: "#eaeaea",
              border: "1px solid #2a2a2a",
              borderRadius: 8,
              padding: "10px 12px",
            }}
          />
          <button
            type="submit"
            style={{
              background: "#2f6fed",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "0 14px",
              fontWeight: 600,
            }}
          >
            Send
          </button>
        </form>
      </div>
    </main>
  );
}
