import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(__dirname, "..", "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "poker.sqlite"));

db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA foreign_keys = ON;`);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

// Append-only double-entry-style ledger. Every wallet-affecting event (real
// deposit, buy-in escrow, cash-out, hand win/loss) writes exactly one row
// here inside a transaction that also updates the derived balance, so the
// balance is always reconstructible by summing `amount` for a user.
db.exec(`
CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  ref TEXT,
  created_at INTEGER NOT NULL
);
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id, id);`);

// Table seating -- which user currently has chips escrowed into which live
// table, so a server restart (or crash) can reconcile stacks back to wallet
// balances instead of losing chips.
db.exec(`
CREATE TABLE IF NOT EXISTS table_buyins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  table_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS hand_history (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
`);
