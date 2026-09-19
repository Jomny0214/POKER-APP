import { getToken } from "./api.js";

class GameSocket {
  constructor() {
    this.ws = null;
    this.listeners = new Map(); // tableId -> Set<fn(state)>
    this.globalListeners = new Set(); // fn(msg) for non-table messages (errors, auth_ok)
    this.ready = null;
    this.authed = false;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return this.ready;
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    this.ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ready = new Promise((resolve) => {
      this.ws.addEventListener("open", () => {
        const token = getToken();
        if (token) this.send({ type: "auth", token });
        resolve();
      });
    });
    this.ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "table_state") {
        const set = this.listeners.get(msg.tableId);
        if (set) for (const fn of set) fn(msg);
      } else {
        for (const fn of this.globalListeners) fn(msg);
      }
    });
    this.ws.addEventListener("close", () => {
      this.ws = null;
      this.ready = null;
      // simple auto-reconnect
      setTimeout(() => this.connect(), 1500);
    });
    return this.ready;
  }

  async send(obj) {
    await this.connect();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  onGlobal(fn) {
    this.globalListeners.add(fn);
    return () => this.globalListeners.delete(fn);
  }

  subscribeTable(tableId, fn) {
    if (!this.listeners.has(tableId)) this.listeners.set(tableId, new Set());
    this.listeners.get(tableId).add(fn);
    this.send({ type: "subscribe", tableId });
    return () => {
      this.listeners.get(tableId)?.delete(fn);
      this.send({ type: "unsubscribe", tableId });
    };
  }
}

export const gameSocket = new GameSocket();
