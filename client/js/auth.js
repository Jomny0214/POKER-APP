import { api, setToken } from "./api.js";

export function renderAuth(root, onAuthed) {
  let mode = "login"; // "login" | "register" | "forgot"

  function render() {
    root.innerHTML = "";
    const box = document.createElement("div");
    box.className = "auth-box";

    if (mode === "forgot") {
      box.innerHTML = `
        <h2>Reset your password</h2>
        <form id="forgot-form">
          <input name="email" type="email" placeholder="Email" required />
          <div class="error-msg" id="auth-error"></div>
          <div class="meta" id="forgot-success" style="display:none;color:var(--accent-2, #2ecc71);font-size:13px"></div>
          <button type="submit" class="primary">Send reset link</button>
        </form>
        <div class="switch"><a id="switch-link">Back to log in</a></div>
      `;
      root.appendChild(box);

      box.querySelector("#switch-link").addEventListener("click", () => {
        mode = "login";
        render();
      });

      box.querySelector("#forgot-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = new FormData(e.target);
        const errEl = box.querySelector("#auth-error");
        const okEl = box.querySelector("#forgot-success");
        errEl.textContent = "";
        okEl.style.display = "none";
        try {
          const result = await api.forgotPassword(form.get("email"));
          okEl.textContent = result.message;
          okEl.style.display = "block";
          e.target.querySelector("button").disabled = true;
        } catch (err) {
          errEl.textContent = err.message;
        }
      });
      return;
    }

    box.innerHTML = `
      <h2>${mode === "login" ? "Log in" : "Create an account"}</h2>
      <form id="auth-form">
        ${mode === "register" ? `<input name="username" placeholder="Username" required minlength="3" maxlength="20" />` : ""}
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="Password" required minlength="8" />
        <div class="error-msg" id="auth-error"></div>
        <button type="submit" class="primary">${mode === "login" ? "Log in" : "Sign up"}</button>
      </form>
      ${mode === "login" ? `<div class="switch"><a id="forgot-link">Forgot password?</a></div>` : ""}
      <div class="switch">
        ${mode === "login" ? `Don't have an account? <a id="switch-link">Sign up</a>` : `Already have an account? <a id="switch-link">Log in</a>`}
      </div>
    `;
    root.appendChild(box);

    box.querySelector("#switch-link").addEventListener("click", () => {
      mode = mode === "login" ? "register" : "login";
      render();
    });

    const forgotLink = box.querySelector("#forgot-link");
    if (forgotLink) {
      forgotLink.addEventListener("click", () => {
        mode = "forgot";
        render();
      });
    }

    box.querySelector("#auth-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const errEl = box.querySelector("#auth-error");
      errEl.textContent = "";
      try {
        const result =
          mode === "login"
            ? await api.login(form.get("email"), form.get("password"))
            : await api.register(form.get("email"), form.get("username"), form.get("password"));
        setToken(result.token);
        onAuthed(result.user, result.balance);
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  }

  render();
}
