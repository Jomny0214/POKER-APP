import { api } from "./api.js";
import { toast } from "./toast.js";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function kindLabel(kind) {
  return kind === "shared_ip" ? "Shared IP" : kind === "chip_dumping" ? "Chip dumping" : kind;
}

function fmtTime(ms) {
  const d = new Date(ms);
  return d.toLocaleString();
}

export function renderCollusionPanel(container, currentUser) {
  if (!currentUser?.isAdmin) {
    container.innerHTML = "";
    return () => {};
  }

  container.innerHTML = `
    <div class="wallet-panel" style="margin-top:10px">
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin-bottom:8px">
        <strong>Collusion &amp; Multi-Account Flags</strong>
        <span style="font-weight:400"> &mdash; signals for review, not automatic action</span>
      </div>
      <div id="collusion-list" style="max-height:320px;overflow-y:auto;border-top:1px solid rgba(255,255,255,0.08)"></div>
    </div>
  `;

  async function refresh() {
    const { flags } = await api.adminCollusionFlags();
    const listEl = container.querySelector("#collusion-list");
    if (!listEl) return;

    if (!flags.length) {
      listEl.innerHTML = `<div class="meta" style="font-size:12px;color:var(--text-dim);padding:8px 0">No flags raised.</div>`;
      return;
    }

    listEl.innerHTML = flags
      .map(
        (f) => `
      <div class="row" data-flag-id="${f.id}" style="flex-direction:column;align-items:flex-start;gap:4px;border-top:1px solid rgba(255,255,255,0.06);padding:8px 0;font-size:12px;${f.resolved ? "opacity:0.5" : ""}">
        <div style="display:flex;justify-content:space-between;width:100%">
          <strong style="color:${f.kind === "chip_dumping" ? "var(--danger)" : "var(--accent)"}">${escapeHtml(kindLabel(f.kind))}</strong>
          <span style="color:var(--text-dim)">${escapeHtml(fmtTime(f.createdAt))}</span>
        </div>
        <div>${escapeHtml(f.userA)} &amp; ${escapeHtml(f.userB)}${f.tableId ? ` &middot; table ${escapeHtml(f.tableId.slice(0, 8))}` : ""}</div>
        <div style="color:var(--text-dim)">${escapeHtml(f.detail)}</div>
        ${
          f.resolved
            ? `<span style="color:var(--text-dim)">Resolved</span>`
            : `<button class="resolve-btn" data-id="${f.id}" style="font-size:11px;padding:3px 8px">Mark reviewed</button>`
        }
      </div>`
      )
      .join("");

    listEl.querySelectorAll(".resolve-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await api.adminResolveCollusionFlag(btn.dataset.id);
          await refresh();
        } catch (e) {
          toast(e.message, "error");
          btn.disabled = false;
        }
      });
    });
  }

  refresh().catch((e) => {
    toast(e.message, "error");
    const listEl = container.querySelector("#collusion-list");
    if (listEl) listEl.textContent = "Error: " + e.message;
  });

  const poll = setInterval(() => refresh().catch(() => {}), 15000);
  return () => clearInterval(poll);
}
