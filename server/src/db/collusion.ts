import { IncomingMessage } from "http";
import { db } from "./database";

// Lightweight, in-house anti-collusion / anti-multi-accounting heuristics.
// This is not a substitute for a real fraud/risk pipeline -- it's the kind
// of pragmatic signal-flagging a single-node poker room can run on its own
// data: same-IP players seated together, and one-directional chip flow
// between two accounts that looks like deliberate chip-dumping. Every flag
// is surfaced to admins for human review, never acted on automatically --
// false positives are expected (housemates, internet cafes, a normal bad
// run of cards against the same opponent) and it's not this code's job to
// judge intent, only to point at patterns worth a human look.

db.exec(`
CREATE TABLE IF NOT EXISTS login_fingerprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  ip TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_fingerprints_user ON login_fingerprints(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_fingerprints_ip ON login_fingerprints(ip);

CREATE TABLE IF NOT EXISTS pairwise_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id TEXT NOT NULL,
  hand_id TEXT NOT NULL,
  from_user TEXT NOT NULL REFERENCES users(id),
  to_user TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pairwise_transfers_pair ON pairwise_transfers(from_user, to_user, created_at DESC);

CREATE TABLE IF NOT EXISTS collusion_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  table_id TEXT,
  user_a TEXT NOT NULL REFERENCES users(id),
  user_b TEXT NOT NULL REFERENCES users(id),
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_collusion_flags_created ON collusion_flags(created_at DESC);
`);

/** Thresholds, tunable without touching call sites. */
const CHIP_DUMP_WINDOW_HANDS = 20; // look back this many shared hands between a pair
const CHIP_DUMP_MIN_NET = 2000; // net one-way transfer within the window to trigger a flag
const CHIP_DUMP_ONE_SIDEDNESS = 0.85; // >=85% of the flow between them goes one direction
const FLAG_DEDUPE_MS = 6 * 60 * 60 * 1000; // don't re-flag the same pair/kind/table within 6h

export function getClientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  if (Array.isArray(fwd) && fwd.length > 0) return fwd[0];
  return req.socket.remoteAddress ?? "unknown";
}

const insertFingerprintStmt = db.prepare(
  `INSERT INTO login_fingerprints (user_id, ip, user_agent, created_at) VALUES (?, ?, ?, ?)`
);
const latestFingerprintStmt = db.prepare(
  `SELECT ip FROM login_fingerprints WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`
);

export function recordLoginFingerprint(userId: string, ip: string, userAgent: string): void {
  insertFingerprintStmt.run(userId, ip, userAgent.slice(0, 300), Date.now());
}

const recentFlagStmt = db.prepare(
  `SELECT id FROM collusion_flags
   WHERE kind = ? AND table_id IS ? AND
     ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)) AND
     created_at > ?
   LIMIT 1`
);
const insertFlagStmt = db.prepare(
  `INSERT INTO collusion_flags (kind, table_id, user_a, user_b, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`
);

function raiseFlag(kind: string, tableId: string | null, userA: string, userB: string, detail: string): void {
  const since = Date.now() - FLAG_DEDUPE_MS;
  const existing = recentFlagStmt.get(kind, tableId, userA, userB, userB, userA, since);
  if (existing) return; // already flagged recently, don't spam admins
  insertFlagStmt.run(kind, tableId, userA, userB, detail, Date.now());
}

/**
 * Checks every pair of currently-seated players at a table against their
 * most recent login IP. Two accounts logging in from the same IP and then
 * playing at the same table together is exactly the pattern multi-accounting
 * (one person playing both seats) and IP-based collusion rings both produce.
 */
export function checkSharedIpSeating(tableId: string, seatedUserIds: string[]): void {
  const ids = [...new Set(seatedUserIds)];
  if (ids.length < 2) return;
  const ipOf = new Map<string, string>();
  for (const id of ids) {
    const row = latestFingerprintStmt.get(id) as { ip: string } | undefined;
    if (row) ipOf.set(id, row.ip);
  }
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      const ipA = ipOf.get(a);
      const ipB = ipOf.get(b);
      if (ipA && ipB && ipA === ipB && ipA !== "unknown") {
        raiseFlag("shared_ip", tableId, a, b, `Both players' most recent login IP was ${ipA}`);
      }
    }
  }
}

/**
 * Records a settled hand's chip movement between players as pairwise
 * transfers, then checks whether any pair now shows a lopsided,
 * fast, one-directional flow -- the signature of chip-dumping (one account
 * deliberately feeding chips to another, e.g. two players sharing one
 * bankroll, or a "banker" seat funneling winnings out).
 *
 * Since the engine's result only gives each player's net change for the
 * hand (not literally which loser's chips went to which winner -- multiple
 * players can contest one pot), each loser's chips are attributed to
 * winners proportionally by the winners' share of the hand's total payout.
 * This is an approximation, same as any pairwise-flow heuristic without
 * full showdown reconstruction, but it's stable and good enough to surface
 * a pattern worth a human review.
 */
export function recordHandTransfers(tableId: string, handId: string, netStackChange: Record<string, number>): void {
  const winners = Object.entries(netStackChange).filter(([, net]) => net > 0);
  const losers = Object.entries(netStackChange).filter(([, net]) => net < 0);
  const totalWin = winners.reduce((sum, [, net]) => sum + net, 0);
  if (totalWin <= 0 || winners.length === 0 || losers.length === 0) return;

  const now = Date.now();
  const touchedPairs = new Set<string>();
  for (const [loserId, loserNet] of losers) {
    const loss = -loserNet;
    for (const [winnerId, winnerNet] of winners) {
      const share = Math.round(loss * (winnerNet / totalWin));
      if (share <= 0) continue;
      db.prepare(
        `INSERT INTO pairwise_transfers (table_id, hand_id, from_user, to_user, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(tableId, handId, loserId, winnerId, share, now);
      touchedPairs.add([loserId, winnerId].sort().join("|"));
    }
  }

  for (const pairKey of touchedPairs) {
    const [a, b] = pairKey.split("|");
    checkChipDumping(tableId, a, b);
  }
}

function checkChipDumping(tableId: string, userA: string, userB: string): void {
  const rows = db
    .prepare(
      `SELECT from_user, to_user, amount FROM pairwise_transfers
       WHERE table_id = ? AND ((from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?))
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(tableId, userA, userB, userB, userA, CHIP_DUMP_WINDOW_HANDS * 2) as {
    from_user: string;
    to_user: string;
    amount: number;
  }[];
  if (rows.length === 0) return;

  let aToB = 0;
  let bToA = 0;
  for (const r of rows) {
    if (r.from_user === userA) aToB += r.amount;
    else bToA += r.amount;
  }
  const total = aToB + bToA;
  if (total < CHIP_DUMP_MIN_NET) return;

  const netToB = aToB - bToA; // positive => A has been feeding B
  const dominant = Math.max(aToB, bToA) / total;
  if (dominant < CHIP_DUMP_ONE_SIDEDNESS) return; // flow goes both ways enough to look like normal play

  const [feederId, receiverId] = aToB > bToA ? [userA, userB] : [userB, userA];
  const feeder = usernameOf(feederId);
  const receiver = usernameOf(receiverId);
  raiseFlag(
    "chip_dumping",
    tableId,
    userA,
    userB,
    `Over the last ${rows.length} pairwise pot(s), ~${Math.round(dominant * 100)}% of chip flow between these two ran one direction (${feeder} -> ${receiver}, net ${Math.abs(netToB)})`
  );
}

const usernameStmt = db.prepare(`SELECT username FROM users WHERE id = ?`);
function usernameOf(userId: string): string {
  const row = usernameStmt.get(userId) as { username: string } | undefined;
  return row?.username ?? userId;
}

export interface CollusionFlagRow {
  id: number;
  kind: string;
  tableId: string | null;
  userA: string;
  userB: string;
  detail: string;
  createdAt: number;
  resolved: boolean;
}

export function listCollusionFlags(limit = 100): CollusionFlagRow[] {
  const rows = db
    .prepare(
      `SELECT cf.id, cf.kind, cf.table_id, ua.username as user_a_name, ub.username as user_b_name, cf.detail, cf.created_at, cf.resolved
       FROM collusion_flags cf
       JOIN users ua ON ua.id = cf.user_a
       JOIN users ub ON ub.id = cf.user_b
       ORDER BY cf.created_at DESC LIMIT ?`
    )
    .all(limit) as {
    id: number;
    kind: string;
    table_id: string | null;
    user_a_name: string;
    user_b_name: string;
    detail: string;
    created_at: number;
    resolved: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    tableId: r.table_id,
    userA: r.user_a_name,
    userB: r.user_b_name,
    detail: r.detail,
    createdAt: r.created_at,
    resolved: r.resolved === 1,
  }));
}

export function resolveCollusionFlag(id: number): void {
  db.prepare(`UPDATE collusion_flags SET resolved = 1 WHERE id = ?`).run(id);
}
