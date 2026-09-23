import { api, getToken, setToken } from "./api.js";
import { renderAuth } from "./auth.js";
import { renderLobby } from "./lobby.js";
import { renderTable } from "./table.js";
import { renderTournamentLobby, renderTournamentDetail } from "./tournamentLobby.js";
import { gameSocket } from "./ws.js";
import { toast } from "./toast.js";

const root = document.getElementById("app-root");
const headerRight = document.getElementById("header-right");

let currentUser = null;
let cleanupTableView = null;
let cleanupLobbyView = null;

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

function stopLobbyViewIfActive() {
  if (cleanupLobbyView) {
    cleanupLobbyView();
    cleanupLobbyView = null;
  }
}

async function route() {
  if (!currentUser) return;
  const hash = location.hash.replace(/^#\/?/, "");
  stopTableViewIfActive();
  stopLobbyViewIfActive();

  if (hash.startsWith("tournament-table/")) {
    const rest = hash.slice("tournament-table/".length);
    const [tournamentId, tableId] = rest.split("/");
    cleanupTableView = renderTable(root, tableId, currentUser, navigate, { tournamentId });
  } else if (hash.startsWith("table/")) {
    const tableId = hash.slice("table/".length);
    cleanupTableView = renderTable(root, tableId, currentUser, navigate);
  } else if (hash.startsWith("tournament/")) {
    const tournamentId = hash.slice("tournament/".length);
    cleanupLobbyView = await renderTournamentDetail(root, tournamentId, navigate, currentUser);
  } else if (hash === "tournaments") {
    cleanupLobbyView = await renderTournamentLobby(root, navigate, currentUser);
  } else {
    cleanupLobbyView = await renderLobby(root, navigate, (balance) => renderHeader(balance), currentUser);
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
