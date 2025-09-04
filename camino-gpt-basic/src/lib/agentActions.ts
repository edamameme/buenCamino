
// lib/agentActions.ts
export type AgentAction =
    | { type: "drawRoute"; geojson: any }
    | { type: "drawMarkers"; markers: Array<{ lat: number; lon: number; title?: string; subtitle?: string }> }
    | { type: "clearRoute" }
    | { type: "focus"; lat: number; lon: number; zoom?: number };

export function emitAction(a: AgentAction) {
    window.dispatchEvent(new CustomEvent("camino:action", { detail: a }));
}

