# Apex Poker

An online multiplayer poker platform: real-time play, a real-money-shaped
wallet ledger, and nine poker variants. Built as a foundation to build on,
not a GGPoker-scale product — see **Scope & honesty** below for exactly
what that means.

## Variants

Texas Hold'em, Pot-Limit Omaha, Omaha Hi-Lo (8-or-better), 5-Card Omaha
Hi-Lo (Big O), 7-Card Stud, 7-Card Stud Hi-Lo, Razz, 5-Card Draw, and 2-7
Triple Draw. Each runs a correct betting structure (no-limit, pot-limit, or
fixed-limit with a raise cap), side pots for multi-way all-ins, and hi/lo
pot splitting where the variant calls for it.

## Architecture

```
packages/engine/   Pure game logic (no I/O): cards, hand evaluation,
                    betting rounds, side pots, per-variant dealing/showdown
                    state machine. Fully unit- and simulation-tested.
server/             Node HTTP + WebSocket server: auth, wallet ledger
                    (SQLite), table/seat management, turn timers.
client/              Plain HTML/CSS/JS front end (no build step).
```

**A note on dependencies:** this was built in a sandboxed environment with
no access to the npm registry, so the server and client use zero external
runtime packages — the WebSocket server (RFC 6455) is hand-implemented on
Node's built-in `http`/`crypto`, the wallet/auth database uses Node's
built-in `node:sqlite`, and the client is dependency-free HTML/CSS/ES
modules instead of a React/Vite build. Everything still runs on plain
`npm install` + `node`. If you have registry access and want React,
Express, or `ws` instead, those are drop-in swaps — the engine package
doesn't care what's on top of it.

## Setup

```bash
./scripts/setup.sh   # npm install (workspaces) + build, with an offline fallback
npm run start -w server
```

Then open `http://localhost:8080`. Set `PORT` to change the port.

For development with auto-reload: `npm run dev -w server` (uses `tsx watch`).

To re-run the engine's test suite (hand-evaluator unit tests + simulated
random-bot games across every variant, checking chip conservation):

```bash
npm run test:engine
```

## How it works

- **Auth**: email/username/password, `scrypt` password hashing, bearer-token
  sessions stored in SQLite.
- **Wallet**: an append-only ledger (`ledger_entries`) — every chip gained or
  lost (deposit, buy-in, cash-out, hand win/loss) is one row, so a balance is
  always the sum of a user's rows, not a mutable field that can drift out of
  sync. Deposits/withdrawals are stand-ins for a real payment processor
  (Stripe, etc.) — swap the two `/api/wallet/deposit|withdraw` handlers for
  that processor's webhook handlers and the rest of the ledger is unchanged.
- **Tables**: a fixed lobby (two stakes levels per variant) is created at
  boot. Buying in escrows chips from the wallet into the table; standing up
  (or busting) settles back. A hand auto-starts once 2+ seated players are
  ready, and auto-advances through the whole game — betting, dealing,
  drawing, showdown — driven by WebSocket messages from clients.
- **Realtime protocol**: one WebSocket per browser tab. Client sends
  `{type: "sit"|"action"|"draw"|...}`; server broadcasts the full table
  state, sanitized per-viewer (you only ever receive your own hole cards).
- **Turn timer**: 25s per action; on timeout, the engine auto-checks/folds
  (or stands pat on a draw) so the table never stalls.

## Scope & honesty (read this before deploying with real money)

This is a strong, tested foundation — not a licensed, launch-ready real-money
product. Specifically:

- **No gaming license, no KYC/AML, no real payment processor.** Deposits and
  withdrawals directly credit/debit the ledger; hook up a real processor and
  identity verification before real money is involved.
- **RNG**: shuffling uses Node's `crypto.randomInt` (CSPRNG), which is sound,
  but a licensed room would also want a certified/audited shuffle and
  server-side hand-history signing for dispute resolution.
- **Anti-collusion / anti-multi-accounting**: not implemented.
- **Known simplifications** in the engine (all documented in code comments):
  stud/razz "who acts first" and bring-in ties use a simplified board
  comparison rather than full suit-ranking edge cases; fixed-limit raise cap
  is a flat 4 raises/street; table seat caps follow real casino conventions
  for the same reason casinos use them (a single 52-card shoe can only deal
  so many hands' worth of cards), except draw games, which recycle
  folded/discarded cards back into the shoe when it runs low (the standard
  poker-room rule for exactly this situation).
- **Scaling**: one Node process, in-memory tables, SQLite on disk. Fine for
  a demo or a single-node deployment; horizontal scaling would need the
  table state moved to a shared store (Redis, etc.) and sessions to be
  server-agnostic.

None of that is hidden in the code — it's flagged inline wherever it matters
so the next engineer (or you) knows exactly where the edges are.
