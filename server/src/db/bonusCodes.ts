import { db } from "./database";
import { credit } from "./wallet";

// Promo/beta-invite chip codes: an admin creates a code worth N chips, hands
// it out (e.g. "use code BETA500 after you sign in"), and each account can
// redeem any given code exactly once. Not tied to real money in any way --
// this is purely a way to hand starting chips to a batch of beta testers
// without the admin crediting each account by hand.

db.exec(`
CREATE TABLE IF NOT EXISTS bonus_codes (
  code TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS bonus_code_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL REFERENCES bonus_codes(code),
  user_id TEXT NOT NULL REFERENCES users(id),
  redeemed_at INTEGER NOT NULL,
  UNIQUE(code, user_id)
);
`);

export class BonusCodeError extends Error {}

export interface BonusCodeRow {
  code: string;
  amount: number;
  active: number;
  created_at: number;
  created_by: string | null;
}

const insertCodeStmt = db.prepare(
  `INSERT INTO bonus_codes (code, amount, active, created_at, created_by) VALUES (?, ?, 1, ?, ?)`
);
const getCodeStmt = db.prepare(`SELECT * FROM bonus_codes WHERE code = ?`);
const listCodesStmt = db.prepare(`SELECT * FROM bonus_codes ORDER BY created_at DESC`);
const insertRedemptionStmt = db.prepare(
  `INSERT INTO bonus_code_redemptions (code, user_id, redeemed_at) VALUES (?, ?, ?)`
);
const hasRedeemedStmt = db.prepare(
  `SELECT 1 FROM bonus_code_redemptions WHERE code = ? AND user_id = ?`
);
const redemptionCountStmt = db.prepare(
  `SELECT COUNT(*) AS n FROM bonus_code_redemptions WHERE code = ?`
);

/** Admin: create a new redeemable code, e.g. createBonusCode("BETA500", 500, adminId). */
export function createBonusCode(code: string, amount: number, createdBy: string): BonusCodeRow {
  const cleanCode = code.trim().toUpperCase();
  const cleanAmount = Math.floor(Number(amount));
  if (!cleanCode || !/^[A-Z0-9_-]{3,32}$/.test(cleanCode)) {
    throw new BonusCodeError("Code must be 3-32 letters/numbers/-/_ characters");
  }
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0 || cleanAmount > 1_000_000) {
    throw new BonusCodeError("Amount must be a positive number (up to 1,000,000)");
  }
  if (getCodeStmt.get(cleanCode)) {
    throw new BonusCodeError("That code already exists");
  }
  insertCodeStmt.run(cleanCode, cleanAmount, Date.now(), createdBy);
  return getCodeStmt.get(cleanCode) as unknown as BonusCodeRow;
}

/** Admin: list every bonus code with how many times it's been redeemed. */
export function listBonusCodes(): (BonusCodeRow & { redemptions: number })[] {
  const codes = listCodesStmt.all() as unknown as BonusCodeRow[];
  return codes.map((c) => ({
    ...c,
    redemptions: (redemptionCountStmt.get(c.code) as { n: number }).n,
  }));
}

/** Player: redeem a code for the chips it's worth. Throws if invalid, inactive, or already used by this account. */
export function redeemBonusCode(code: string, userId: string): number {
  const cleanCode = code.trim().toUpperCase();
  const row = getCodeStmt.get(cleanCode) as unknown as BonusCodeRow | undefined;
  if (!row || !row.active) {
    throw new BonusCodeError("That bonus code isn't valid");
  }
  if (hasRedeemedStmt.get(cleanCode, userId)) {
    throw new BonusCodeError("You've already redeemed this code");
  }
  insertRedemptionStmt.run(cleanCode, userId, Date.now());
  return credit(userId, "bonus", row.amount, `bonus-code-${cleanCode}`);
}
