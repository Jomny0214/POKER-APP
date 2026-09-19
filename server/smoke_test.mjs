const BASE = "http://localhost:8099";
const WS = "ws://localhost:8099/ws";

async function j(path, opts) {
  const res = await fetch(BASE + path, opts);
  const body = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const msgs = [];
    ws.onmessage = (ev) => msgs.push(JSON.parse(ev.data));
    ws.onerror = (e) => reject(e);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", token }));
      resolve({ ws, msgs });
    };
  });
}

function latestState(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].type === "table_state") return msgs[i];
  }
  return null;
}

async function waitFor(msgs, pred, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = latestState(msgs);
    if (s && pred(s)) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timeout waiting for condition. last state: " + JSON.stringify(latestState(msgs)));
}

async function main() {
  const tables = (await j("/api/tables")).tables;
  const table = tables.find((t) => t.variantId === "holdem" && t.stakes.id === "micro");
  console.log("table:", table.id, table.name);

  const aliceLogin = await j("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "alice@example.com", password: "password123" }),
  });
  const bobLogin = await j("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "bob@example.com", password: "password123" }),
  });

  const alice = await connect(aliceLogin.token);
  const bob = await connect(bobLogin.token);
  await new Promise((r) => setTimeout(r, 200));

  alice.ws.send(JSON.stringify({ type: "subscribe", tableId: table.id }));
  bob.ws.send(JSON.stringify({ type: "subscribe", tableId: table.id }));
  await new Promise((r) => setTimeout(r, 200));

  alice.ws.send(JSON.stringify({ type: "sit", tableId: table.id, seatIndex: 0, buyIn: 200 }));
  await new Promise((r) => setTimeout(r, 200));
  bob.ws.send(JSON.stringify({ type: "sit", tableId: table.id, seatIndex: 1, buyIn: 200 }));

  const started = await waitFor(alice.msgs, (s) => s.hand && s.hand.phase !== undefined);
  console.log("hand started, phase:", started.hand.phase, "pot:", started.hand.pot);

  const balBeforeAlice = await j("/api/wallet/balance", { headers: { Authorization: `Bearer ${aliceLogin.token}` } });
  const balBeforeBob = await j("/api/wallet/balance", { headers: { Authorization: `Bearer ${bobLogin.token}` } });
  console.log("balances after buy-in (200 escrowed each):", balBeforeAlice, balBeforeBob);

  // Drive the hand to completion: whoever's turn it is calls/checks, until complete.
  let guard = 0;
  while (guard++ < 200) {
    const aState = latestState(alice.msgs);
    if (!aState.hand) break;
    if (aState.hand.phase === "complete") break;
    const actorId = aState.hand.currentActor;
    if (!actorId) {
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }
    const actingClient = aState.yourSeat !== null && aState.seats[aState.yourSeat]?.userId === actorId ? alice : bob;
    // figure out which client actually owns this actor id by checking seats
    const seat = aState.seats.find((s) => s && s.userId === actorId);
    const client = seat && seat.username === "alice" ? alice : bob;
    const legal = aState.hand.legalActions;
    const action = legal && legal.canCheck ? { type: "check" } : { type: "call" };
    client.ws.send(JSON.stringify({ type: "action", tableId: table.id, action }));
    await new Promise((r) => setTimeout(r, 150));
  }

  const finalState = await waitFor(alice.msgs, (s) => s.hand && s.hand.phase === "complete", 8000);
  console.log("hand complete. result:", JSON.stringify(finalState.hand.result));
  console.log("final seats:", JSON.stringify(finalState.seats));

  alice.ws.close();
  bob.ws.close();
  console.log("SMOKE TEST PASSED");
}

main().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
