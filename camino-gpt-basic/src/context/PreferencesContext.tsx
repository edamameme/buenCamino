// context/PreferencesContext.tsx
"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  CaminoPreferences,
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
} from "@/lib/preferences";

type Ctx = {
  prefs: CaminoPreferences;
  update: <K extends keyof CaminoPreferences>(k: K, v: CaminoPreferences[K]) => void;
  replace: (p: CaminoPreferences) => void;
};

const PreferencesContext = createContext<Ctx | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<CaminoPreferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    setPrefs(loadPreferences());
  }, []);

  const update = useCallback(<K extends keyof CaminoPreferences>(k: K, v: CaminoPreferences[K]) => {
    setPrefs(prev => {
      const next = { ...prev, [k]: v };
      savePreferences(next);
      return next;
    });
  }, []);

  const replace = useCallback((p: CaminoPreferences) => {
    savePreferences(p);
    setPrefs(p);
  }, []);

  return (
    <PreferencesContext.Provider value={{ prefs, update, replace }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}
