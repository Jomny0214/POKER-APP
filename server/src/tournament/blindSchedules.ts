export interface BlindLevel {
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationMinutes: number;
  /** True for a break level: play pauses (no new hand is dealt) for
   * `durationMinutes`, and the blinds/ante fields are unused (they just
   * repeat the level before the break so old data/UI that ignores
   * `isBreak` doesn't render zeros). */
  isBreak?: boolean;
}

/** The user's real 72-level tournament structure (source: "Ultimate Holdem
 * Timer" blind-structure PDF supplied by the user -- these are the exact
 * small/big blind values from that document, not invented). The document
 * has no ante column, so per the user's explicit instruction each level's
 * ante is computed as 10% of that level's big blind. Shared by the presets
 * below -- they only differ in level duration. */
const PROGRESSION: Array<[number, number, number]> = [
  // [smallBlind, bigBlind, ante]
  [25, 50, 5],
  [50, 100, 10],
  [75, 150, 15],
  [100, 200, 20],
  [125, 250, 25],
  [150, 300, 30],
  [175, 350, 35],
  [200, 400, 40],
  [250, 500, 50],
  [300, 600, 60],
  [350, 700, 70],
  [400, 800, 80],
  [500, 1000, 100],
  [600, 1200, 120],
  [700, 1400, 140],
  [800, 1600, 160],
  [1000, 2000, 200],
  [1500, 3000, 300],
  [2000, 4000, 400],
  [2500, 5000, 500],
  [3000, 6000, 600],
  [3500, 7000, 700],
  [4000, 8000, 800],
  [5000, 10000, 1000],
  [6000, 12000, 1200],
  [7000, 14000, 1400],
  [8000, 16000, 1600],
  [10000, 20000, 2000],
  [15000, 30000, 3000],
  [20000, 40000, 4000],
  [25000, 50000, 5000],
  [30000, 60000, 6000],
  [35000, 70000, 7000],
  [40000, 80000, 8000],
  [50000, 100000, 10000],
  [60000, 120000, 12000],
  [70000, 140000, 14000],
  [80000, 160000, 16000],
  [100000, 200000, 20000],
  [125000, 250000, 25000],
  [150000, 300000, 30000],
  [175000, 350000, 35000],
  [200000, 400000, 40000],
  [225000, 450000, 45000],
  [250000, 500000, 50000],
  [275000, 550000, 55000],
  [300000, 600000, 60000],
  [325000, 650000, 65000],
  [375000, 750000, 75000],
  [425000, 850000, 85000],
  [475000, 950000, 95000],
  [525000, 1050000, 105000],
  [575000, 1150000, 115000],
  [650000, 1300000, 130000],
  [725000, 1450000, 145000],
  [800000, 1600000, 160000],
  [900000, 1800000, 180000],
  [1000000, 2000000, 200000],
  [1130000, 2250000, 225000],
  [1250000, 2500000, 250000],
  [1400000, 2800000, 280000],
  [1580000, 3150000, 315000],
  [1750000, 3500000, 350000],
  [1950000, 3900000, 390000],
  [2180000, 4350000, 435000],
  [2430000, 4850000, 485000],
  [2700000, 5400000, 540000],
  [3030000, 6050000, 605000],
  [3380000, 6750000, 675000],
  [3780000, 7550000, 755000],
  [4230000, 8450000, 845000],
  [4730000, 9450000, 945000],
];

/** Per the PDF, a break falls after real levels 11, 22, 33, 44, 55 and 66
 * (six breaks total across the 72-level structure). */
const BREAK_AFTER_LEVEL = new Set([11, 22, 33, 44, 55, 66]);

function buildPreset(durationMinutes: number): BlindLevel[] {
  const levels: BlindLevel[] = [];
  PROGRESSION.forEach(([smallBlind, bigBlind, ante], i) => {
    levels.push({ smallBlind, bigBlind, ante, durationMinutes });
    const levelNumber = i + 1;
    if (BREAK_AFTER_LEVEL.has(levelNumber)) {
      // The break "level" repeats the blinds it follows (nothing changes
      // during a break) and is marked isBreak so the table pauses dealing
      // instead of applying them as a new level.
      levels.push({ smallBlind, bigBlind, ante, durationMinutes, isBreak: true });
    }
  });
  return levels;
}

export const BLIND_PRESETS: Record<string, BlindLevel[]> = {
  standard: buildPreset(15),
  turbo: buildPreset(5),
  hyperturbo: buildPreset(3),
};

export const BLIND_PRESET_LABELS: Record<string, string> = {
  standard: "Standard (~15 min levels, with breaks)",
  turbo: "Turbo (~5 min levels, with breaks)",
  hyperturbo: "Hyper-Turbo (~3 min levels, with breaks)",
};

/** Index into a BLIND_PRESETS[...] array (0-indexed, includes the break rows
 * ahead of it) that corresponds to "re-entry until end of level 13" from the
 * PDF -- i.e. the default `rebuyPeriodValue` a "levels"-windowed rebuy should
 * use with these presets, since one break (after level 11) sits ahead of
 * level 13 in the array. Exposed so the tournament-creation form can default
 * to it instead of an invented number. */
export const REENTRY_THROUGH_REAL_LEVEL_13 = 14;

export function isValidCustomSchedule(levels: unknown): levels is BlindLevel[] {
  if (!Array.isArray(levels) || levels.length === 0 || levels.length > 200) return false;
  return levels.every(
    (l) =>
      l &&
      typeof l === "object" &&
      Number.isFinite(l.durationMinutes) &&
      l.durationMinutes > 0 &&
      l.durationMinutes <= 24 * 60 &&
      (l.isBreak
        ? true
        : Number.isFinite(l.smallBlind) &&
          Number.isFinite(l.bigBlind) &&
          Number.isFinite(l.ante) &&
          l.smallBlind > 0 &&
          l.bigBlind >= l.smallBlind &&
          l.ante >= 0)
  );
}
