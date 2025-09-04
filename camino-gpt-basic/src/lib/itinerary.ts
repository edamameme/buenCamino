// lib/itinerary.ts
export type Leg = {
  day: number;          // 1-based index for UI labeling
  from: string;         // e.g., "Sarria"
  to: string;           // e.g., "Portomarín"
  km?: number;
  ascentM?: number;
  notes?: string[];
  lat: number;          // end-of-day (overnight) town center
  lon: number;
};

export type Itinerary = Leg[];