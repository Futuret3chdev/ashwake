export type UpgradeKey = "hull" | "engine" | "jaw" | "mercy" | "plates";

export type Upgrades = Record<UpgradeKey, number>;

export type Save = {
  version: 1;
  bank: number;
  best: number;
  bestCities: number;
  hunts: number;
  mercyActs: number;
  muted: boolean;
  upgrades: Upgrades;
};

export const UPGRADE_MAX = 5;
export const UPGRADE_COST = [40, 75, 120, 180, 260];

export const UPGRADE_META: { key: UpgradeKey; name: string; blurb: string }[] = [
  { key: "hull", name: "Plate strata", blurb: "More hull before the city falls." },
  { key: "engine", name: "Wheel drums", blurb: "Higher top speed and a deeper fuel tank." },
  { key: "jaw", name: "Jaw reach", blurb: "Latch towns from farther out, digest faster." },
  { key: "mercy", name: "Steward yield", blurb: "Mercy and the grove pay more t3x." },
  { key: "plates", name: "Aegis duration", blurb: "Shield plates stay shut longer." },
];

const KEY = "ashwake-beta-v1";

export function defaultSave(): Save {
  return {
    version: 1,
    bank: 0,
    best: 0,
    bestCities: 0,
    hunts: 0,
    mercyActs: 0,
    muted: false,
    upgrades: { hull: 0, engine: 0, jaw: 0, mercy: 0, plates: 0 },
  };
}

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as Save;
    if (parsed.version !== 1 || !parsed.upgrades) return defaultSave();
    return { ...defaultSave(), ...parsed, upgrades: { ...defaultSave().upgrades, ...parsed.upgrades } };
  } catch {
    return defaultSave();
  }
}

export function writeSave(save: Save) {
  localStorage.setItem(KEY, JSON.stringify(save));
}
