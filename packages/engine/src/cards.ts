import { randomInt } from "crypto";

// A card is packed as (rank << 2) | suit.
// rank: 2..14 (14 = Ace)
// suit: 0=clubs, 1=diamonds, 2=hearts, 3=spades
export type Card = number;

export const RANK_CHARS = "23456789TJQKA";
export const SUIT_CHARS = "cdhs";

export function makeCard(rank: number, suit: number): Card {
  return (rank << 2) | suit;
}

export function rankOf(card: Card): number {
  return card >> 2;
}

export function suitOf(card: Card): number {
  return card & 3;
}

export function cardToString(card: Card): string {
  return RANK_CHARS[rankOf(card) - 2] + SUIT_CHARS[suitOf(card)];
}

export function stringToCard(s: string): Card {
  const rank = RANK_CHARS.indexOf(s[0].toUpperCase()) + 2;
  const suit = SUIT_CHARS.indexOf(s[1].toLowerCase());
  if (rank < 2 || suit < 0) throw new Error(`Invalid card string: ${s}`);
  return makeCard(rank, suit);
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (let rank = 2; rank <= 14; rank++) {
    for (let suit = 0; suit < 4; suit++) {
      deck.push(makeCard(rank, suit));
    }
  }
  return deck;
}

// Cryptographically secure Fisher-Yates shuffle. Used for every deal so
// that no player (or the house) can predict or bias card order.
export function secureShuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Shoe {
  private cards: Card[];
  private pos = 0;

  constructor() {
    this.cards = secureShuffle(fullDeck());
  }

  draw(): Card {
    if (this.pos >= this.cards.length) {
      throw new Error("Shoe exhausted");
    }
    return this.cards[this.pos++];
  }

  drawN(n: number): Card[] {
    const out: Card[] = [];
    for (let i = 0; i < n; i++) out.push(this.draw());
    return out;
  }

  remaining(): number {
    return this.cards.length - this.pos;
  }

  // Burn a card (standard casino procedure between streets).
  burn(): void {
    this.draw();
  }

  /**
   * Shuffles `extraCards` (folded/mucked/discarded cards no longer needed
   * elsewhere in the hand) and appends them to the shoe. Standard poker-room
   * procedure (see Robert's Rules of Poker) for stud/draw games with enough
   * players and enough draw rounds to exhaust a single 52-card deck.
   */
  refill(extraCards: Card[]): void {
    if (extraCards.length === 0) return;
    this.cards.push(...secureShuffle(extraCards));
  }
}
