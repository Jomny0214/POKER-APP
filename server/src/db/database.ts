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

// Multi-table tournaments. `blind_schedule` is a JSON array of
// {smallBlind,bigBlind,ante,durationMinutes}. Enough of a tournament's live
// state (status, current level, entries' table/seat/stack) is persisted here
// that a server restart mid-event can be reconstructed by TournamentManager
// instead of losing the tournament outright.
db.exec(`
CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  table_size INTEGER NOT NULL,
  buyin INTEGER NOT NULL,
  starting_stack INTEGER NOT NULL,
  rebuy_allowed INTEGER NOT NULL DEFAULT 0,
  rebuy_price INTEGER NOT NULL DEFAULT 0,
  rebuy_period_type TEXT,
  rebuy_period_value INTEGER,
  max_tables INTEGER NOT NULL,
  blind_schedule TEXT NOT NULL,
  scheduled_start_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'registering',
  current_level INTEGER NOT NULL DEFAULT 0,
  level_started_at INTEGER,
  prize_pool INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS tournament_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'registered',
  stack INTEGER NOT NULL DEFAULT 0,
  table_no INTEGER,
  seat_index INTEGER,
  rebuys_used INTEGER NOT NULL DEFAULT 0,
  finish_rank INTEGER,
  payout INTEGER,
  registered_at INTEGER NOT NULL,
  busted_at INTEGER
);
`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tourney_entry_unique ON tournament_entries(tournament_id, user_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tourney_entries_tid ON tournament_entries(tournament_id);`);

// Records which table numbers currently exist for a running tournament, so a
// restart knows which tables to recreate (entries themselves carry the
// table_no/seat_index/stack needed to reseat every player into them).
db.exec(`
CREATE TABLE IF NOT EXISTS tournament_tables (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  table_no INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, table_no)
);
`);

// Player-submitted "I made a bank transfer" claims. Nothing here touches the
// wallet ledger -- an admin reviews each pending row against their real bank
// account and only then approves it (which credits chips) or rejects it.
db.exec(`
CREATE TABLE IF NOT EXISTS deposit_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  username TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT
);
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_deposit_requests_user ON deposit_requests(user_id, id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_deposit_requests_status ON deposit_requests(status, id);`);
