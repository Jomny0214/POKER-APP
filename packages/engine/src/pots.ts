export interface Contribution {
  playerId: string;
  amount: number; // total chips this player put into the pot this hand
  folded: boolean;
}

export interface Pot {
  amount: number;
  eligiblePlayerIds: string[]; // players who can win this pot (not folded, contributed enough)
}

/**
 * Splits total contributions into a main pot and side pots based on
 * all-in amounts, standard Texas Hold'em side-pot algorithm.
 */
export function buildPots(contributions: Contribution[]): Pot[] {
  const active = contributions.filter((c) => c.amount > 0);
  if (active.length === 0) return [];

  const levels = [...new Set(active.map((c) => c.amount))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prevLevel = 0;

  for (const level of levels) {
    const slice = level - prevLevel;
    const payers = active.filter((c) => c.amount >= level);
    const potAmount = slice * payers.length;
    if (potAmount > 0) {
      const eligible = payers.filter((c) => !c.folded).map((c) => c.playerId);
      pots.push({ amount: potAmount, eligiblePlayerIds: eligible });
    }
    prevLevel = level;
  }

  // Merge consecutive pots that have identical eligibility (cosmetic, keeps
  // pot count minimal when no one is actually short-stacked at a level).
  const merged: Pot[] = [];
  for (const p of pots) {
    const last = merged[merged.length - 1];
    if (last && sameSet(last.eligiblePlayerIds, p.eligiblePlayerIds)) {
      last.amount += p.amount;
    } else {
      merged.push({ ...p });
    }
  }
  return merged;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}
