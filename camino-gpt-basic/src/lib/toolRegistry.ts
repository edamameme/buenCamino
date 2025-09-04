// lib/toolRegistry.ts
import { z } from "zod";
import {
    FocusInput, DrawRouteInput, AddMarkersInput,
    RagSearchInput, RagSearchOutput,
    ElevationProfileInput, ElevationProfileOutput,
    ExportGpxInput, ExportGpxOutput,
    PlacesSearchInput,
} from "@/lib/schemas";
import { geocodeOnline, lineStringBetween } from "@/lib/geo"; // <— use online geocoder
import { townsBetween } from "@/lib/stages/frances";          // <-- NEW

export type ToolContext = {
    // supabase?: SupabaseClient;
    // fetcher?: typeof fetch;
};

type ToolDef<I extends z.ZodTypeAny, O extends z.ZodTypeAny | undefined = undefined> = {
    name: string;
    input: I;
    output?: O;
    /** Optional async coercion: turn loose args into the strict input schema. */
    coerceAsync?: (raw: unknown, ctx: ToolContext) => Promise<unknown>;
    run: (
        args: z.infer<I>,
        ctx: ToolContext
    ) => Promise<{ uiActions?: any[]; data?: O extends z.ZodTypeAny ? z.infer<O> : unknown }>;
};

function toDataUrl(content: string, mime = "application/gpx+xml"): string {
    const b64 = Buffer.from(content, "utf8").toString("base64");
    return `data:${mime};base64,${b64}`;
}

export const toolRegistry = {
    "map.focus": {
        name: "map.focus",
        input: FocusInput,
        coerceAsync: async (raw: any) => {
            if (raw && typeof raw === "object" && typeof raw.location === "string") {
                const p = await geocodeOnline(raw.location);
                if (p) return { lat: p.lat, lon: p.lon, zoom: raw.zoom };
            }
            return raw;
        },
        run: async (args) => ({ uiActions: [{ type: "focus", ...args }] }),
    } satisfies ToolDef<typeof FocusInput>,

    "map.drawRoute": {
        name: "map.drawRoute",
        input: DrawRouteInput,
        /**
         * Coercion rules (loose → strict):
         * - If args.meta.startName/endName are present, build a LineString via known stage towns.
         * - Else if start/end strings are present, geocode and connect.
         * - Else accept provided geojson as-is.
         */
        coerceAsync: async (raw: any) => {
            // Prefer exact match of stage names if meta provided
            if (raw && typeof raw === "object" && raw.meta?.startName && raw.meta?.endName) {
                const seg = townsBetween(String(raw.meta.startName), String(raw.meta.endName));
                if (seg.length >= 2) {
                    return {
                        geojson: {
                            type: "LineString",
                            coordinates: seg.map(t => [t.lon, t.lat]),
                        },
                        meta: raw.meta,
                    };
                }
            }

            // Fallback: start/end strings → geocode and connect straight
            if (raw && typeof raw === "object" && "start" in raw && "end" in raw) {
                const a = typeof raw.start === "string" ? await geocodeOnline(raw.start) : null;
                const b = typeof raw.end === "string" ? await geocodeOnline(raw.end) : null;
                if (a && b) {
                    return { geojson: lineStringBetween(a, b), meta: raw.meta };
                }
            }

            return raw;
        },
        run: async (args) => {
            const actions: any[] = [{ type: "drawRoute", geojson: args.geojson }];

            // Emit markers for segment endpoints if we have meta OR can infer from coords
            try {
                let startTitle: string | undefined;
                let endTitle: string | undefined;
                if (args as any && (args as any).meta) {
                    startTitle = (args as any).meta.startName;
                    endTitle = (args as any).meta.endName;
                }

                const coords = (args.geojson as any)?.coordinates;
                if (Array.isArray(coords) && coords.length >= 2) {
                    const [lonA, latA] = coords[0];
                    const [lonB, latB] = coords[coords.length - 1];
                    actions.push({
                        type: "drawMarkers",
                        markers: [
                            { lat: latA, lon: lonA, title: startTitle ?? "Start" },
                            { lat: latB, lon: lonB, title: endTitle ?? "End" },
                        ],
                    });
                }
            } catch { /* no-op */ }

            return { uiActions: actions };
        },
    } satisfies ToolDef<typeof DrawRouteInput>,

    "map.addMarkers": {
        name: "map.addMarkers",
        input: AddMarkersInput,
        run: async (args) => ({ uiActions: [{ type: "drawMarkers", markers: args.markers }] }),
    } satisfies ToolDef<typeof AddMarkersInput>,

    "rag.search": {
        name: "rag.search",
        input: RagSearchInput,
        output: RagSearchOutput,
        run: async () => ({ data: [] }),
    } satisfies ToolDef<typeof RagSearchInput, typeof RagSearchOutput>,

    "elevation.profile": {
        name: "elevation.profile",
        input: ElevationProfileInput,
        output: ElevationProfileOutput,
        run: async (args) => {
            const out = args.coords.map((_, i) => ({ distKm: i * 1.0, elevM: 0 }));
            return { data: out };
        },
    } satisfies ToolDef<typeof ElevationProfileInput, typeof ElevationProfileOutput>,

    "export.gpx": {
        name: "export.gpx",
        input: ExportGpxInput,
        output: ExportGpxOutput,
        run: async (args) => {
            const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Camino GPT">
  <trk><name>${args.name}</name>
    ${args.segments
                    .map(
                        (seg) => `<trkseg>
${seg.map(([lon, lat]) => `      <trkpt lon="${lon}" lat="${lat}"></trkpt>`).join("\n")}
    </trkseg>`
                    )
                    .join("\n")}
  </trk>
</gpx>`;
            return { data: { url: toDataUrl(gpx) } };
        },
    } satisfies ToolDef<typeof ExportGpxInput, typeof ExportGpxOutput>,

    "places.search": {
        name: "places.search",
        input: PlacesSearchInput,
        run: async () => ({ data: [] as unknown }),
    } satisfies ToolDef<typeof PlacesSearchInput>,
} as const;

export type ToolKey = keyof typeof toolRegistry;

export async function runTool(name: ToolKey, rawArgs: unknown, ctx: ToolContext) {
    const tool = toolRegistry[name];
    if (!tool) throw new Error(`Unknown tool: ${name}`);

    // NEW: async coercion BEFORE validation
    const prepared = tool.coerceAsync ? await tool.coerceAsync(rawArgs, ctx) : rawArgs;

    const parsed = tool.input.safeParse(prepared);
    if (!parsed.success) throw new Error(`Invalid args for ${name}: ${parsed.error.message}`);

    const res = await tool.run(parsed.data as any, ctx);
    return res;
}
