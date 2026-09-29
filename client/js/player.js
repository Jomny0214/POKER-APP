import { renderWalletPanel } from "./wallet.js";
import { renderDepositPanel } from "./deposits.js";
import { renderPlayerLog } from "./playerlog.js";
import { renderHouseRevenue } from "./houserevenue.js";
import { renderCollusionPanel } from "./collusion.js";
import { renderKycPanel } from "./kyc.js";
import { renderKycAdminPanel } from "./kycadmin.js";
import { renderHandHistoryPanel } from "./handhistory.js";
import { renderChatPanel } from "./chat.js";
import { renderAccountPanel } from "./account.js";

// The "Player" tab: everything that isn't a table list -- wallet, identity
// verification, deposits, chat with the admin, hand-history/collusion/player
// log for admins, and account deletion. Previously all of this sat stacked
// under the cash-tables list in lobby.js; it's its own tab now so the table
// list isn't buried under a long scroll of account panels.
export async function renderPlayerTab(root, navigate, onBalanceChange, currentUser) {
  root.innerHTML = `
    <div class="nav-tabs">
      <button id="nav-cash">Cash Tables</button>
      <button id="nav-tourneys">Tournaments</button>
      <button class="active" id="nav-player">Player</button>
    </div>
    <div id="wallet-panel-mount"></div>
    <div id="kyc-panel-mount"></div>
    <div id="deposit-panel-mount"></div>
    <div id="kyc-admin-mount"></div>
    <div id="player-log-mount"></div>
    <div id="house-revenue-mount"></div>
    <div id="hand-history-mount"></div>
    <div id="collusion-panel-mount"></div>
    <div id="chat-panel-mount"></div>
    <div id="account-panel-mount"></div>
  `;

  root.querySelector("#nav-cash").addEventListener("click", () => navigate("lobby"));
  root.querySelector("#nav-tourneys").addEventListener("click", () => navigate("tournaments"));

  // renderWalletPanel is the one panel whose return value isn't a cleanup
  // function -- it returns its own internal `refresh`, which nothing here
  // needs to call, so it's invoked separately rather than folded into the
  // cleanups array below.
  renderWalletPanel(root.querySelector("#wallet-panel-mount"), onBalanceChange, currentUser);

  // Every other panel manages its own polling and returns a real cleanup
  // function (or nothing, for panels with no interval) -- collected here so
  // switching away from this tab actually stops all of them instead of
  // leaking timers.
  const cleanups = [
    renderKycPanel(root.querySelector("#kyc-panel-mount"), currentUser),
    renderDepositPanel(root.querySelector("#deposit-panel-mount"), currentUser),
    renderKycAdminPanel(root.querySelector("#kyc-admin-mount"), currentUser),
    renderPlayerLog(root.querySelector("#player-log-mount"), currentUser),
    renderHouseRevenue(root.querySelector("#house-revenue-mount"), currentUser),
    renderHandHistoryPanel(root.querySelector("#hand-history-mount"), currentUser),
    renderCollusionPanel(root.querySelector("#collusion-panel-mount"), currentUser),
    renderChatPanel(root.querySelector("#chat-panel-mount"), currentUser),
  ];
  renderAccountPanel(root.querySelector("#account-panel-mount"), currentUser, () => location.reload());

  return () => {
    for (const cleanup of cleanups) {
      if (typeof cleanup === "function") cleanup();
    }
  };
}
