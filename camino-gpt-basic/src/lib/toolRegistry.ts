// lib/toolRegistry.ts
import { z } from "zod";
import {
  FocusInput, DrawRouteInput, AddMarkersInput,
  RagSearchInput, RagSearchOutput,
  ElevationProfileInput, ElevationProfileOutput,
  ExportGpxInput, ExportGpxOutput,
  PlacesSearchInput,
} from "@/lib/schemas";
import { geocodeOnline, lineStringBetween } from "@/lib/geo"; // online geocoder
import { townsBetween, FRANCES_LAST100, distanceBetweenTowns } from "@/lib/stages/frances";
import type { Itinerary, Leg } from "@/lib/leg";

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
  ) => Promise<{
    uiActions?: any[];
    data?: O extends z.ZodTypeAny ? z.infer<O> : unknown;
    /** NEW: optional itinerary surfaced by tools (executor can forward it) */
    itinerary?: Itinerary;
  }>;
};

function toDataUrl(content: string, mime = "application/gpx+xml"): string {
  const b64 = Buffer.from(content, "utf8").toString("base64");
  return `data:${mime};base64,${b64}`;
}

async function lookupTownCoords(name: string): Promise<{ lat: number; lon: number } | null> {
  const cleanName = name.toLowerCase().trim();
  
  // First try exact match
  let town = FRANCES_LAST100.find(t => 
    t.name.toLowerCase() === cleanName
  );
  
  // Then try partial matches (both directions)
  if (!town) {
    town = FRANCES_LAST100.find(t => 
      t.name.toLowerCase().includes(cleanName) || 
      cleanName.includes(t.name.toLowerCase())
    );
  }
  
  // Handle common variations
  if (!town) {
    const variations: Record<string, string> = {
      'santiago': 'Santiago de Compostela',
      'o pedrouzo': 'O Pedrouzo',
      'pedrouzo': 'O Pedrouzo',
      'palas': 'Palas de Rei',
      'portomarin': 'Portomarín',
    };
    
    const variation = variations[cleanName];
    if (variation) {
      town = FRANCES_LAST100.find(t => t.name === variation);
    }
  }
  
  if (town) {
    return { lat: town.lat, lon: town.lon };
  }
  
  // Fallback to online geocoding for towns not in our database
  return await geocodeOnline(name);
}

export const toolRegistry = {
  "map.focus": {
    name: "map.focus",
    input: FocusInput,
    coerceAsync: async (raw: any) => {
      if (raw && typeof raw === "object") {
        // Handle center array format: { center: [lon, lat], zoom: 12 }
        if (Array.isArray(raw.center) && raw.center.length >= 2) {
          return { lat: raw.center[1], lon: raw.center[0], zoom: raw.zoom };
        }
        // Handle location string format: { location: "Santiago", zoom: 12 }
        if (typeof raw.location === "string") {
          const p = await geocodeOnline(raw.location);
          if (p) return { lat: p.lat, lon: p.lon, zoom: raw.zoom };
        }
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
     * - If meta.startName/endName or start/end strings are present, derive a LineString
     *   from known stage towns (preferred) or a straight line (fallback).
     * - If planner sent `stages` (either {stage:"A to B", distance?} or {from,to,distanceKm?}),
     *   normalize them and store under `geojson.properties.itinerary` so Zod preserves it.
     */
    coerceAsync: async (plannerInput: any) => {
      console.log(`[debug] map.drawRoute - Raw input from planner:`, JSON.stringify(plannerInput, null, 2));
      const processedArgs: any = { ...plannerInput };

      // Normalize names
      const startName: string | undefined =
        processedArgs?.meta?.startName ?? (typeof processedArgs?.start === "string" ? processedArgs.start : undefined);
      const endName: string | undefined =
        processedArgs?.meta?.endName ?? (typeof processedArgs?.end === "string" ? processedArgs.end : undefined);

      // If names exist, ensure meta carries them
      if (startName || endName) {
        processedArgs.meta = { ...(processedArgs.meta ?? {}), startName, endName };
      }

      // Normalize stages -> itinerary (we DO NOT put this at the top level; stash under geojson.properties)
      let itinerary: Partial<Leg>[] | undefined;
      if (Array.isArray(processedArgs?.stages) && processedArgs.stages.length) {
        itinerary = processedArgs.stages.map((stage: any, stageIndex: number) => {
          let fromTown: string;
          let toTown: string;

          // Parse stage data
          if (typeof stage?.stage === "string" && stage.stage.includes(" to ")) {
            const [fromPart, toPart] = stage.stage.split(" to ");
            fromTown = (fromPart || "").trim();
            toTown = (toPart || "").trim();
          } else {
            fromTown = stage?.from;
            toTown = stage?.to;
          }

          // Apply fallbacks for missing from/to
          if (!fromTown) {
            fromTown = stageIndex === 0 ? (startName || "Start") : itinerary?.[stageIndex-1]?.to || "Previous";
          }
          if (!toTown) {
            toTown = stageIndex === processedArgs.stages.length - 1 ? (endName || "End") : "Unknown";
          }

          // Calculate distance - try exact calculation first, then use provided value
          let distanceKm = distanceBetweenTowns(fromTown, toTown);
          if (!distanceKm) {
            distanceKm = typeof stage?.distanceKm === "number" ? stage.distanceKm :
                 typeof stage?.distance === "number" ? stage.distance : undefined;
          }

          return { day: stageIndex + 1, from: fromTown, to: toTown, km: distanceKm };
        });
      }

      // Build geojson if not provided
      if (!processedArgs?.geojson) {
        // If we have itinerary stages, create separate LineStrings for each stage
        if (itinerary?.length && itinerary.length > 1) {
          const routeFeatures = [];
          
          for (let legIndex = 0; legIndex < itinerary.length; legIndex++) {
            const leg = itinerary[legIndex];
            const startCoords = await lookupTownCoords(leg.from || "");
            const endCoords = await lookupTownCoords(leg.to || "");
            
            if (startCoords && endCoords) {
              routeFeatures.push({
                type: "Feature",
                properties: {
                  day: leg.day,
                  from: leg.from,
                  to: leg.to,
                  distance: leg.km
                },
                geometry: {
                  type: "LineString",
                  coordinates: [[startCoords.lon, startCoords.lat], [endCoords.lon, endCoords.lat]]
                }
              });
            }
          }
          
          if (routeFeatures.length > 0) {
            processedArgs.geojson = {
              type: "FeatureCollection",
              features: routeFeatures
            };
          }
        } 
        
        // Fallback: single line from start to end
        if (!processedArgs.geojson && startName && endName) {
          const routeSegment = townsBetween(String(startName), String(endName));
          if (Array.isArray(routeSegment) && routeSegment.length >= 2) {
            processedArgs.geojson = {
              type: "LineString",
              coordinates: routeSegment.map(town => [town.lon, town.lat]),
            };
          } else {
            // Final fallback: geocode both and connect straight
            const startPoint = await geocodeOnline(startName);
            const endPoint = await geocodeOnline(endName);
            if (startPoint && endPoint) processedArgs.geojson = lineStringBetween(startPoint, endPoint);
          }
        }
      }

      // Ensure geojson exists minimally; if still missing, pass through and let run throw validation error
      if (!processedArgs?.geojson) {
        return processedArgs;
      }

      // Attach itinerary under geojson.properties so Zod keeps it (geojson is .passthrough())
      if (itinerary?.length) {
        const geojsonData: any = processedArgs.geojson;
        geojsonData.properties = { ...(geojsonData.properties ?? {}), itinerary };
      }

      return processedArgs;
    },

    run: async (args) => {
      const actions: any[] = [{ type: "drawRoute", geojson: args.geojson }];

      // Optional start/end markers based on meta or coordinate endpoints
      try {
        const startTitle: string | undefined = (args as any)?.meta?.startName;
        const endTitle: string | undefined = (args as any)?.meta?.endName;

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

      // Surface itinerary if it was stashed under geojson.properties.itinerary
      let itinerary: Itinerary | undefined = (args as any)?.geojson?.properties?.itinerary;
      console.log(`[debug] map.drawRoute - Initial itinerary from geojson.properties:`, itinerary);
      
      // Only create fallback single-day itinerary if no proper itinerary exists
      if (!itinerary || itinerary.length === 0) {
        const startName = (args as any)?.meta?.startName;
        const endName = (args as any)?.meta?.endName;
        console.log(`[debug] map.drawRoute - No itinerary found, creating fallback with startName=${startName}, endName=${endName}`);
        if (startName || endName) {
          itinerary = [{ 
            day: 1, 
            from: startName || "Start", 
            to: endName || "End", 
            lat: 0, 
            lon: 0 
          }];
          console.log(`[debug] map.drawRoute - Created fallback itinerary:`, itinerary);
        }
      } else {
        console.log(`[debug] map.drawRoute - Using existing itinerary with ${itinerary.length} days`);
      }

      // Add coordinates to itinerary - prefer town lookups over polyline sampling
      if (itinerary) {
        const coords = (args.geojson as any)?.coordinates;
        
        // Try to resolve coordinates from town names first
        const resolvedItinerary = [];
        for (let i = 0; i < itinerary.length; i++) {
          const day = itinerary[i];
          let resolvedDay = { ...day };
          
          // For the first leg, also resolve starting coordinates
          if (i === 0 && day.from && (!day.fromLat || !day.fromLon)) {
            const fromCoords = await lookupTownCoords(day.from);
            if (fromCoords) {
              resolvedDay.fromLat = fromCoords.lat;
              resolvedDay.fromLon = fromCoords.lon;
            }
          }
          
          // If day already has destination coordinates, keep them
          if (day.toLat && day.toLon) {
            resolvedItinerary.push(resolvedDay);
            continue;
          }
          
          // Try to resolve coordinates from the 'to' town name
          if (day.to) {
            const townCoords = await lookupTownCoords(day.to);
            if (townCoords) {
              resolvedDay.toLat = townCoords.lat;
              resolvedDay.toLon = townCoords.lon;
              resolvedItinerary.push(resolvedDay);
              continue;
            }
          }
          
          // Fallback to polyline sampling if we have coordinates
          if (Array.isArray(coords) && coords.length >= 2) {
            if (itinerary.length > 1 && coords.length >= itinerary.length) {
              // Distribute coordinates along the route
              const step = Math.floor(coords.length / itinerary.length);
              const coordIndex = Math.min(resolvedItinerary.length * step, coords.length - 1);
              resolvedDay.toLat = coords[coordIndex][1];
              resolvedDay.toLon = coords[coordIndex][0];
            } else {
              // Single day or not enough coordinates - use start/end
              const isLast = resolvedItinerary.length === itinerary.length - 1;
              resolvedDay.toLat = isLast ? coords[coords.length - 1][1] : coords[0][1];
              resolvedDay.toLon = isLast ? coords[coords.length - 1][0] : coords[0][0];
            }
          }
          
          resolvedItinerary.push(resolvedDay);
        }
        
        itinerary = resolvedItinerary;
      }

      console.log(`[debug] map.drawRoute - Final itinerary being returned:`, itinerary?.map(leg => ({ day: leg.day, from: leg.from, to: leg.to, toLat: leg.toLat, toLon: leg.toLon })));
      return { uiActions: actions, itinerary };
    },
  } satisfies ToolDef<typeof DrawRouteInput>,

  "map.addMarkers": {
    name: "map.addMarkers",
    input: AddMarkersInput,
    coerceAsync: async (plannerInput: any, ctx: ToolContext) => {
      console.log(`[debug] map.addMarkers - Raw input from planner:`, JSON.stringify(plannerInput, null, 2));
      // Handle { locations: [{ name, kind?, ... }] } format
      if (plannerInput && typeof plannerInput === "object" && Array.isArray(plannerInput.locations)) {
        const resolvedMarkers = [];
        for (const location of plannerInput.locations) {
          if (typeof location.name === "string") {
            const townCoords = await lookupTownCoords(location.name);
            if (townCoords) {
              resolvedMarkers.push({
                toLat: townCoords.lat,
                toLon: townCoords.lon,
                title: location.name,
                subtitle: location.kind || undefined,
              });
            }
          }
        }
        return { markers: resolvedMarkers };
      }
      return plannerInput;
    },
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

  // Async coercion BEFORE validation (lets us normalize loose planner args)
  const prepared = tool.coerceAsync ? await tool.coerceAsync(rawArgs, ctx) : rawArgs;

  const parsed = tool.input.safeParse(prepared);
  if (!parsed.success) throw new Error(`Invalid args for ${name}: ${parsed.error.message}`);

  const res = await tool.run(parsed.data as any, ctx);
  return res;
}
