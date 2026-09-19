export type VariantCategory = "flop" | "stud" | "draw";
export type BettingStructure = "no-limit" | "pot-limit" | "fixed-limit";
export type LowMethod = "ace-to-five" | "deuce-to-seven" | undefined;

export interface VariantConfig {
  id: string;
  name: string;
  category: VariantCategory;
  bettingStructure: BettingStructure;
  // Hard seat cap for a single 52-card shoe: flop games deal every seat's
  // hole cards up front (community + burns are fixed overhead regardless of
  // folding), and stud deals every *active* player a card on every street,
  // so both have a real per-deck ceiling. Draw games recycle folded/discarded
  // cards back into the shoe mid-hand (see Shoe.refill), so their cap is a
  // conventional table-size limit rather than a hard arithmetic one.
  maxPlayers: number;

  // flop games
  holeCards?: number; // cards dealt face down per player at start
  communityCards?: number; // total community cards revealed across streets
  useHoleCount?: number; // exact # hole cards that MUST be used in best hand (Omaha rule)
  useBoardCount?: number; // exact # board cards that MUST be used (Omaha rule)

  // draw games
  drawRounds?: number; // number of draw phases (1 for 5-card draw, 3 for triple draw)

  // high/low
  highEnabled: boolean;
  lowEnabled: boolean;
  lowMethod?: LowMethod;
  lowQualifier?: number; // e.g. 8 for "8-or-better"; undefined = no qualifier (Razz)

  // forced bets
  usesBlinds: boolean; // true for flop games and (optionally) draw games
  usesAntesAndBringIn: boolean; // true for stud games
}

export const VARIANTS: Record<string, VariantConfig> = {
  holdem: {
    id: "holdem",
    name: "Texas Hold'em",
    category: "flop",
    bettingStructure: "no-limit",
    holeCards: 2,
    communityCards: 5,
    useHoleCount: undefined,
    useBoardCount: undefined,
    highEnabled: true,
    lowEnabled: false,
    usesBlinds: true,
    usesAntesAndBringIn: false,
    maxPlayers: 9,
  },
  omaha: {
    id: "omaha",
    name: "Pot-Limit Omaha",
    category: "flop",
    bettingStructure: "pot-limit",
    holeCards: 4,
    communityCards: 5,
    useHoleCount: 2,
    useBoardCount: 3,
    highEnabled: true,
    lowEnabled: false,
    usesBlinds: true,
    usesAntesAndBringIn: false,
    maxPlayers: 9,
  },
  omaha_hilo: {
    id: "omaha_hilo",
    name: "Omaha Hi-Lo (8 or better)",
    category: "flop",
    bettingStructure: "pot-limit",
    holeCards: 4,
    communityCards: 5,
    useHoleCount: 2,
    useBoardCount: 3,
    highEnabled: true,
    lowEnabled: true,
    lowMethod: "ace-to-five",
    lowQualifier: 8,
    usesBlinds: true,
    usesAntesAndBringIn: false,
    maxPlayers: 9,
  },
  big_o: {
    id: "big_o",
    name: "5-Card Omaha Hi-Lo",
    category: "flop",
    bettingStructure: "pot-limit",
    holeCards: 5,
    communityCards: 5,
    useHoleCount: 2,
    useBoardCount: 3,
    highEnabled: true,
    lowEnabled: true,
    lowMethod: "ace-to-five",
    lowQualifier: 8,
    usesBlinds: true,
    usesAntesAndBringIn: false,
    maxPlayers: 8,
  },
  seven_stud: {
    id: "seven_stud",
    name: "7-Card Stud",
    category: "stud",
    bettingStructure: "fixed-limit",
    highEnabled: true,
    lowEnabled: false,
    usesBlinds: false,
    usesAntesAndBringIn: true,
    maxPlayers: 7,
  },
  seven_stud_hilo: {
    id: "seven_stud_hilo",
    name: "7-Card Stud Hi-Lo",
    category: "stud",
    bettingStructure: "fixed-limit",
    highEnabled: true,
    lowEnabled: true,
    lowMethod: "ace-to-five",
    lowQualifier: 8,
    usesBlinds: false,
    usesAntesAndBringIn: true,
    maxPlayers: 7,
  },
  razz: {
    id: "razz",
    name: "Razz",
    category: "stud",
    bettingStructure: "fixed-limit",
    highEnabled: false,
    lowEnabled: true,
    lowMethod: "ace-to-five",
    lowQualifier: undefined,
    usesBlinds: false,
    usesAntesAndBringIn: true,
    maxPlayers: 7,
  },
  five_draw: {
    id: "five_draw",
    name: "5-Card Draw",
    category: "draw",
    bettingStructure: "no-limit",
    drawRounds: 1,
    highEnabled: true,
    lowEnabled: false,
    usesBlinds: true,
    usesAntesAndBringIn: false,
    maxPlayers: 8,
  },
  triple_draw_27: {
    id: "triple_draw_27",
    name: "2-7 Triple Draw",
    category: "draw",
    bettingStructure: "fixed-limit",
    drawRounds: 3,
    highEnabled: false,
    lowEnabled: true,
    lowMethod: "deuce-to-seven",
    lowQualifier: undefined,
    usesBlinds: true,
    usesAntesAndBringIn: false,
    maxPlayers: 8,
  },
};

export function getVariant(id: string): VariantConfig {
  const v = VARIANTS[id];
  if (!v) throw new Error(`Unknown variant: ${id}`);
  return v;
}
