import { api, setToken } from "./api.js";
import { toast } from "./toast.js";

// Self-service account deletion. The server enforces the real rules (zero
// balance, not seated anywhere) -- this just surfaces whatever it says and,
// on success, logs the browser out since the account no longer exists.
export function renderAccountPanel(container, currentUser, onDeleted) {
  container.innerHTML = `
    <div class="wallet-panel" style="margin-top:10px">
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin-bottom:8px">
        <strong>Account</strong>
      </div>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px">
        Deleting your account requires a $0 chip balance and that you're not seated at a table.
      </div>
      <button id="delete-account-btn" style="color:var(--danger, #e74c3c);border-color:var(--danger, #e74c3c)">
        Delete my account
      </button>
    </div>
  `;

  container.querySelector("#delete-account-btn").addEventListener("click", () => {
    const confirmed = confirm(
      "This permanently deletes your Apex Poker account and cannot be undone. Continue?"
    );
    if (!confirmed) return;
    api
      .deleteAccount()
      .then(() => {
        toast("Your account has been deleted.");
        setToken(null);
        onDeleted();
      })
      .catch((err) => toast(err.message, "error"));
  });
}
