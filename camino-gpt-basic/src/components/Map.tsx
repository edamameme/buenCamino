"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
// import "leaflet/dist/leaflet.css"; // ✅ critical

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
