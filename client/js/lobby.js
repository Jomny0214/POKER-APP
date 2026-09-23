import { api } from "./api.js";
import { toast } from "./toast.js";
import { renderWalletPanel } from "./wallet.js";
import { renderDepositPanel } from "./deposits.js";

export async function renderLobby(root, navigate, onBalanceChange, currentUser) {
  root.innerHTML = `
    <div id="wallet-panel-mount"></div>
    <div id="deposit-panel-mount"></div>
    <div class="nav-tabs">
      <button class="active" id="nav-cash">Cash Tables</button>
      <button id="nav-tourneys">Tournaments</button>
    </div>
    <div class="lobby-toolbar">
      <h2 style="margin:0">Tables</h2>
      <button id="refresh-btn">Refresh</button>
    </div>
    <div class="lobby-grid" id="lobby-grid">Loading...</div>
  `;

  root.querySelector("#nav-tourneys").addEventListener("click", () => navigate("tournaments"));

  renderWalletPanel(root.querySelector("#wallet-panel-mount"), onBalanceChange, currentUser);
  renderDepositPanel(root.querySelector("#deposit-panel-mount"), currentUser);

  async function load() {
    const { tables } = await api.tables();
    const grid = root.querySelector("#lobby-grid");
    grid.innerHTML = "";
    // group by variant for readability
    const byVariant = new Map();
    for (const t of tables) {
      if (!byVariant.has(t.variantName)) byVariant.set(t.variantName, []);
      byVariant.get(t.variantName).push(t);
    }
    for (const [variantName, rows] of byVariant) {
      const header = document.createElement("div");
      header.style.gridColumn = "1 / -1";
      header.style.marginTop = "10px";
      header.style.fontWeight = "700";
      header.style.color = "var(--text-dim)";
      header.textContent = variantName;
      grid.appendChild(header);
      for (const t of rows) {
        const card = document.createElement("div");
        card.className = "table-card";
        card.innerHTML = `
          <h3>${t.name}</h3>
          <div class="meta">Stakes ${t.stakes.label} &middot; Buy-in ${t.stakes.minBuyIn}-${t.stakes.maxBuyIn}</div>
          <div class="row">
            <span class="seat-badge">${t.occupied}/${t.maxSeats} seated</span>
            <span class="meta">${t.handInProgress ? "<span class=\"live-dot\"></span>Hand in progress" : "Waiting for players"}</span>
          </div>
          <div class="row">
            <button class="primary join-btn" style="width:100%">Join Table</button>
          </div>
        `;
        card.querySelector(".join-btn").addEventListener("click", () => navigate(`table/${t.id}`));
        grid.appendChild(card);
      }
    }
  }

  root.querySelector("#refresh-btn").addEventListener("click", () => load().catch((e) => toast(e.message, "error")));
  await load().catch((e) => toast(e.message, "error"));

  const pollInterval = setInterval(() => {
    load().catch(() => {});
  }, 5000);

  return () => clearInterval(pollInterval);
}
