export interface BlindLevel {
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationMinutes: number;
}

/** A standard-ish chip progression, roughly doubling every few levels, with
 * antes kicking in partway through. Shared by the presets below -- they only
 * differ in level duration. */
const PROGRESSION: Array<[number, number, number]> = [
  // [smallBlind, bigBlind, ante]
  [25, 50, 0],
  [50, 100, 0],
  [75, 150, 0],
  [100, 200, 25],
  [150, 300, 25],
  [200, 400, 50],
  [300, 600, 75],
  [400, 800, 100],
  [500, 1000, 100],
  [600, 1200, 200],
  [800, 1600, 200],
  [1000, 2000, 300],
  [1500, 3000, 400],
  [2000, 4000, 500],
  [3000, 6000, 1000],
  [4000, 8000, 1000],
  [5000, 10000, 1000],
  [6000, 12000, 2000],
  [8000, 16000, 2000],
  [10000, 20000, 3000],
];

function buildPreset(durationMinutes: number): BlindLevel[] {
  return PROGRESSION.map(([smallBlind, bigBlind, ante]) => ({ smallBlind, bigBlind, ante, durationMinutes }));
}

export const BLIND_PRESETS: Record<string, BlindLevel[]> = {
  standard: buildPreset(15),
  turbo: buildPreset(5),
  hyperturbo: buildPreset(3),
};

export const BLIND_PRESET_LABELS: Record<string, string> = {
  standard: "Standard (~15 min levels)",
  turbo: "Turbo (~5 min levels)",
  hyperturbo: "Hyper-Turbo (~3 min levels)",
};

export function isValidCustomSchedule(levels: unknown): levels is BlindLevel[] {
  if (!Array.isArray(levels) || levels.length === 0 || levels.length > 100) return false;
  return levels.every(
    (l) =>
      l &&
      typeof l === "object" &&
      Number.isFinite(l.smallBlind) &&
      Number.isFinite(l.bigBlind) &&
      Number.isFinite(l.ante) &&
      Number.isFinite(l.durationMinutes) &&
      l.smallBlind > 0 &&
      l.bigBlind >= l.smallBlind &&
      l.ante >= 0 &&
      l.durationMinutes > 0 &&
      l.durationMinutes <= 24 * 60
  );
}
