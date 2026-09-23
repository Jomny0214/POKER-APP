import { Card, cardToString, Shoe } from "./cards";
import { VariantConfig } from "./variants";
import { BettingPlayer, BettingRound, PlayerAction } from "./betting";
import { buildPots, Contribution, Pot } from "./pots";
import {
  evaluateBestHigh,
  evaluateBestHighConstrained,
  evaluateBestAceToFiveLow,
  evaluateBestAceToFiveLowConstrained,
  evaluateBest27Low,
  BestHandResult,
  LowResult,
} from "./evaluator";
import { lowestUpCard, highestUpCard, bestExposedHigh, bestExposedLow } from "./exposed";

export interface ForcedBets {
  smallBlind?: number;
  bigBlind?: number;
  ante?: number;
  bringIn?: number;
  smallBet?: number; // fixed-limit early-street bet size / NL-PL base unit
  bigBet?: number; // fixed-limit late-street bet size
  maxRaises?: number; // fixed-limit raise cap per street
}

interface PlayerHandState {
  id: string;
  stack: number;
  holeCards: Card[]; // flop games: private hole cards; draw games: the 5-card hand
  downCards: Card[]; // stud: face-down cards (starts with 2, gains the 7th)
  upCards: Card[]; // stud: face-up cards
  folded: boolean;
  allIn: boolean;
  committedTotal: number;
  sittingOut: boolean;
}

export interface WinnerShare {
  playerId: string;
  amount: number;
  hand?: string;
  side: "high" | "low";
}

export interface PotResult {
  amount: number;
  winners: WinnerShare[];
}

export interface ShowdownResult {
  pots: PotResult[];
  revealed: Record<string, { cards: string[]; description?: string }>;
  netStackChange: Record<string, number>;
}

export type HandPhase =
  | "preflop" | "flop" | "turn" | "river"
  | "third" | "fourth" | "fifth" | "sixth" | "seventh"
  | "predraw" | `draw${number}` | `betting${number}`
  | "showdown" | "complete";

export interface PublicPlayerView {
  id: string;
  stack: number;
  committed: number;
  folded: boolean;
  allIn: boolean;
  upCards?: string[];
  holeCardCount: number;
  revealedHoleCards?: string[];
}

export interface PublicHandState {
  phase: HandPhase;
  community: string[];
  pot: number;
  currentActor: string | null;
  legalActions: ReturnType<BettingRound["legalActions"]> | null;
  players: PublicPlayerView[];
  buttonId: string;
  result: ShowdownResult | null;
}

export class HandEngine {
  private variant: VariantConfig;
  private shoe = new Shoe();
  private seatOrder: string[]; // fixed clockwise seating for this hand
  private buttonId: string;
  private forced: ForcedBets;
  private players = new Map<string, PlayerHandState>();
  private community: Card[] = [];
  private phase: HandPhase;
  private betting: BettingRound | null = null;
  private drawRoundIndex = 0;
  private result: ShowdownResult | null = null;
  private pendingDraws = new Set<string>(); // draw games: players who still need to submit a draw action
  private muckPile: Card[] = []; // folded/discarded cards, recycled into the shoe if it runs low

  constructor(variant: VariantConfig, seats: { id: string; stack: number }[], buttonId: string, forced: ForcedBets) {
    if (seats.length > variant.maxPlayers) {
      throw new Error(`${variant.name} supports at most ${variant.maxPlayers} players (got ${seats.length})`);
    }
    if (seats.length < 2) {
      throw new Error("A hand requires at least 2 players");
    }
    this.variant = variant;
    this.seatOrder = seats.map((s) => s.id);
    this.buttonId = buttonId;
    this.forced = forced;
    for (const s of seats) {
      this.players.set(s.id, {
        id: s.id,
        stack: s.stack,
        holeCards: [],
        downCards: [],
        upCards: [],
        folded: false,
        allIn: false,
        committedTotal: 0,
        sittingOut: false,
      });
    }
    this.phase = variant.category === "flop" ? "preflop" : variant.category === "stud" ? "third" : "betting0" as HandPhase;
    this.dealStart();
    this.checkAdvance();
  }

  // ---------------------------------------------------------------------
  // Dealing
  // ---------------------------------------------------------------------

  private rotateFrom(startId: string): string[] {
    const idx = this.seatOrder.indexOf(startId);
    if (idx < 0) return this.seatOrder.slice();
    return [...this.seatOrder.slice(idx), ...this.seatOrder.slice(0, idx)];
  }

  private activeIds(): string[] {
    return this.seatOrder.filter((id) => !this.players.get(id)!.folded);
  }

  private dealStart(): void {
    if (this.variant.category === "flop") {
      this.dealFlopHoleCards();
      this.postBlindsAndStartBetting("preflop");
    } else if (this.variant.category === "stud") {
      this.dealStudCard(2, true); // two down
      this.dealStudCard(1, false); // one up (3rd street)
      this.postAntesAndStartBringIn();
    } else {
      this.dealDrawHoleCards();
      this.postBlindsAndStartBetting("betting0" as HandPhase);
    }
  }

  private ensureSupply(n: number): void {
    if (this.shoe.remaining() < n) {
      this.shoe.refill(this.muckPile);
      this.muckPile = [];
    }
  }

  private dealFlopHoleCards(): void {
    const n = this.variant.holeCards ?? 2;
    this.ensureSupply(n * this.seatOrder.length);
    for (const id of this.seatOrder) {
      const p = this.players.get(id)!;
      p.holeCards = this.shoe.drawN(n);
    }
  }

  private dealDrawHoleCards(): void {
    this.ensureSupply(5 * this.seatOrder.length);
    for (const id of this.seatOrder) {
      const p = this.players.get(id)!;
      p.holeCards = this.shoe.drawN(5);
    }
  }

  private dealStudCard(n: number, down: boolean): void {
    const active = this.activeIds();
    this.ensureSupply(n * active.length);
    for (const id of active) {
      const p = this.players.get(id)!;
      const cards = this.shoe.drawN(n);
      if (down) p.downCards.push(...cards);
      else p.upCards.push(...cards);
    }
  }

  // ---------------------------------------------------------------------
  // Forced bets & round setup
  // ---------------------------------------------------------------------

  private toBettingPlayers(committedStreet: Map<string, number> = new Map()): BettingPlayer[] {
    return this.activeIds().map((id) => {
      const p = this.players.get(id)!;
      return {
        id,
        stack: p.stack,
        committedTotal: p.committedTotal,
        committedStreet: committedStreet.get(id) ?? 0,
        folded: p.folded,
        allIn: p.allIn,
      };
    });
  }

  private applyBettingBackToPlayers(): void {
    if (!this.betting) return;
    for (const [id, bp] of this.betting.players) {
      const p = this.players.get(id)!;
      p.stack = bp.stack;
      p.committedTotal = bp.committedTotal;
      p.folded = bp.folded;
      p.allIn = bp.allIn;
      if (p.folded && (p.holeCards.length || p.downCards.length || p.upCards.length)) {
        // Muck: folded hands are never revealed, and their cards can be
        // recycled into the shoe if it runs low later in the hand.
        this.muckPile.push(...p.holeCards, ...p.downCards, ...p.upCards);
        p.holeCards = [];
        p.downCards = [];
        p.upCards = [];
      }
    }
  }

  private postBlindsAndStartBetting(phase: HandPhase): void {
    const active = this.activeIds();
    const n = active.length;
    const committedStreet = new Map<string, number>();
    let order: string[];

    // Tournament-style ante: posted by every active player straight into the
    // pot (not counted toward the street's "amount to call"), before blinds.
    // Only ever fires when `forced.ante` is explicitly set, which stud games
    // handle separately via postAntesAndStartBringIn and cash flop/draw games
    // never set (see stakes.ts) -- so this is a no-op for existing cash play.
    if (this.variant.category !== "stud" && this.forced.ante) {
      for (const id of active) {
        const p = this.players.get(id)!;
        const actual = Math.min(this.forced.ante, p.stack);
        p.stack -= actual;
        p.committedTotal += actual;
        if (p.stack === 0) p.allIn = true;
      }
    }

    if (this.forced.smallBlind !== undefined && this.forced.bigBlind !== undefined) {
      const sb = this.forced.smallBlind;
      const bb = this.forced.bigBlind;
      let sbId: string, bbId: string, firstActor: string;
      if (n === 2) {
        sbId = this.buttonId;
        bbId = active.find((id) => id !== this.buttonId)!;
        firstActor = phase === "preflop" || phase === "betting0" ? sbId : bbId;
      } else {
        const rotation = this.rotateFrom(this.buttonId).filter((id) => active.includes(id));
        sbId = rotation[1];
        bbId = rotation[2];
        firstActor = phase === "preflop" || phase === "betting0" ? rotation[3] : rotation[1];
      }
      this.postForced(sbId, sb, committedStreet);
      this.postForced(bbId, bb, committedStreet);
      order = this.rotateFrom(firstActor).filter((id) => active.includes(id));
    } else {
      order = this.rotateFrom(this.buttonId).filter((id) => active.includes(id));
    }

    const isPreflopLike = phase === "preflop" || phase === "betting0";
    const smallBet = this.forced.smallBet ?? this.forced.bigBlind ?? 1;
    this.betting = new BettingRound(this.toBettingPlayers(committedStreet), order, {
      structure: this.variant.bettingStructure,
      smallBet,
      maxRaisesFixedLimit: this.forced.maxRaises,
      startingBet: isPreflopLike ? this.forced.bigBlind ?? 0 : 0,
    });
    this.phase = phase;
  }

  private postForced(id: string, amount: number, committedStreet: Map<string, number>): void {
    const p = this.players.get(id)!;
    const actual = Math.min(amount, p.stack);
    p.stack -= actual;
    p.committedTotal += actual;
    if (p.stack === 0) p.allIn = true;
    committedStreet.set(id, (committedStreet.get(id) ?? 0) + actual);
  }

  private postAntesAndStartBringIn(): void {
    const ante = this.forced.ante ?? 0;
    for (const id of this.activeIds()) {
      const p = this.players.get(id)!;
      const actual = Math.min(ante, p.stack);
      p.stack -= actual;
      p.committedTotal += actual;
      if (p.stack === 0) p.allIn = true;
    }

    const upCards = new Map(this.activeIds().map((id) => [id, this.players.get(id)!.upCards]));
    const bringInId = this.variant.lowMethod === "ace-to-five" && !this.variant.highEnabled
      ? highestUpCard(this.activeIds(), upCards) // Razz: high card brings it in
      : lowestUpCard(this.activeIds(), upCards); // Stud/Stud Hi-Lo: low card brings it in

    const committedStreet = new Map<string, number>();
    const bringIn = this.forced.bringIn ?? 1;
    this.postForced(bringInId, bringIn, committedStreet);

    const order = this.rotateFrom(bringInId).filter((id) => this.activeIds().includes(id));
    this.betting = new BettingRound(this.toBettingPlayers(committedStreet), order, {
      structure: this.variant.bettingStructure,
      smallBet: this.forced.smallBet ?? 1,
      maxRaisesFixedLimit: this.forced.maxRaises,
      startingBet: bringIn,
    });
    this.phase = "third";
  }

  private startStudBettingRound(phase: HandPhase, useBigBet: boolean): void {
    const upCards = new Map(this.activeIds().map((id) => [id, this.players.get(id)!.upCards]));
    const firstId = this.variant.lowMethod === "ace-to-five" && !this.variant.highEnabled
      ? bestExposedLow(this.activeIds(), upCards)
      : bestExposedHigh(this.activeIds(), upCards);
    const order = this.rotateFrom(firstId).filter((id) => this.activeIds().includes(id));
    this.betting = new BettingRound(this.toBettingPlayers(), order, {
      structure: this.variant.bettingStructure,
      smallBet: (useBigBet ? this.forced.bigBet : this.forced.smallBet) ?? 1,
      maxRaisesFixedLimit: this.forced.maxRaises,
    });
    this.phase = phase;
  }

  private startPostflopBettingRound(phase: HandPhase): void {
    const order = this.rotateFrom(this.buttonId).filter((id) => this.activeIds().includes(id));
    // first active player left of button acts first postflop
    const rotated = order;
    this.betting = new BettingRound(this.toBettingPlayers(), rotated, {
      structure: this.variant.bettingStructure,
      smallBet: this.forced.smallBet ?? this.forced.bigBlind ?? 1,
      maxRaisesFixedLimit: this.forced.maxRaises,
    });
    this.phase = phase;
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  currentActor(): string | null {
    if (this.phase === "showdown" || this.phase === "complete") return null;
    if (this.isDrawPhase()) {
      const next = [...this.pendingDraws][0];
      return next ?? null;
    }
    return this.betting?.currentPlayerId() ?? null;
  }

  private isDrawPhase(): boolean {
    return typeof this.phase === "string" && this.phase.startsWith("draw");
  }

  legalActions(playerId: string) {
    if (!this.betting) return null;
    return this.betting.legalActions(playerId);
  }

  act(playerId: string, action: PlayerAction): void {
    if (!this.betting) throw new Error("No active betting round");
    this.betting.apply(playerId, action);
    this.applyBettingBackToPlayers();
    this.checkAdvance();
  }

  /** Draw-game action: discard the cards at these indices (0-based, within the player's 5 hole cards) and replace them. */
  draw(playerId: string, discardIndices: number[]): void {
    if (!this.isDrawPhase()) throw new Error("Not in a drawing phase");
    if (!this.pendingDraws.has(playerId)) throw new Error("Not this player's draw");
    const p = this.players.get(playerId)!;
    const unique = [...new Set(discardIndices)].filter((i) => i >= 0 && i < p.holeCards.length);
    if (unique.length > 0) {
      const kept = p.holeCards.filter((_, i) => !unique.includes(i));
      const discarded = p.holeCards.filter((_, i) => unique.includes(i));
      this.muckPile.push(...discarded);
      this.ensureSupply(unique.length);
      const fresh = this.shoe.drawN(unique.length);
      p.holeCards = [...kept, ...fresh];
    }
    this.pendingDraws.delete(playerId);
    if (this.pendingDraws.size === 0) this.afterAllDrawsSubmitted();
  }

  private checkAdvance(): void {
    // Loops so that hands where the remaining players are all all-in run
    // straight through to showdown (dealing every remaining street / draw
    // automatically), rather than stalling on a phase nobody can act in.
    while (true) {
      if (this.phase === "complete") return;
      if (this.isDrawPhase()) {
        if (this.pendingDraws.size > 0) return; // waiting on a human draw() call
        return; // advanceDraw() already fast-forwarded past an all-in draw phase
      }
      if (!this.betting) return;
      if (this.betting.handIsOver()) {
        this.applyBettingBackToPlayers();
        this.resolveUncontested();
        return;
      }
      if (!this.betting.isComplete()) return;

      this.applyBettingBackToPlayers();
      this.advancePhase();
    }
  }

  private advancePhase(): void {
    switch (this.variant.category) {
      case "flop":
        this.advanceFlop();
        break;
      case "stud":
        this.advanceStud();
        break;
      case "draw":
        this.advanceDraw();
        break;
    }
  }

  private advanceFlop(): void {
    if (this.phase === "preflop") {
      this.ensureSupply(4);
      this.shoe.burn();
      this.community.push(...this.shoe.drawN(3));
      this.startPostflopBettingRound("flop");
    } else if (this.phase === "flop") {
      this.ensureSupply(2);
      this.shoe.burn();
      this.community.push(...this.shoe.drawN(1));
      this.startPostflopBettingRound("turn");
    } else if (this.phase === "turn") {
      this.ensureSupply(2);
      this.shoe.burn();
      this.community.push(...this.shoe.drawN(1));
      this.startPostflopBettingRound("river");
    } else if (this.phase === "river") {
      this.resolveShowdown();
    }
  }

  private advanceStud(): void {
    if (this.phase === "third") {
      this.dealStudCard(1, false);
      this.startStudBettingRound("fourth", false);
    } else if (this.phase === "fourth") {
      this.dealStudCard(1, false);
      this.startStudBettingRound("fifth", true);
    } else if (this.phase === "fifth") {
      this.dealStudCard(1, false);
      this.startStudBettingRound("sixth", true);
    } else if (this.phase === "sixth") {
      this.dealStudCard(1, true); // 7th street dealt face down
      this.startStudBettingRound("seventh", true);
    } else if (this.phase === "seventh") {
      this.resolveShowdown();
    }
  }

  private advanceDraw(): void {
    const roundsTotal = this.variant.drawRounds ?? 1;
    const m = /^betting(\d+)$/.exec(this.phase as string);
    if (!m) return;
    const idx = parseInt(m[1], 10);
    if (idx >= roundsTotal) {
      this.resolveShowdown();
      return;
    }
    // enter drawing phase idx
    this.phase = `draw${idx}` as HandPhase;
    this.pendingDraws = new Set(this.activeIds().filter((id) => !this.players.get(id)!.allIn));
    if (this.pendingDraws.size === 0) {
      this.startNextDrawBettingRound(idx + 1);
    }
  }

  private startNextDrawBettingRound(nextIdx: number): void {
    this.startPostflopBettingRound(`betting${nextIdx}` as HandPhase);
  }

  // called externally after the last draw() resolves pendingDraws to empty via checkAdvance -> but we need
  // to actually start the next betting round rather than re-entering advanceDraw's "showdown" branch.
  private afterAllDrawsSubmitted(): void {
    const m = /^draw(\d+)$/.exec(this.phase as string);
    if (!m) return;
    const idx = parseInt(m[1], 10);
    this.startNextDrawBettingRound(idx + 1);
    this.checkAdvance();
  }

  // ---------------------------------------------------------------------
  // Showdown
  // ---------------------------------------------------------------------

  private fullCards(id: string): Card[] {
    const p = this.players.get(id)!;
    if (this.variant.category === "stud") return [...p.downCards, ...p.upCards];
    if (this.variant.category === "draw") return p.holeCards;
    return p.holeCards; // flop games: combine with community separately for Omaha rules
  }

  private evaluateHigh(id: string): BestHandResult | null {
    if (!this.variant.highEnabled) return null;
    if (this.variant.category === "flop") {
      const p = this.players.get(id)!;
      if (this.variant.useHoleCount && this.variant.useBoardCount) {
        return evaluateBestHighConstrained(p.holeCards, this.community, this.variant.useHoleCount, this.variant.useBoardCount);
      }
      return evaluateBestHigh([...p.holeCards, ...this.community]);
    }
    if (this.variant.category === "stud") {
      return evaluateBestHigh(this.fullCards(id));
    }
    return evaluateBestHigh(this.fullCards(id)); // draw games: exactly 5 cards
  }

  private evaluateLow(id: string): LowResult | null {
    if (!this.variant.lowEnabled) return null;
    if (this.variant.lowMethod === "deuce-to-seven") {
      const r = evaluateBest27Low(this.fullCards(id));
      return { qualifies: true, badness: r.category, ranks: r.ranks, cards: r.cards, description: r.description };
    }
    // ace-to-five
    if (this.variant.category === "flop") {
      const p = this.players.get(id)!;
      if (this.variant.useHoleCount && this.variant.useBoardCount) {
        return evaluateBestAceToFiveLowConstrained(p.holeCards, this.community, this.variant.useHoleCount, this.variant.useBoardCount, this.variant.lowQualifier);
      }
      return evaluateBestAceToFiveLow([...p.holeCards, ...this.community], this.variant.lowQualifier);
    }
    return evaluateBestAceToFiveLow(this.fullCards(id), this.variant.lowQualifier);
  }

  private resolveUncontested(): void {
    const remaining = this.activeIds();
    const winnerId = remaining[0];
    const contributions: Contribution[] = this.seatOrder.map((id) => ({
      playerId: id,
      amount: this.players.get(id)!.committedTotal,
      folded: this.players.get(id)!.folded,
    }));
    const pots = buildPots(contributions);
    const potResults: PotResult[] = pots.map((pot) => ({
      amount: pot.amount,
      winners: [{ playerId: winnerId, amount: pot.amount, side: "high" as const }],
    }));
    const net: Record<string, number> = {};
    for (const id of this.seatOrder) net[id] = -this.players.get(id)!.committedTotal;
    for (const pr of potResults) for (const w of pr.winners) net[w.playerId] = (net[w.playerId] ?? 0) + w.amount;
    for (const pr of potResults) {
      for (const w of pr.winners) {
        this.players.get(w.playerId)!.stack += w.amount;
      }
    }
    this.result = { pots: potResults, revealed: {}, netStackChange: net };
    this.phase = "complete";
  }

  private resolveShowdown(): void {
    const contenders = this.activeIds();
    const contributions: Contribution[] = this.seatOrder.map((id) => ({
      playerId: id,
      amount: this.players.get(id)!.committedTotal,
      folded: this.players.get(id)!.folded,
    }));
    const pots = buildPots(contributions);

    const highResults = new Map<string, BestHandResult>();
    const lowResults = new Map<string, LowResult>();
    for (const id of contenders) {
      const h = this.evaluateHigh(id);
      if (h) highResults.set(id, h);
      const l = this.evaluateLow(id);
      if (l) lowResults.set(id, l);
    }

    const potResults: PotResult[] = pots.map((pot) => this.resolvePot(pot, highResults, lowResults));

    const net: Record<string, number> = {};
    for (const id of this.seatOrder) net[id] = -this.players.get(id)!.committedTotal;
    for (const pr of potResults) {
      for (const w of pr.winners) {
        net[w.playerId] = (net[w.playerId] ?? 0) + w.amount;
        this.players.get(w.playerId)!.stack += w.amount;
      }
    }

    const revealed: ShowdownResult["revealed"] = {};
    for (const id of contenders) {
      const cards = this.fullCards(id);
      const h = highResults.get(id);
      const l = lowResults.get(id);
      revealed[id] = {
        cards: cards.map(cardToString),
        description: h?.description ?? l?.description,
      };
    }

    this.result = { pots: potResults, revealed, netStackChange: net };
    this.phase = "complete";
  }

  private resolvePot(pot: Pot, highResults: Map<string, BestHandResult>, lowResults: Map<string, LowResult>): PotResult {
    const eligible = pot.eligiblePlayerIds;
    const winners: WinnerShare[] = [];

    const hiEligible = this.variant.highEnabled ? eligible.filter((id) => highResults.has(id)) : [];
    const loEligible = this.variant.lowEnabled ? eligible.filter((id) => lowResults.has(id)) : [];

    let hiShareTotal = pot.amount;
    let loShareTotal = 0;

    if (this.variant.highEnabled && this.variant.lowEnabled) {
      if (loEligible.length > 0) {
        loShareTotal = Math.floor(pot.amount / 2);
        hiShareTotal = pot.amount - loShareTotal; // odd chip to high
      } else {
        hiShareTotal = pot.amount;
        loShareTotal = 0;
      }
    } else if (!this.variant.highEnabled && this.variant.lowEnabled) {
      hiShareTotal = 0;
      loShareTotal = pot.amount;
    }

    if (hiShareTotal > 0 && hiEligible.length > 0) {
      const best = hiEligible.reduce((a, b) => {
        const cmp = compareHigh(highResults.get(a)!, highResults.get(b)!);
        return cmp >= 0 ? a : b;
      });
      const winnersHi = hiEligible.filter((id) => compareHigh(highResults.get(id)!, highResults.get(best)!) === 0);
      this.distributeShare(hiShareTotal, winnersHi, "high", winners, highResults.get(best)!.description);
    } else if (hiShareTotal > 0) {
      // no eligible high hand for this pot slice (shouldn't normally happen) -> roll into low, or return
      loShareTotal += hiShareTotal;
    }

    if (loShareTotal > 0 && loEligible.length > 0) {
      const best = loEligible.reduce((a, b) => {
        const cmp = compareLow(lowResults.get(a)!, lowResults.get(b)!);
        return cmp <= 0 ? a : b;
      });
      const winnersLo = loEligible.filter((id) => compareLow(lowResults.get(id)!, lowResults.get(best)!) === 0);
      this.distributeShare(loShareTotal, winnersLo, "low", winners, lowResults.get(best)?.description);
    } else if (loShareTotal > 0) {
      // no qualifying low -> the whole slice goes to high winners instead
      if (hiEligible.length > 0) {
        const best = hiEligible.reduce((a, b) => (compareHigh(highResults.get(a)!, highResults.get(b)!) >= 0 ? a : b));
        const winnersHi = hiEligible.filter((id) => compareHigh(highResults.get(id)!, highResults.get(best)!) === 0);
        this.distributeShare(loShareTotal, winnersHi, "high", winners, highResults.get(best)!.description);
      }
    }

    return { amount: pot.amount, winners };
  }

  private distributeShare(amount: number, winnerIds: string[], side: "high" | "low", out: WinnerShare[], desc?: string): void {
    const base = Math.floor(amount / winnerIds.length);
    let remainder = amount - base * winnerIds.length;
    // odd chips go to players closest to the left of the button, in seat order
    const ordered = this.rotateFrom(this.buttonId).filter((id) => winnerIds.includes(id));
    for (const id of ordered) {
      let share = base;
      if (remainder > 0) {
        share += 1;
        remainder -= 1;
      }
      const existing = out.find((w) => w.playerId === id && w.side === side);
      if (existing) existing.amount += share;
      else out.push({ playerId: id, amount: share, side, hand: desc });
    }
  }

  isComplete(): boolean {
    return this.phase === "complete";
  }

  getResult(): ShowdownResult | null {
    return this.result;
  }

  getPublicState(perspectiveId?: string): PublicHandState {
    const players: PublicPlayerView[] = this.seatOrder.map((id) => {
      const p = this.players.get(id)!;
      const view: PublicPlayerView = {
        id,
        stack: p.stack,
        committed: p.committedTotal,
        folded: p.folded,
        allIn: p.allIn,
        holeCardCount: this.variant.category === "stud" ? p.downCards.length + p.upCards.length : p.holeCards.length,
      };
      if (this.variant.category === "stud") {
        view.upCards = p.upCards.map(cardToString);
      }
      if (perspectiveId === id && this.variant.category !== "stud") {
        view.revealedHoleCards = p.holeCards.map(cardToString);
      }
      if (this.phase === "complete" && this.result?.revealed[id]) {
        view.revealedHoleCards = this.result.revealed[id].cards;
      }
      return view;
    });

    let pot = 0;
    for (const p of this.players.values()) pot += p.committedTotal;
    if (this.betting) {
      // include live (uncommitted-to-total) street bets already reflected via applyBettingBackToPlayers
    }

    const actor = this.currentActor();
    const canComputeLegal = actor && this.betting && !this.isDrawPhase();
    return {
      phase: this.phase,
      community: this.community.map(cardToString),
      pot,
      currentActor: actor,
      legalActions: canComputeLegal ? this.betting!.legalActions(actor!) : null,
      players,
      buttonId: this.buttonId,
      result: this.result,
    };
  }
}

function compareHigh(a: BestHandResult, b: BestHandResult): number {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i++) {
    const av = a.ranks[i] ?? -1;
    const bv = b.ranks[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function compareLow(a: LowResult, b: LowResult): number {
  if (a.badness !== b.badness) return a.badness - b.badness;
  for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i++) {
    const av = a.ranks[i] ?? 0;
    const bv = b.ranks[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}
