import { randomUUID, randomBytes } from "crypto";
import { db } from "./database";

export interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  password_salt: string;
  created_at: number;
}

const insertUserStmt = db.prepare(
  `INSERT INTO users (id, email, username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)`
);
const getByEmailStmt = db.prepare(`SELECT * FROM users WHERE email = ?`);
const getByUsernameStmt = db.prepare(`SELECT * FROM users WHERE username = ?`);
const getByIdStmt = db.prepare(`SELECT * FROM users WHERE id = ?`);
const listAllStmt = db.prepare(`SELECT * FROM users ORDER BY username COLLATE NOCASE`);

export class UserExistsError extends Error {
  constructor() {
    super("An account with that email or username already exists");
  }
}

export function createUser(email: string, username: string, passwordHash: string, passwordSalt: string): UserRow {
  if (getByEmailStmt.get(email) || getByUsernameStmt.get(username)) {
    throw new UserExistsError();
  }
  const id = randomUUID();
  insertUserStmt.run(id, email, username, passwordHash, passwordSalt, Date.now());
  return getByIdStmt.get(id) as unknown as UserRow;
}

export function findByEmail(email: string): UserRow | undefined {
  return getByEmailStmt.get(email) as unknown as UserRow | undefined;
}

export function findById(id: string): UserRow | undefined {
  return getByIdStmt.get(id) as unknown as UserRow | undefined;
}

export function findByUsername(username: string): UserRow | undefined {
  return getByUsernameStmt.get(username) as unknown as UserRow | undefined;
}

export function listAll(): UserRow[] {
  return listAllStmt.all() as unknown as UserRow[];
}

const updatePasswordStmt = db.prepare(`UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?`);

/** Used by both the "forgot password" reset flow and (were it ever added) a
 * logged-in change-password flow. Does not touch sessions -- callers that
 * want existing logins invalidated do that separately. */
export function updatePassword(id: string, passwordHash: string, passwordSalt: string): void {
  updatePasswordStmt.run(passwordHash, passwordSalt, id);
}

const anonymizeStmt = db.prepare(
  `UPDATE users SET email = ?, username = ?, password_hash = ?, password_salt = ?, deleted_at = ? WHERE id = ?`
);

/** Self-service account deletion, scoped by the product decision to require
 * a zero wallet balance and no active seat first (enforced by the caller in
 * routes.ts before this runs). Rather than a hard DELETE -- which would
 * orphan hand_history/ledger_entries/house_revenue rows that reference this
 * user's id via foreign keys, breaking historical records and admin
 * reporting -- this scrubs the identifying fields and sets password_hash to
 * random bytes no real password can ever hash to, so the account becomes
 * permanently unloggable-into and the email/username free up for reuse. */
export function anonymizeUser(id: string): void {
  const suffix = randomUUID().slice(0, 8);
  const junkHash = randomBytes(32).toString("hex");
  const junkSalt = randomBytes(16).toString("hex");
  anonymizeStmt.run(`deleted-${suffix}@deleted.local`, `deleted-${suffix}`, junkHash, junkSalt, Date.now(), id);
}
