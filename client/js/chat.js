import { api } from "./api.js";
import { toast } from "./toast.js";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function bubble(msg, isMine) {
  return `
    <div style="display:flex;justify-content:${isMine ? "flex-end" : "flex-start"};margin:4px 0">
      <div style="max-width:80%;background:${isMine ? "#1f7a4d" : "rgba(255,255,255,0.06)"};color:#fff;padding:6px 10px;border-radius:10px;font-size:13px">
        ${escapeHtml(msg.message)}
        <div style="font-size:10px;color:rgba(255,255,255,0.6);margin-top:2px">${fmtTime(msg.created_at)}</div>
      </div>
    </div>
  `;
}

export function renderChatPanel(container, currentUser) {
  const isAdmin = !!currentUser?.isAdmin;

  if (!isAdmin) {
    container.innerHTML = `
      <div class="wallet-panel" style="margin-top:10px">
        <div class="meta" style="font-size:12px;color:var(--text-dim);margin-bottom:8px"><strong>Support Chat</strong></div>
        <div id="chat-messages" style="max-height:220px;overflow-y:auto;border-top:1px solid rgba(255,255,255,0.08);padding-top:6px"></div>
        <div class="row" style="margin-top:8px">
          <input id="chat-input" type="text" placeholder="Message the admin..." style="flex:1" />
          <button class="primary" id="chat-send-btn">Send</button>
        </div>
      </div>
    `;

    async function refresh() {
      const { messages } = await api.chatMine();
      const box = container.querySelector("#chat-messages");
      if (!box) return;
      const wasAtBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 10;
      box.innerHTML = messages.length
        ? messages.map((m) => bubble(m, m.sender === "player")).join("")
        : `<div class="meta" style="font-size:12px;color:var(--text-dim)">No messages yet. Say hello!</div>`;
      if (wasAtBottom) box.scrollTop = box.scrollHeight;
    }

    container.querySelector("#chat-send-btn").addEventListener("click", async () => {
      const input = container.querySelector("#chat-input");
      const message = input.value.trim();
      if (!message) return;
      input.value = "";
      try {
        await api.chatSend(message);
        await refresh();
      } catch (err) {
        toast(err.message, "error");
      }
    });
    container.querySelector("#chat-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") container.querySelector("#chat-send-btn").click();
    });

    refresh().catch((e) => toast(e.message, "error"));
    const poll = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(poll);
  }

  // Admin view: inbox of threads, click to open one.
  let openThreadId = null;

  container.innerHTML = `
    <div class="wallet-panel" style="margin-top:10px">
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin-bottom:8px"><strong>Support Chat Inbox</strong></div>
      <div id="chat-thread-list"></div>
      <div id="chat-thread-view" style="margin-top:10px"></div>
    </div>
  `;

  async function refreshThreads() {
    const { threads } = await api.adminChatThreads();
    const list = container.querySelector("#chat-thread-list");
    if (!list) return;
    if (!threads.length) {
      list.innerHTML = `<div class="meta" style="font-size:12px;color:var(--text-dim)">No conversations yet.</div>`;
      return;
    }
    list.innerHTML = threads
      .map(
        (t) => `
      <div class="row thread-row" data-user="${escapeHtml(t.user_id)}" data-username="${escapeHtml(t.username)}"
           style="justify-content:space-between;border-top:1px solid rgba(255,255,255,0.06);padding:6px 0;cursor:pointer">
        <span>${escapeHtml(t.username)}${t.unread_count > 0 ? ` <span style="color:#e0a72d">(${t.unread_count} new)</span>` : ""}</span>
        <span class="meta" style="font-size:11px;color:var(--text-dim)">${fmtTime(t.last_message_at)}</span>
      </div>`
      )
      .join("");
    list.querySelectorAll(".thread-row").forEach((row) => {
      row.addEventListener("click", () => openThread(row.dataset.user, row.dataset.username));
    });
  }

  async function openThread(userId, username) {
    openThreadId = userId;
    const view = container.querySelector("#chat-thread-view");
    view.innerHTML = `
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin:6px 0"><strong>${escapeHtml(username)}</strong></div>
      <div id="chat-thread-messages" style="max-height:220px;overflow-y:auto;border-top:1px solid rgba(255,255,255,0.08);padding-top:6px"></div>
      <div class="row" style="margin-top:8px">
        <input id="chat-reply-input" type="text" placeholder="Reply..." style="flex:1" />
        <button class="primary" id="chat-reply-btn">Send</button>
      </div>
    `;
    async function refreshMessages() {
      const { messages } = await api.adminChatThread(userId);
      const box = view.querySelector("#chat-thread-messages");
      if (!box) return;
      box.innerHTML = messages.length
        ? messages.map((m) => bubble(m, m.sender === "admin")).join("")
        : `<div class="meta" style="font-size:12px;color:var(--text-dim)">No messages yet.</div>`;
      box.scrollTop = box.scrollHeight;
      refreshThreads().catch(() => {});
    }
    view.querySelector("#chat-reply-btn").addEventListener("click", async () => {
      const input = view.querySelector("#chat-reply-input");
      const message = input.value.trim();
      if (!message) return;
      input.value = "";
      try {
        await api.adminChatSend(userId, username, message);
        await refreshMessages();
      } catch (err) {
        toast(err.message, "error");
      }
    });
    view.querySelector("#chat-reply-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") view.querySelector("#chat-reply-btn").click();
    });
    await refreshMessages();
  }

  refreshThreads().catch((e) => toast(e.message, "error"));
  const poll = setInterval(() => {
    refreshThreads().catch(() => {});
  }, 6000);
  return () => clearInterval(poll);
}
