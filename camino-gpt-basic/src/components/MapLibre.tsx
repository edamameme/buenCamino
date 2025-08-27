"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Status = "loading" | "ready" | "error";

export default function MapLibre() {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;

    try {
      const map = new maplibregl.Map({
        container: ref.current,
        // Try either of these styles; uncomment the one you want.
        style: "https://tiles.openfreemap.org/styles/positron",
        // style: "https://demotiles.maplibre.org/style.json",
        center: [-8.5449, 42.8806], // Santiago
        zoom: 11,
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }));

      map.on("load", () => setStatus("ready"));
      map.on("error", (e) => {
        const msg = String((e as any)?.error?.message ?? "Map error");
        console.warn("MapLibre error:", msg);
        setErr(msg);
        setStatus("error");
      });

      // Handle WebGL context loss/restoration without using extra MapOptions flags
      const canvas = map.getCanvas();
      const onLost = (ev: Event) => {
        ev.preventDefault();      // allow restoration attempt
        setStatus("loading");
      };
      const onRestored = () => {
        map.resize();
        setStatus("ready");
      };
      canvas.addEventListener("webglcontextlost", onLost, false);
      canvas.addEventListener("webglcontextrestored", onRestored, false);

      mapRef.current = map;
      return () => {
        canvas.removeEventListener("webglcontextlost", onLost);
        canvas.removeEventListener("webglcontextrestored", onRestored);
        map.remove();
      };
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setStatus("error");
    }
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        inset: 0,
        background:
          status === "ready"
            ? "#000" // will be covered by the canvas
            : "repeating-linear-gradient(45deg,#0e0e0e 0 12px,#121212 12px 24px)",
      }}
    >
      {/* status badge */}
      <div
        style={{
          position: "absolute",
          left: 12,
          top: 12,
          fontSize: 12,
          padding: "4px 8px",
          borderRadius: 6,
          background:
            status === "ready"
              ? "rgba(24,160,88,0.85)"
              : status === "error"
              ? "rgba(200,60,60,0.85)"
              : "rgba(100,100,100,0.85)",
        }}
      >
        {status === "ready" ? "Map ready" : status === "error" ? "Map error" : "Loading map…"}
      </div>

      {status === "error" && err && (
        <div
          style={{
            position: "absolute",
            left: 12,
            top: 40,
            maxWidth: 420,
            padding: "6px 8px",
            fontSize: 12,
            background: "rgba(0,0,0,0.6)",
            border: "1px solid #333",
            borderRadius: 6,
          }}
        >
          {err}
        </div>
      )}
    </div>
  );
}
