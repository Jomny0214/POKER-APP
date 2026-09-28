import { api } from "./api.js";
import { toast } from "./toast.js";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtTime(ms) {
  return ms ? new Date(ms).toLocaleString() : "";
}

export function renderKycAdminPanel(container, currentUser) {
  if (!currentUser?.isAdmin) {
    container.innerHTML = "";
    return () => {};
  }

  container.innerHTML = `
    <div class="wallet-panel" style="margin-top:10px">
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin-bottom:8px">
        <strong>ID Verification Queue</strong>
      </div>
      <div id="kyc-admin-list"></div>
    </div>
  `;

  const listEl = container.querySelector("#kyc-admin-list");
  let expandedId = null; // while set, the poll below leaves the open review card alone

  async function openDetail(id) {
    expandedId = id;
    const { submission } = await api.adminKycDetail(id);
    const row = listEl.querySelector(`[data-pending-id="${id}"]`);
    if (!row) return;
    row.innerHTML = `
      <div style="font-size:12px;margin-bottom:6px">
        <div><strong>${escapeHtml(submission.fullName)}</strong> (${escapeHtml(submission.username)})</div>
        <div>DOB: ${escapeHtml(submission.dateOfBirth)}</div>
        <div>Address: ${escapeHtml(submission.address)}</div>
        <div>${escapeHtml(submission.idType)} &middot; ${escapeHtml(submission.idNumber)}</div>
        <div style="color:var(--text-dim)">Submitted ${escapeHtml(fmtTime(submission.submittedAt))}</div>
      </div>
      <img src="${submission.idImageData}" alt="ID photo" style="max-width:100%;border-radius:6px;margin-bottom:8px;display:block" />
      <div style="display:flex;gap:6px">
        <button class="primary approve-btn">Approve</button>
        <button class="reject-btn">Reject</button>
      </div>
    `;
    row.querySelector(".approve-btn").addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        await api.adminKycApprove(id);
        toast("Verified", "success");
        expandedId = null;
        await refresh();
      } catch (err) {
        toast(err.message, "error");
        e.target.disabled = false;
      }
    });
    row.querySelector(".reject-btn").addEventListener("click", async () => {
      const reason = prompt("Reason for rejecting this submission?") ?? "";
      try {
        await api.adminKycReject(id, reason);
        toast("Rejected", "success");
        expandedId = null;
        await refresh();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  async function refresh() {
    if (expandedId !== null) return; // don't clobber an open review card
    const { pending } = await api.adminKycPending();
    if (!pending.length) {
      listEl.innerHTML = `<div class="meta" style="font-size:12px;color:var(--text-dim);padding:8px 0">No submissions waiting on review.</div>`;
      return;
    }
    listEl.innerHTML = pending
      .map(
        (p) => `
      <div class="row" data-pending-id="${p.id}" style="flex-direction:column;align-items:flex-start;gap:4px;border-top:1px solid rgba(255,255,255,0.06);padding:8px 0;font-size:12px">
        <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
          <span>${escapeHtml(p.username)} &middot; ${escapeHtml(p.full_name)} &middot; ${escapeHtml(p.id_type)}</span>
          <button class="review-btn" data-id="${p.id}" style="font-size:11px;padding:3px 8px">Review</button>
        </div>
      </div>`
      )
      .join("");
    listEl.querySelectorAll(".review-btn").forEach((btn) => {
      btn.addEventListener("click", () => openDetail(Number(btn.dataset.id)).catch((e) => toast(e.message, "error")));
    });
  }

  refresh().catch((e) => {
    toast(e.message, "error");
    listEl.textContent = "Error: " + e.message;
  });

  const poll = setInterval(() => refresh().catch(() => {}), 15000);
  return () => clearInterval(poll);
}
