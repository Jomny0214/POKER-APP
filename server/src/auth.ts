import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "crypto";
import { db } from "./db/database";
import { createUser, findByEmail, findById, UserRow } from "./db/users";

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function register(email: string, username: string, password: string): UserRow {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email address");
  if (username.length < 3 || username.length > 20) throw new Error("Username must be 3-20 characters");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  const { hash, salt } = hashPassword(password);
  return createUser(email.toLowerCase().trim(), username.trim(), hash, salt);
}

export function login(email: string, password: string): UserRow {
  const user = findByEmail(email.toLowerCase().trim());
  if (!user) throw new Error("Invalid email or password");
  if (!verifyPassword(password, user.password_hash, user.password_salt)) {
    throw new Error("Invalid email or password");
  }
  return user;
}

const insertSessionStmt = db.prepare(
  `INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
);
const getSessionStmt = db.prepare(`SELECT * FROM sessions WHERE token = ?`);
const deleteSessionStmt = db.prepare(`DELETE FROM sessions WHERE token = ?`);

export function createSession(userId: string): string {
  const token = randomUUID() + randomBytes(16).toString("hex");
  const now = Date.now();
  insertSessionStmt.run(token, userId, now, now + SESSION_TTL_MS);
  return token;
}

export function resolveSession(token: string): UserRow | null {
  const row = getSessionStmt.get(token) as { token: string; user_id: string; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    deleteSessionStmt.run(token);
    return null;
  }
  return findById(row.user_id) ?? null;
}

export function destroySession(token: string): void {
  deleteSessionStmt.run(token);
}

export function isAdmin(user: UserRow): boolean {
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").toLowerCase().trim();
  return !!adminEmail && user.email === adminEmail;
}

export function publicUser(user: UserRow) {
  return { id: user.id, email: user.email, username: user.username, isAdmin: isAdmin(user) };
}
