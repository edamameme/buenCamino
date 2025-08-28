// lib/preferences.ts
export type BudgetTier = "$" | "$$" | "$$$";
export type UnitSystem = "km" | "miles";
export type RouteStyle = "scenic" | "balanced" | "fast";
export type AlbergueKind = "municipal" | "private" | "parochial";

export interface CaminoPreferences {
  unitSystem: UnitSystem;
  routeStyle: RouteStyle;
  targetStageKm: number;
  budget: BudgetTier;
  albergueKinds: AlbergueKind[];
  quietDormsPreferred: boolean;
  privateRoomPreferred: boolean;
  dietary: ("none" | "vegetarian" | "vegan" | "gluten-free")[];
  languageHelp: ("english" | "spanish")[];
  otherNotes: string;
}

export const DEFAULT_PREFERENCES: CaminoPreferences = {
  unitSystem: "km",
  routeStyle: "balanced",
  targetStageKm: 22,
  budget: "$$",
  albergueKinds: ["municipal", "private", "parochial"],
  quietDormsPreferred: true,
  privateRoomPreferred: false,
  dietary: ["none"],
  languageHelp: ["english"],
  otherNotes: "",
};

const KEY = "camino.preferences.v1";

export function loadPreferences(): CaminoPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) } : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(p: CaminoPreferences) {
  if (typeof window !== "undefined") {
    localStorage.setItem(KEY, JSON.stringify(p));
  }
}

/** Compact sentence for system prompt */
export function preferencesToInstruction(p: CaminoPreferences): string {
  const diet = p.dietary.filter(d => d !== "none");
  const parts = [
    `Use ${p.unitSystem}.`,
    `Favor ${p.routeStyle} routing.`,
    `Aim for ~${p.targetStageKm} ${p.unitSystem === "miles" ? "miles" : "km"} stages.`,
    `Budget ${p.budget}.`,
    p.albergueKinds.length ? `Stays: ${p.albergueKinds.join(", ")}.` : "",
    p.quietDormsPreferred ? "Prefer quiet dorms." : "",
    p.privateRoomPreferred ? "Prefer private rooms." : "",
    diet.length ? `Dietary: ${diet.join(", ")}.` : "",
    p.languageHelp.length ? `Language help: ${p.languageHelp.join(" + ")}.` : "",
    p.otherNotes ? `Other: ${p.otherNotes}` : "",
  ].filter(Boolean);
  return parts.join(" ");
}
