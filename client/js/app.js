import { api, getToken, setToken } from "./api.js";
import { renderAuth } from "./auth.js";
import { renderLobby } from "./lobby.js";
import { renderTable } from "./table.js";
import { gameSocket } from "./ws.js";
import { toast } from "./toast.js";

const root = document.getElementById("app-root");
const headerRight = document.getElementById("header-right");

let currentUser = null;
let cleanupTableView = null;

function renderHeader(balance) {
  if (!currentUser) {
    headerRight.innerHTML = "";
    return;
  }
  headerRight.innerHTML = `
    <span class="balance-chip">${balance ?? 0} chips</span>
    <span>${currentUser.username}</span>
    <button id="logout-btn">Log out</button>
  `;
  headerRight.querySelector("#logout-btn").addEventListener("click", async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    setToken(null);
    currentUser = null;
    location.hash = "";
    boot();
  });
}

function navigate(path) {
  location.hash = `#/${path}`;
}

function stopTableViewIfActive() {
  if (cleanupTableView) {
    cleanupTableView();
    cleanupTableView = null;
  }
}

async function route() {
  if (!currentUser) return;
  const hash = location.hash.replace(/^#\/?/, "");
  stopTableViewIfActive();

  if (hash.startsWith("table/")) {
    const tableId = hash.slice("table/".length);
    cleanupTableView = renderTable(root, tableId, currentUser, navigate);
  } else {
    await renderLobby(root, navigate, (balance) => renderHeader(balance));
  }
}

window.addEventListener("hashchange", () => route().catch((e) => toast(e.message, "error")));

async function boot() {
  const token = getToken();
  if (!token) {
    renderAuth(root, async (user, balance) => {
      currentUser = user;
      renderHeader(balance);
      await gameSocket.connect();
      navigate("lobby");
      route();
    });
    return;
  }

  try {
    const me = await api.me();
    currentUser = me.user;
    renderHeader(me.balance);
    await gameSocket.connect();
    if (!location.hash) navigate("lobby");
    await route();
  } catch {
    setToken(null);
    boot();
  }
}

gameSocket.onGlobal((msg) => {
  if (msg.type === "error") toast(msg.message, "error");
});

boot();
