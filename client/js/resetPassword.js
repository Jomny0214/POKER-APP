import { api } from "./api.js";

// Rendered for a link like #/reset-password/<token>, reached by tapping the
// link in a "forgot password" email -- deliberately bypasses the normal
// login-gated router in app.js, since whoever's here isn't logged in yet.
export function renderResetPassword(root, token, onDone) {
  root.innerHTML = "";
  const box = document.createElement("div");
  box.className = "auth-box";
  box.innerHTML = `
    <h2>Choose a new password</h2>
    <form id="reset-form">
      <input name="password" type="password" placeholder="New password" required minlength="8" />
      <input name="confirm" type="password" placeholder="Confirm new password" required minlength="8" />
      <div class="error-msg" id="reset-error"></div>
      <button type="submit" class="primary">Set new password</button>
    </form>
  `;
  root.appendChild(box);

  box.querySelector("#reset-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const errEl = box.querySelector("#reset-error");
    errEl.textContent = "";
    const password = form.get("password");
    if (password !== form.get("confirm")) {
      errEl.textContent = "Passwords don't match.";
      return;
    }
    try {
      await api.resetPassword(token, password);
      box.innerHTML = `
        <h2>Password updated</h2>
        <p class="meta">Your password has been changed. Log in with your new password.</p>
        <button class="primary" id="reset-done-btn">Go to log in</button>
      `;
      box.querySelector("#reset-done-btn").addEventListener("click", onDone);
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}
