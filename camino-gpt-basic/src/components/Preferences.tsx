// components/Preferences.tsx
"use client";

import { usePreferences } from "@/context/PreferencesContext";
import type { CaminoPreferences } from "@/lib/preferences";
import { useState } from "react";

export default function Preferences() {
  const { prefs, update } = usePreferences();
  const [open, setOpen] = useState(false);

  const toggleIn = <T extends string>(key: keyof CaminoPreferences, val: T) => {
    const set = new Set((prefs as any)[key] as T[]);
    set.has(val) ? set.delete(val) : set.add(val);
    update(key as any, Array.from(set));
  };

  return (
    <>
      {/* shift left a bit so it doesn't overlap the Chat FAB */}
      <button
        onClick={() => setOpen(true)}
        className="fixed right-20 bottom-4 z-[10000] rounded-2xl px-4 py-2 border border-[#2a2a2a] bg-[#0f0f0f] text-white shadow-xl"
      >
        Preferences ⚙️
      </button>

      {open && (
        <div className="fixed inset-0 z-[12000] flex">
          <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="w-[380px] max-w-[95vw] bg-[#151515] border-l border-[#262626] p-3 overflow-y-auto">
            <Header onClose={() => setOpen(false)} />
            <Section title="Units">
              <Radio
                value={prefs.unitSystem}
                options={[
                  ["km", "Kilometers"],
                  ["miles", "Miles"],
                ]}
                onChange={(v) => update("unitSystem", v as any)}
              />
            </Section>
            <Section title="Route Style">
              <Radio
                value={prefs.routeStyle}
                options={[
                  ["scenic", "Scenic"],
                  ["balanced", "Balanced"],
                  ["fast", "Fast"],
                ]}
                onChange={(v) => update("routeStyle", v as any)}
              />
            </Section>
            <Section title={`Target Stage Length (${prefs.unitSystem})`}>
              <input
                type="range"
                min={12}
                max={35}
                step={1}
                value={prefs.targetStageKm}
                onChange={(e) => update("targetStageKm", Number(e.target.value))}
                className="w-full"
              />
              <div className="mt-1 text-xs opacity-75">
                Aim for ~<b>{prefs.targetStageKm}</b> {prefs.unitSystem}.
              </div>
            </Section>
            <Section title="Budget">
              <Radio value={prefs.budget} options={[["$", "$"], ["$$", "$$"], ["$$$", "$$$"]]} onChange={(v) => update("budget", v as any)} />
            </Section>
            <Section title="Stays">
              <Checks
                value={prefs.albergueKinds}
                options={[
                  ["municipal", "Municipal"],
                  ["private", "Private"],
                  ["parochial", "Parochial"],
                ]}
                onToggle={(v) => toggleIn("albergueKinds", v as any)}
              />
              <Toggle
                label="Prefer quiet dorms"
                checked={prefs.quietDormsPreferred}
                onChange={(v) => update("quietDormsPreferred", v)}
              />
              <Toggle
                label="Prefer private rooms"
                checked={prefs.privateRoomPreferred}
                onChange={(v) => update("privateRoomPreferred", v)}
              />
            </Section>
            <Section title="Dietary">
              <Checks
                value={prefs.dietary}
                options={[
                  ["none", "None"],
                  ["vegetarian", "Vegetarian"],
                  ["vegan", "Vegan"],
                  ["gluten-free", "Gluten-free"],
                ]}
                onToggle={(v) => {
                  if (v === "none") return update("dietary", ["none"]);
                  const base = prefs.dietary.includes("none") ? [] : prefs.dietary;
                  update(
                    "dietary",
                    base.includes(v as any) ? base.filter((x) => x !== v) : [...base, v as any],
                  );
                }}
              />
            </Section>
            <Section title="Language Help">
              <Checks
                value={prefs.languageHelp}
                options={[
                  ["english", "English"],
                  ["spanish", "Spanish tips"],
                ]}
                onToggle={(v) => toggleIn("languageHelp", v as any)}
              />
            </Section>
            <Section title="Other Notes">
              <textarea
                rows={4}
                className="w-full rounded-md bg-[#0f0f0f] border border-[#2a2a2a] p-2"
                placeholder="e.g., avoid muddy detours; love coastal views…"
                value={prefs.otherNotes}
                onChange={(e) => update("otherNotes", e.target.value)}
              />
              <div className="mt-1 text-xs opacity-70">Added to the agent’s instructions.</div>
            </Section>
          </div>
        </div>
      )}
    </>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="font-semibold">Your Preferences</div>
      <button className="rounded-md px-2 py-1 bg-[#0f0f0f] border border-[#2a2a2a]" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <div className="font-medium mb-1">{title}</div>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function Radio({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map(([val, label]) => (
        <label
          key={val}
          className={`cursor-pointer rounded-xl px-3 py-1 border ${
            value === val ? "border-white" : "border-[#2a2a2a]"
          }`}
        >
          <input
            type="radio"
            name="pref-radio"
            className="mr-2"
            checked={value === val}
            onChange={() => onChange(val)}
          />
          {label}
        </label>
      ))}
    </div>
  );
}

function Checks({
  value,
  options,
  onToggle,
}: {
  value: string[];
  options: [string, string][];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map(([val, label]) => (
        <label
          key={val}
          className={`cursor-pointer rounded-xl px-3 py-1 border ${
            value.includes(val) ? "border-white" : "border-[#2a2a2a]"
          }`}
        >
          <input
            type="checkbox"
            className="mr-2"
            checked={value.includes(val)}
            onChange={() => onToggle(val)}
          />
          {label}
        </label>
      ))}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
