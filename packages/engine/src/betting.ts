import { BettingStructure } from "./variants";

export interface BettingPlayer {
  id: string;
  stack: number; // chips not yet committed to the pot this hand
  committedTotal: number; // total committed to the pot this hand (all streets)
  committedStreet: number; // committed during the current street
  folded: boolean;
  allIn: boolean;
}

export type PlayerAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "bet"; to: number }
  | { type: "raise"; to: number };

export interface BettingRoundOptions {
  structure: BettingStructure;
  smallBet: number; // fixed-limit small bet size, or the base unit (big blind) for NL/PL
  bigBet?: number; // fixed-limit big bet size (later streets)
  maxRaisesFixedLimit?: number; // typical cap = 4 (bet + 3 raises); undefined = uncapped
  startingBet?: number; // amount already required to call at round start (blind/bring-in), default 0
}

export class BettingRound {
  players: Map<string, BettingPlayer>;
  order: string[]; // fixed action-order rotation for this street (non-folded participants)
  private posIndex = 0; // search start index into `order` for the next actor
  currentBet = 0; // highest committedStreet among active players
  lastRaiseSize: number;
  raisesSoFar = 0;
  actedSinceLastRaise = new Set<string>();
  private opts: BettingRoundOptions;
  public log: { playerId: string; action: PlayerAction }[] = [];

  constructor(players: BettingPlayer[], order: string[], opts: BettingRoundOptions) {
    this.players = new Map(players.map((p) => [p.id, p]));
    this.order = order.filter((id) => {
      const p = this.players.get(id);
      return p && !p.folded;
    });
    this.opts = opts;
    this.currentBet = Math.max(0, opts.startingBet ?? 0, ...players.map((p) => p.committedStreet));
    this.lastRaiseSize = opts.smallBet;
  }

  currentPlayerId(): string | null {
    const n = this.order.length;
    if (n === 0) return null;
    for (let i = 0; i < n; i++) {
      const id = this.order[(this.posIndex + i) % n];
      const p = this.players.get(id)!;
      if (!p.folded && !p.allIn) return id;
    }
    return null;
  }

  legalActions(playerId: string): { canCheck: boolean; canCall: boolean; callAmount: number; canBetOrRaise: boolean; minTo: number; maxTo: number } {
    const p = this.players.get(playerId)!;
    const toCall = this.currentBet - p.committedStreet;
    const canCheck = toCall === 0;
    const canCall = toCall > 0 && p.stack > 0;
    const callAmount = Math.min(toCall, p.stack);

    let minTo = this.currentBet + this.lastRaiseSize;
    let maxTo: number;
    if (this.opts.structure === "no-limit") {
      maxTo = p.committedStreet + p.stack;
    } else if (this.opts.structure === "pot-limit") {
      // Max raise = size of pot after the call is made.
      const potAfterCall = this.totalPot() + callAmount;
      maxTo = this.currentBet + potAfterCall;
      maxTo = Math.min(maxTo, p.committedStreet + p.stack);
    } else {
      // fixed-limit: exactly one bet size, capped number of raises
      maxTo = minTo;
      if (this.opts.maxRaisesFixedLimit !== undefined && this.raisesSoFar >= this.opts.maxRaisesFixedLimit) {
        maxTo = this.currentBet; // no more raising allowed
        minTo = this.currentBet;
      }
      maxTo = Math.min(maxTo, p.committedStreet + p.stack);
      minTo = Math.min(minTo, p.committedStreet + p.stack);
    }
    minTo = Math.min(minTo, p.committedStreet + p.stack);
    const canBetOrRaise = p.stack > 0 && maxTo > this.currentBet;
    return { canCheck, canCall, callAmount, canBetOrRaise, minTo, maxTo };
  }

  totalPot(): number {
    let sum = 0;
    for (const p of this.players.values()) sum += p.committedTotal;
    return sum;
  }

  apply(playerId: string, action: PlayerAction): void {
    const p = this.players.get(playerId);
    if (!p) throw new Error("Unknown player");
    if (p.folded || p.allIn) throw new Error(`${playerId} cannot act (folded/all-in)`);
    if (this.currentPlayerId() !== playerId) throw new Error(`Not ${playerId}'s turn`);

    const legal = this.legalActions(playerId);

    switch (action.type) {
      case "fold": {
        p.folded = true;
        break;
      }
      case "check": {
        if (!legal.canCheck) throw new Error("Cannot check, facing a bet");
        break;
      }
      case "call": {
        const amt = legal.callAmount;
        this.commit(p, amt);
        break;
      }
      case "bet":
      case "raise": {
        if (!legal.canBetOrRaise) throw new Error("Betting/raising not allowed here");
        const to = Math.min(Math.max(action.to, legal.minTo), legal.maxTo);
        const raiseSize = to - this.currentBet;
        const amt = to - p.committedStreet;
        this.commit(p, amt);
        this.currentBet = to;
        this.lastRaiseSize = Math.max(this.lastRaiseSize, raiseSize);
        this.raisesSoFar++;
        this.actedSinceLastRaise = new Set([playerId]);
        break;
      }
    }

    if (p.stack === 0 && !p.folded) p.allIn = true;
    this.actedSinceLastRaise.add(playerId);
    this.log.push({ playerId, action });
    this.advanceCursor(playerId);
  }

  private commit(p: BettingPlayer, amount: number): void {
    const actual = Math.min(amount, p.stack);
    p.stack -= actual;
    p.committedStreet += actual;
    p.committedTotal += actual;
  }

  private advanceCursor(playerId: string): void {
    const n = this.order.length;
    if (n === 0) return;
    const idx = this.order.indexOf(playerId);
    this.posIndex = (idx >= 0 ? idx + 1 : this.posIndex) % n;
  }

  /** True once every player still in the hand has matched currentBet (or is all-in) and has acted. */
  isComplete(): boolean {
    const contenders = [...this.players.values()].filter((p) => !p.folded);
    if (contenders.length <= 1) return true;
    const deciding = contenders.filter((p) => !p.allIn);
    if (deciding.length === 0) return true;
    for (const p of deciding) {
      if (p.committedStreet !== this.currentBet) return false;
      if (!this.actedSinceLastRaise.has(p.id)) return false;
    }
    return true;
  }

  handIsOver(): boolean {
    return [...this.players.values()].filter((p) => !p.folded).length <= 1;
  }
}
