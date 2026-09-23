import { db } from "./database";
import { credit } from "./wallet";

export type DepositStatus = "pending" | "approved" | "rejected";

export interface DepositRequestRow {
  id: number;
  user_id: string;
  username: string;
  amount: number;
  note: string | null;
  status: DepositStatus;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
}

export class DepositRequestError extends Error {}

const insertStmt = db.prepare(
  `INSERT INTO deposit_requests (user_id, username, amount, note, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`
);
const getStmt = db.prepare(`SELECT * FROM deposit_requests WHERE id = ?`);
const listForUserStmt = db.prepare(
  `SELECT * FROM deposit_requests WHERE user_id = ? ORDER BY id DESC LIMIT 50`
);
const listPendingStmt = db.prepare(
  `SELECT * FROM deposit_requests WHERE status = 'pending' ORDER BY id ASC`
);
const resolveStmt = db.prepare(
  `UPDATE deposit_requests SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?`
);

/**
 * Player submits a claim that they made a real bank transfer. This does NOT
 * touch the wallet ledger -- it only creates a "pending" row that an admin
 * reviews once the transfer actually shows up in the bank account.
 */
export function createDepositRequest(
  userId: string,
  username: string,
  amount: number,
  note?: string
): DepositRequestRow {
  const cleanAmount = Math.floor(Number(amount));
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0 || cleanAmount > 1_000_000) {
    throw new DepositRequestError("Invalid amount");
  }
  const now = Date.now();
  const result = insertStmt.run(userId, username, cleanAmount, note?.trim() || null, now);
  return getStmt.get(Number(result.lastInsertRowid)) as unknown as DepositRequestRow;
}

export function listMyDepositRequests(userId: string): DepositRequestRow[] {
  return listForUserStmt.all(userId) as unknown as DepositRequestRow[];
}

export function listPendingDepositRequests(): DepositRequestRow[] {
  return listPendingStmt.all() as unknown as DepositRequestRow[];
}

/** Admin confirms the real bank transfer arrived: credits chips and closes the request. */
export function approveDepositRequest(id: number, resolvedBy: string): DepositRequestRow {
  const row = getStmt.get(id) as unknown as DepositRequestRow | undefined;
  if (!row) throw new DepositRequestError("Deposit request not found");
  if (row.status !== "pending") throw new DepositRequestError("Deposit request already resolved");
  credit(row.user_id, "deposit", row.amount, `deposit-request-${id}`);
  resolveStmt.run("approved", Date.now(), resolvedBy, id);
  return getStmt.get(id) as unknown as DepositRequestRow;
}

/** Admin declines the request (no matching transfer found) -- no chips move. */
export function rejectDepositRequest(id: number, resolvedBy: string): DepositRequestRow {
  const row = getStmt.get(id) as unknown as DepositRequestRow | undefined;
  if (!row) throw new DepositRequestError("Deposit request not found");
  if (row.status !== "pending") throw new DepositRequestError("Deposit request already resolved");
  resolveStmt.run("rejected", Date.now(), resolvedBy, id);
  return getStmt.get(id) as unknown as DepositRequestRow;
}
