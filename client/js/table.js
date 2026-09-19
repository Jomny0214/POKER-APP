import { gameSocket } from "./ws.js";
import { cardEl, renderCardRow } from "./cards.js";
import { toast } from "./toast.js";
import { api } from "./api.js";

function seatPosition(index, maxSeats) {
  // Seats arranged around an ellipse, starting at the bottom-center (index 0)
  // and going clockwise, so "my" seat (when rotated) tends to sit at the bottom.
  const angleStep = (2 * Math.PI) / maxSeats;
  const angle = Math.PI / 2 + angleStep * index;
  const rx = 46; // % of felt width
  const ry = 42; // % of felt height
  const x = 50 + rx * Math.cos(angle);
  const y = 50 + ry * Math.sin(angle);
  return { left: `${x}%`, top: `${y}%` };
}

export function renderTable(root, tableId, currentUser, navigate) {
  root.innerHTML = `
    <div class="table-view-wrap">
      <div class="table-topbar">
        <button id="back-btn">&larr; Lobby</button>
        <div id="table-title" style="font-weight:700"></div>
        <div>
          <button id="sitout-btn">Sit Out</button>
          <button id="leave-btn" class="danger">Leave Table</button>
        </div>
      </div>
      <div class="felt" id="felt">
        <div class="pot-display" id="pot-display"></div>
        <div class="community" id="community"></div>
        <div class="phase-display" id="phase-display"></div>
      </div>
      <div id="showdown-banner"></div>
      <div id="draw-picker"></div>
      <div class="action-bar" id="action-bar" style="display:none"></div>
    </div>
  `;

  root.querySelector("#back-btn").addEventListener("click", () => {
    unsubscribe();
    navigate("lobby");
  });
  root.querySelector("#leave-btn").addEventListener("click", () => {
    gameSocket.send({ type: "standup", tableId });
  });

  let sittingOut = false;
  root.querySelector("#sitout-btn").addEventListener("click", () => {
    sittingOut = !sittingOut;
    gameSocket.send({ type: "sitout", tableId, value: sittingOut });
    root.querySelector("#sitout-btn").textContent = sittingOut ? "Sit In" : "Sit Out";
  });

  let selectedDiscards = new Set();
  let lastState = null;

  function onState(state) {
    lastState = state;
    render(state);
  }

  const unsubscribe = gameSocket.subscribeTable(tableId, onState);

  function render(state) {
    root.querySelector("#table-title").textContent = `${state.variantName} — ${state.stakes.label}`;

    const felt = root.querySelector("#felt");
    felt.querySelectorAll(".seat, .seat-empty").forEach((el) => el.remove());

    const handPlayers = new Map((state.hand?.players ?? []).map((p) => [p.id, p]));

    for (let i = 0; i < state.maxSeats; i++) {
      const pos = seatPosition(i, state.maxSeats);
      const seatData = state.seats[i];

      if (!seatData) {
        const div = document.createElement("div");
        div.className = "seat-empty";
        div.style.left = pos.left;
        div.style.top = pos.top;
        const canSit = state.yourSeat === null;
        div.innerHTML = `<button ${canSit ? "" : "disabled"}>Sit Here</button>`;
        if (canSit) {
          div.querySelector("button").addEventListener("click", () => promptSit(state, i));
        }
        felt.appendChild(div);
        continue;
      }

      const hp = handPlayers.get(seatData.userId);
      const div = document.createElement("div");
      div.className = "seat";
      if (hp?.folded) div.className += " folded";
      if (state.hand?.currentActor === seatData.userId) div.className += " acting";
      div.style.left = pos.left;
      div.style.top = pos.top;

      const isMe = seatData.userId === currentUser.id;
      const isButton = state.buttonSeatIndex === i;

      const box = document.createElement("div");
      box.className = "seat-box";
      box.innerHTML = `
        ${isButton ? `<div class="dealer-btn">D</div>` : ""}
        <div class="name">${seatData.username}${isMe ? " (you)" : ""}${seatData.sittingOut ? " · sitting out" : ""}</div>
        <div class="stack">${seatData.stack} chips</div>
        ${hp && hp.committed ? `<div class="committed">bet ${hp.committed}</div>` : ""}
      `;
      div.appendChild(box);

      // hole cards
      if (hp) {
        const holeRow = document.createElement("div");
        holeRow.className = "hole-cards";
        let codes = [];
        if (hp.revealedHoleCards) {
          codes = hp.revealedHoleCards;
        } else if (state.variantId !== "seven_stud" && state.variantId !== "seven_stud_hilo" && state.variantId !== "razz") {
          codes = Array(hp.holeCardCount).fill("??");
        }
        if (codes.length) {
          renderCardRow(holeRow, codes);
          box.appendChild(holeRow);
        }
        if (hp.upCards && hp.upCards.length) {
          const upRow = document.createElement("div");
          upRow.className = "up-cards";
          renderCardRow(upRow, hp.upCards);
          box.appendChild(upRow);
          if (hp.holeCardCount > hp.upCards.length) {
            const downRow = document.createElement("div");
            downRow.className = "hole-cards";
            renderCardRow(downRow, Array(hp.holeCardCount - hp.upCards.length).fill("??"));
            box.appendChild(downRow);
          }
        }
        if (hp.description) {
          const d = document.createElement("div");
          d.className = "committed";
          d.textContent = hp.description;
          box.appendChild(d);
        }
      }

      felt.appendChild(div);
    }

    root.querySelector("#pot-display").textContent = state.hand ? `Pot: ${state.hand.pot}` : "";
    root.querySelector("#phase-display").textContent = state.hand ? phaseLabel(state.hand.phase) : "Waiting for players";
    renderCardRow(root.querySelector("#community"), state.hand?.community ?? [], "community-card");

    renderShowdown(state);
    renderDrawPicker(state);
    renderActionBar(state);
  }

  function phaseLabel(phase) {
    const map = {
      preflop: "Pre-flop", flop: "Flop", turn: "Turn", river: "River",
      third: "3rd Street", fourth: "4th Street", fifth: "5th Street", sixth: "6th Street", seventh: "7th Street",
      complete: "Hand Complete",
    };
    if (map[phase]) return map[phase];
    if (typeof phase === "string" && phase.startsWith("betting")) return `Betting Round ${Number(phase.slice(7)) + 1}`;
    if (typeof phase === "string" && phase.startsWith("draw")) return `Draw Round ${Number(phase.slice(4)) + 1}`;
    return phase ?? "";
  }

  function renderShowdown(state) {
    const el = root.querySelector("#showdown-banner");
    if (!state.hand || state.hand.phase !== "complete" || !state.hand.result) {
      el.innerHTML = "";
      return;
    }
    const nameFor = (userId) => state.seats.find((s) => s && s.userId === userId)?.username ?? userId;
    const lines = [];
    for (const pot of state.hand.result.pots) {
      for (const w of pot.winners) {
        lines.push(`<div class="winner-line">${nameFor(w.playerId)} wins ${w.amount} (${w.side}${w.hand ? " – " + w.hand : ""})</div>`);
      }
    }
    el.innerHTML = `<div class="showdown-banner">${lines.join("")}</div>`;
  }

  function renderDrawPicker(state) {
    const el = root.querySelector("#draw-picker");
    const isDrawPhase = typeof state.hand?.phase === "string" && state.hand.phase.startsWith("draw");
    const myTurn = isDrawPhase && state.hand.currentActor === currentUser.id;
    if (!myTurn) {
      el.innerHTML = "";
      selectedDiscards = new Set();
      return;
    }
    const me = (state.hand.players ?? []).find((p) => p.id === currentUser.id);
    const codes = me?.revealedHoleCards ?? [];
    el.innerHTML = `<div class="draw-picker"><strong>Choose cards to discard (click to toggle), then draw:</strong><div class="cards-row" id="draw-cards"></div><button class="primary" id="draw-submit">Draw</button> <button id="draw-standpat">Stand Pat</button></div>`;
    const cardsRow = el.querySelector("#draw-cards");
    codes.forEach((code, i) => {
      const wrap = document.createElement("div");
      wrap.className = "card-pick" + (selectedDiscards.has(i) ? " selected" : "");
      wrap.innerHTML = `<div class="discard-label">${selectedDiscards.has(i) ? "DISCARD" : ""}</div>`;
      wrap.appendChild(cardEl(code));
      wrap.addEventListener("click", () => {
        if (selectedDiscards.has(i)) selectedDiscards.delete(i);
        else selectedDiscards.add(i);
        renderDrawPicker(state);
      });
      cardsRow.appendChild(wrap);
    });
    el.querySelector("#draw-submit").addEventListener("click", () => {
      gameSocket.send({ type: "draw", tableId, discardIndices: [...selectedDiscards] });
      selectedDiscards = new Set();
    });
    el.querySelector("#draw-standpat").addEventListener("click", () => {
      gameSocket.send({ type: "draw", tableId, discardIndices: [] });
      selectedDiscards = new Set();
    });
  }

  function renderActionBar(state) {
    const bar = root.querySelector("#action-bar");
    const myTurn = state.hand && state.hand.currentActor === currentUser.id && state.hand.legalActions;
    if (!myTurn) {
      bar.style.display = "none";
      bar.innerHTML = "";
      return;
    }
    bar.style.display = "flex";
    const legal = state.hand.legalActions;
    bar.innerHTML = "";

    const foldBtn = document.createElement("button");
    foldBtn.className = "danger";
    foldBtn.textContent = "Fold";
    foldBtn.addEventListener("click", () => gameSocket.send({ type: "action", tableId, action: { type: "fold" } }));
    bar.appendChild(foldBtn);

    const checkCallBtn = document.createElement("button");
    checkCallBtn.className = "primary";
    checkCallBtn.textContent = legal.canCheck ? "Check" : `Call ${legal.callAmount}`;
    checkCallBtn.addEventListener("click", () =>
      gameSocket.send({ type: "action", tableId, action: { type: legal.canCheck ? "check" : "call" } })
    );
    bar.appendChild(checkCallBtn);

    if (legal.canBetOrRaise) {
      const spacer = document.createElement("div");
      spacer.className = "spacer";
      bar.appendChild(spacer);

      const slider = document.createElement("div");
      slider.className = "bet-slider";
      const isFixed = legal.minTo === legal.maxTo;
      slider.innerHTML = `
        <span>${legal.canCall || !legal.canCheck ? "Raise to" : "Bet"}</span>
        ${isFixed ? "" : `<input type="range" min="${legal.minTo}" max="${legal.maxTo}" value="${legal.minTo}" id="bet-range" />`}
        <input type="number" min="${legal.minTo}" max="${legal.maxTo}" value="${legal.minTo}" id="bet-amount" ${isFixed ? "readonly" : ""} />
      `;
      bar.appendChild(slider);
      const range = slider.querySelector("#bet-range");
      const amount = slider.querySelector("#bet-amount");
      if (range) {
        range.addEventListener("input", () => (amount.value = range.value));
        amount.addEventListener("input", () => (range.value = amount.value));
      }

      const betBtn = document.createElement("button");
      betBtn.className = "gold";
      betBtn.textContent = legal.canCall || !legal.canCheck ? "Raise" : "Bet";
      betBtn.addEventListener("click", () => {
        const to = Math.max(legal.minTo, Math.min(legal.maxTo, Number(amount.value)));
        gameSocket.send({
          type: "action",
          tableId,
          action: { type: legal.canCheck ? "bet" : "raise", to },
        });
      });
      bar.appendChild(betBtn);

      const allInBtn = document.createElement("button");
      allInBtn.textContent = "All-In";
      allInBtn.addEventListener("click", () =>
        gameSocket.send({ type: "action", tableId, action: { type: legal.canCheck ? "bet" : "raise", to: legal.maxTo } })
      );
      bar.appendChild(allInBtn);
    }
  }

  async function promptSit(state, seatIndex) {
    const amountStr = prompt(`Buy in for how many chips? (${state.stakes.minBuyIn} - ${state.stakes.maxBuyIn})`, String(state.stakes.minBuyIn));
    if (!amountStr) return;
    const amount = Number(amountStr);
    if (!Number.isFinite(amount)) return;
    try {
      const bal = await api.balance();
      if (bal.balance < amount) {
        toast("Insufficient balance. Deposit chips from the lobby wallet panel first.", "error");
        return;
      }
      gameSocket.send({ type: "sit", tableId, seatIndex, buyIn: amount });
    } catch (err) {
      toast(err.message, "error");
    }
  }

  if (lastState) render(lastState);

  return unsubscribe;
}
