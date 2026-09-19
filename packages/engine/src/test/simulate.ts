import assert from "node:assert";
import { HandEngine, ForcedBets } from "../hand";
import { getVariant, VariantConfig } from "../variants";

function randInt(n: number): number {
  return Math.floor(Math.random() * n);
}

function forcedBetsFor(variant: VariantConfig): ForcedBets {
  if (variant.category === "stud") {
    return { ante: 1, bringIn: 2, smallBet: 4, bigBet: 8, maxRaises: 4 };
  }
  if (variant.bettingStructure === "fixed-limit") {
    return { smallBlind: 1, bigBlind: 2, smallBet: 2, bigBet: 4, maxRaises: 4 };
  }
  return { smallBlind: 1, bigBlind: 2, smallBet: 2 };
}

function randomStack(): number {
  // vary stacks so side-pot logic gets exercised, including short all-ins
  const r = Math.random();
  if (r < 0.2) return 5 + randInt(10); // short stack -> likely all-in
  return 80 + randInt(400);
}

function playOneHand(variant: VariantConfig, numPlayers: number): void {
  const seats = Array.from({ length: numPlayers }, (_, i) => ({ id: `p${i}`, stack: randomStack() }));
  const totalChipsIn = seats.reduce((s, p) => s + p.stack, 0);
  const buttonId = seats[randInt(numPlayers)].id;
  const engine = new HandEngine(variant, seats, buttonId, forcedBetsFor(variant));

  let steps = 0;
  const maxSteps = 5000;
  while (!engine.isComplete() && steps < maxSteps) {
    steps++;
    const phase = engine.getPublicState().phase;
    if (typeof phase === "string" && phase.startsWith("draw")) {
      const actor = engine.currentActor();
      if (!actor) throw new Error("draw phase with no pending actor but not complete");
      const numDiscard = randInt(4); // 0-3 cards discarded, keeps it simple
      const indices: number[] = [];
      for (let i = 0; i < numDiscard; i++) indices.push(randInt(5));
      engine.draw(actor, [...new Set(indices)]);
      continue;
    }

    const actor = engine.currentActor();
    if (!actor) {
      // shouldn't happen while not complete, but guard against infinite loop
      break;
    }
    const legal = engine.legalActions(actor)!;
    const choice = pickAction(legal);
    engine.act(actor, choice);
  }

  if (!engine.isComplete()) {
    throw new Error(`Hand did not complete within ${maxSteps} steps (variant=${variant.id}, players=${numPlayers})`);
  }

  const result = engine.getResult()!;
  const totalPaidOut = result.pots.reduce((s, pot) => s + pot.winners.reduce((s2, w) => s2 + w.amount, 0), 0);
  const totalPotAmount = result.pots.reduce((s, pot) => s + pot.amount, 0);
  assert.strictEqual(totalPotAmount, totalPaidOut, `every chip in each pot must be paid out (variant=${variant.id})`);

  // Total net stack change across all players must sum to zero (chip conservation).
  const netSum = Object.values(result.netStackChange).reduce((a, b) => a + b, 0);
  assert.strictEqual(netSum, 0, `net stack changes must sum to zero (variant=${variant.id})`);

  // Chips out (final stacks) must equal chips in.
  const finalState = engine.getPublicState();
  const totalChipsOut = finalState.players.reduce((s, p) => s + p.stack, 0);
  assert.strictEqual(totalChipsOut, totalChipsIn, `total chips must be conserved (variant=${variant.id}, in=${totalChipsIn}, out=${totalChipsOut})`);
}

function pickAction(legal: ReturnType<HandEngine["legalActions"]>) {
  if (!legal) throw new Error("no legal actions");
  const r = Math.random();
  if (legal.canCheck) {
    if (r < 0.55) return { type: "check" as const };
    if (legal.canBetOrRaise && r < 0.85) {
      const to = legal.minTo + randInt(Math.max(1, legal.maxTo - legal.minTo + 1));
      return { type: "bet" as const, to };
    }
    return { type: "check" as const };
  }
  // facing a bet
  if (r < 0.15) return { type: "fold" as const };
  if (legal.canBetOrRaise && r < 0.4) {
    const to = legal.minTo + randInt(Math.max(1, legal.maxTo - legal.minTo + 1));
    return { type: "raise" as const, to };
  }
  return { type: "call" as const };
}

export function run(): void {
  const variantIds = [
    "holdem",
    "omaha",
    "omaha_hilo",
    "big_o",
    "seven_stud",
    "seven_stud_hilo",
    "razz",
    "five_draw",
    "triple_draw_27",
  ];

  let handsPlayed = 0;
  for (const id of variantIds) {
    const variant = getVariant(id);
    const playerCounts = [2, 3, Math.min(6, variant.maxPlayers), variant.maxPlayers];
    for (const n of playerCounts) {
      const trials = 25;
      for (let t = 0; t < trials; t++) {
        playOneHand(variant, n);
        handsPlayed++;
      }
    }
  }
  console.log(`simulate.ts: played ${handsPlayed} hands across all variants, all chip-conserved and completed cleanly`);
}
