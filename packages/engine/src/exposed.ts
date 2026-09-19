import { Card, rankOf, suitOf } from "./cards";
import { groupByRank } from "./evaluator";

// Helpers for stud-style games: who brings it in on 3rd street, and who
// acts first on each subsequent street, based only on the up-cards
// currently showing. These use the informal "best/worst board" comparison
// casinos use at the table (grouped-rank ordering), not a full 5-card
// evaluation, since players may be showing as few as 1-4 cards.

// Standard suit order for breaking single-card ties (bring-in only):
// clubs < diamonds < hearts < spades.
function suitRank(card: Card): number {
  return suitOf(card);
}

/** Lowest single up-card brings it in (7-Stud / 7-Stud Hi-Lo). Ties broken by suit (low). */
export function lowestUpCard(playerIds: string[], upCards: Map<string, Card[]>): string {
  let best: { id: string; rank: number; suit: number } | null = null;
  for (const id of playerIds) {
    const cards = upCards.get(id) ?? [];
    for (const c of cards) {
      const rank = rankOf(c);
      const suit = suitRank(c);
      if (!best || rank < best.rank || (rank === best.rank && suit < best.suit)) {
        best = { id, rank, suit };
      }
    }
  }
  return best!.id;
}

/** Highest single up-card brings it in (Razz). Ties broken by suit (high). */
export function highestUpCard(playerIds: string[], upCards: Map<string, Card[]>): string {
  let best: { id: string; rank: number; suit: number } | null = null;
  for (const id of playerIds) {
    const cards = upCards.get(id) ?? [];
    for (const c of cards) {
      const rank = rankOf(c);
      const suit = suitRank(c);
      if (!best || rank > best.rank || (rank === best.rank && suit > best.suit)) {
        best = { id, rank, suit };
      }
    }
  }
  return best!.id;
}

function exposedScoreHigh(cards: Card[]): number[] {
  const ranks = cards.map(rankOf);
  const groups = groupByRank(ranks); // count desc, rank desc
  return groups.flatMap((g) => Array(g.count).fill(g.rank));
}

/** Player with the best-looking exposed high hand acts first (4th-7th street, Stud/Stud Hi-Lo). */
export function bestExposedHigh(playerIds: string[], upCards: Map<string, Card[]>): string {
  let bestId = playerIds[0];
  let bestScore = exposedScoreHigh(upCards.get(bestId) ?? []);
  for (const id of playerIds.slice(1)) {
    const score = exposedScoreHigh(upCards.get(id) ?? []);
    if (compareTuplesDesc(score, bestScore) > 0) {
      bestId = id;
      bestScore = score;
    }
  }
  return bestId;
}

function exposedScoreLow(cards: Card[]): number[] {
  const ranks = cards.map((c) => (rankOf(c) === 14 ? 1 : rankOf(c)));
  const groups = groupByRank(ranks);
  return groups.flatMap((g) => Array(g.count).fill(g.rank));
}

/** Player with the best-looking exposed low hand acts first (4th-7th street, Razz). */
export function bestExposedLow(playerIds: string[], upCards: Map<string, Card[]>): string {
  let bestId = playerIds[0];
  let bestScore = exposedScoreLow(upCards.get(bestId) ?? []);
  for (const id of playerIds.slice(1)) {
    const score = exposedScoreLow(upCards.get(id) ?? []);
    if (compareTuplesDesc(score, bestScore) < 0) {
      bestId = id;
      bestScore = score;
    }
  }
  return bestId;
}

function compareTuplesDesc(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? -1;
    const bv = b[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}
