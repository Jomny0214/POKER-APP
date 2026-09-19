import { Card, rankOf, suitOf } from "./cards";

// ---------------------------------------------------------------------------
// Core 5-card classification, shared by the high evaluator and the
// deuce-to-seven low evaluator (which is just "high hand, but smaller is
// better, and the ace never plays low for a wheel straight").
// ---------------------------------------------------------------------------

export const HandCategory = {
  HighCard: 0,
  OnePair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;

export interface FiveCardResult {
  category: number;
  // Tiebreak ranks, most significant first, DESCENDING-is-better within a
  // category (mirrors standard high-poker kicker ordering).
  ranks: number[];
  cards: Card[];
}

export function groupByRank(ranks: number[]): { rank: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => (b.count - a.count) || (b.rank - a.rank));
}

/**
 * Classifies exactly 5 cards as a standard high-poker hand.
 * @param aceLowStraight if true, A-2-3-4-5 counts as a straight (the wheel),
 *   ranked below 6-high straight. If false (2-7 lowball uses this), the ace
 *   only ever plays high, so A-2-3-4-5 is just ace-high no pair.
 */
export function evaluate5(cards: Card[], aceLowStraight = true): FiveCardResult {
  if (cards.length !== 5) throw new Error("evaluate5 requires exactly 5 cards");
  const ranks = cards.map(rankOf);
  const suits = cards.map(suitOf);
  const isFlush = suits.every((s) => s === suits[0]);

  const uniqueRanks = [...new Set(ranks)].sort((a, b) => b - a);
  let isStraight = false;
  let straightHigh = 0;
  if (uniqueRanks.length === 5) {
    if (uniqueRanks[0] - uniqueRanks[4] === 4) {
      isStraight = true;
      straightHigh = uniqueRanks[0];
    } else if (
      aceLowStraight &&
      uniqueRanks[0] === 14 &&
      uniqueRanks[1] === 5 &&
      uniqueRanks[2] === 4 &&
      uniqueRanks[3] === 3 &&
      uniqueRanks[4] === 2
    ) {
      // wheel: A-5-4-3-2
      isStraight = true;
      straightHigh = 5;
    }
  }

  const groups = groupByRank(ranks);
  const shape = groups.map((g) => g.count);

  if (isStraight && isFlush) {
    return { category: HandCategory.StraightFlush, ranks: [straightHigh], cards };
  }
  if (shape[0] === 4) {
    const quad = groups[0].rank;
    const kicker = groups[1].rank;
    return { category: HandCategory.Quads, ranks: [quad, kicker], cards };
  }
  if (shape[0] === 3 && shape[1] === 2) {
    return { category: HandCategory.FullHouse, ranks: [groups[0].rank, groups[1].rank], cards };
  }
  if (isFlush) {
    return { category: HandCategory.Flush, ranks: ranks.slice().sort((a, b) => b - a), cards };
  }
  if (isStraight) {
    return { category: HandCategory.Straight, ranks: [straightHigh], cards };
  }
  if (shape[0] === 3) {
    const trip = groups[0].rank;
    const kickers = groups.slice(1).map((g) => g.rank).sort((a, b) => b - a);
    return { category: HandCategory.Trips, ranks: [trip, ...kickers], cards };
  }
  if (shape[0] === 2 && shape[1] === 2) {
    const [hi, lo] = [groups[0].rank, groups[1].rank].sort((a, b) => b - a);
    const kicker = groups[2].rank;
    return { category: HandCategory.TwoPair, ranks: [hi, lo, kicker], cards };
  }
  if (shape[0] === 2) {
    const pair = groups[0].rank;
    const kickers = groups.slice(1).map((g) => g.rank).sort((a, b) => b - a);
    return { category: HandCategory.OnePair, ranks: [pair, ...kickers], cards };
  }
  return { category: HandCategory.HighCard, ranks: ranks.slice().sort((a, b) => b - a), cards };
}

export function compareFiveCardDesc(a: FiveCardResult, b: FiveCardResult): number {
  // Returns >0 if a is better (higher), <0 if b is better.
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i++) {
    const av = a.ranks[i] ?? -1;
    const bv = b.ranks[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  const n = arr.length;
  if (k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map((i) => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

export interface BestHandResult extends FiveCardResult {
  description: string;
}

const CATEGORY_NAMES = [
  "High Card",
  "Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
];

export function describeHigh(res: FiveCardResult): string {
  return CATEGORY_NAMES[res.category];
}

/** Best 5-card high hand out of 5..7 cards (Hold'em / Omaha style, high side). */
export function evaluateBestHigh(cards: Card[]): BestHandResult {
  if (cards.length < 5) throw new Error("Need at least 5 cards");
  let best: FiveCardResult | null = null;
  for (const combo of combinations(cards, 5)) {
    const r = evaluate5(combo, true);
    if (!best || compareFiveCardDesc(r, best) > 0) best = r;
  }
  return { ...best!, description: describeHigh(best!) };
}

/** Best 5-card 2-7 lowball hand: smaller category/ranks is better; ace never low. */
export function evaluateBest27Low(cards: Card[]): BestHandResult {
  if (cards.length < 5) throw new Error("Need at least 5 cards");
  let best: FiveCardResult | null = null;
  for (const combo of combinations(cards, 5)) {
    const r = evaluate5(combo, false);
    if (!best || compareFiveCardDesc(r, best) < 0) best = r;
  }
  return { ...best!, description: `${best!.ranks[0] === 14 ? "Ace" : best!.ranks[0]}-low (${describeHigh(best!)})` };
}

// ---------------------------------------------------------------------------
// Ace-to-five lowball (A-5 low): used for Razz and Omaha Hi/Lo's low side.
// Ace plays low (1). Straights and flushes are irrelevant — a hand is judged
// purely by rank duplication (fewer/lower duplicates = better) and then by
// the actual rank values, smallest-is-best.
// ---------------------------------------------------------------------------

export interface LowResult {
  qualifies: boolean;
  // shape badness: 0 = no pair (best) .. 5 = quads (worst)
  badness: number;
  // ranks ordered by (group size desc, rank desc) with ace=1 -- smaller is better
  ranks: number[];
  cards: Card[];
  description: string;
}

function aceLowRank(rank: number): number {
  return rank === 14 ? 1 : rank;
}

function evaluate5AceToFiveLow(cards: Card[]): LowResult {
  const ranks = cards.map((c) => aceLowRank(rankOf(c)));
  const groups = groupByRank(ranks); // sorted by count desc, rank desc
  const shapeToBadness: Record<string, number> = {
    "1,1,1,1,1": 0,
    "2,1,1,1": 1,
    "2,2,1": 2,
    "3,1,1": 3,
    "3,2": 4,
    "4,1": 5,
  };
  const shapeKey = groups.map((g) => g.count).join(",");
  const badness = shapeToBadness[shapeKey] ?? 5;
  const orderedRanks = groups.flatMap((g) => Array(g.count).fill(g.rank));
  return { qualifies: true, badness, ranks: orderedRanks, cards, description: "" };
}

function compareLowAsc(a: LowResult, b: LowResult): number {
  // Returns <0 if a is better (lower/smaller), >0 if b is better.
  if (a.badness !== b.badness) return a.badness - b.badness;
  for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i++) {
    const av = a.ranks[i] ?? 0;
    const bv = b.ranks[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

const LOW_RANK_CHARS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "T"];

function describeLow(res: LowResult): string {
  const shown = res.ranks.slice(0, 5).sort((a, b) => b - a);
  return shown.map((r) => LOW_RANK_CHARS[r] ?? String(r)).join("-") + " low";
}

/**
 * Best ace-to-five low hand out of the given cards (5..7).
 * @param qualifierMax if set (e.g. 8 for "8-or-better"), the best low hand
 *   must have all 5 distinct ranks <= qualifierMax or it does not qualify.
 *   Razz has no qualifier (pass undefined). Omaha Hi/Lo uses 8.
 */
export function evaluateBestAceToFiveLow(cards: Card[], qualifierMax?: number): LowResult | null {
  if (cards.length < 5) return null;
  let best: LowResult | null = null;
  for (const combo of combinations(cards, 5)) {
    const r = evaluate5AceToFiveLow(combo);
    if (!best || compareLowAsc(r, best) < 0) best = r;
  }
  if (!best) return null;
  if (qualifierMax !== undefined) {
    if (best.badness !== 0) return null; // must be 5 distinct ranks
    if (Math.max(...best.ranks) > qualifierMax) return null;
  }
  best.description = describeLow(best);
  return best;
}

export function compareLowResults(a: LowResult, b: LowResult): number {
  return compareLowAsc(a, b);
}

// ---------------------------------------------------------------------------
// Omaha-style constrained evaluation: exactly `useHole` cards from the hole
// and `useBoard` cards from the board must be used.
// ---------------------------------------------------------------------------

export function evaluateBestHighConstrained(
  hole: Card[],
  board: Card[],
  useHole: number,
  useBoard: number
): BestHandResult {
  let best: FiveCardResult | null = null;
  for (const h of combinations(hole, useHole)) {
    for (const b of combinations(board, useBoard)) {
      const r = evaluate5([...h, ...b], true);
      if (!best || compareFiveCardDesc(r, best) > 0) best = r;
    }
  }
  if (!best) throw new Error("No valid combination");
  return { ...best, description: describeHigh(best) };
}

export function evaluateBestAceToFiveLowConstrained(
  hole: Card[],
  board: Card[],
  useHole: number,
  useBoard: number,
  qualifierMax?: number
): LowResult | null {
  let best: LowResult | null = null;
  for (const h of combinations(hole, useHole)) {
    for (const b of combinations(board, useBoard)) {
      const r = evaluate5AceToFiveLow([...h, ...b]);
      if (!best || compareLowAsc(r, best) < 0) best = r;
    }
  }
  if (!best) return null;
  if (qualifierMax !== undefined) {
    if (best.badness !== 0) return null;
    if (Math.max(...best.ranks) > qualifierMax) return null;
  }
  best.description = describeLow(best);
  return best;
}
