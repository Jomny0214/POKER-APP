import { api } from "./api.js";
import { toast } from "./toast.js";

function statusBadge(status) {
  const color = status === "pending" ? "#e0a72d" : status === "approved" ? "#2ecc71" : "#e74c3c";
  return `<span style="color:${color};font-weight:700;text-transform:capitalize">${status}</span>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function renderDepositPanel(container, currentUser) {
  const isAdmin = !!currentUser?.isAdmin;

  container.innerHTML = `
    <div class="wallet-panel" style="margin-top:10px">
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin-bottom:8px">
        <strong>${isAdmin ? "Pending Deposits" : "Request a Deposit"}</strong>
      </div>
      ${
        isAdmin
          ? `<div id="admin-pending-list">Loading...</div>`
          : `
      <div class="row">
        <input id="dep-amount" type="number" min="1" placeholder="Amount" value="500" />
        <input id="dep-note" type="text" placeholder="Note (optional, e.g. bank ref)" />
        <button class="primary" id="dep-request-btn">Request Deposit</button>
      </div>
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin-top:6px">
        Make your bank transfer first, then submit a request here. The admin will confirm the transfer arrived and credit your chips.
      </div>
      <div id="my-deposits-list" style="margin-top:10px"></div>
      `
      }
    </div>
  `;

  async function refreshMine() {
    const { requests } = await api.myDeposits();
    const list = container.querySelector("#my-deposits-list");
    if (!list) return;
    if (!requests.length) {
      list.innerHTML = `<div class="meta" style="font-size:12px;color:var(--text-dim)">No deposit requests yet.</div>`;
      return;
    }
    list.innerHTML = requests
      .map(
        (r) => `
      <div class="row" style="justify-content:space-between;border-top:1px solid rgba(255,255,255,0.08);padding-top:6px;margin-top:6px">
        <span>${r.amount} chips${r.note ? ` &middot; ${escapeHtml(r.note)}` : ""}</span>
        ${statusBadge(r.status)}
      </div>`
      )
      .join("");
  }

  async function refreshPending() {
    const { requests } = await api.adminPendingDeposits();
    const list = container.querySelector("#admin-pending-list");
    if (!list) return;
    if (!requests.length) {
      list.innerHTML = `<div class="meta" style="font-size:12px;color:var(--text-dim)">No pending deposits.</div>`;
      return;
    }
    list.innerHTML = "";
    for (const r of requests) {
      const row = document.createElement("div");
      row.className = "row";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.borderTop = "1px solid rgba(255,255,255,0.08)";
      row.style.paddingTop = "6px";
      row.style.marginTop = "6px";
      row.innerHTML = `
        <span><strong>${escapeHtml(r.username)}</strong> &middot; ${r.amount} chips${r.note ? ` &middot; ${escapeHtml(r.note)}` : ""}</span>
        <span>
          <button class="primary approve-btn" style="padding:4px 10px">Approve</button>
          <button class="reject-btn" style="padding:4px 10px">Reject</button>
        </span>
      `;
      row.querySelector(".approve-btn").addEventListener("click", async () => {
        try {
          await api.adminApproveDeposit(r.id);
          toast(`Approved ${r.amount} chips for ${r.username}`);
          await refreshPending();
        } catch (err) {
          toast(err.message, "error");
        }
      });
      row.querySelector(".reject-btn").addEventListener("click", async () => {
        try {
          await api.adminRejectDeposit(r.id);
          toast(`Rejected request from ${r.username}`);
          await refreshPending();
        } catch (err) {
          toast(err.message, "error");
        }
      });
      list.appendChild(row);
    }
  }

  if (isAdmin) {
    refreshPending().catch((e) => toast(e.message, "error"));
    const poll = setInterval(() => refreshPending().catch(() => {}), 8000);
    container._depositsCleanup = () => clearInterval(poll);
  } else {
    container.querySelector("#dep-request-btn").addEventListener("click", async () => {
      const amount = Number(container.querySelector("#dep-amount").value);
      const note = container.querySelector("#dep-note").value.trim();
      try {
        await api.requestDeposit(amount, note);
        toast("Deposit request sent. The admin will confirm once your transfer arrives.");
        container.querySelector("#dep-note").value = "";
        await refreshMine();
      } catch (err) {
        toast(err.message, "error");
      }
    });
    refreshMine().catch((e) => toast(e.message, "error"));
  }

  return () => {
    if (container._depositsCleanup) container._depositsCleanup();
  };
}
