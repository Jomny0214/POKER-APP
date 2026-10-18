import { api } from "./api.js";
import { toast } from "./toast.js";

export function renderWalletPanel(container, onBalanceChange, currentUser) {
  const isAdmin = !!currentUser?.isAdmin;

  container.innerHTML = `
    <div class="wallet-panel">
      <div><strong>Wallet balance:</strong> <span id="wallet-balance">...</span> chips</div>
      ${
        isAdmin
          ? `
      <div class="row">
        <input id="deposit-amount" type="number" min="1" placeholder="Amount" value="500" />
        <button class="primary" id="deposit-btn">Deposit</button>
        <button id="withdraw-btn">Withdraw</button>
      </div>
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin-top:10px">
        <strong>Credit a player (admin)</strong>
      </div>
      <div class="row">
        <select id="admin-credit-username" style="min-width:180px">
          <option value="">Loading players...</option>
        </select>
        <button id="admin-players-refresh" title="Refresh player list">Refresh list</button>
      </div>
      <div class="row" style="margin-top:6px">
        <input id="admin-credit-amount" type="number" min="1" placeholder="Amount" value="500" />
        <button class="primary" id="admin-credit-btn">Credit</button>
      </div>
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin-top:10px">
        <strong>Bonus codes (admin)</strong>
      </div>
      <div class="row">
        <input id="bonus-code-new" type="text" placeholder="CODE e.g. BETA500" style="text-transform:uppercase" />
        <input id="bonus-code-amount" type="number" min="1" placeholder="Amount" value="500" style="max-width:100px" />
        <button class="primary" id="bonus-code-create-btn">Create</button>
      </div>
      <div id="bonus-code-list" class="meta" style="font-size:12px;color:var(--text-dim);margin-top:6px"></div>
      `
          : `
      <div class="row">
        <button id="withdraw-btn">Withdraw</button>
      </div>
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin-top:6px">
        Chip deposits are managed by the site admin. Ask them to credit your account.
      </div>
      `
      }
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin-top:10px">
        <strong>Have a bonus code?</strong>
      </div>
      <div class="row">
        <input id="bonus-code-redeem" type="text" placeholder="Enter code" style="text-transform:uppercase" />
        <button class="primary" id="bonus-code-redeem-btn">Redeem</button>
      </div>
    </div>
  `;

  async function refresh() {
    const { balance } = await api.balance();
    container.querySelector("#wallet-balance").textContent = balance;
    onBalanceChange?.(balance);
  }

  async function loadPlayers() {
    const select = container.querySelector("#admin-credit-username");
    if (!select) return;
    const previousValue = select.value;
    select.innerHTML = `<option value="">Loading players...</option>`;
    try {
      const { players } = await api.adminPlayers();
      if (!players.length) {
        select.innerHTML = `<option value="">No registered players yet</option>`;
        return;
      }
      select.innerHTML = players
        .map((p) => `<option value="${p.username}">${p.username} (${p.balance} chips)</option>`)
        .join("");
      if (previousValue && players.some((p) => p.username === previousValue)) {
        select.value = previousValue;
      }
    } catch (err) {
      select.innerHTML = `<option value="">Failed to load players</option>`;
      toast(err.message, "error");
    }
  }

  async function loadBonusCodes() {
    const list = container.querySelector("#bonus-code-list");
    if (!list) return;
    try {
      const { codes } = await api.adminListBonusCodes();
      list.innerHTML = codes.length
        ? codes.map((c) => `${c.code}: ${c.amount} chips (${c.redemptions} redeemed)`).join("<br>")
        : "No bonus codes yet.";
    } catch (err) {
      list.textContent = "Failed to load bonus codes.";
    }
  }

  if (isAdmin) {
    loadPlayers().catch(() => {});
    loadBonusCodes().catch(() => {});

    container.querySelector("#admin-players-refresh").addEventListener("click", () => {
      loadPlayers().catch((e) => toast(e.message, "error"));
    });

    container.querySelector("#bonus-code-create-btn").addEventListener("click", async () => {
      const code = container.querySelector("#bonus-code-new").value.trim();
      const amount = Number(container.querySelector("#bonus-code-amount").value);
      if (!code) {
        toast("Enter a code first", "error");
        return;
      }
      try {
        await api.adminCreateBonusCode(code, amount);
        toast(`Created bonus code ${code.toUpperCase()}`);
        container.querySelector("#bonus-code-new").value = "";
        await loadBonusCodes();
      } catch (err) {
        toast(err.message, "error");
      }
    });

    container.querySelector("#deposit-btn").addEventListener("click", async () => {
      const amount = Number(container.querySelector("#deposit-amount").value);
      try {
        await api.deposit(amount);
        await refresh();
        toast(`Deposited ${amount} chips`);
      } catch (err) {
        toast(err.message, "error");
      }
    });

    container.querySelector("#admin-credit-btn").addEventListener("click", async () => {
      const username = container.querySelector("#admin-credit-username").value.trim();
      const amount = Number(container.querySelector("#admin-credit-amount").value);
      if (!username) {
        toast("Pick a player from the list first", "error");
        return;
      }
      try {
        const result = await api.adminCredit(username, amount);
        toast(`Credited ${amount} chips to ${result.username}`);
        await loadPlayers();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  container.querySelector("#withdraw-btn").addEventListener("click", async () => {
    const amount = Number(prompt("Withdraw how many chips?", "100"));
    if (!amount) return;
    try {
      await api.withdraw(amount);
      await refresh();
      toast(`Withdrew ${amount} chips`);
    } catch (err) {
      toast(err.message, "error");
    }
  });

  container.querySelector("#bonus-code-redeem-btn").addEventListener("click", async () => {
    const input = container.querySelector("#bonus-code-redeem");
    const code = input.value.trim();
    if (!code) {
      toast("Enter a code first", "error");
      return;
    }
    try {
      await api.redeemBonus(code);
      await refresh();
      toast(`Bonus code redeemed!`);
      input.value = "";
    } catch (err) {
      toast(err.message, "error");
    }
  });

  refresh().catch((e) => toast(e.message, "error"));
  return refresh;
}
