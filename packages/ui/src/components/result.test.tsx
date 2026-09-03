/**
 * The end-game scoring screen, against games that really ended.
 *
 * The screen's claim is that every VP on it can be traced to something on the
 * table, so the test that earns its keep is the one that RE-DERIVES two of the
 * three sources from the `PlayerView` alone - receipts off the island tiles,
 * printed VP off the tableau - and checks them against the numbers the engine
 * actually scored the game with. A screen that quietly showed different numbers
 * from the ones that decided the result would be the worst failure this surface
 * has, and `agrees` is what makes that loud.
 *
 * The third source is deliberately not re-derived: end-game formulas run against
 * the true state (V21 counts barn colours, O21 counts rival hands), so the engine
 * reports them per card and the screen names them.
 *
 * ⛔ THE FOURTH SOURCE AND ITS WHOLE TEST SUITE ARE GONE (v31). Three of the
 * cases in this file were about the coin pity rate: the column when the knob was
 * on, the "leftover coins score nothing" note when it was off, and the Bread
 * Hall's replacement line. There is no currency and no knob, so none of the
 * three has anything to arrange for. What took their place is the FARMSTEAD,
 * which lands in the end-game section as five ordinary `gameEnd` handlers.
 *
 * Positions are searched rather than pinned, the same as the other UI tests: a
 * seed that happens to finish today is a fixture that rots the first time the
 * card data moves. Not every game ends - ticket 34's supply lock is a real
 * outcome - so the search takes the first few that do.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BASE_GAME_DATA as data } from '@gp/data';
import type { Suit } from '@gp/data';
import type { GameScore, PlayerView } from '@gp/engine';

import { Session } from '../session/table';
import { scoreReport, separatorOf, verdictLine } from '../view/scoring';
import type { Verdict } from '../view/scoring';
import { Result } from './Result';

interface Finished {
  readonly seed: string;
  readonly view: PlayerView;
  readonly score: GameScore;
}

const SUITS: Suit[] = ['wheat', 'vegetable', 'orchard', 'dairy'];

/**
 * Play whole games until `want` of them reach the end trigger. Every seat is
 * driven by a real bot including yours, because what is under test is the
 * scoring of a finished game, not anyone's line of play.
 */
function finishedGames(want: number, seats = 3): Finished[] {
  const out: Finished[] = [];
  for (let i = 0; i < 24 && out.length < want; i++) {
    const seed = `result-${seats}-${i}`;
    const session = new Session(data, {
      seats,
      suits: SUITS.slice(0, seats),
      seed,
      opponents: ['balanced', 'socialite', 'racer', 'loyalist'],
    });
    let snap = session.snapshot();
    for (let step = 0; step < 2400 && !snap.over; step++) {
      if (snap.yours) {
        const move = snap.moves[step % snap.moves.length];
        if (!move) break;
        session.send(move);
      } else if (!session.stepBot()) {
        break;
      }
      snap = session.snapshot();
    }
    if (snap.over && snap.score) out.push({ seed, view: snap.view, score: snap.score });
  }
  if (out.length === 0) throw new Error('no game reached the end trigger');
  return out;
}

const GAMES = finishedGames(3);

describe('the scoring breakdown traces back to the table', () => {
  for (const game of GAMES) {
    it(`re-derives every seat's score from the view alone (${game.seed})`, () => {
      const report = scoreReport(data, game.view, game.score);
      for (const seat of report.seats) {
        // Island and printed VP, recounted off the view.
        expect(seat.agrees, `${seat.name} in ${game.seed}`).toBe(true);
        // And the three sources add up to the total the game was decided on.
        const { receipts, printed, endgame, total } = seat.breakdown;
        expect(receipts + printed + endgame).toBe(total);
        // Every end-game card is named, so no VP arrives anonymously.
        expect(seat.endgame.reduce((sum, c) => sum + c.vp, 0)).toBe(endgame);
      }
    });
  }

  /**
   * ⭐ THE FARMSTEAD ARRIVES THROUGH THE EXISTING SEAM, which is the one thing
   * the v31 brief asks this screen to prove. All five print "Game end: 1 VP for
   * each CROP card you have built", so every seat has at least one line in the
   * end-game section and the card is NAMED there rather than turning up as an
   * unexplained lump in a total.
   */
  it('names every seat their Farmstead, in the end-game working', () => {
    for (const game of GAMES) {
      const report = scoreReport(data, game.view, game.score);
      for (const seat of report.seats) {
        const farmstead = seat.endgame.find((c) => /^(W2|V2|O2|A2|D2)$/.test(c.id));
        expect(farmstead, `${seat.name} in ${game.seed}`).toBeDefined();
        // Its printed formula travels with its number, so the number is
        // arguable rather than asserted.
        expect(farmstead!.text).toMatch(/^Game end: 1 VP for each /);
        expect(farmstead!.vp).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('ranks best first and agrees with the engine', () => {
    for (const game of GAMES) {
      const report = scoreReport(data, game.view, game.score);
      expect(report.seats.map((s) => s.seat)).toEqual(game.score.ranking);
      const totals = report.seats.map((s) => s.breakdown.total);
      expect([...totals].sort((a, b) => b - a)).toEqual(totals);
      expect(report.seats.map((s) => s.rank)).toEqual(report.seats.map((_, i) => i + 1));
    }
  });

  it('names the seat that triggered the end', () => {
    for (const game of GAMES) {
      const report = scoreReport(data, game.view, game.score);
      expect(report.verdict.trigger?.seat).toBe(game.view.endTrigger?.seat);
    }
  });

  /**
   * The dead-component number. A meeple is a stored action that leaves the game
   * when spent, so one still in a supply at the end was never used - and the
   * v31 plan asks for exactly that count. It is NOT a score, which is why it is
   * reported beside the table rather than in it.
   */
  it('counts the meeples that died unspent, without scoring them', () => {
    for (const game of GAMES) {
      const report = scoreReport(data, game.view, game.score);
      const perSeat = report.seats.reduce((sum, s) => sum + s.meeplesLeft, 0);
      expect(report.meeplesUnspent).toBe(perSeat);
      // Nobody's total moved because of them.
      for (const seat of report.seats) {
        const { receipts, printed, endgame, total } = seat.breakdown;
        expect(receipts + printed + endgame).toBe(total);
      }
    }
  });
});

describe('the tie-break is stated rather than assumed', () => {
  const at = (total: number, stock: number, receipts: number) => ({ total, stock, receipts });

  /**
   * ⭐ THE SECOND LINK CHANGED IN v31: it was coins remaining and it is now
   * cards in hand plus barn, which is the only stock a player still ends the
   * game holding. Deliberately NOT unspent meeples - paying VP for holding one
   * would reward not spending it, which is precisely the mistake the coin pity
   * rate was deleted for on 2026-08-03.
   */
  it('walks the chain and reports which link decided it', () => {
    expect(separatorOf(at(50, 3, 2), at(40, 9, 4))).toEqual({ separator: 'vp', margin: [50, 40] });
    expect(separatorOf(at(50, 9, 2), at(50, 3, 4))).toEqual({
      separator: 'stock',
      margin: [9, 3],
    });
    expect(separatorOf(at(50, 3, 4), at(50, 3, 2))).toEqual({
      separator: 'receipts',
      margin: [4, 2],
    });
    // The chain runs out at seat order, which is a thing to say out loud rather
    // than a silent fallback.
    expect(separatorOf(at(50, 3, 2), at(50, 3, 2))).toEqual({ separator: 'seat', margin: null });
  });

  it('says it in English, in every branch', () => {
    const base = scoreReport(data, GAMES[0]!.view, GAMES[0]!.score).verdict;
    const line = (v: Partial<Verdict>): string => verdictLine({ ...base, ...v } as Verdict);
    expect(line({ separator: 'vp', margin: [50, 38] })).toContain('wins by 12 VP');
    expect(line({ separator: 'stock', margin: [9, 3] })).toContain(
      'cards in hand and barn, 9 to 3',
    );
    expect(line({ separator: 'receipts', margin: [4, 2] })).toContain('receipts taken, 4 to 2');
    expect(line({ separator: 'seat', margin: null })).toContain('tie-break runs out');
    // No branch of the sentence mentions money.
    for (const sep of ['vp', 'stock', 'receipts', 'seat'] as const) {
      expect(line({ separator: sep, margin: [4, 2] })).not.toContain('£');
    }
  });
});

describe('the result screen renders', () => {
  it('shows the three sources, the winner and the end trigger', () => {
    const game = GAMES[0]!;
    const html = renderToStaticMarkup(
      <Result data={data} view={game.view} score={game.score} onAgain={() => {}} />,
    );
    expect(html).toContain('Island receipts');
    expect(html).toContain('VP printed on cards you built');
    expect(html).toContain('End-game cards');
    expect(html).toContain('island delivery, which ended the game');
    expect(html).toContain('Another game');
    // The design instrument: the island's share of the winning score, printed.
    expect(html).toContain('of the winning score');
    expect(html).not.toContain('is a bug in the breakdown');
  });

  /**
   * ⛔ NO CURRENCY ANYWHERE ON THE SCREEN. Both halves matter: the coin column
   * is gone, and so is the "leftover coins score nothing" note that replaced it
   * on 2026-08-03 - there is nothing to reassure anybody about, and a screen
   * that still mentioned coins would be teaching a rule the game does not have.
   */
  it('mentions no coin, no pity column and no leftover-coins note', () => {
    const game = GAMES[0]!;
    const html = renderToStaticMarkup(
      <Result data={data} view={game.view} score={game.score} onAgain={() => {}} />,
    );
    expect(html).not.toContain('coins ÷');
    expect(html).not.toContain('Leftover coins');
    expect(html).not.toContain('£');
  });

  /** The tie-break's stock and the dead-component count, both on the screen. */
  it('prints the cards held and whether any meeple died unspent', () => {
    const game = GAMES[0]!;
    const html = renderToStaticMarkup(
      <Result data={data} view={game.view} score={game.score} onAgain={() => {}} />,
    );
    expect(html).toContain('Held at the end');
    expect(html).toMatch(/meeple|None went to waste/);
  });

  it('raises the alarm when the working disagrees with the engine', () => {
    const game = GAMES[0]!;
    const first = game.score.ranking[0]!;
    const wrong: GameScore = {
      ...game.score,
      seats: game.score.seats.map((s, i) =>
        i === first ? { ...s, receipts: s.receipts + 5, total: s.total + 5 } : s,
      ),
    };
    const html = renderToStaticMarkup(
      <Result data={data} view={game.view} score={wrong} onAgain={() => {}} />,
    );
    expect(html).toContain('is a bug in the breakdown');
  });
});
