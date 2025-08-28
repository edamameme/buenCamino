// lib/preferences.ts

// ───────────────────────────────────────────────────────────────────────────────
// 1) Canonical option arrays (single source of truth)
//    • Update these arrays to add/remove choices
//    • All related TypeScript unions are derived from them
// ───────────────────────────────────────────────────────────────────────────────
export const UNIT_SYSTEMS = ["km", "miles"] as const;
export const ROUTE_STYLES = ["scenic", "balanced", "fast"] as const;
export const BUDGET_TIERS = ["$", "$$", "$$$"] as const;
export const ALBERGUE_KINDS = ["municipal", "private", "parochial"] as const;
export const DIETARY_OPTIONS = ["none", "vegetarian", "vegan", "gluten-free"] as const;
export const LANGUAGE_OPTIONS = [
  "english",
  "spanish",
  "french",
  "german",
  "italian",
  "portuguese",
  "chinese",
  "korean",
] as const;

// ───────────────────────────────────────────────────────────────────────────────
/** 2) Types derived from arrays (no duplicate string unions to maintain) */
// ───────────────────────────────────────────────────────────────────────────────
export type UnitSystem = typeof UNIT_SYSTEMS[number];
export type RouteStyle = typeof ROUTE_STYLES[number];
export type BudgetTier = typeof BUDGET_TIERS[number];
export type AlbergueKind = typeof ALBERGUE_KINDS[number];
export type DietaryOption = typeof DIETARY_OPTIONS[number];
export type LanguageOption = typeof LANGUAGE_OPTIONS[number];

// ───────────────────────────────────────────────────────────────────────────────
/** 3) Main preferences interface (uses the derived types) */
// ───────────────────────────────────────────────────────────────────────────────
export interface CaminoPreferences {
  unitSystem: UnitSystem;
  routeStyle: RouteStyle;
  targetStageKm: number;
  budget: BudgetTier;
  albergueKinds: AlbergueKind[];
  quietDormsPreferred: boolean;
  privateRoomPreferred: boolean;
  dietary: DietaryOption[];        // ← derived union
  languageHelp: LanguageOption[];  // ← derived union
  otherNotes: string;
}

// ───────────────────────────────────────────────────────────────────────────────
/** 4) Labels for display (i18n-friendly) */
// ───────────────────────────────────────────────────────────────────────────────
export const LABELS = {
  unitSystem: { km: "Kilometers", miles: "Miles" } as Record<UnitSystem, string>,
  routeStyle: {
    scenic: "Scenic",
    balanced: "Balanced",
    fast: "Fast",
  } as Record<RouteStyle, string>,
  budget: { $: "$", $$: "$$", $$$: "$$$" } as Record<BudgetTier, string>,
  albergueKinds: {
    municipal: "Municipal",
    private: "Private",
    parochial: "Parochial",
  } as Record<AlbergueKind, string>,
  dietary: {
    none: "None",
    vegetarian: "Vegetarian",
    vegan: "Vegan",
    "gluten-free": "Gluten-free",
  } as Record<DietaryOption, string>,
  language: {
    english: "English",
    spanish: "Spanish",
    french: "French",
    german: "German",
    italian: "Italian",
    portuguese: "Portuguese",
    chinese: "Chinese",
    korean: "Korean",
  } as Record<LanguageOption, string>,
};

// ───────────────────────────────────────────────────────────────────────────────
/** 5) Defaults, storage helpers, and prompt helper */
// ───────────────────────────────────────────────────────────────────────────────
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

export const PREFERENCES_STORAGE_KEY = "camino.preferences.v1";

export function loadPreferences(): CaminoPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    return raw ? { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) } : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(p: CaminoPreferences) {
  if (typeof window !== "undefined") {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(p));
  }
}

/** Compact sentence for system prompt */
export function preferencesToInstruction(p: CaminoPreferences): string {
  const diet = p.dietary.filter((d) => d !== "none");
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
