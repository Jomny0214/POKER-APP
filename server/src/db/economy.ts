// Central place for the house's cut of the money in play. Change the two
// numbers below to retune the whole platform's economics -- nothing else
// needs to change.

/** Cash-game rake: this fraction of every pot a player wins is taken by
 *  the house before the rest is added to their stack. Applied per pot, per
 *  winner, flat -- no "no flop no drop" exemption and no cap, on purpose,
 *  per product decision. Revisit here if that ever needs to change. */
export const CASH_RAKE_RATE = 0.04;

/** Tournament registration fee: this fraction of every buy-in is kept by
 *  the house; the remainder is what actually funds the prize pool. A
 *  player who unregisters before the tournament starts is refunded in
 *  full, fee included -- see TournamentManager.unregister(). Rebuys are
 *  NOT fee'd; the whole rebuy price goes to the prize pool. */
export const TOURNAMENT_FEE_RATE = 0.08;

/** Floor a raw chip amount down to a whole chip after applying a rate.
 *  Always rounds in the house's favor by truncating (never rounds up),
 *  so the house never takes more than the stated percentage. */
export function applyRate(amount: number, rate: number): number {
  return Math.floor(amount * rate);
}
