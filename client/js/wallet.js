import { api } from "./api.js";
import { toast } from "./toast.js";

export function renderWalletPanel(container, onBalanceChange, currentUser) {
  const admin = !!currentUser?.isAdmin;

  container.innerHTML = `
    <div class="wallet-panel">
      <div><strong>Wallet balance:</strong> <span id="wallet-balance">...</span> chips</div>
      ${
        admin
          ? `
      <div class="row">
        <input id="deposit-amount" type="number" min="1" placeholder="Amount" value="500" />
        <button class="primary" id="deposit-btn">Deposit</button>
        <button id="withdraw-btn">Withdraw</button>
      </div>
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin-top:6px">
        Deposits/withdrawals simulate a real payment processor for this build.
      </div>
      <hr style="border-color:#333;margin:12px 0" />
      <div><strong>Credit a player (admin)</strong></div>
      <div class="row">
        <input id="admin-username" type="text" placeholder="Username" />
        <input id="admin-amount" type="number" min="1" placeholder="Amount" value="500" />
        <button class="primary" id="admin-credit-btn">Credit</button>
      </div>
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
    </div>
  `;

  async function refresh() {
    const { balance } = await api.balance();
    container.querySelector("#wallet-balance").textContent = balance;
    onBalanceChange?.(balance);
  }

  if (admin) {
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
      const username = container.querySelector("#admin-username").value.trim();
      const amount = Number(container.querySelector("#admin-amount").value);
      if (!username) {
        toast("Enter a username", "error");
        return;
      }
      try {
        const result = await api.adminCredit(username, amount);
        toast(`Credited ${amount} chips to ${result.username}`);
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  container.querySelector("#withdraw-btn").addEventListener("click", async () => {
    const amount = Number(prompt("Withdraw how many chips?", "100"));
    if (!amount || amount <= 0) return;
    try {
      await api.withdraw(amount);
      await refresh();
      toast(`Withdrew ${amount} chips`);
    } catch (err) {
      toast(err.message, "error");
    }
  });

  refresh().catch((e) => toast(e.message, "error"));
  return refresh;
}
