import { randomBytes } from "crypto";
import { db } from "./database";

// "Forgot password" reset tokens. A token is a random 64-char hex string
// (256 bits -- unguessable), single-use, and expires 30 minutes after
// issue. See db/database.ts for the table definition.

const TOKEN_TTL_MS = 30 * 60 * 1000;

const insertStmt = db.prepare(
  `INSERT INTO password_reset_tokens (token, user_id, created_at, expires_at, used) VALUES (?, ?, ?, ?, 0)`
);
const getStmt = db.prepare(`SELECT * FROM password_reset_tokens WHERE token = ?`);
const markUsedStmt = db.prepare(`UPDATE password_reset_tokens SET used = 1 WHERE token = ?`);
// A fresh request invalidates any earlier outstanding token for this user,
// so if someone requests a reset twice, only the most recently emailed link
// still works (an old, unread email in an inbox can't be used later).
const invalidateForUserStmt = db.prepare(`UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0`);

interface ResetTokenRow {
  token: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  used: number;
}

export function createResetToken(userId: string): string {
  invalidateForUserStmt.run(userId);
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  insertStmt.run(token, userId, now, now + TOKEN_TTL_MS);
  return token;
}

/** Validates and burns a token in one step. Returns the user id it belonged
 * to, or null if the token is unknown, already used, or expired. */
export function consumeResetToken(token: string): string | null {
  const row = getStmt.get(token) as unknown as ResetTokenRow | undefined;
  if (!row || row.used || row.expires_at < Date.now()) return null;
  markUsedStmt.run(token);
  return row.user_id;
}
