import { api, setToken } from "./api.js";

export function renderAuth(root, onAuthed) {
  let mode = "login";

  function render() {
    root.innerHTML = "";
    const box = document.createElement("div");
    box.className = "auth-box";
    box.innerHTML = `
      <h2>${mode === "login" ? "Log in" : "Create an account"}</h2>
      <form id="auth-form">
        ${mode === "register" ? `<input name="username" placeholder="Username" required minlength="3" maxlength="20" />` : ""}
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="Password" required minlength="8" />
        <div class="error-msg" id="auth-error"></div>
        <button type="submit" class="primary">${mode === "login" ? "Log in" : "Sign up"}</button>
      </form>
      <div class="switch">
        ${mode === "login" ? `Don't have an account? <a id="switch-link">Sign up</a>` : `Already have an account? <a id="switch-link">Log in</a>`}
      </div>
    `;
    root.appendChild(box);

    box.querySelector("#switch-link").addEventListener("click", () => {
      mode = mode === "login" ? "register" : "login";
      render();
    });

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
