import { api } from "./api.js";
import { toast } from "./toast.js";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function renderPlayerLog(container, currentUser) {
  if (!currentUser?.isAdmin) {
    container.innerHTML = "";
    return () => {};
  }

  container.innerHTML = `
    <div class="wallet-panel" style="margin-top:10px">
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <strong>All Players &amp; Balances</strong>
        <span id="player-log-count" style="font-weight:400"></span>
      </div>
      <div id="player-log-list" style="max-height:260px;overflow-y:auto;border-top:1px solid rgba(255,255,255,0.08)">
        Loading...
      </div>
    </div>
  `;

  async function refresh() {
    const { players } = await api.adminPlayers();
    const list = container.querySelector("#player-log-list");
    const count = container.querySelector("#player-log-count");
    if (!list) return;
    count.textContent = `${players.length} player${players.length === 1 ? "" : "s"}`;
    if (!players.length) {
      list.innerHTML = `<div class="meta" style="font-size:12px;color:var(--text-dim);padding:8px 0">No players yet.</div>`;
      return;
    }
    const sorted = [...players].sort((a, b) => b.balance - a.balance);
    list.innerHTML = sorted
      .map(
        (p) => `
      <div class="row" style="justify-content:space-between;border-top:1px solid rgba(255,255,255,0.06);padding:6px 0">
        <span>${escapeHtml(p.username)}</span>
        <strong>${p.balance} chips</strong>
      </div>`
      )
      .join("");
  }

  refresh().catch((e) => {
    toast(e.message, "error");
    const list = container.querySelector("#player-log-list");
    if (list) list.textContent = "Error: " + e.message;
  });

  const poll = setInterval(() => refresh().catch(() => {}), 10000);
  return () => clearInterval(poll);
}
