// lib/schemas.ts
import { z } from "zod";

/** ---------- Tool I/O (zod) ---------- */
export const FocusInput = z.object({
    lat: z.number(),
    lon: z.number(),
    zoom: z.number().min(1).max(20).optional(),
    label: z.string().optional(),

});

export const DrawRouteInput = z.object({
    // Accept LineString or Feature<LineString>; passthrough props (coords, etc.)
    geojson: z.object({ type: z.enum(["LineString", "Feature"]) }).passthrough(),
    meta: z.object({
        startName: z.string().optional(),
        endName: z.string().optional(),
    }).optional(), // NEW
});

export const AddMarkersInput = z.object({
    markers: z.array(
        z.object({
            lat: z.number(),
            lon: z.number(),
            title: z.string().optional(),
            subtitle: z.string().optional(),
        })
    ),
});

export const RagSearchInput = z.object({
    query: z.string().min(2),
    topK: z.number().int().min(1).max(20).optional(),
});
export const RagSearchOutput = z.array(
    z.object({
        id: z.string(),
        title: z.string(),
        snippet: z.string(),
        url: z.string().url().optional(),
    })
);

export const ElevationProfileInput = z.object({
    // [lon, lat]
    coords: z.array(z.tuple([z.number(), z.number()])),
});
export const ElevationProfileOutput = z.array(
    z.object({ distKm: z.number(), elevM: z.number() })
);

export const ExportGpxInput = z.object({
    name: z.string().min(1),
    segments: z.array(z.array(z.tuple([z.number(), z.number()]))), // [[ [lon,lat], ... ], ...]
});
export const ExportGpxOutput = z.object({
    url: z.string(), // data: URL for now
});

export const PlacesSearchInput = z.object({
    near: z.tuple([z.number(), z.number()]).optional(), // [lon,lat]
    q: z.string().min(2),
    kind: z.enum(["albergue", "cafe", "grocery"]).optional(),
});

/** ---------- Plan schema ---------- */
export const ToolName = z.enum([
    "map.focus",
    "map.drawRoute",
    "map.addMarkers",
    "rag.search",
    "places.search",
    "elevation.profile",
    "export.gpx",
]);

export const PlanStep = z.object({
    id: z.string().min(1),
    tool: ToolName,
    args: z.record(z.unknown()), // validated per tool at runtime
    why: z.string().optional(),
    pauseForUser: z.boolean().optional(),
});

export const PlanSchema = z.object({
    steps: z.array(PlanStep).min(1).max(50),
    specialist: z.enum(["navigator", "concierge", "safety", "logistics"]).optional(),
    budget: z.object({
        maxSteps: z.number().int().min(1).max(50).optional(),
        maxTokens: z.number().int().min(100).max(200000).optional(),
    }).optional(),
});

export type Plan = z.infer<typeof PlanSchema>;
export type PlanStepT = z.infer<typeof PlanStep>;
