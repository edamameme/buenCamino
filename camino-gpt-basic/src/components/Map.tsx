"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import { AgentAction } from "@/lib/agentActions";

// Provide Leaflet's marker icon URLs as plain strings (not StaticImageData).
// Using import.meta.url ensures a correct URL in Next.js bundling.
const iconRetinaUrl = new URL("leaflet/dist/images/marker-icon-2x.png", import.meta.url).toString();
const iconUrl = new URL("leaflet/dist/images/marker-icon.png", import.meta.url).toString();
const shadowUrl = new URL("leaflet/dist/images/marker-shadow.png", import.meta.url).toString();

// Merge defaults so every L.marker() uses the right assets
L.Icon.Default.mergeOptions({
  iconRetinaUrl,
  iconUrl,
  shadowUrl,
});

export default function Map() {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return undefined;

    // Center on Santiago de Compostela
    const map = L.map(ref.current, {
      center: [42.8806, -8.5449],
      zoom: 11,
      zoomControl: true,
      preferCanvas: true,
    });

    // Stable, free OSM tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    // Example marker
    L.marker([42.8806, -8.5449]).addTo(map).bindPopup("Santiago de Compostela");

    // ✅ Ensure Leaflet measures after paint to avoid “black until resize”
    const invalidate = () => map.invalidateSize();
    const t = setTimeout(invalidate, 0);
    window.addEventListener("resize", invalidate);

    mapRef.current = map;
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", invalidate);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 👇 NEW: listen for agent actions and draw/clear/focus on the map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let routeLayer: L.GeoJSON | null = null;
    let markersGroup: L.LayerGroup | null = null; // 👈 add this next to routeLayer

    function handleAction(ev: Event) {
      const detail = (ev as CustomEvent<AgentAction>).detail

      if (!detail || typeof detail !== "object" || !("type" in detail)) return;
      if (!map) return null;

      if (detail.type === "clearRoute") {
        if (routeLayer) {
          map.removeLayer(routeLayer);
          routeLayer = null;
        }
        if (markersGroup) { map.removeLayer(markersGroup); markersGroup = null; } // 👈 clear pins too

        return;
      }

      if (detail.type === "focus") {
        map.setView([detail.lat, detail.lon], detail.zoom ?? Math.max(map.getZoom(), 12));
        return;
      }

      if (detail.type === "drawRoute") {
        // replace existing route
        if (routeLayer) {
          map.removeLayer(routeLayer);
          routeLayer = null;
        }

        routeLayer = L.geoJSON(detail.geojson as any, {
          style: () => ({
            weight: 5,
            opacity: 0.9,
          }),
        }).addTo(map);

        // fit the map to the route
        try {
          const bounds = routeLayer.getBounds();
          if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
        } catch { }
      }
      if (detail.type === "drawMarkers") {
        if (markersGroup) { map.removeLayer(markersGroup); markersGroup = null; }
        markersGroup = L.layerGroup().addTo(map);

        detail.markers.forEach((m, idx) => {
          L.marker([m.lat, m.lon])
            .addTo(markersGroup!)
            .bindPopup(
              `<div style="font-weight:600">Day ${idx + 1}${m.title ? ` — ${m.title}` : ""}</div>` +
              (m.subtitle ? `<div style="opacity:.8">${m.subtitle}</div>` : "")
            );
        });
        }
      }
  
      window.addEventListener("camino:action", handleAction as EventListener);
      return () => {
        window.removeEventListener("camino:action", handleAction as EventListener);
        if (routeLayer) {
          map.removeLayer(routeLayer);
          routeLayer = null;
        }
        if (markersGroup) {
          map.removeLayer(markersGroup);
          markersGroup = null;
        }
      };
    }, []);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        inset: 0,
        background: "#0b0b0b",
        minHeight: "400px", // add this line
        minWidth: "400px",  // add this line
        zIndex: 0,             // 👈 low layer for the map
      }}
      aria-label="Map"
    />
  );
}
