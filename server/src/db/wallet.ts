import { db } from "./database";

export type LedgerType =
  | "deposit"
  | "withdrawal"
  | "buyin"
  | "cashout"
  | "hand_win"
  | "hand_loss"
  | "adjustment"
  | "tournament_buyin"
  | "tournament_cashout"
  | "tournament_rebuy"
  | "tournament_payout";

export class InsufficientFundsError extends Error {
  constructor() {
    super("Insufficient funds");
  }
}

const getBalanceStmt = db.prepare(
  `SELECT balance_after FROM ledger_entries WHERE user_id = ? ORDER BY id DESC LIMIT 1`
);
const insertLedgerStmt = db.prepare(
  `INSERT INTO ledger_entries (user_id, type, amount, balance_after, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)`
);

export function getBalance(userId: string): number {
  const row = getBalanceStmt.get(userId) as { balance_after: number } | undefined;
  return row ? Number(row.balance_after) : 0;
}

/**
 * Appends one ledger row for `userId`. Positive amount = credit, negative =
 * debit. This is the ONLY way chip balances change; nothing in the table
 * layer touches ledger_entries directly, so every unit gained or lost by a
 * player traces back to exactly one row here.
 */
function record(userId: string, type: LedgerType, amount: number, ref?: string): number {
  const current = getBalance(userId);
  const next = current + amount;
  if (next < 0) throw new InsufficientFundsError();
  insertLedgerStmt.run(userId, type, amount, next, ref ?? null, Date.now());
  return next;
}

export function credit(userId: string, type: LedgerType, amount: number, ref?: string): number {
  if (amount <= 0) throw new Error("credit amount must be positive");
  return record(userId, type, amount, ref);
}

export function debit(userId: string, type: LedgerType, amount: number, ref?: string): number {
  if (amount <= 0) throw new Error("debit amount must be positive");
  return record(userId, type, -amount, ref);
}

/** Runs `fn` inside a SQLite transaction; rolls back on any thrown error. */
export function withTransaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function ledgerHistory(userId: string, limit = 50) {
  const stmt = db.prepare(
    `SELECT id, type, amount, balance_after, ref, created_at FROM ledger_entries WHERE user_id = ? ORDER BY id DESC LIMIT ?`
  );
  return stmt.all(userId, limit);
}
