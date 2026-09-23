/**
 * Standard-shape, percentage-based MTT payout curve: roughly the top 15% of
 * the field is paid, with a monotonically decreasing share per place (1st
 * gets the largest cut, tapering off toward the min-cash spot). Not modeled
 * on any specific site's exact numbers -- just a fair, smooth decay curve
 * that happens to land close to the commonly-cited "~30/20/14/..." shape for
 * small-to-mid fields.
 */
export function paidSpots(numEntrants: number): number {
  if (numEntrants <= 1) return numEntrants;
  return Math.max(1, Math.min(numEntrants, Math.round(numEntrants * 0.15)));
}

/** Returns prize amounts by finishing place (index 0 = 1st), summing exactly
 * to `prizePool`. */
export function computePayouts(prizePool: number, numEntrants: number): number[] {
  const spots = paidSpots(numEntrants);
  if (spots <= 0 || prizePool <= 0) return [];
  if (spots === 1) return [prizePool];

  const weights = Array.from({ length: spots }, (_, i) => 1 / Math.pow(i + 1, 0.9));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const amounts = weights.map((w) => Math.floor((w / weightSum) * prizePool));
  let remainder = prizePool - amounts.reduce((a, b) => a + b, 0);
  // Hand out leftover chips (from flooring) one at a time starting at 1st,
  // which keeps the total exact without breaking the descending order.
  let i = 0;
  while (remainder > 0) {
    amounts[i % amounts.length] += 1;
    remainder -= 1;
    i += 1;
  }
  return amounts;
}
