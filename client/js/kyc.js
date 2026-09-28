import { api } from "./api.js";
import { toast } from "./toast.js";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtTime(ms) {
  return ms ? new Date(ms).toLocaleString() : "";
}

// Downscales/compresses a File image to a JPEG data URL, so a phone-camera
// photo of an ID (often several MB) fits comfortably under the server's
// upload cap instead of failing with "Request body too large".
function fileToCompressedDataUrl(file, maxDim = 1600, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file"));
    reader.onload = () => {
      img.onerror = () => reject(new Error("Could not read the selected image"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function statusBadge(status) {
  const map = {
    unverified: ["Not verified", "var(--text-dim)"],
    pending: ["Pending review", "var(--accent)"],
    approved: ["Verified", "var(--accent-2)"],
    rejected: ["Rejected", "var(--danger)"],
  };
  const [label, color] = map[status] ?? [status, "var(--text-dim)"];
  return `<strong style="color:${color}">${escapeHtml(label)}</strong>`;
}

export function renderKycPanel(container, currentUser) {
  if (!currentUser) {
    container.innerHTML = "";
    return () => {};
  }

  container.innerHTML = `
    <div class="wallet-panel" style="margin-top:10px">
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin-bottom:8px">
        <strong>Identity Verification</strong>
      </div>
      <div id="kyc-body">Loading...</div>
    </div>
  `;

  const bodyEl = container.querySelector("#kyc-body");

  function renderForm(rejectionReason) {
    bodyEl.innerHTML = `
      ${rejectionReason ? `<div style="font-size:12px;color:var(--danger);margin-bottom:8px">Previous submission rejected: ${escapeHtml(rejectionReason)}</div>` : ""}
      <form id="kyc-form" style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        <input name="fullName" placeholder="Full legal name" required maxlength="100" />
        <input name="dateOfBirth" type="date" required />
        <textarea name="address" placeholder="Home address" required maxlength="300" rows="2"></textarea>
        <select name="idType" required>
          <option value="">ID document type&hellip;</option>
          <option value="passport">Passport</option>
          <option value="national_id">National ID</option>
          <option value="drivers_license">Driver's License</option>
        </select>
        <input name="idNumber" placeholder="ID number" required maxlength="60" />
        <label style="font-size:12px;color:var(--text-dim)">Photo of your ID (front)</label>
        <input name="idImage" type="file" accept="image/*" capture="environment" required />
        <button type="submit" class="primary">Submit for verification</button>
      </form>
    `;
    bodyEl.querySelector("#kyc-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const submitBtn = form.querySelector("button[type=submit]");
      const file = form.idImage.files[0];
      if (!file) {
        toast("Select a photo of your ID first", "error");
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = "Uploading...";
      try {
        const idImageData = await fileToCompressedDataUrl(file);
        await api.kycSubmit({
          fullName: form.fullName.value,
          dateOfBirth: form.dateOfBirth.value,
          address: form.address.value,
          idType: form.idType.value,
          idNumber: form.idNumber.value,
          idImageData,
        });
        toast("Submitted for review", "success");
        await refresh();
      } catch (err) {
        toast(err.message, "error");
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit for verification";
      }
    });
  }

  async function refresh() {
    const { status, submission } = await api.kycMine();
    if (status === "pending") {
      bodyEl.innerHTML = `
        <div style="font-size:13px">${statusBadge("pending")}</div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:4px">
          Submitted ${escapeHtml(fmtTime(submission?.submittedAt))}. An admin will review it shortly.
        </div>
      `;
    } else if (status === "approved") {
      bodyEl.innerHTML = `<div style="font-size:13px">${statusBadge("approved")}</div>`;
    } else if (status === "rejected") {
      renderForm(submission?.rejectionReason);
    } else {
      renderForm();
    }
  }

  refresh().catch((e) => {
    toast(e.message, "error");
    bodyEl.textContent = "Error: " + e.message;
  });

  return () => {};
}
