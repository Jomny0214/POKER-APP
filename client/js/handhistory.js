import { api } from "./api.js";
import { toast } from "./toast.js";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtTime(ms) {
  return ms ? new Date(ms).toLocaleString() : "";
}

// The engine encodes ten as "Tx" (e.g. "Th") -- displayed here as "10h" to
// match how the table itself shows it, without touching the stored/hashed data.
function displayCard(code) {
  if (!code || code.length < 2) return code;
  const rank = code.slice(0, -1);
  const suit = code.slice(-1);
  return (rank === "T" ? "10" : rank) + suit;
}

function cardsLine(cards) {
  if (!cards || !cards.length) return "&mdash;";
  return cards.map((c) => escapeHtml(displayCard(c))).join(" ");
}

export function renderHandHistoryPanel(container, currentUser) {
  if (!currentUser?.isAdmin) {
    container.innerHTML = "";
    return () => {};
  }

  container.innerHTML = `
    <div class="wallet-panel" style="margin-top:10px">
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin-bottom:8px">
        <strong>Hand History</strong>
      </div>
      <div id="hh-list" style="max-height:360px;overflow-y:auto;border-top:1px solid rgba(255,255,255,0.08)"></div>
    </div>
  `;

  const listEl = container.querySelector("#hh-list");
  let expandedId = null; // while set, the poll below leaves the open detail alone

  function winnersLine(winners) {
    if (!winners.length) return "&mdash;";
    return winners.map((w) => `${escapeHtml(w.username)} +${w.amount}${w.side === "low" ? " (lo)" : ""}`).join(", ");
  }

  async function verify(id, targetEl) {
    targetEl.textContent = "Checking...";
    try {
      const res = await api.verifyHand(id);
      targetEl.innerHTML = res.valid
        ? `<span style="color:var(--accent-2)">&check; Signature valid</span>`
        : `<span style="color:var(--danger)">&#10007; ${res.reason === "unsigned" ? "Not signed (pre-dates hand signing)" : "Signature INVALID -- data may have been altered"}</span>`;
    } catch (e) {
      targetEl.textContent = "Error: " + e.message;
    }
  }

  async function openDetail(id) {
    expandedId = id;
    const { hand } = await api.adminHandDetail(id);
    const row = listEl.querySelector(`[data-hand-id="${id}"]`);
    if (!row) return;
    const revealedEntries = Object.entries(hand.revealed);
    row.innerHTML = `
      <div style="font-size:12px;display:flex;flex-direction:column;gap:6px">
        <div><strong>Table</strong> ${escapeHtml(hand.tableId.slice(0, 8))} &middot; ${escapeHtml(hand.variant)} &middot; ${escapeHtml(fmtTime(hand.startedAt))}</div>
        <div><strong>Board</strong> ${cardsLine(hand.community)}</div>
        <div><strong>Pots</strong></div>
        ${hand.pots
          .map(
            (p, i) => `<div style="padding-left:8px">Pot ${i + 1}: ${p.amount} chips &rarr; ${winnersLine(p.winners)}</div>`
          )
          .join("")}
        ${
          revealedEntries.length
            ? `<div><strong>Showdown</strong></div>${revealedEntries
                .map(([username, v]) => `<div style="padding-left:8px">${escapeHtml(username)}: ${cardsLine(v.cards)}${v.description ? ` &mdash; ${escapeHtml(v.description)}` : ""}</div>`)
                .join("")}`
            : `<div style="color:var(--text-dim)">Hand ended uncontested (no showdown).</div>`
        }
        <div id="hh-verify-${id}" style="color:var(--text-dim)">${hand.signed ? "Signed -- click Verify to check" : "Not signed"}</div>
        <div style="display:flex;gap:6px">
          ${hand.signed ? `<button class="verify-btn">Verify signature</button>` : ""}
          <button class="close-btn">Close</button>
        </div>
      </div>
    `;
    if (hand.signed) {
      row.querySelector(".verify-btn").addEventListener("click", () => verify(id, row.querySelector(`#hh-verify-${id}`)));
    }
    row.querySelector(".close-btn").addEventListener("click", () => {
      expandedId = null;
      refresh().catch((e) => toast(e.message, "error"));
    });
  }

  async function refresh() {
    if (expandedId !== null) return; // don't clobber an open detail card
    const { hands } = await api.adminHandHistory(50);
    if (!hands.length) {
      listEl.innerHTML = `<div class="meta" style="font-size:12px;color:var(--text-dim);padding:8px 0">No hands recorded yet.</div>`;
      return;
    }
    listEl.innerHTML = hands
      .map(
        (h) => `
      <div class="row" data-hand-id="${h.id}" style="flex-direction:column;align-items:flex-start;gap:4px;border-top:1px solid rgba(255,255,255,0.06);padding:8px 0;font-size:12px">
        <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
          <span>${escapeHtml(h.variant)} &middot; ${escapeHtml(fmtTime(h.startedAt))} &middot; pot ${h.potTotal} &middot; ${winnersLine(h.winners)}</span>
          <button class="view-btn" data-id="${h.id}" style="font-size:11px;padding:3px 8px">View</button>
        </div>
        <div style="color:var(--text-dim)">${h.signed ? "&check; signed" : "not signed"}</div>
      </div>`
      )
      .join("");
    listEl.querySelectorAll(".view-btn").forEach((btn) => {
      btn.addEventListener("click", () => openDetail(btn.dataset.id).catch((e) => toast(e.message, "error")));
    });
  }

  refresh().catch((e) => {
    toast(e.message, "error");
    listEl.textContent = "Error: " + e.message;
  });

  const poll = setInterval(() => refresh().catch(() => {}), 15000);
  return () => clearInterval(poll);
}
