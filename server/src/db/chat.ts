import { db } from "./database";

export interface ChatMessageRow {
  id: number;
  user_id: string;
  username: string;
  sender: "player" | "admin";
  message: string;
  created_at: number;
  read_by_admin: number;
  read_by_player: number;
}

export class ChatError extends Error {}

const insertStmt = db.prepare(
  `INSERT INTO chat_messages (user_id, username, sender, message, created_at, read_by_admin, read_by_player)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

const listForUserStmt = db.prepare(
  `SELECT * FROM chat_messages WHERE user_id = ? ORDER BY id ASC LIMIT 500`
);

const listThreadsStmt = db.prepare(
  `SELECT user_id, username,
          MAX(created_at) AS last_message_at,
          SUM(CASE WHEN sender = 'player' AND read_by_admin = 0 THEN 1 ELSE 0 END) AS unread_count
   FROM chat_messages
   GROUP BY user_id, username
   ORDER BY last_message_at DESC`
);

const markReadByAdminStmt = db.prepare(
  `UPDATE chat_messages SET read_by_admin = 1 WHERE user_id = ? AND read_by_admin = 0`
);

const markReadByPlayerStmt = db.prepare(
  `UPDATE chat_messages SET read_by_player = 1 WHERE user_id = ? AND read_by_player = 0`
);

function cleanMessage(message: string): string {
  const trimmed = (message ?? "").trim();
  if (!trimmed) throw new ChatError("Message cannot be empty");
  if (trimmed.length > 2000) throw new ChatError("Message too long");
  return trimmed;
}

export function sendPlayerMessage(userId: string, username: string, message: string): ChatMessageRow {
  const clean = cleanMessage(message);
  const now = Date.now();
  const result = insertStmt.run(userId, username, "player", clean, now, 0, 1);
  return db
    .prepare(`SELECT * FROM chat_messages WHERE id = ?`)
    .get(Number(result.lastInsertRowid)) as unknown as ChatMessageRow;
}

export function sendAdminMessage(userId: string, username: string, message: string): ChatMessageRow {
  const clean = cleanMessage(message);
  const now = Date.now();
  const result = insertStmt.run(userId, username, "admin", clean, now, 1, 0);
  return db
    .prepare(`SELECT * FROM chat_messages WHERE id = ?`)
    .get(Number(result.lastInsertRowid)) as unknown as ChatMessageRow;
}

export function listMessagesForUser(userId: string): ChatMessageRow[] {
  return listForUserStmt.all(userId) as unknown as ChatMessageRow[];
}

export function listChatThreads(): Array<{
  user_id: string;
  username: string;
  last_message_at: number;
  unread_count: number;
}> {
  return listThreadsStmt.all() as unknown as Array<{
    user_id: string;
    username: string;
    last_message_at: number;
    unread_count: number;
  }>;
}

export function markThreadReadByAdmin(userId: string): void {
  markReadByAdminStmt.run(userId);
}

export function markThreadReadByPlayer(userId: string): void {
  markReadByPlayerStmt.run(userId);
}
