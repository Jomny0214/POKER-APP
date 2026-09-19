import assert from "node:assert";
import { stringToCard } from "../cards";
import {
  evaluateBestHigh,
  evaluateBestAceToFiveLow,
  evaluateBest27Low,
  compareLowResults,
} from "../evaluator";

function cs(s: string) {
  return s.split(" ").map(stringToCard);
}

export function run(): void {
  // --- High hand tests ---
  {
    const r = evaluateBestHigh(cs("As Ks Qs Js Ts 2c 3d"));
    assert.strictEqual(r.category, 8, "royal flush should be straight flush category");
  }
  {
    const r = evaluateBestHigh(cs("2h 2c 2d 2s 5h 6c 7d"));
    assert.strictEqual(r.category, 7, "quads");
    assert.strictEqual(r.ranks[0], 2);
    assert.strictEqual(r.ranks[1], 7);
  }
  {
    const a = evaluateBestHigh(cs("Kh Kc Kd 2s 2h 3c 4d"));
    assert.strictEqual(a.category, 6, "full house KKK22");
    assert.strictEqual(a.ranks[0], 13);
    assert.strictEqual(a.ranks[1], 2);
  }
  {
    // wheel straight
    const r = evaluateBestHigh(cs("Ah 2c 3d 4s 5h 9c 9d"));
    assert.strictEqual(r.category, 4, "wheel is a straight");
    assert.strictEqual(r.ranks[0], 5, "wheel straight high card is 5");
  }
  {
    // Hold'em classic: two pair vs set on board
    const r1 = evaluateBestHigh(cs("Ah Ad 5c 5d 9h 2c 3d")); // AA + 55 two pair
    assert.strictEqual(r1.category, 2);
  }

  // --- Ace-to-five low tests (Razz / Omaha Hi-Lo) ---
  {
    const wheel = evaluateBestAceToFiveLow(cs("Ah 2c 3d 4s 5h 9c 9d"));
    assert.ok(wheel);
    assert.strictEqual(wheel!.badness, 0);
    assert.deepStrictEqual(wheel!.ranks.slice(0, 5).sort((a, b) => a - b), [1, 2, 3, 4, 5], "wheel is the best possible low");
  }
  {
    // pair should be worse (higher badness) than any 5 unpaired low cards
    const paired = evaluateBestAceToFiveLow(cs("2h 2c 9d 8s 7h 6c 5d"));
    const unpaired = evaluateBestAceToFiveLow(cs("Th 9c 8d 7s 6h 3c 2d"));
    assert.ok(paired && unpaired);
    assert.ok(compareLowResults(unpaired!, paired!) < 0, "unpaired ten-high beats any paired low");
  }
  {
    // 8-or-better qualifier: only two cards <=8 among the seven -> no qualifying low exists
    const notQualifying = evaluateBestAceToFiveLow(cs("9h Tc Jd Qs Kh 8c 7d"), 8);
    assert.strictEqual(notQualifying, null, "only two cards <=8 means no 5-card combo can qualify for 8-or-better");
    const qualifying = evaluateBestAceToFiveLow(cs("8h 7c 6d 5s 4h 2c 3d"), 8);
    assert.ok(qualifying, "8-7-6-5-4 qualifies for 8-or-better");
  }

  // --- 2-7 lowball tests ---
  {
    const best = evaluateBest27Low(cs("7h 5c 4d 3s 2h Kc Qd"));
    assert.strictEqual(best.category, 0, "7-5-4-3-2 unsuited is no-pair (best possible 2-7 hand)");
    assert.strictEqual(best.ranks[0], 7);
  }
  {
    // Ace counts high in 2-7, so it's a liability, not a wheel; with two 9s in the
    // pool the engine should pick 9-5-4-3-2 (best-of-7) over any hand using the ace.
    const wheelIn27 = evaluateBest27Low(cs("Ah 2c 3d 4s 5h 9c 9d"));
    assert.strictEqual(wheelIn27.category, 0, "no pair");
    assert.strictEqual(wheelIn27.ranks[0], 9, "avoids the ace by using a 9 kicker instead");
  }
  {
    // With no better option, the ace does count as a bad high card (never plays low).
    const aceForced = evaluateBest27Low(cs("Ah 2c 3d 4s 5h 6c 6d"));
    assert.strictEqual(aceForced.ranks[0], 14, "ace must play high when no help avoids it");
  }

  console.log("evaluator.test.ts: all assertions passed");
}
