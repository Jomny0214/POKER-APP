/**
 * "Vector" payout model -- ported verbatim from the user's own
 * poker-payout-api service (calculateVectorPayouts() in its index.js). The
 * share percentages, the 2/3 decay ratio, the final-table/outer-tier split
 * for large fields, and every edge case below (including the "always pay at
 * least 3 spots once the field reaches 10 players" behavior that falls out
 * of ftShare's fixed 3-entry base) are exactly what that script computes.
 * Nothing here is invented or adjusted -- only reshaped from percent-of-pool
 * + grouped tiers into a flat per-rank array so it plugs into this app's
 * rank-indexed payout table, and from fractional USD into integer chips.
 */

/** Percentage of the prize pool each paid finishing place gets, in rank
 * order (index 0 = 1st). Length is however many places the source script's
 * rules pay for this field size. */
function shareVector(totalPlayers: number): number[] {
  if (totalPlayers <= 0) return [];

  if (totalPlayers <= 3) return [100];

  if (totalPlayers < 10) return [50, 30, 20];

  const placesPaid = Math.max(1, Math.floor(totalPlayers * 0.1));
  const decayRatio = 2 / 3;
  const ftShare: number[] = [22.5, 15.0, 10.0];
  for (let pos = 4; pos <= Math.min(9, placesPaid); pos++) {
    const prevWeight = ftShare[pos - 2];
    ftShare.push(Number((prevWeight * decayRatio).toFixed(2)));
  }

  if (placesPaid <= 9) {
    const rawSum = ftShare.reduce((a, b) => a + b, 0);
    return ftShare.map((val) => Number(((val / rawSum) * 100).toFixed(2)));
  }

  // Multi-table: final table (1st-9th) paid individually off ftShare; the
  // rest of the field paid in 9-wide grouped tiers with 0.65^tier decay.
  const outerCount = placesPaid - 9;
  const outerPoolPct = Math.min(35.0, outerCount * 0.7);
  const ftPoolPct = 100.0 - outerPoolPct;
  const ftRawSum = ftShare.reduce((a, b) => a + b, 0);
  const shares = ftShare.map((val) => Number(((val / ftRawSum) * ftPoolPct).toFixed(2)));

  const numTiers = Math.ceil(outerCount / 9);
  const tierWeights: number[] = [];
  let tierWeightSum = 0;
  for (let t = 0; t < numTiers; t++) {
    const tw = Math.pow(0.65, t);
    tierWeights.push(tw);
    tierWeightSum += tw;
  }

  let currentPos = 10;
  for (let t = 0; t < numTiers; t++) {
    const playersInTier = Math.min(9, placesPaid - currentPos + 1);
    const tierTotalPct = (tierWeights[t] / tierWeightSum) * outerPoolPct;
    const individualPct = Number((tierTotalPct / playersInTier).toFixed(3));
    // Every player within a grouped tier is paid the same share -- expand
    // that one tier-level number into one entry per rank in the tier.
    for (let i = 0; i < playersInTier; i++) shares.push(individualPct);
    currentPos += playersInTier;
  }

  return shares;
}

/** How many places get paid for a field of this size. */
export function paidSpots(numEntrants: number): number {
  return shareVector(numEntrants).length;
}

/** Returns prize amounts by finishing place (index 0 = 1st), summing exactly
 * to `prizePool`. */
export function computePayouts(prizePool: number, numEntrants: number): number[] {
  const shares = shareVector(numEntrants);
  if (shares.length === 0 || prizePool <= 0) return [];

  // The source script works in fractional USD off players*buyIn; this app's
  // economy is integer chips off the actual accumulated prize pool (buy-ins
  // minus house fee), so the percentages are applied to that pool instead
  // and floored/remaindered to land on an exact integer total.
  const amounts = shares.map((pct) => Math.floor((pct / 100) * prizePool));
  const remainder = prizePool - amounts.reduce((a, b) => a + b, 0);
  if (remainder > 0) {
    // Hand out leftover chips (from flooring) one at a time starting at
    // 1st, which keeps the total exact without breaking the descending order.
    let i = 0;
    for (let n = remainder; n > 0; n--) {
      amounts[i % amounts.length] += 1;
      i += 1;
    }
  } else if (remainder < 0) {
    // The source script's own rounding (toFixed on normalized percentages)
    // can make its share vector sum to slightly over 100% for some field
    // sizes -- when that happens the floored chip amounts would otherwise
    // total more than the actual prize pool exists to pay. Trim the surplus
    // one chip at a time starting from the last (smallest) paid place,
    // cycling backward, so the pool is never overpaid and the top places
    // are the last ones touched.
    let i = amounts.length - 1;
    for (let over = -remainder; over > 0; ) {
      if (amounts[i] > 0) {
        amounts[i] -= 1;
        over -= 1;
      }
      i = i === 0 ? amounts.length - 1 : i - 1;
    }
  }
  return amounts;
}
