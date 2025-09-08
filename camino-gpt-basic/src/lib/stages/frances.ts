// lib/stages/frances.ts
export type StageTown = { 
  name: string; 
  lat: number; 
  lon: number; 
  kmFromSantiago?: number; // Distance from Santiago along the Camino (reverse direction)
};

/** Camino Francés — last ~115km (Sarria → Santiago) with more waypoints */
export const FRANCES_LAST100: StageTown[] = [
  { name: "Sarria",               lat: 42.7812, lon: -7.4143, kmFromSantiago: 115.0 },
  { name: "Barbadelo",            lat: 42.7945, lon: -7.4387, kmFromSantiago: 110.4 },
  { name: "Rente",                lat: 42.8123, lon: -7.4721, kmFromSantiago: 106.8 },
  { name: "Mercadoiro",           lat: 42.8156, lon: -7.5234, kmFromSantiago: 101.9 },
  { name: "Portomarín",           lat: 42.8075, lon: -7.6153, kmFromSantiago: 92.8 },
  { name: "Gonzar",               lat: 42.8254, lon: -7.6891, kmFromSantiago: 83.2 },
  { name: "Castromaior",          lat: 42.8421, lon: -7.7234, kmFromSantiago: 77.6 },
  { name: "Hospital da Cruz",     lat: 42.8587, lon: -7.7812, kmFromSantiago: 72.1 },
  { name: "Palas de Rei",         lat: 42.8741, lon: -7.8687, kmFromSantiago: 67.7 },
  { name: "Casanova",             lat: 42.8923, lon: -7.9234, kmFromSantiago: 61.2 },
  { name: "Porto de Bois",        lat: 42.9034, lon: -7.9645, kmFromSantiago: 56.9 },
  { name: "Melide",               lat: 42.9142, lon: -8.0129, kmFromSantiago: 52.3 },
  { name: "Boente",               lat: 42.9178, lon: -8.0567, kmFromSantiago: 46.1 },
  { name: "Castañeda",            lat: 42.9234, lon: -8.0891, kmFromSantiago: 41.8 },
  { name: "Ribadiso da Baixo",    lat: 42.9267, lon: -8.1234, kmFromSantiago: 37.2 },
  { name: "Arzúa",                lat: 42.9290, lon: -8.1585, kmFromSantiago: 33.5 },
  { name: "Pedrouzo",             lat: 42.8971, lon: -8.2156, kmFromSantiago: 24.9 },
  { name: "A Rúa",                lat: 42.9034, lon: -8.2567, kmFromSantiago: 19.6 },
  { name: "O Pedrouzo",           lat: 42.8971, lon: -8.3773, kmFromSantiago: 14.2 },
  { name: "Amenal",               lat: 42.8834, lon: -8.4123, kmFromSantiago: 9.3 },
  { name: "San Paio",             lat: 42.8789, lon: -8.4567, kmFromSantiago: 5.6 },
  { name: "Santiago de Compostela", lat: 42.8806, lon: -8.5449, kmFromSantiago: 0 },
];

/** Calculate distance between two towns using their kmFromSantiago values */
export function distanceBetweenTowns(fromTown: string, toTown: string): number | null {
  const from = FRANCES_LAST100.find(t => t.name.toLowerCase() === fromTown.toLowerCase());
  const to = FRANCES_LAST100.find(t => t.name.toLowerCase() === toTown.toLowerCase());
  
  if (!from || !to || from.kmFromSantiago === undefined || to.kmFromSantiago === undefined) {
    return null;
  }
  
  return Math.abs(from.kmFromSantiago - to.kmFromSantiago);
}

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
