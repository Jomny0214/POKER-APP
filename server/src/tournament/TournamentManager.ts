import { randomUUID } from "crypto";
import { getVariant, VariantConfig } from "@poker/engine";
import { db } from "../db/database";
import { credit, debit, withTransaction } from "../db/wallet";
import { Table } from "../table/Table";
import { tableManager } from "../table/TableManager";
import { StakesLevel } from "../table/stakes";
import { BlindLevel, BLIND_PRESETS, isValidCustomSchedule } from "./blindSchedules";
import { computePayouts } from "./payouts";

// Only these two variants may ever be offered for a tournament, regardless
// of what else the engine supports.
export const TOURNAMENT_VARIANTS = ["holdem", "omaha"] as const;
export type TournamentVariantId = (typeof TOURNAMENT_VARIANTS)[number];

export type TournamentStatus = "registering" | "running" | "finished" | "canceled";
export type EntryStatus = "registered" | "active" | "busted";

export interface TournamentRow {
  id: string;
  name: string;
  variant_id: string;
  table_size: number;
  buyin: number;
  starting_stack: number;
  rebuy_allowed: number;
  rebuy_price: number;
  rebuy_period_type: "levels" | "minutes" | null;
  rebuy_period_value: number | null;
  max_tables: number;
  blind_schedule: string;
  scheduled_start_at: number;
  status: TournamentStatus;
  current_level: number;
  level_started_at: number | null;
  prize_pool: number;
  created_by: string;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface EntryRow {
  id: number;
  tournament_id: string;
  user_id: string;
  username: string;
  status: EntryStatus;
  stack: number;
  table_no: number | null;
  seat_index: number | null;
  rebuys_used: number;
  finish_rank: number | null;
  payout: number | null;
  registered_at: number;
  busted_at: number | null;
}

export interface CreateTournamentInput {
  name: string;
  variantId: string;
  tableSize: number;
  buyin: number;
  startingStack: number;
  rebuyAllowed: boolean;
  rebuyPrice?: number;
  rebuyPeriodType?: "levels" | "minutes";
  rebuyPeriodValue?: number;
  maxTables: number;
  scheduledStartAt: number;
  blindPreset?: string; // "standard" | "turbo" | "hyperturbo"
  customBlindSchedule?: BlindLevel[];
}

const BALANCE_IMBALANCE_THRESHOLD = 2; // keep tables within this many players of each other

// ---------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------

const insertTournamentStmt = db.prepare(`
  INSERT INTO tournaments
    (id, name, variant_id, table_size, buyin, starting_stack, rebuy_allowed, rebuy_price,
     rebuy_period_type, rebuy_period_value, max_tables, blind_schedule, scheduled_start_at,
     status, current_level, level_started_at, prize_pool, created_by, created_at, started_at, finished_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registering', 0, NULL, 0, ?, ?, NULL, NULL)
`);
const getTournamentStmt = db.prepare(`SELECT * FROM tournaments WHERE id = ?`);
const listTournamentsStmt = db.prepare(`SELECT * FROM tournaments ORDER BY scheduled_start_at DESC`);
const listByStatusStmt = db.prepare(`SELECT * FROM tournaments WHERE status = ?`);
const updateStatusStmt = db.prepare(`UPDATE tournaments SET status = ? WHERE id = ?`);
const updatePrizePoolStmt = db.prepare(`UPDATE tournaments SET prize_pool = prize_pool + ? WHERE id = ?`);
const startTournamentStmt = db.prepare(
  `UPDATE tournaments SET status = 'running', started_at = ?, current_level = 0, level_started_at = ? WHERE id = ?`
);
const advanceLevelStmt = db.prepare(`UPDATE tournaments SET current_level = ?, level_started_at = ? WHERE id = ?`);
const finishTournamentStmt = db.prepare(`UPDATE tournaments SET status = 'finished', finished_at = ? WHERE id = ?`);

const insertEntryStmt = db.prepare(
  `INSERT INTO tournament_entries (tournament_id, user_id, username, status, stack, registered_at) VALUES (?, ?, ?, 'registered', 0, ?)`
);
const deleteEntryStmt = db.prepare(
  `DELETE FROM tournament_entries WHERE tournament_id = ? AND user_id = ? AND status = 'registered'`
);
const getEntryStmt = db.prepare(`SELECT * FROM tournament_entries WHERE tournament_id = ? AND user_id = ?`);
const listEntriesStmt = db.prepare(`SELECT * FROM tournament_entries WHERE tournament_id = ? ORDER BY id ASC`);
const listActiveEntriesStmt = db.prepare(
  `SELECT * FROM tournament_entries WHERE tournament_id = ? AND status = 'active'`
);
const countActiveEntriesStmt = db.prepare(
  `SELECT COUNT(*) AS n FROM tournament_entries WHERE tournament_id = ? AND status = 'active'`
);
const listRegisteredEntriesStmt = db.prepare(
  `SELECT * FROM tournament_entries WHERE tournament_id = ? AND status = 'registered'`
);
const seatEntryStmt = db.prepare(
  `UPDATE tournament_entries SET status = 'active', stack = ?, table_no = ?, seat_index = ? WHERE tournament_id = ? AND user_id = ?`
);
const moveEntryStmt = db.prepare(
  `UPDATE tournament_entries SET table_no = ?, seat_index = ? WHERE tournament_id = ? AND user_id = ?`
);
const setEntryStackStmt = db.prepare(
  `UPDATE tournament_entries SET stack = ? WHERE tournament_id = ? AND user_id = ?`
);
const bustEntryStmt = db.prepare(
  `UPDATE tournament_entries SET status = 'busted', stack = 0, finish_rank = ?, busted_at = ? WHERE tournament_id = ? AND user_id = ?`
);
const rebuyEntryStmt = db.prepare(
  `UPDATE tournament_entries SET rebuys_used = rebuys_used + 1 WHERE tournament_id = ? AND user_id = ?`
);
const payoutEntryStmt = db.prepare(`UPDATE tournament_entries SET payout = ? WHERE tournament_id = ? AND user_id = ?`);

const insertTableStmt = db.prepare(
  `INSERT OR IGNORE INTO tournament_tables (tournament_id, table_no, created_at) VALUES (?, ?, ?)`
);
const deleteTableStmt = db.prepare(`DELETE FROM tournament_tables WHERE tournament_id = ? AND table_no = ?`);

// ---------------------------------------------------------------------

interface LiveTournament {
  tables: Map<number, Table>; // table_no -> live Table instance
  levels: BlindLevel[];
}

export class TournamentManager {
  private live = new Map<string, LiveTournament>();

  /** Reconstructs any tournament that was mid-flight when the process last
   * exited: recreates its tables from persisted entries and reapplies the
   * current blind level. Call once at server boot. */
  init(): void {
    const running = listByStatusStmt.all("running") as unknown as TournamentRow[];
    for (const t of running) {
      this.rebuildLive(t);
    }
  }

  private rebuildLive(t: TournamentRow): void {
    const levels = JSON.parse(t.blind_schedule) as BlindLevel[];
    const variant = getVariant(t.variant_id);
    const activeEntries = listActiveEntriesStmt.all(t.id) as unknown as EntryRow[];
    const byTable = new Map<number, EntryRow[]>();
    for (const e of activeEntries) {
      if (e.table_no === null) continue;
      if (!byTable.has(e.table_no)) byTable.set(e.table_no, []);
      byTable.get(e.table_no)!.push(e);
    }
    const live: LiveTournament = { tables: new Map(), levels };
    const level = levels[Math.min(t.current_level, levels.length - 1)];
    for (const [tableNo, entries] of byTable) {
      const table = this.makeTable(t, variant, tableNo, level);
      for (const e of entries) {
        if (e.seat_index === null || e.stack <= 0) continue;
        table.seatTournamentPlayer(e.user_id, e.username, e.seat_index, e.stack);
      }
      live.tables.set(tableNo, table);
    }
    this.live.set(t.id, live);
  }

  // -------------------------------------------------------------------
  // Admin: create
  // -------------------------------------------------------------------

  create(adminUserId: string, input: CreateTournamentInput): TournamentRow {
    const name = (input.name ?? "").trim();
    if (!name) throw new Error("Name is required");
    if (!TOURNAMENT_VARIANTS.includes(input.variantId as TournamentVariantId)) {
      throw new Error("Tournaments may only offer Texas Hold'em or Omaha");
    }
    getVariant(input.variantId); // throws if unknown to the engine at all
    if (input.tableSize !== 6 && input.tableSize !== 9) throw new Error("Table size must be 6 or 9");
    if (!Number.isFinite(input.buyin) || input.buyin <= 0) throw new Error("Buy-in must be a positive number");
    if (!Number.isFinite(input.startingStack) || input.startingStack <= 0) {
      throw new Error("Starting stack must be a positive number");
    }
    if (!Number.isFinite(input.maxTables) || input.maxTables < 1 || input.maxTables > 100) {
      throw new Error("Max tables must be between 1 and 100");
    }
    if (!Number.isFinite(input.scheduledStartAt) || input.scheduledStartAt <= Date.now()) {
      throw new Error("Scheduled start must be in the future");
    }

    let levels: BlindLevel[];
    if (input.customBlindSchedule) {
      if (!isValidCustomSchedule(input.customBlindSchedule)) throw new Error("Invalid custom blind schedule");
      levels = input.customBlindSchedule;
    } else {
      const preset = BLIND_PRESETS[input.blindPreset ?? "standard"];
      if (!preset) throw new Error("Unknown blind preset");
      levels = preset;
    }

    let rebuyPeriodType: "levels" | "minutes" | null = null;
    let rebuyPeriodValue: number | null = null;
    let rebuyPrice = 0;
    if (input.rebuyAllowed) {
      rebuyPeriodType = input.rebuyPeriodType === "minutes" ? "minutes" : "levels";
      rebuyPeriodValue = Number(input.rebuyPeriodValue);
      if (!Number.isFinite(rebuyPeriodValue) || rebuyPeriodValue <= 0) {
        throw new Error("Rebuy period must be a positive number of levels or minutes");
      }
      rebuyPrice = Number(input.rebuyPrice);
      if (!Number.isFinite(rebuyPrice) || rebuyPrice <= 0) throw new Error("Rebuy price must be a positive number");
    }

    const id = randomUUID();
    const now = Date.now();
    insertTournamentStmt.run(
      id,
      name,
      input.variantId,
      input.tableSize,
      Math.floor(input.buyin),
      Math.floor(input.startingStack),
      input.rebuyAllowed ? 1 : 0,
      Math.floor(rebuyPrice),
      rebuyPeriodType,
      rebuyPeriodValue,
      Math.floor(input.maxTables),
      JSON.stringify(levels),
      Math.floor(input.scheduledStartAt),
      adminUserId,
      now
    );
    return this.get(id)!;
  }

  get(id: string): TournamentRow | undefined {
    return getTournamentStmt.get(id) as unknown as TournamentRow | undefined;
  }

  list(): TournamentRow[] {
    return listTournamentsStmt.all() as unknown as TournamentRow[];
  }

  entries(tournamentId: string): EntryRow[] {
    return listEntriesStmt.all(tournamentId) as unknown as EntryRow[];
  }

  entryFor(tournamentId: string, userId: string): EntryRow | undefined {
    return getEntryStmt.get(tournamentId, userId) as unknown as EntryRow | undefined;
  }

  /** The live table a player is currently seated at within a running tournament, if any. */
  tableFor(tournamentId: string, userId: string): Table | undefined {
    const entry = this.entryFor(tournamentId, userId);
    if (!entry || entry.table_no === null) return undefined;
    return this.live.get(tournamentId)?.tables.get(entry.table_no);
  }

  // -------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------

  register(tournamentId: string, userId: string, username: string): TournamentRow {
    const t = this.get(tournamentId);
    if (!t) throw new Error("Tournament not found");
    if (t.status !== "registering") throw new Error("Registration is closed for this tournament");
    if (t.scheduled_start_at <= Date.now()) throw new Error("Registration is closed for this tournament");
    if (this.entryFor(tournamentId, userId)) throw new Error("Already registered");

    withTransaction(() => {
      debit(userId, "tournament_buyin", t.buyin, `tournament-buyin-${tournamentId}`);
      insertEntryStmt.run(tournamentId, userId, username, Date.now());
      updatePrizePoolStmt.run(t.buyin, tournamentId);
    });
    return this.get(tournamentId)!;
  }

  unregister(tournamentId: string, userId: string): TournamentRow {
    const t = this.get(tournamentId);
    if (!t) throw new Error("Tournament not found");
    if (t.status !== "registering") throw new Error("This tournament has already started");
    const entry = this.entryFor(tournamentId, userId);
    if (!entry || entry.status !== "registered") throw new Error("Not registered");

    withTransaction(() => {
      credit(userId, "tournament_cashout", t.buyin, `tournament-unregister-${tournamentId}`);
      deleteEntryStmt.run(tournamentId, userId);
      updatePrizePoolStmt.run(-t.buyin, tournamentId);
    });
    return this.get(tournamentId)!;
  }

  rebuy(tournamentId: string, userId: string): EntryRow {
    const t = this.get(tournamentId);
    if (!t) throw new Error("Tournament not found");
    if (t.status !== "running") throw new Error("Tournament is not running");
    if (!t.rebuy_allowed) throw new Error("Rebuys are not allowed in this tournament");
    const entry = this.entryFor(tournamentId, userId);
    if (!entry || entry.status !== "active" || entry.stack > 0) {
      throw new Error("You don't currently have a rebuy available");
    }
    if (!this.rebuyWindowOpen(t)) throw new Error("The rebuy period has ended");
    const table = this.tableFor(tournamentId, userId);
    if (!table) throw new Error("Not seated at a table");

    withTransaction(() => {
      debit(userId, "tournament_rebuy", t.rebuy_price, `tournament-rebuy-${tournamentId}`);
      rebuyEntryStmt.run(tournamentId, userId);
      setEntryStackStmt.run(t.starting_stack, tournamentId, userId);
      updatePrizePoolStmt.run(t.rebuy_price, tournamentId);
    });
    table.rebuyPlayer(userId, t.starting_stack);
    return this.entryFor(tournamentId, userId)!;
  }

  private rebuyWindowOpen(t: TournamentRow): boolean {
    if (!t.rebuy_allowed) return false;
    if (t.rebuy_period_type === "minutes") {
      const startedAt = t.started_at ?? Date.now();
      return Date.now() - startedAt < (t.rebuy_period_value ?? 0) * 60_000;
    }
    // "levels": rebuys allowed through the end of level N (1-indexed for the admin)
    return t.current_level < (t.rebuy_period_value ?? 0);
  }

  // -------------------------------------------------------------------
  // Starting
  // -------------------------------------------------------------------

  private makeTable(t: TournamentRow, variant: VariantConfig, tableNo: number, level: BlindLevel): Table {
    const stakes: StakesLevel = {
      id: `tournament-${t.id}`,
      label: t.name,
      bigBlind: level.bigBlind,
      minBuyIn: 0,
      maxBuyIn: Number.MAX_SAFE_INTEGER,
    };
    const table = new Table(variant, stakes, t.table_size, `${t.name} — Table ${tableNo + 1}`, {
      tournamentMode: true,
      onPlayerBusted: (userId) => this.handleBust(t.id, userId),
    });
    table.setBlinds(level.smallBlind, level.bigBlind, level.ante);
    tableManager.addTournamentTable(table);
    insertTableStmt.run(t.id, tableNo, Date.now());
    return table;
  }

  /** Starts a "registering" tournament whose scheduled time has passed: seats
   * every registered player across balanced tables and deals blind level 1. */
  start(tournamentId: string): void {
    const t = this.get(tournamentId);
    if (!t || t.status !== "registering") return;
    const registered = listRegisteredEntriesStmt.all(tournamentId) as unknown as EntryRow[];

    if (registered.length < 2) {
      // Not enough players showed up: cancel and refund everyone rather than
      // leaving the tournament stuck forever.
      withTransaction(() => {
        for (const e of registered) {
          credit(e.user_id, "tournament_cashout", t.buyin, `tournament-canceled-${tournamentId}`);
        }
        updateStatusStmt.run("canceled", tournamentId);
      });
      return;
    }

    const levels = JSON.parse(t.blind_schedule) as BlindLevel[];
    const variant = getVariant(t.variant_id);
    const numTables = Math.max(1, Math.min(t.max_tables, Math.ceil(registered.length / t.table_size)));

    // Shuffle for random seat/table draw, then deal round-robin across
    // tables so each one starts within one player of every other.
    const shuffled = [...registered];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const now = Date.now();
    const live: LiveTournament = { tables: new Map(), levels };
    const nextSeatIndex = new Array(numTables).fill(0);

    withTransaction(() => {
      startTournamentStmt.run(now, now, tournamentId);
      for (let i = 0; i < shuffled.length; i++) {
        const e = shuffled[i];
        const tableNo = i % numTables;
        const seatIndex = nextSeatIndex[tableNo]++;
        seatEntryStmt.run(t.starting_stack, tableNo, seatIndex, tournamentId, e.user_id);
      }
    });

    const freshT = this.get(tournamentId)!;
    const level0 = levels[0];
    for (let tableNo = 0; tableNo < numTables; tableNo++) {
      live.tables.set(tableNo, this.makeTable(freshT, variant, tableNo, level0));
    }
    this.live.set(tournamentId, live);

    // Now actually seat everyone (after all tables exist, so balancing math
    // during seating -- there isn't any at this point -- has somewhere to go).
    for (let i = 0; i < shuffled.length; i++) {
      const e = shuffled[i];
      const tableNo = i % numTables;
      const table = live.tables.get(tableNo)!;
      const seatIndex = table.firstOpenSeatIndex();
      table.seatTournamentPlayer(e.user_id, e.username, seatIndex, t.starting_stack);
    }
  }

  // -------------------------------------------------------------------
  // Blind levels
  // -------------------------------------------------------------------

  /** Advances any running tournament whose current level's time has elapsed
   * (looping in case several levels elapsed while the process wasn't
   * ticking), applying the new blinds to every live table. */
  advanceLevels(): void {
    const running = listByStatusStmt.all("running") as unknown as TournamentRow[];
    for (const t of running) {
      const live = this.live.get(t.id);
      if (!live) continue;
      let current = t.current_level;
      let levelStartedAt = t.level_started_at ?? t.started_at ?? Date.now();
      let changed = false;
      while (
        current < live.levels.length - 1 &&
        Date.now() - levelStartedAt >= live.levels[current].durationMinutes * 60_000
      ) {
        current += 1;
        levelStartedAt = Date.now();
        changed = true;
      }
      if (changed) {
        advanceLevelStmt.run(current, levelStartedAt, t.id);
        const level = live.levels[current];
        for (const table of live.tables.values()) {
          table.setBlinds(level.smallBlind, level.bigBlind, level.ante);
        }
      }
    }
  }

  /** Sweeps running tournaments for players who busted during their rebuy
   * window but never rebought before it closed -- finalizes their elimination. */
  sweepExpiredRebuys(): void {
    const running = listByStatusStmt.all("running") as unknown as TournamentRow[];
    for (const t of running) {
      if (!t.rebuy_allowed || this.rebuyWindowOpen(t)) continue;
      const live = this.live.get(t.id);
      if (!live) continue;
      const stillWaiting = (listActiveEntriesStmt.all(t.id) as unknown as EntryRow[]).filter((e) => e.stack <= 0);
      for (const e of stillWaiting) {
        const table = e.table_no !== null ? live.tables.get(e.table_no) : undefined;
        table?.eliminateSeat(e.user_id);
        this.finalizeElimination(t.id, e.user_id);
      }
      if (stillWaiting.length > 0) this.rebalance(t.id);
    }
  }

  // -------------------------------------------------------------------
  // Elimination
  // -------------------------------------------------------------------

  private handleBust(tournamentId: string, userId: string): void {
    const t = this.get(tournamentId);
    if (!t || t.status !== "running") return;
    const entry = this.entryFor(tournamentId, userId);
    // Guards against re-processing: a heads-up hand can bust both remaining
    // players in the same instant (e.g. an exact-tie all-in), which would
    // otherwise fire this callback twice after the tournament has already
    // finished off the first bust.
    if (!entry || entry.status !== "active") return;
    if (this.rebuyWindowOpen(t)) {
      // Leave the seat in place, stack 0, awaiting a rebuy -- nothing else to do.
      return;
    }
    const table = this.tableFor(tournamentId, userId);
    table?.eliminateSeat(userId);
    this.finalizeElimination(tournamentId, userId);
    this.rebalance(tournamentId);
  }

  /** Marks an entry busted with its finish rank, then finishes the
   * tournament outright if that leaves only one player standing. */
  private finalizeElimination(tournamentId: string, userId: string): void {
    const activeCount = (countActiveEntriesStmt.get(tournamentId) as { n: number }).n;
    // The busting player is still counted as 'active' at this point, so the
    // current active count IS their finish rank (e.g. 5 active including
    // them -> they finish 5th).
    const finishRank = activeCount;
    bustEntryStmt.run(finishRank, Date.now(), tournamentId, userId);

    if (finishRank === 2) {
      // Exactly one player remains: the tournament is over.
      const remaining = (listActiveEntriesStmt.all(tournamentId) as unknown as EntryRow[])[0];
      if (remaining) {
        bustEntryStmt.run(1, Date.now(), tournamentId, remaining.user_id);
        // bustEntryStmt sets status='busted', which is fine for bookkeeping
        // (the winner's row still carries finish_rank=1 and their final
        // stack via the payout, not the `stack` column).
      }
      this.finish(tournamentId);
    }
  }

  // -------------------------------------------------------------------
  // Table balancing
  // -------------------------------------------------------------------

  private rebalance(tournamentId: string): void {
    const live = this.live.get(tournamentId);
    if (!live) return;
    const t = this.get(tournamentId);
    if (!t) return;

    let changed = true;
    let iterations = 0;
    while (changed && iterations < 100) {
      changed = false;
      iterations++;
      const entries = [...live.tables.entries()];
      if (entries.length <= 1) break;
      entries.sort((a, b) => a[1].occupiedCount() - b[1].occupiedCount());

      const totalPlayers = entries.reduce((s, [, table]) => s + table.occupiedCount(), 0);
      const idealTables = Math.max(1, Math.ceil(totalPlayers / t.table_size));

      const [smallNo, smallTable] = entries[0];
      if (entries.length > idealTables && !smallTable.hasHandInProgress()) {
        const others = entries.slice(1).filter(([, table]) => !table.hasHandInProgress());
        const openSeats = others.reduce((s, [, table]) => s + (table.maxSeats - table.occupiedCount()), 0);
        if (openSeats >= smallTable.occupiedCount()) {
          const movable = smallTable.pullAllPlayers();
          for (const p of movable) {
            others.sort((a, b) => b[1].maxSeats - b[1].occupiedCount() - (a[1].maxSeats - a[1].occupiedCount()));
            const target = others.find(([, table]) => table.occupiedCount() < table.maxSeats);
            if (!target) continue;
            const seatIdx = target[1].firstOpenSeatIndex();
            target[1].seatTournamentPlayer(p.userId, p.username, seatIdx, p.stack);
            moveEntryStmt.run(target[0], seatIdx, tournamentId, p.userId);
          }
          tableManager.removeTournamentTable(smallTable.id);
          live.tables.delete(smallNo);
          deleteTableStmt.run(tournamentId, smallNo);
          changed = true;
          continue;
        }
      }

      entries.sort((a, b) => a[1].occupiedCount() - b[1].occupiedCount());
      const smallest = entries[0][1];
      const largestEntry = entries[entries.length - 1];
      const largest = largestEntry[1];
      if (
        largest.occupiedCount() - smallest.occupiedCount() >= BALANCE_IMBALANCE_THRESHOLD &&
        !largest.hasHandInProgress() &&
        smallest.occupiedCount() < smallest.maxSeats
      ) {
        const p = largest.pullOnePlayer();
        if (p) {
          const seatIdx = smallest.firstOpenSeatIndex();
          smallest.seatTournamentPlayer(p.userId, p.username, seatIdx, p.stack);
          moveEntryStmt.run(entries[0][0], seatIdx, tournamentId, p.userId);
          changed = true;
        }
      }
    }
  }

  /** Periodic safety-net pass over every running tournament -- catches
   * imbalances/breaks that couldn't complete earlier because a table was
   * mid-hand at the time. */
  rebalanceAll(): void {
    for (const id of this.live.keys()) this.rebalance(id);
  }

  // -------------------------------------------------------------------
  // Finish / payouts
  // -------------------------------------------------------------------

  private finish(tournamentId: string): void {
    const t = this.get(tournamentId);
    if (!t || t.status !== "running") return;
    const entries = this.entries(tournamentId);
    const numEntrants = entries.length;
    const payouts = computePayouts(t.prize_pool, numEntrants);

    withTransaction(() => {
      for (const e of entries) {
        if (!e.finish_rank || e.finish_rank > payouts.length) continue;
        const amount = payouts[e.finish_rank - 1];
        if (amount <= 0) continue;
        credit(e.user_id, "tournament_payout", amount, `tournament-payout-${tournamentId}-rank-${e.finish_rank}`);
        payoutEntryStmt.run(amount, tournamentId, e.user_id);
      }
      finishTournamentStmt.run(Date.now(), tournamentId);
    });

    const live = this.live.get(tournamentId);
    if (live) {
      for (const table of live.tables.values()) tableManager.removeTournamentTable(table.id);
      this.live.delete(tournamentId);
    }
  }

  /** Admin force-end: ranks everyone still active by current chip stack
   * (biggest stack = best remaining rank) and pays out from there. */
  forceEnd(tournamentId: string): void {
    const t = this.get(tournamentId);
    if (!t || t.status !== "running") throw new Error("Tournament is not running");
    const live = this.live.get(tournamentId);
    const active = listActiveEntriesStmt.all(tournamentId) as unknown as EntryRow[];

    // Pull current stacks straight from the live tables (the entries table
    // is only updated on rebuy/seat moves, not every hand).
    const stacks = new Map<string, number>();
    if (live) {
      for (const table of live.tables.values()) {
        for (const seat of table.seats) {
          if (seat) stacks.set(seat.userId, seat.stack);
        }
      }
    }

    const ranked = [...active].sort((a, b) => (stacks.get(b.user_id) ?? b.stack) - (stacks.get(a.user_id) ?? a.stack));
    const alreadyBusted = (this.entries(tournamentId) as unknown as EntryRow[]).filter((e) => e.status === "busted").length;
    ranked.forEach((e, i) => {
      const rank = alreadyBusted + (ranked.length - i);
      bustEntryStmt.run(rank, Date.now(), tournamentId, e.user_id);
    });

    if (live) {
      for (const table of live.tables.values()) tableManager.removeTournamentTable(table.id);
    }

    const entries = this.entries(tournamentId);
    const payouts = computePayouts(t.prize_pool, entries.length);
    withTransaction(() => {
      for (const e of entries) {
        if (!e.finish_rank || e.finish_rank > payouts.length) continue;
        const amount = payouts[e.finish_rank - 1];
        if (amount <= 0) continue;
        credit(e.user_id, "tournament_payout", amount, `tournament-payout-${tournamentId}-rank-${e.finish_rank}`);
        payoutEntryStmt.run(amount, tournamentId, e.user_id);
      }
      finishTournamentStmt.run(Date.now(), tournamentId);
    });
    this.live.delete(tournamentId);
  }

  // -------------------------------------------------------------------
  // Scheduler entry point
  // -------------------------------------------------------------------

  tick(): void {
    const due = (listByStatusStmt.all("registering") as unknown as TournamentRow[]).filter(
      (t) => t.scheduled_start_at <= Date.now()
    );
    for (const t of due) {
      try {
        this.start(t.id);
      } catch (err) {
        console.error(`Failed to start tournament ${t.id}:`, err);
      }
    }
    try {
      this.advanceLevels();
    } catch (err) {
      console.error("Failed to advance tournament blind levels:", err);
    }
    try {
      this.sweepExpiredRebuys();
    } catch (err) {
      console.error("Failed to sweep expired tournament rebuys:", err);
    }
    try {
      this.rebalanceAll();
    } catch (err) {
      console.error("Failed to rebalance tournament tables:", err);
    }
  }
}

export const tournamentManager = new TournamentManager();
