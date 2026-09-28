import { db } from "./database";

// Read-side helpers for the admin Hand History panel. hand_history stores
// each hand's raw engine result as a JSON blob (see Table.settleHand()) --
// these functions unpack that blob into something a UI can render, and
// resolve player ids to usernames along the way. Nothing here writes
// anything; signing/verification lives in handSigning.ts.

interface HandHistoryRow {
  id: string;
  table_id: string;
  variant: string;
  started_at: number;
  ended_at: number;
  data: string;
  hash: string | null;
  signature: string | null;
}

interface WinnerShare {
  playerId: string;
  amount: number;
  side: "high" | "low";
}

interface StoredHandData {
  result: {
    pots: { amount: number; winners: WinnerShare[] }[];
    revealed: Record<string, { cards: string[]; description?: string }>;
  };
  community: string[];
}

export interface HandWinner {
  username: string;
  amount: number;
  side: "high" | "low";
}

export interface HandSummary {
  id: string;
  tableId: string;
  variant: string;
  startedAt: number;
  endedAt: number;
  community: string[];
  potTotal: number;
  winners: HandWinner[];
  signed: boolean;
}

export interface HandDetail extends HandSummary {
  pots: { amount: number; winners: HandWinner[] }[];
  revealed: Record<string, { cards: string[]; description?: string }>; // keyed by username
  hash: string | null;
  signature: string | null;
}

function usernameMap(ids: string[]): Map<string, string> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id, username FROM users WHERE id IN (${placeholders})`).all(...unique) as {
    id: string;
    username: string;
  }[];
  return new Map(rows.map((r) => [r.id, r.username]));
}

function collectPlayerIds(data: StoredHandData): string[] {
  const ids: string[] = [];
  for (const pot of data.result?.pots ?? []) for (const w of pot.winners ?? []) ids.push(w.playerId);
  for (const id of Object.keys(data.result?.revealed ?? {})) ids.push(id);
  return ids;
}

function parseRow(row: HandHistoryRow, names: Map<string, string>): HandDetail {
  const data = JSON.parse(row.data) as StoredHandData;
  const pots = (data.result?.pots ?? []).map((p) => ({
    amount: p.amount,
    winners: (p.winners ?? []).map((w) => ({
      username: names.get(w.playerId) ?? w.playerId,
      amount: w.amount,
      side: w.side,
    })),
  }));
  const potTotal = pots.reduce((sum, p) => sum + p.amount, 0);
  const revealedRaw = data.result?.revealed ?? {};
  const revealed: Record<string, { cards: string[]; description?: string }> = {};
  for (const [playerId, v] of Object.entries(revealedRaw)) {
    revealed[names.get(playerId) ?? playerId] = v;
  }
  return {
    id: row.id,
    tableId: row.table_id,
    variant: row.variant,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    community: data.community ?? [],
    potTotal,
    winners: pots.flatMap((p) => p.winners),
    pots,
    revealed,
    hash: row.hash,
    signature: row.signature,
    signed: !!(row.hash && row.signature),
  };
}

/** Most recent settled hands, newest first, optionally scoped to one table. */
export function listRecentHands(limit = 50, tableId?: string): HandSummary[] {
  const cap = Math.min(Math.max(1, Math.floor(limit) || 50), 200);
  const rows = (
    tableId
      // hand_history.id is a random UUID (see Table.settleHand()), not an
      // autoincrement integer -- ordering by it sorts alphabetically, not
      // chronologically. Sort by the actual timestamp instead.
      ? db.prepare(`SELECT * FROM hand_history WHERE table_id = ? ORDER BY started_at DESC LIMIT ?`).all(tableId, cap)
      : db.prepare(`SELECT * FROM hand_history ORDER BY started_at DESC LIMIT ?`).all(cap)
  ) as unknown as HandHistoryRow[];

  const allIds = rows.flatMap((r) => collectPlayerIds(JSON.parse(r.data)));
  const names = usernameMap(allIds);

  return rows.map((row) => {
    const detail = parseRow(row, names);
    // Strip the fields a list view doesn't need (full pots/revealed), keep the summary shape.
    const { pots, revealed, hash, signature, ...summary } = detail;
    return summary;
  });
}

/** Full detail for one hand -- board, per-pot winners, revealed showdown hands, and its signature. */
export function getHandDetail(id: string): HandDetail | null {
  const row = db.prepare(`SELECT * FROM hand_history WHERE id = ?`).get(id) as unknown as HandHistoryRow | undefined;
  if (!row) return null;
  const names = usernameMap(collectPlayerIds(JSON.parse(row.data)));
  return parseRow(row, names);
}
