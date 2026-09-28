import { Card, rankOf, suitOf } from "./cards";
import { groupByRank } from "./evaluator";

// Helpers for stud-style games: who brings it in on 3rd street, and who
// acts first on each subsequent street, based only on the up-cards
// currently showing. These use the "best/worst board" comparison casinos
// use at the table (grouped-rank ordering, not a full 5-card evaluation,
// since players may be showing as few as 1-4 cards), with full suit-based
// tiebreaking per Robert's Rules of Poker whenever two or more players'
// up-cards are an exact rank-for-rank tie.

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

// Full suit-ranking edge case (Robert's Rules of Poker): when two or more
// players' exposed up-cards are an exact rank-for-rank tie (same pairs,
// same kickers, all the way down), the tie is broken by the suit of each
// player's single highest up-card -- higher suit (toward spades) is
// considered the technically-better hand and acts first. This mirrors the
// same suit convention already used for bring-in ties (lowestUpCard /
// highestUpCard above), just applied to the 4th-7th-street "who acts
// first" decision instead of 3rd street.
function highCardSuit(cards: Card[]): number {
  let bestRank = -1;
  let bestSuit = -1;
  for (const c of cards) {
    const rank = rankOf(c);
    const suit = suitRank(c);
    if (rank > bestRank || (rank === bestRank && suit > bestSuit)) {
      bestRank = rank;
      bestSuit = suit;
    }
  }
  return bestSuit;
}

/** Player with the best-looking exposed high hand acts first (4th-7th street, Stud/Stud Hi-Lo). */
export function bestExposedHigh(playerIds: string[], upCards: Map<string, Card[]>): string {
  let bestId = playerIds[0];
  let bestCards = upCards.get(bestId) ?? [];
  let bestScore = exposedScoreHigh(bestCards);
  for (const id of playerIds.slice(1)) {
    const cards = upCards.get(id) ?? [];
    const score = exposedScoreHigh(cards);
    const cmp = compareTuplesDesc(score, bestScore);
    if (cmp > 0 || (cmp === 0 && highCardSuit(cards) > highCardSuit(bestCards))) {
      bestId = id;
      bestCards = cards;
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

// Same edge case as highCardSuit, mirrored for low games (Razz): on an
// exact tie, the player's lowest-ranked up-card (ace counts as 1) with the
// LOWER suit (toward clubs) is considered the technically-better low hand,
// matching lowestUpCard's bring-in direction.
function lowCardSuit(cards: Card[]): number {
  let bestRank = Infinity;
  let bestSuit = 4;
  for (const c of cards) {
    const rank = rankOf(c) === 14 ? 1 : rankOf(c);
    const suit = suitRank(c);
    if (rank < bestRank || (rank === bestRank && suit < bestSuit)) {
      bestRank = rank;
      bestSuit = suit;
    }
  }
  return bestSuit;
}

/** Player with the best-looking exposed low hand acts first (4th-7th street, Razz). */
export function bestExposedLow(playerIds: string[], upCards: Map<string, Card[]>): string {
  let bestId = playerIds[0];
  let bestCards = upCards.get(bestId) ?? [];
  let bestScore = exposedScoreLow(bestCards);
  for (const id of playerIds.slice(1)) {
    const cards = upCards.get(id) ?? [];
    const score = exposedScoreLow(cards);
    const cmp = compareTuplesDesc(score, bestScore);
    if (cmp < 0 || (cmp === 0 && lowCardSuit(cards) < lowCardSuit(bestCards))) {
      bestId = id;
      bestCards = cards;
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
