// lib/stages/frances.ts
export type StageTown = { name: string; lat: number; lon: number };

/** Camino Francés — last ~100km (Sarria → Santiago) */
export const FRANCES_LAST100: StageTown[] = [
  { name: "Sarria",               lat: 42.7812, lon: -7.4143 },
//   { name: "Portomarín",           lat: 42.8075, lon: -7.6153 },
//   { name: "Palas de Rei",         lat: 42.8741, lon: -7.8687 },
//   { name: "Melide",               lat: 42.9142, lon: -8.0129 },
  { name: "Arzúa",                lat: 42.9290, lon: -8.1585 },
  { name: "O Pedrouzo",           lat: 42.8971, lon: -8.3773 },
  { name: "Santiago de Compostela", lat: 42.8806, lon: -8.5449 },
];

/** Return inclusive slice of stage towns between start and end, or [] if not found */
export function townsBetween(startName: string, endName: string): StageTown[] {
  const idx = (n: string) =>
    FRANCES_LAST100.findIndex(t => t.name.toLowerCase() === n.trim().toLowerCase());
  const i = idx(startName);
  const j = idx(endName);
  if (i === -1 || j === -1) return [];
  if (i <= j) return FRANCES_LAST100.slice(i, j + 1);
  return FRANCES_LAST100.slice(j, i + 1).reverse();
}
