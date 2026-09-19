export function toast(message, kind = "info") {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast ${kind === "error" ? "error" : ""}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}
