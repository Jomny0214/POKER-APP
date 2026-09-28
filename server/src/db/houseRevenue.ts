import { db } from "./database";

export type HouseRevenueKind = "cash_rake" | "tournament_fee";

const insertStmt = db.prepare(
  `INSERT INTO house_revenue (kind, amount, table_id, tournament_id, user_id, ref, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

/** Records chips taken by the house out of a cash-game pot. Called once per
 *  hand with the total rake collected across every pot/winner in that hand. */
export function recordCashRake(tableId: string, amount: number, ref?: string): void {
  if (amount <= 0) return;
  insertStmt.run("cash_rake", amount, tableId, null, null, ref ?? null, Date.now());
}

/** Records the house's cut of a single tournament registration buy-in. */
export function recordTournamentFee(tournamentId: string, userId: string, amount: number, ref?: string): void {
  if (amount <= 0) return;
  insertStmt.run("tournament_fee", amount, null, tournamentId, userId, ref ?? null, Date.now());
}

/** Reverses a previously-recorded tournament fee (used when a player
 *  unregisters before the tournament starts and gets a full refund). */
export function reverseTournamentFee(tournamentId: string, userId: string, amount: number, ref?: string): void {
  if (amount <= 0) return;
  insertStmt.run("tournament_fee", -amount, null, tournamentId, userId, ref ?? null, Date.now());
}

export function totalHouseRevenue(): { cashRake: number; tournamentFees: number; total: number } {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'cash_rake' THEN amount ELSE 0 END), 0) AS cash_rake,
         COALESCE(SUM(CASE WHEN kind = 'tournament_fee' THEN amount ELSE 0 END), 0) AS tournament_fees
       FROM house_revenue`
    )
    .get() as { cash_rake: number; tournament_fees: number };
  return {
    cashRake: Number(row.cash_rake),
    tournamentFees: Number(row.tournament_fees),
    total: Number(row.cash_rake) + Number(row.tournament_fees),
  };
}

export function houseRevenueHistory(limit = 200) {
  return db
    .prepare(
      `SELECT id, kind, amount, table_id, tournament_id, user_id, ref, created_at
       FROM house_revenue ORDER BY id DESC LIMIT ?`
    )
    .all(limit);
}
