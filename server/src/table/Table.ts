import { randomUUID } from "crypto";
import { HandEngine, VariantConfig, PublicHandState, PlayerAction, ForcedBets } from "@poker/engine";
import { WSConnection } from "../ws/websocket";
import { credit, debit, withTransaction } from "../db/wallet";
import { db } from "../db/database";
import { forcedBetsForStakes, StakesLevel } from "./stakes";

export interface Seat {
  index: number;
  userId: string;
  username: string;
  stack: number;
  sittingOut: boolean;
  leavingAfterHand: boolean;
}

interface Subscriber {
  conn: WSConnection;
  userId: string | null; // null = spectator (not logged in view, still allowed to watch)
}

const ACTION_TIMEOUT_MS = 25_000;
const NEXT_HAND_DELAY_MS = 3_000;

const insertBuyinStmt = db.prepare(
  `INSERT INTO table_buyins (user_id, table_id, amount, active, created_at) VALUES (?, ?, ?, 1, ?)`
);
const closeBuyinStmt = db.prepare(
  `UPDATE table_buyins SET active = 0 WHERE user_id = ? AND table_id = ? AND active = 1`
);
const insertHandHistoryStmt = db.prepare(
  `INSERT INTO hand_history (id, table_id, variant, started_at, ended_at, data) VALUES (?, ?, ?, ?, ?, ?)`
);

export interface TableOptions {
  /**
   * Tournament tables reuse this Table class for its hand-play engine, but
   * differ in how seats/chips work: no wallet-funded buy-ins (chips were
   * already collected from the wallet at tournament registration), no
   * cashing a stack back out mid-event, and busting doesn't just clear a
   * seat -- it's reported up to the tournament so it can decide whether the
   * player is still inside a rebuy window.
   */
  tournamentMode?: boolean;
  /** tournamentMode only: fired when a seated player's stack hits 0. */
  onPlayerBusted?: (userId: string, seatIndex: number) => void;
}

export class Table {
  readonly id = randomUUID();
  readonly seats: (Seat | null)[];
  readonly origin: "cash" | "tournament";
  private engine: HandEngine | null = null;
  private buttonSeatIndex = 0;
  private subscribers = new Set<Subscriber>();
  private actionTimer: NodeJS.Timeout | null = null;
  private nextHandTimer: NodeJS.Timeout | null = null;
  private handStartedAt = 0;
  private currentActorSeat: number | null = null;
  private opts: TableOptions;
  private forcedOverride: ForcedBets | null = null;
  public onBroadcastError: ((err: unknown) => void) | null = null;

  constructor(
    public readonly variant: VariantConfig,
    public readonly stakes: StakesLevel,
    public readonly maxSeats: number = variant.maxPlayers,
    public readonly name: string = `${variant.name} ${stakes.label}`,
    opts: TableOptions = {}
  ) {
    this.seats = new Array(maxSeats).fill(null);
    this.opts = opts;
    this.origin = opts.tournamentMode ? "tournament" : "cash";
  }

  /** Sets an explicit blind/ante schedule (tournament tables), overriding the
   * stakes-derived cash forced bets. Takes effect from the next hand dealt. */
  setBlinds(smallBlind: number, bigBlind: number, ante: number): void {
    this.forcedOverride = { smallBlind, bigBlind, ante: ante > 0 ? ante : undefined, smallBet: bigBlind };
  }

  hasHandInProgress(): boolean {
    return !!this.engine && !this.engine.isComplete();
  }

  /** Seats a player at a tournament table without touching the wallet (the
   * buy-in/rebuy was already collected by the tournament layer). */
  seatTournamentPlayer(userId: string, username: string, seatIndex: number, stack: number): void {
    if (!this.opts.tournamentMode) throw new Error("Not a tournament table");
    if (seatIndex < 0 || seatIndex >= this.maxSeats) throw new Error("Invalid seat");
    if (this.seats[seatIndex]) throw new Error("Seat already taken");
    if (this.seatOf(userId)) throw new Error("Already seated at this table");
    this.seats[seatIndex] = {
      index: seatIndex,
      userId,
      username,
      stack,
      sittingOut: false,
      leavingAfterHand: false,
    };
    this.maybeStartHand();
    this.broadcast();
  }

  /** Tops a seated (typically busted-and-awaiting-rebuy) player's stack back up. */
  rebuyPlayer(userId: string, addStack: number): void {
    const seat = this.seatOf(userId);
    if (!seat) throw new Error("Not seated at this table");
    seat.stack += addStack;
    seat.sittingOut = false;
    this.maybeStartHand();
    this.broadcast();
  }

  /** Finalizes an elimination: clears the seat outright (no wallet credit --
   * tournament chips only pay out via the prize pool at the end). */
  eliminateSeat(userId: string): void {
    const seat = this.seatOf(userId);
    if (!seat) return;
    this.seats[seat.index] = null;
    this.broadcast();
  }

  firstOpenSeatIndex(): number {
    return this.seats.findIndex((s) => s === null);
  }

  /** Table-balancing helper: pulls one occupied seat out (no wallet effect).
   * Caller is responsible for only calling this between hands. */
  pullOnePlayer(): { userId: string; username: string; stack: number } | null {
    for (const seat of this.seats) {
      if (seat) {
        const { userId, username, stack } = seat;
        this.seats[seat.index] = null;
        this.broadcast();
        return { userId, username, stack };
      }
    }
    return null;
  }

  /** Table-balancing helper: pulls every occupied seat out, for breaking a table. */
  pullAllPlayers(): { userId: string; username: string; stack: number }[] {
    const out: { userId: string; username: string; stack: number }[] = [];
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (seat) {
        out.push({ userId: seat.userId, username: seat.username, stack: seat.stack });
        this.seats[i] = null;
      }
    }
    this.broadcast();
    return out;
  }

  subscribe(conn: WSConnection, userId: string | null): void {
    this.subscribers.add({ conn, userId });
  }

  unsubscribe(conn: WSConnection): void {
    for (const s of this.subscribers) {
      if (s.conn === conn) this.subscribers.delete(s);
    }
  }

  private seatOf(userId: string): Seat | null {
    return this.seats.find((s) => s?.userId === userId) ?? null;
  }

  occupiedCount(): number {
    return this.seats.filter((s) => s !== null).length;
  }

  sit(userId: string, username: string, seatIndex: number, buyIn: number): void {
    if (this.opts.tournamentMode) throw new Error("Seats at a tournament table are assigned automatically");
    if (seatIndex < 0 || seatIndex >= this.maxSeats) throw new Error("Invalid seat");
    if (this.seats[seatIndex]) throw new Error("Seat already taken");
    if (this.seatOf(userId)) throw new Error("Already seated at this table");
    if (buyIn < this.stakes.minBuyIn || buyIn > this.stakes.maxBuyIn) {
      throw new Error(`Buy-in must be between ${this.stakes.minBuyIn} and ${this.stakes.maxBuyIn}`);
    }
    withTransaction(() => {
      debit(userId, "buyin", buyIn, this.id);
      insertBuyinStmt.run(userId, this.id, buyIn, Date.now());
    });
    this.seats[seatIndex] = {
      index: seatIndex,
      userId,
      username,
      stack: buyIn,
      sittingOut: false,
      leavingAfterHand: false,
    };
    this.maybeStartHand();
    this.broadcast();
  }

  /** Cash out and leave. If a hand is live, takes effect once it finishes. */
  standUp(userId: string): void {
    const seat = this.seatOf(userId);
    if (!seat) return;
    if (this.opts.tournamentMode) {
      // No cashing a tournament stack out mid-event -- the only way out is
      // busting (or the tournament ending). Sitting out just auto-folds the
      // player's hands via the normal action-timeout path until they either
      // come back or bust.
      throw new Error("You can't leave a tournament table -- sit out instead, or wait to bust out");
    }
    if (this.engine && !this.engine.isComplete()) {
      seat.leavingAfterHand = true;
      seat.sittingOut = true;
      this.broadcast();
      return;
    }
    this.removeSeat(seat);
    this.broadcast();
  }

  private removeSeat(seat: Seat): void {
    withTransaction(() => {
      if (seat.stack > 0) credit(seat.userId, "cashout", seat.stack, this.id);
      closeBuyinStmt.run(seat.userId, this.id);
    });
    this.seats[seat.index] = null;
  }

  setSittingOut(userId: string, sittingOut: boolean): void {
    const seat = this.seatOf(userId);
    if (!seat) return;
    seat.sittingOut = sittingOut;
    if (!sittingOut) this.maybeStartHand();
    this.broadcast();
  }

  private activeSeats(): Seat[] {
    return this.seats.filter((s): s is Seat => !!s && !s.sittingOut && s.stack > 0);
  }

  private maybeStartHand(): void {
    if (this.engine && !this.engine.isComplete()) return;
    const eligible = this.activeSeats();
    if (eligible.length < 2) return;

    // rotate button to the next occupied+eligible seat after the previous button
    let btnIdx = this.buttonSeatIndex;
    for (let i = 1; i <= this.maxSeats; i++) {
      const idx = (this.buttonSeatIndex + i) % this.maxSeats;
      const s = this.seats[idx];
      if (s && !s.sittingOut && s.stack > 0) {
        btnIdx = idx;
        break;
      }
    }
    this.buttonSeatIndex = btnIdx;

    const seatOrder = this.orderedFromButton(eligible);
    const forced = this.forcedOverride ?? forcedBetsForStakes(this.variant, this.stakes.bigBlind);
    this.engine = new HandEngine(
      this.variant,
      seatOrder.map((s) => ({ id: s.userId, stack: s.stack })),
      this.seats[this.buttonSeatIndex]!.userId,
      forced
    );
    this.handStartedAt = Date.now();
    this.currentActorSeat = null;
    this.afterEngineUpdate();
  }

  private orderedFromButton(eligible: Seat[]): Seat[] {
    // Seat order clockwise starting right after the button, restricted to eligible seats.
    const order: Seat[] = [];
    for (let i = 0; i < this.maxSeats; i++) {
      const idx = (this.buttonSeatIndex + i) % this.maxSeats;
      const s = this.seats[idx];
      if (s && eligible.includes(s)) order.push(s);
    }
    return order;
  }

  handleAction(userId: string, action: { type: string; to?: number }): void {
    if (!this.engine) throw new Error("No hand in progress");
    const actor = this.engine.currentActor();
    if (actor !== userId) throw new Error("Not your turn");
    this.clearActionTimer();
    let a: PlayerAction;
    if (action.type === "bet") a = { type: "bet", to: Number(action.to) };
    else if (action.type === "raise") a = { type: "raise", to: Number(action.to) };
    else if (action.type === "call") a = { type: "call" };
    else if (action.type === "check") a = { type: "check" };
    else if (action.type === "fold") a = { type: "fold" };
    else throw new Error(`Unknown action type: ${action.type}`);
    this.engine.act(userId, a);
    this.afterEngineUpdate();
  }

  handleDraw(userId: string, discardIndices: number[]): void {
    if (!this.engine) throw new Error("No hand in progress");
    this.clearActionTimer();
    this.engine.draw(userId, discardIndices);
    this.afterEngineUpdate();
  }

  private clearActionTimer(): void {
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
  }

  private afterEngineUpdate(): void {
    if (!this.engine) return;

    if (this.engine.isComplete()) {
      this.settleHand();
      this.broadcast();
      if (this.nextHandTimer) clearTimeout(this.nextHandTimer);
      this.nextHandTimer = setTimeout(() => {
        this.processLeavers();
        this.removeBustedPlayers();
        this.maybeStartHand();
        this.broadcast();
      }, NEXT_HAND_DELAY_MS);
      return;
    }

    const actor = this.engine.currentActor();
    if (actor) {
      const seat = this.seatOf(actor);
      this.currentActorSeat = seat?.index ?? null;
      this.clearActionTimer();
      this.actionTimer = setTimeout(() => this.autoAct(actor), ACTION_TIMEOUT_MS);
    }
    this.broadcast();
  }

  private autoAct(userId: string): void {
    if (!this.engine || this.engine.isComplete()) return;
    if (this.engine.currentActor() !== userId) return;
    const phase = this.engine.getPublicState().phase;
    if (typeof phase === "string" && phase.startsWith("draw")) {
      // time's up: stand pat
      this.engine.draw(userId, []);
      this.afterEngineUpdate();
      return;
    }
    const legal = this.engine.legalActions(userId);
    if (!legal) return;
    const action = legal.canCheck ? { type: "check" as const } : { type: "fold" as const };
    this.engine.act(userId, action);
    this.afterEngineUpdate();
  }

  private settleHand(): void {
    if (!this.engine) return;
    const result = this.engine.getResult();
    const state = this.engine.getPublicState();
    // sync stacks back from the engine's final player state
    for (const pv of state.players) {
      const seat = this.seatOf(pv.id);
      if (seat) seat.stack = pv.stack;
    }
    if (result) {
      insertHandHistoryStmt.run(
        randomUUID(),
        this.id,
        this.variant.id,
        this.handStartedAt,
        Date.now(),
        JSON.stringify({ result, community: state.community })
      );
    }
  }

  private processLeavers(): void {
    for (const seat of this.seats) {
      if (seat && seat.leavingAfterHand) this.removeSeat(seat);
    }
  }

  private removeBustedPlayers(): void {
    for (const seat of this.seats) {
      if (seat && seat.stack <= 0) {
        if (this.opts.tournamentMode) {
          // Leave the seat in place (stack 0 already excludes them from
          // activeSeats(), so they won't be dealt in) and let the
          // tournament layer decide: hold the seat open for a rebuy, or
          // call eliminateSeat() to finalize the elimination.
          this.opts.onPlayerBusted?.(seat.userId, seat.index);
        } else {
          // cash table: busted, nothing to cash out, just clear the seat
          this.seats[seat.index] = null;
        }
      }
    }
  }

  getLobbyInfo() {
    return {
      id: this.id,
      name: this.name,
      variantId: this.variant.id,
      variantName: this.variant.name,
      stakes: this.stakes,
      maxSeats: this.maxSeats,
      occupied: this.occupiedCount(),
      handInProgress: !!this.engine && !this.engine.isComplete(),
    };
  }

  getStateFor(userId: string | null): unknown {
    const engineState: PublicHandState | null = this.engine ? this.engine.getPublicState(userId ?? undefined) : null;
    return {
      type: "table_state",
      tableId: this.id,
      variantId: this.variant.id,
      variantName: this.variant.name,
      stakes: this.stakes,
      maxSeats: this.maxSeats,
      seats: this.seats.map((s) =>
        s
          ? {
              index: s.index,
              username: s.username,
              userId: s.userId,
              stack: s.stack,
              sittingOut: s.sittingOut,
            }
          : null
      ),
      buttonSeatIndex: this.buttonSeatIndex,
      hand: engineState,
      yourSeat: userId ? this.seatOf(userId)?.index ?? null : null,
    };
  }

  broadcast(): void {
    for (const sub of this.subscribers) {
      try {
        sub.conn.send(JSON.stringify(this.getStateFor(sub.userId)));
      } catch (err) {
        this.onBroadcastError?.(err);
      }
    }
  }
}
