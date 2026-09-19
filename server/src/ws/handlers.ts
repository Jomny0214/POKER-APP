import { WSConnection } from "./websocket";
import { resolveSession } from "../auth";
import { tableManager } from "../table/TableManager";
import { findById } from "../db/users";

interface ConnState {
  userId: string | null;
  username: string | null;
  subscribed: Set<string>;
}

function stateOf(conn: WSConnection): ConnState {
  if (!conn.data.state) {
    conn.data.state = { userId: null, username: null, subscribed: new Set<string>() } as ConnState;
  }
  return conn.data.state as ConnState;
}

function sendError(conn: WSConnection, message: string): void {
  conn.send(JSON.stringify({ type: "error", message }));
}

export function handleConnection(conn: WSConnection): void {
  conn.on("message", (raw: string) => {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      sendError(conn, "Invalid JSON");
      return;
    }
    try {
      dispatch(conn, msg);
    } catch (err) {
      sendError(conn, (err as Error).message ?? "Error");
    }
  });

  conn.on("close", () => {
    const state = stateOf(conn);
    for (const tableId of state.subscribed) {
      tableManager.get(tableId)?.unsubscribe(conn);
    }
  });
}

function dispatch(conn: WSConnection, msg: any): void {
  const state = stateOf(conn);

  switch (msg.type) {
    case "auth": {
      const user = resolveSession(String(msg.token ?? ""));
      if (!user) {
        sendError(conn, "Invalid or expired session");
        return;
      }
      state.userId = user.id;
      state.username = user.username;
      conn.send(JSON.stringify({ type: "auth_ok", userId: user.id, username: user.username }));
      return;
    }

    case "subscribe": {
      const table = tableManager.get(String(msg.tableId ?? ""));
      if (!table) {
        sendError(conn, "Unknown table");
        return;
      }
      state.subscribed.add(table.id);
      table.subscribe(conn, state.userId);
      conn.send(JSON.stringify(table.getStateFor(state.userId)));
      return;
    }

    case "unsubscribe": {
      const table = tableManager.get(String(msg.tableId ?? ""));
      if (table) {
        table.unsubscribe(conn);
        state.subscribed.delete(table.id);
      }
      return;
    }

    case "sit": {
      requireAuth(state);
      const table = requireTable(msg.tableId);
      const username = state.username ?? findById(state.userId!)?.username ?? "Player";
      table.sit(state.userId!, username, Number(msg.seatIndex), Number(msg.buyIn));
      return;
    }

    case "standup": {
      requireAuth(state);
      const table = requireTable(msg.tableId);
      table.standUp(state.userId!);
      return;
    }

    case "sitout": {
      requireAuth(state);
      const table = requireTable(msg.tableId);
      table.setSittingOut(state.userId!, !!msg.value);
      return;
    }

    case "action": {
      requireAuth(state);
      const table = requireTable(msg.tableId);
      table.handleAction(state.userId!, msg.action ?? {});
      return;
    }

    case "draw": {
      requireAuth(state);
      const table = requireTable(msg.tableId);
      const indices = Array.isArray(msg.discardIndices) ? msg.discardIndices.map(Number) : [];
      table.handleDraw(state.userId!, indices);
      return;
    }

    default:
      sendError(conn, `Unknown message type: ${msg.type}`);
  }
}

function requireAuth(state: ConnState): void {
  if (!state.userId) throw new Error("Not authenticated (send an auth message first)");
}

function requireTable(tableId: unknown) {
  const table = tableManager.get(String(tableId ?? ""));
  if (!table) throw new Error("Unknown table");
  return table;
}
