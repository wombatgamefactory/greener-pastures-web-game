/**
 * The end-game scoring screen, against games that really ended.
 *
 * The screen's claim is that every VP on it can be traced to something on the
 * table, so the test that earns its keep is the one that RE-DERIVES three of the
 * four sources from the `PlayerView` alone - receipts off the island tiles,
 * printed VP off the tableau, pity off the coins - and checks them against the
 * numbers the engine actually scored the game with. A screen that quietly showed
 * different numbers from the ones that decided the result would be the worst
 * failure this surface has, and `agrees` is what makes that loud.
 *
 * The fourth source is deliberately not re-derived: end-game formulas run
 * against the true state (V21 counts barn colours, O21 counts rival hands), so
 * the engine reports them per card and the screen names them.
 *
 * Positions are searched rather than pinned, the same as the other UI tests: a
 * seed that happens to finish today is a fixture that rots the first time the
 * card data moves. Not every game ends - ticket 34's supply lock is a real
 * outcome - so the search takes the first few that do.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BASE_GAME_DATA as data } from '@gp/data';
import { cloneData } from '@gp/data';
import type { GameData, Suit } from '@gp/data';
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
        // Island, printed VP and coin pity, recounted off the view.
        expect(seat.agrees, `${seat.name} in ${game.seed}`).toBe(true);
        // And the four sources add up to the total the game was decided on.
        const { receipts, printed, endgame, coinPity, total } = seat.breakdown;
        expect(receipts + printed + endgame + coinPity).toBe(total);
        // Every end-game card is named, so no VP arrives anonymously.
        expect(seat.endgame.reduce((sum, c) => sum + c.vp, 0)).toBe(endgame);
      }
    });
  }

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
});

describe('the tie-break is stated rather than assumed', () => {
  const at = (total: number, coins: number, receipts: number) => ({ total, coins, receipts });

  it('walks DL-16 chain and reports which link decided it', () => {
    expect(separatorOf(at(50, 3, 2), at(40, 9, 4))).toEqual({ separator: 'vp', margin: [50, 40] });
    expect(separatorOf(at(50, 9, 2), at(50, 3, 4))).toEqual({
      separator: 'coins',
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
    expect(line({ separator: 'coins', margin: [9, 3] })).toContain('ahead on coins, £9 to £3');
    expect(line({ separator: 'receipts', margin: [4, 2] })).toContain('receipts taken, 4 to 2');
    expect(line({ separator: 'seat', margin: null })).toContain('tie-break runs out');
  });
});

/**
 * The live rule is `coinPityDivisor: null` (ticket 37 - coins score nothing).
 * The knob survives, so both branches of the screen still need covering, and
 * the pity-ON branch is now the one that has to be arranged for.
 */
function pityOn(): GameData {
  const on = cloneData(data) as { rules: { economy: { coinPityDivisor: number | null } } };
  on.rules.economy.coinPityDivisor = 5;
  return on as unknown as GameData;
}

describe('the result screen renders', () => {
  it('shows the four sources, the winner and the end trigger', () => {
    const game = GAMES[0]!;
    const html = renderToStaticMarkup(
      <Result data={data} view={game.view} score={game.score} onAgain={() => {}} />,
    );
    expect(html).toContain('Island receipts');
    expect(html).toContain('VP printed on cards you built');
    expect(html).toContain('End-game cards');
    // Ticket 37 deleted the pity, so coins are no longer a VP source. The
    // screen still has to SAY so - a seat holding £40 that scores nothing for
    // it reads as a bug unless the screen names the rule.
    expect(html).not.toContain('coins ÷');
    expect(html).toContain('Leftover coins score nothing');
    expect(html).toContain('delivered to Level 3');
    expect(html).toContain('Another game');
    // The design instrument: the island's share of the winning score, printed.
    expect(html).toContain('of the winning score');
    expect(html).not.toContain('is a bug in the breakdown');
  });

  /**
   * The mirror of the case above, and it is the one that now needs arranging:
   * ticket 37 set `coinPityDivisor` to null, so the live rule renders no coin
   * column at all. The knob survives, so the column has to keep working if the
   * pity is ever switched back on - which is also what a sweep would render.
   */
  it('shows the coin column when the pity rule is switched back on', () => {
    const game = GAMES[0]!;
    const withPity = pityOn();
    // The engine scored this game with the rule OFF, so the pity lines have to
    // go back on, or the screen is right to complain it cannot reconcile them.
    const coinsOf = (seat: number): number =>
      seat === game.view.seat
        ? game.view.you.coins
        : (game.view.rivals.find((r) => r.seat === seat)?.coins ?? 0);
    const scored: GameScore = {
      ...game.score,
      seats: game.score.seats.map((s, seat) => {
        const pity = s.coinPityReplacedBy === null ? Math.floor(coinsOf(seat) / 5) : 0;
        return { ...s, coinPity: pity, total: s.total + pity };
      }),
    };

    const report = scoreReport(withPity, game.view, scored);
    expect(report.pityDivisor).toBe(5);
    for (const seat of report.seats) {
      expect(seat.agrees).toBe(true);
    }

    const html = renderToStaticMarkup(
      <Result data={withPity} view={game.view} score={scored} onAgain={() => {}} />,
    );
    expect(html).toContain('coins ÷');
    expect(html).not.toContain('Leftover coins score nothing');
    expect(html).not.toContain('is a bug in the breakdown');
  });

  /**
   * The Bread Hall replaces its holder's coin pity, so their coin line is 0 and
   * their coins were scored on the card instead. Left unsaid, the screen shows a
   * seat with £40 scoring nothing for them, which reads as a bug.
   *
   * With the pity now off there is no coin line to replace and nothing to
   * explain, so the note belongs to the pity-ON branch. Both are asserted here:
   * the note appears when the knob is on, and does NOT appear under the live
   * rule, where the card is simply an end-game card like any other.
   */
  it('says so when a card replaced the coin pity', () => {
    const game = GAMES[0]!;
    const first = game.score.ranking[0]!;
    const coins =
      first === game.view.seat
        ? game.view.you.coins
        : (game.view.rivals.find((r) => r.seat === first)?.coins ?? 0);
    const rate = Math.floor(coins / 2);
    const withBreadHall: GameScore = {
      ...game.score,
      seats: game.score.seats.map((s, i) =>
        i === first
          ? {
              ...s,
              coinPity: 0,
              endgame: s.endgame + rate,
              total: s.total - s.coinPity + rate,
              coinPityReplacedBy: 'W21',
              endgameCards: [...s.endgameCards, { card: 'W21', vp: rate }],
            }
          : s,
      ),
    };
    const withPity = pityOn();
    // Every other seat keeps a real pity line, so the holder's zero is a
    // deliberate replacement rather than the rule simply being off.
    const scored: GameScore = {
      ...withBreadHall,
      seats: withBreadHall.seats.map((s, seat) => {
        if (s.coinPityReplacedBy !== null) return s;
        const c =
          seat === game.view.seat
            ? game.view.you.coins
            : (game.view.rivals.find((r) => r.seat === seat)?.coins ?? 0);
        const pity = Math.floor(c / 5);
        return { ...s, coinPity: pity, total: s.total + pity };
      }),
    };
    const report = scoreReport(withPity, game.view, scored);
    const holder = report.seats.find((s) => s.seat === first)!;
    expect(holder.pity?.vp).toBe(0);
    expect(holder.pity?.replacedBy).toBe('The Bread Hall');
    expect(holder.agrees).toBe(true);

    const html = renderToStaticMarkup(
      <Result data={withPity} view={game.view} score={scored} onAgain={() => {}} />,
    );
    expect(html).toContain('scored above by The Bread Hall');
    expect(html).not.toContain('is a bug in the breakdown');

    // Under the live rule there is no pity line at all, so nothing to explain.
    const live = renderToStaticMarkup(
      <Result data={data} view={game.view} score={withBreadHall} onAgain={() => {}} />,
    );
    expect(live).not.toContain('scored above by The Bread Hall');
    expect(live).toContain('Leftover coins score nothing');
    expect(live).not.toContain('is a bug in the breakdown');
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
