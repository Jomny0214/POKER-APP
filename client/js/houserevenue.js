import { api } from "./api.js";
import { toast } from "./toast.js";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function kindLabel(kind) {
  return kind === "cash_rake" ? "Cash rake" : kind === "tournament_fee" ? "Tournament fee" : kind;
}

function fmtTime(ms) {
  const d = new Date(ms);
  return d.toLocaleString();
}

export function renderHouseRevenue(container, currentUser) {
  if (!currentUser?.isAdmin) {
    container.innerHTML = "";
    return () => {};
  }

  container.innerHTML = `
    <div class="wallet-panel" style="margin-top:10px">
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin-bottom:8px">
        <strong>House Revenue (Rake &amp; Tournament Fees)</strong>
      </div>
      <div id="house-revenue-totals" style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px">
        Loading...
      </div>
      <div id="house-revenue-list" style="max-height:260px;overflow-y:auto;border-top:1px solid rgba(255,255,255,0.08)"></div>
    </div>
  `;

  async function refresh() {
    const { totals, recent } = await api.adminHouseRevenue();
    const totalsEl = container.querySelector("#house-revenue-totals");
    const listEl = container.querySelector("#house-revenue-list");
    if (!totalsEl || !listEl) return;

    totalsEl.innerHTML = `
      <div class="stat">
        <div class="label" style="font-size:10px;color:var(--text-dim);text-transform:uppercase">Cash rake (4%)</div>
        <div class="value" style="font-weight:700;color:var(--accent)">${totals.cashRake} chips</div>
      </div>
      <div class="stat">
        <div class="label" style="font-size:10px;color:var(--text-dim);text-transform:uppercase">Tournament fees (8%)</div>
        <div class="value" style="font-weight:700;color:var(--accent)">${totals.tournamentFees} chips</div>
      </div>
      <div class="stat">
        <div class="label" style="font-size:10px;color:var(--text-dim);text-transform:uppercase">Total</div>
        <div class="value" style="font-weight:700;color:var(--accent-2)">${totals.total} chips</div>
      </div>
    `;

    if (!recent.length) {
      listEl.innerHTML = `<div class="meta" style="font-size:12px;color:var(--text-dim);padding:8px 0">No revenue recorded yet.</div>`;
      return;
    }
    listEl.innerHTML = recent
      .map(
        (r) => `
      <div class="row" style="justify-content:space-between;border-top:1px solid rgba(255,255,255,0.06);padding:6px 0;font-size:12px">
        <span>${escapeHtml(kindLabel(r.kind))} &middot; ${escapeHtml(fmtTime(r.created_at))}</span>
        <strong style="color:${r.amount < 0 ? "var(--danger)" : "var(--accent-2)"}">${r.amount > 0 ? "+" : ""}${r.amount} chips</strong>
      </div>`
      )
      .join("");
  }

  refresh().catch((e) => {
    toast(e.message, "error");
    const totalsEl = container.querySelector("#house-revenue-totals");
    if (totalsEl) totalsEl.textContent = "Error: " + e.message;
  });

  const poll = setInterval(() => refresh().catch(() => {}), 15000);
  return () => clearInterval(poll);
}
