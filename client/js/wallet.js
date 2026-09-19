import { api } from "./api.js";
import { toast } from "./toast.js";

export function renderWalletPanel(container, onBalanceChange) {
  container.innerHTML = `
    <div class="wallet-panel">
      <div><strong>Wallet balance:</strong> <span id="wallet-balance">...</span> chips</div>
      <div class="row">
        <input id="deposit-amount" type="number" min="1" placeholder="Amount" value="500" />
        <button class="primary" id="deposit-btn">Deposit</button>
        <button id="withdraw-btn">Withdraw</button>
      </div>
      <div class="meta" style="font-size:12px;color:var(--text-dim);margin-top:6px">
        Deposits/withdrawals simulate a real payment processor for this build.
      </div>
    </div>
  `;

  async function refresh() {
    const { balance } = await api.balance();
    container.querySelector("#wallet-balance").textContent = balance;
    onBalanceChange?.(balance);
  }

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

  container.querySelector("#withdraw-btn").addEventListener("click", async () => {
    const amount = Number(container.querySelector("#deposit-amount").value);
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
