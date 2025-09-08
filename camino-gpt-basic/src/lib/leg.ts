// lib/itinerary.ts
export type Leg = {
  day: number;          // 1-based index for UI labeling
  from: string;         // e.g., "Sarria"
  to: string;           // e.g., "Portomarín"
  km?: number;
  toLat: number;        // destination coordinates (end-of-day town center)
  toLon: number;
  fromLat?: number;     // starting coordinates (only needed for first leg)
  fromLon?: number;
  ascentM?: number;
  notes?: string;
};

export type Itinerary = Leg[];