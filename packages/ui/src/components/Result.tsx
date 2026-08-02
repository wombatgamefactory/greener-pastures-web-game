/**
 * The end of the game, stated plainly.
 *
 * Deliberately thin: [27 - The end-game scoring screen] owns the real one, and
 * building a good version here would be the same work twice. What this has to
 * do is close the loop - a game that reaches the Level 3 trigger must be able
 * to finish and say who won - so it prints the four VP sources the scoring
 * architecture locks and offers another game.
 */

import type { GameData } from '@gp/data';
import type { GameScore, PlayerView } from '@gp/engine';

import { seatName } from '../view/suits';
import { seatSuits } from '../view/table';

export function Result({
  data,
  view,
  score,
  onAgain,
}: {
  data: GameData;
  view: PlayerView;
  score: GameScore;
  onAgain(): void;
}) {
  const suits = seatSuits(view);
  const pity = data.rules.economy.coinPityDivisor;

  return (
    <div className="overlay" role="dialog" aria-label="final scores">
      <div className="inspector result">
        <h2>
          {seatName(suits[score.ranking[0] ?? 0], score.ranking[0] ?? 0, view.seat)} wins the island
        </h2>
        <table className="result-table">
          <thead>
            <tr>
              <th>farm</th>
              <th>island</th>
              <th>built</th>
              <th>end-game cards</th>
              {pity !== null && <th>coins ÷ {pity}</th>}
              <th>total</th>
            </tr>
          </thead>
          <tbody>
            {score.ranking.map((seat) => {
              const row = score.seats[seat];
              if (!row) return null;
              return (
                <tr key={seat} className={seat === view.seat ? 'result-you' : undefined}>
                  <td>{seatName(suits[seat], seat, view.seat)}</td>
                  <td>{row.receipts}</td>
                  <td>{row.printed}</td>
                  <td>{row.endgame}</td>
                  {pity !== null && <td>{row.coinPity}</td>}
                  <td>
                    <b>{row.total}</b>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="start-note">
          Ties break on coins, then on how many receipts were taken. A full scoring screen is still
          to come.
        </p>
        <button className="primary" onClick={onAgain}>
          Another game
        </button>
      </div>
    </div>
  );
}
