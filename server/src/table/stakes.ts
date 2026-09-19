import { ForcedBets, VariantConfig } from "@poker/engine";

export interface StakesLevel {
  id: string;
  label: string;
  bigBlind: number; // the unit everything else is derived from
  minBuyIn: number; // in chips (100x BB)
  maxBuyIn: number; // in chips (250x BB)
}

export const STAKES_LEVELS: StakesLevel[] = [
  { id: "micro", label: "1/2", bigBlind: 2, minBuyIn: 100, maxBuyIn: 400 },
  { id: "low", label: "5/10", bigBlind: 10, minBuyIn: 500, maxBuyIn: 2000 },
  { id: "mid", label: "25/50", bigBlind: 50, minBuyIn: 2500, maxBuyIn: 10000 },
  { id: "high", label: "100/200", bigBlind: 200, minBuyIn: 10000, maxBuyIn: 40000 },
];

/** Derives the full forced-bet schedule for a variant from a single big-blind unit. */
export function forcedBetsForStakes(variant: VariantConfig, bigBlind: number): ForcedBets {
  if (variant.category === "stud") {
    const smallBet = bigBlind;
    const bigBet = bigBlind * 2;
    return {
      ante: Math.max(1, Math.round(bigBlind * 0.2)),
      bringIn: Math.max(1, Math.round(bigBlind * 0.4)),
      smallBet,
      bigBet,
      maxRaises: 4,
    };
  }
  if (variant.bettingStructure === "fixed-limit") {
    return {
      smallBlind: Math.max(1, Math.round(bigBlind / 2)),
      bigBlind,
      smallBet: bigBlind,
      bigBet: bigBlind * 2,
      maxRaises: 4,
    };
  }
  return {
    smallBlind: Math.max(1, Math.round(bigBlind / 2)),
    bigBlind,
    smallBet: bigBlind,
  };
}
