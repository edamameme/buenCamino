// lib/geo.ts
import { fetchWithTimeout } from "@/lib/net";

type Point = { lat: number; lon: number };

// Tiny in-memory cache to avoid hammering the geocoder
const cache = new Map<string, Point>();

// Optional seed for common Camino places (acts as a warm cache, not a source of truth)
const SEED: Record<string, Point> = {
    "Sarria": { lat: 42.7812, lon: -7.4143 },
    "Portomarín": { lat: 42.8075, lon: -7.6153 },
    "Portomarin": { lat: 42.8075, lon: -7.6153 }, // spelling variant
    "Palas de Rei": { lat: 42.8741, lon: -7.8687 },
    "Arzúa": { lat: 42.9290, lon: -8.1585 },
    "Arzua": { lat: 42.9290, lon: -8.1585 },      // variant
    "O Pedrouzo": { lat: 42.8971, lon: -8.3773 },
    "Pedrouzo": { lat: 42.8971, lon: -8.3773 },   // variant
    "Santiago de Compostela": { lat: 42.8806, lon: -8.5449 },
    "Santiago": { lat: 42.8806, lon: -8.5449 },
};

// Populate warm cache
for (const [k, v] of Object.entries(SEED)) cache.set(k.toLowerCase(), v);

/** Online geocode via OpenStreetMap Nominatim (server-side only). */
export async function geocodeOnline(query: string): Promise<Point | null> {
    const key = query.trim().toLowerCase();
    const hit = cache.get(key);
    if (hit) return hit;

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
        query
    )}`;
    const res = await fetchWithTimeout(url, {
        headers: {
            "User-Agent": "CaminoGPT/1.0 (+https://example.com)",
            Accept: "application/json",
        },
    }, 5000); // 5s timeout
    if (!res.ok) return null;

    const arr: any[] = await res.json();
    if (!arr?.length) return null;

    const { lat, lon } = arr[0];
    const pt = { lat: Number(lat), lon: Number(lon) };
    cache.set(key, pt);
    return pt;
}

/** Build a simple straight LineString between two points (placeholder for real routing). */
export function lineStringBetween(a: Point, b: Point) {
    return {
        type: "LineString",
        coordinates: [
            [a.lon, a.lat],
            [b.lon, b.lat],
        ],
    };
}
