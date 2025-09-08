// lib/utils.ts

/** Format distance to 1 decimal place, removing unnecessary trailing zeros */
export function formatDistance(km: number | undefined | null): string | null {
  if (typeof km !== 'number' || isNaN(km)) return null;
  
  // Round to 1 decimal place
  const rounded = Math.round(km * 10) / 10;
  
  // Remove .0 for whole numbers (22.0 → 22, but keep 22.3 → 22.3)
  return rounded % 1 === 0 ? rounded.toString() : rounded.toFixed(1);
}

/** Format distance with "km" unit, or return fallback text */
export function formatDistanceWithUnit(km: number | undefined | null, fallback = "Distance n/a"): string {
  const formatted = formatDistance(km);
  return formatted ? `${formatted} km` : fallback;
}