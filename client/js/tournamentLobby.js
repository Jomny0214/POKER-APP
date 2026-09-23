import { api } from "./api.js";
import { toast } from "./toast.js";

function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function fmtDuration(ms) {
  if (ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function statusPill(status) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return `<span class="status-pill ${status}">${label}</span>`;
}

// ---------------------------------------------------------------------
// Lobby list
// ---------------------------------------------------------------------

export async function renderTournamentLobby(root, navigate, currentUser) {
  root.innerHTML = `
    <div class="nav-tabs">
      <button id="nav-cash">Cash Tables</button>
      <button class="active" id="nav-tourneys">Tournaments</button>
    </div>
    <div class="lobby-toolbar">
      <h2 style="margin:0">Tournaments</h2>
      <div>
        ${currentUser?.isAdmin ? `<button id="create-tourney-btn" class="primary">Create Tournament</button>` : ""}
        <button id="refresh-btn">Refresh</button>
      </div>
    </div>
    <div id="create-tourney-mount"></div>
    <div id="tourney-sections">Loading...</div>
  `;

  root.querySelector("#nav-cash").addEventListener("click", () => navigate("lobby"));

  if (currentUser?.isAdmin) {
    root.querySelector("#create-tourney-btn").addEventListener("click", () => {
      const mount = root.querySelector("#create-tourney-mount");
      if (mount.innerHTML) {
        mount.innerHTML = "";
      } else {
        renderCreateForm(mount, () => load().catch(() => {}));
      }
    });
  }

  async function load() {
    const { tournaments } = await api.tournaments();
    const sections = root.querySelector("#tourney-sections");
    sections.innerHTML = "";
    const groups = [
      ["registering", "Registering"],
      ["running", "Running"],
      ["finished", "Finished"],
    ];
    for (const [status, label] of groups) {
      const rows = tournaments.filter((t) => t.status === status);
      const section = document.createElement("div");
      section.className = "tourney-section";
      section.innerHTML = `<h3>${label} (${rows.length})</h3>`;
      const grid = document.createElement("div");
      grid.className = "tourney-grid";
      if (rows.length === 0) {
        grid.innerHTML = `<div class="meta" style="color:var(--text-dim)">None right now</div>`;
      }
      for (const t of rows) {
        const card = document.createElement("div");
        card.className = "tourney-card";
        card.innerHTML = `
          <div class="row" style="justify-content:space-between;align-items:center">
            <h3>${t.name}</h3>
            ${statusPill(t.status)}
          </div>
          <div class="meta">${t.variantId === "holdem" ? "Texas Hold'em" : "Omaha"} &middot; ${t.tableSize}-max</div>
          <div class="meta">Buy-in ${t.buyin} chips ${t.rebuyAllowed ? "&middot; rebuys allowed" : ""}</div>
          <div class="meta">${t.status === "registering" ? `Starts ${fmtDate(t.scheduledStartAt)}` : `Prize pool ${t.prizePool} chips`}</div>
          <div class="row">
            <span class="seat-badge">${t.entrants.total} entered${t.status !== "registering" ? ` &middot; ${t.entrants.active} left` : ""}</span>
          </div>
        `;
        card.addEventListener("click", () => navigate(`tournament/${t.id}`));
        grid.appendChild(card);
      }
      section.appendChild(grid);
      sections.appendChild(section);
    }
  }

  root.querySelector("#refresh-btn").addEventListener("click", () => load().catch((e) => toast(e.message, "error")));
  await load().catch((e) => toast(e.message, "error"));

  const pollInterval = setInterval(() => load().catch(() => {}), 8000);
  return () => clearInterval(pollInterval);
}

function renderCreateForm(mount, onCreated) {
  mount.innerHTML = `<div class="panel" style="background:var(--panel);border:1px solid #24333f;border-radius:var(--radius);padding:16px;margin-bottom:16px">
    <h3 style="margin-top:0">New Tournament</h3>
    <div class="form-grid">
      <label>Name<input id="f-name" type="text" placeholder="Sunday Special" /></label>
      <label>Variant
        <select id="f-variant">
          <option value="holdem">Texas Hold'em</option>
          <option value="omaha">Omaha</option>
        </select>
      </label>
      <label>Table size
        <select id="f-size"><option value="9">9-max</option><option value="6">6-max</option></select>
      </label>
      <label>Buy-in (chips)<input id="f-buyin" type="number" min="1" value="1000" /></label>
      <label>Starting stack<input id="f-stack" type="number" min="1" value="10000" /></label>
      <label>Max tables (cap 100)<input id="f-maxtables" type="number" min="1" max="100" value="20" /></label>
      <label>Scheduled start<input id="f-start" type="datetime-local" /></label>
      <label>Blind schedule
        <select id="f-preset">
          <option value="standard">Standard (~15 min levels)</option>
          <option value="turbo">Turbo (~5 min levels)</option>
          <option value="hyperturbo">Hyper-Turbo (~3 min levels)</option>
          <option value="custom">Custom (JSON)</option>
        </select>
      </label>
      <label class="span-2" id="f-custom-wrap" style="display:none">Custom levels (JSON array of {smallBlind,bigBlind,ante,durationMinutes})
        <textarea id="f-custom">[{"smallBlind":25,"bigBlind":50,"ante":0,"durationMinutes":15}]</textarea>
      </label>
      <label><input id="f-rebuy" type="checkbox" style="width:auto" /> Allow rebuys</label>
      <label>Rebuy price<input id="f-rebuy-price" type="number" min="1" value="1000" disabled /></label>
      <label>Rebuy window type
        <select id="f-rebuy-type" disabled>
          <option value="levels">First N levels</option>
          <option value="minutes">First N minutes</option>
        </select>
      </label>
      <label>Rebuy window value<input id="f-rebuy-value" type="number" min="1" value="4" disabled /></label>
    </div>
    <div class="row" style="margin-top:14px">
      <button class="primary" id="f-submit">Create Tournament</button>
    </div>
  </div>`;

  const presetSel = mount.querySelector("#f-preset");
  const customWrap = mount.querySelector("#f-custom-wrap");
  presetSel.addEventListener("change", () => {
    customWrap.style.display = presetSel.value === "custom" ? "flex" : "none";
  });

  const rebuyChk = mount.querySelector("#f-rebuy");
  const rebuyFields = ["#f-rebuy-price", "#f-rebuy-type", "#f-rebuy-value"].map((s) => mount.querySelector(s));
  rebuyChk.addEventListener("change", () => {
    for (const el of rebuyFields) el.disabled = !rebuyChk.checked;
  });

  mount.querySelector("#f-submit").addEventListener("click", async () => {
    try {
      const startLocal = mount.querySelector("#f-start").value;
      if (!startLocal) throw new Error("Pick a scheduled start time");
      const scheduledStartAt = new Date(startLocal).getTime();

      const input = {
        name: mount.querySelector("#f-name").value.trim(),
        variantId: mount.querySelector("#f-variant").value,
        tableSize: Number(mount.querySelector("#f-size").value),
        buyin: Number(mount.querySelector("#f-buyin").value),
        startingStack: Number(mount.querySelector("#f-stack").value),
        maxTables: Number(mount.querySelector("#f-maxtables").value),
        scheduledStartAt,
        rebuyAllowed: rebuyChk.checked,
      };
      if (rebuyChk.checked) {
        input.rebuyPrice = Number(mount.querySelector("#f-rebuy-price").value);
        input.rebuyPeriodType = mount.querySelector("#f-rebuy-type").value;
        input.rebuyPeriodValue = Number(mount.querySelector("#f-rebuy-value").value);
      }
      if (presetSel.value === "custom") {
        input.customBlindSchedule = JSON.parse(mount.querySelector("#f-custom").value);
      } else {
        input.blindPreset = presetSel.value;
      }

      await api.createTournament(input);
      toast(`Tournament "${input.name}" created`);
      mount.innerHTML = "";
      onCreated();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ---------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------

export async function renderTournamentDetail(root, tournamentId, navigate, currentUser) {
  root.innerHTML = `<div class="tourney-detail" id="tourney-detail-root">Loading...</div>`;

  async function load() {
    let t;
    try {
      t = await api.tournament(tournamentId);
    } catch (err) {
      toast(err.message, "error");
      navigate("tournaments");
      return;
    }
    render(t);
  }

  function render(t) {
    const wrap = root.querySelector("#tourney-detail-root");
    if (!wrap) return;

    const level = t.currentLevelInfo;
    const levelText = level
      ? `${level.smallBlind}/${level.bigBlind}${level.ante ? ` (ante ${level.ante})` : ""} &middot; Level ${t.currentLevel + 1}/${t.totalLevels}`
      : "—";

    let actionHtml = "";
    if (t.status === "registering") {
      if (t.you.registered) {
        actionHtml = `<button class="danger" id="unreg-btn">Unregister (refund ${t.buyin})</button>`;
      } else {
        actionHtml = `<button class="primary" id="reg-btn">Register — ${t.buyin} chips</button>`;
      }
    } else if (t.status === "running" && t.you.registered) {
      if (t.you.status === "active" && t.you.tableId) {
        actionHtml = `<button class="primary" id="goto-table-btn">Go to my table</button>`;
      } else if (t.you.status === "active") {
        actionHtml = `<div class="meta">Waiting to be seated…</div>`;
      } else {
        actionHtml = `<div class="meta">You finished in place ${t.you.finishRank ?? "?"}${t.you.payout ? ` — paid ${t.you.payout} chips` : ""}.</div>`;
      }
    } else if (t.status === "finished" && t.you.registered) {
      actionHtml = `<div class="meta">You finished in place ${t.you.finishRank ?? "?"}${t.you.payout ? ` — paid ${t.you.payout} chips` : ""}.</div>`;
    }

    const adminHtml =
      currentUser?.isAdmin && t.status === "running"
        ? `<button class="danger" id="force-end-btn">Force End Tournament</button>`
        : "";

    wrap.innerHTML = `
      <div class="panel">
        <div class="row" style="justify-content:space-between;align-items:center">
          <h2 style="margin:0">${t.name}</h2>
          ${statusPill(t.status)}
        </div>
        <div class="meta">${t.variantId === "holdem" ? "Texas Hold'em" : "Omaha"} &middot; ${t.tableSize}-max ${t.rebuyAllowed ? "&middot; rebuys allowed" : "&middot; freezeout"}</div>
        <div class="stat-row">
          <div class="stat"><div class="label">Buy-in</div><div class="value">${t.buyin}</div></div>
          <div class="stat"><div class="label">Starting stack</div><div class="value">${t.startingStack}</div></div>
          <div class="stat"><div class="label">Prize pool</div><div class="value">${t.prizePool}</div></div>
          <div class="stat"><div class="label">Entrants</div><div class="value">${t.entrants.total}</div></div>
          <div class="stat"><div class="label">Paid spots</div><div class="value">${t.paidSpots}</div></div>
          ${t.status !== "registering" ? `<div class="stat"><div class="label">Blinds</div><div class="value" style="font-size:14px">${levelText}</div></div>` : ""}
          ${t.status === "registering" ? `<div class="stat"><div class="label">Starts</div><div class="value" style="font-size:14px">${fmtDate(t.scheduledStartAt)}</div></div>` : ""}
        </div>
        <div class="row">${actionHtml}${adminHtml}</div>
      </div>
      <div class="panel">
        <h3 style="margin-top:0">Standings</h3>
        <table class="standings-table">
          <thead><tr><th>#</th><th>Player</th><th>Status</th><th>Stack</th><th>Rebuys</th><th>Payout</th></tr></thead>
          <tbody id="standings-body"></tbody>
        </table>
      </div>
    `;

    const tbody = wrap.querySelector("#standings-body");
    t.standings.forEach((s, i) => {
      const tr = document.createElement("tr");
      const isYou = currentUser && s.username === currentUser.username;
      tr.className = `${isYou ? "you " : ""}${s.status === "busted" ? "busted" : ""}`;
      const place = s.finishRank ?? (s.status === "busted" ? "—" : i + 1);
      tr.innerHTML = `
        <td>${place}</td>
        <td>${s.username}${isYou ? " (you)" : ""}</td>
        <td>${s.status}</td>
        <td>${s.status === "busted" ? "—" : s.stack}</td>
        <td>${s.rebuysUsed || 0}</td>
        <td>${s.payout ?? "—"}</td>
      `;
      tbody.appendChild(tr);
    });

    const regBtn = wrap.querySelector("#reg-btn");
    if (regBtn) {
      regBtn.addEventListener("click", async () => {
        try {
          await api.registerTournament(tournamentId);
          toast("Registered!");
          load();
        } catch (err) {
          toast(err.message, "error");
        }
      });
    }
    const unregBtn = wrap.querySelector("#unreg-btn");
    if (unregBtn) {
      unregBtn.addEventListener("click", async () => {
        try {
          await api.unregisterTournament(tournamentId);
          toast("Unregistered, buy-in refunded");
          load();
        } catch (err) {
          toast(err.message, "error");
        }
      });
    }
    const gotoBtn = wrap.querySelector("#goto-table-btn");
    if (gotoBtn) {
      gotoBtn.addEventListener("click", () => navigate(`tournament-table/${tournamentId}/${t.you.tableId}`));
    }
    const forceEndBtn = wrap.querySelector("#force-end-btn");
    if (forceEndBtn) {
      forceEndBtn.addEventListener("click", async () => {
        if (!confirm("Force-end this tournament now and pay out by current chip counts?")) return;
        try {
          await api.forceEndTournament(tournamentId);
          toast("Tournament ended");
          load();
        } catch (err) {
          toast(err.message, "error");
        }
      });
    }
  }

  await load();
  const pollInterval = setInterval(() => load().catch(() => {}), 5000);
  return () => clearInterval(pollInterval);
}
