import { randomUUID } from "crypto";
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
