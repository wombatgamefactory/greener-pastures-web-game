/**
 * The new-game screen. It landed here because ticket 10 had nowhere else to put
 * it, and it carries two of that ticket's decisions.
 *
 * The ladder ships with TWO rungs, not three. `hard` exists in the roster as an
 * alias with no bot behind it until ticket 11 measures which weight profile
 * actually wins, and ticket 10's instruction was to hide the rung or point it
 * at `balanced` - never to invent a strength claim. Hidden is the honest
 * reading, and the archetypes below give the same variety without pretending to
 * be a difficulty.
 *
 * The archetypes ARE worth a name: they exist for the simulator regardless, so
 * offering them costs a label each, and in a game whose hook is that your
 * neighbours have farms you want to use, it matters that a neighbour has a
 * temperament. A hermit never visits and a socialite lives on your Notice
 * Board, and you can feel the difference from the first turn.
 */

import { useState } from 'react';
import type { Suit } from '@gp/data';
import type { PolicyId } from '@gp/bots';

import { logoArt } from '../view/art';
import { SUIT_META } from '../view/suits';
import type { SessionOptions } from '../session/table';

const ALL_SUITS: readonly Suit[] = ['wheat', 'vegetable', 'orchard', 'apiary', 'dairy'];

interface Rung {
  readonly id: PolicyId;
  readonly label: string;
  readonly blurb: string;
}

const LADDER: readonly Rung[] = [
  {
    id: 'pulse',
    label: 'Easy',
    blurb: 'Plays at random, but always delivers when it can. Weak, and it finishes games.',
  },
  {
    id: 'balanced',
    label: 'Normal',
    blurb: 'Scores every legal move and takes the best. The reference brain.',
  },
];

const ARCHETYPES: readonly { id: PolicyId; label: string; blurb: string }[] = [
  { id: 'balanced', label: 'even-handed', blurb: 'no strong taste' },
  { id: 'socialite', label: 'a socialite', blurb: 'lives on your Notice Board' },
  { id: 'hermit', label: 'a hermit', blurb: 'never visits anybody' },
  { id: 'loyalist', label: 'a loyalist', blurb: 'builds their own crop and little else' },
  { id: 'racer', label: 'a racer', blurb: 'runs at the island' },
];

/** Suits for a table: yours first, then the rest in printed order. */
function suitsFor(yours: Suit, seats: number): Suit[] {
  return [yours, ...ALL_SUITS.filter((s) => s !== yours)].slice(0, seats);
}

export function Start({ onStart }: { onStart(options: SessionOptions): void }) {
  const [seats, setSeats] = useState(3);
  const [suit, setSuit] = useState<Suit>('wheat');
  const [rung, setRung] = useState<PolicyId>('balanced');
  const [custom, setCustom] = useState<Record<number, PolicyId>>({});
  const [seed, setSeed] = useState('greener-pastures');

  const suits = suitsFor(suit, seats);
  const start = () => {
    const opponents: PolicyId[] = [];
    for (let s = 0; s < seats; s++) opponents.push(s === 0 ? rung : (custom[s] ?? rung));
    onStart({ seats, suits, seed, opponents });
  };

  return (
    <div className="start" style={{ ['--start-bg' as string]: `url(${logoArt()})` }}>
      <div className="start-card">
        {/* The cover carries the title as painted lettering, so the h1 stays for
            structure and screen readers and the art speaks for itself. */}
        <h1 className="visually-hidden">Greener Pastures</h1>

        <div className="start-hero">
          <img className="start-cover" src={logoArt()} alt="Greener Pastures" />
          <p className="start-hook">
            You cannot run your farm alone. Your neighbours power your engine, so the whole island
            competes to be the farm everyone needs.
          </p>
        </div>

        <div className="start-form">
          <fieldset>
            <legend>Farmers</legend>
            <div className="choices">
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  className={`choice${seats === n ? ' choice-on' : ''}`}
                  onClick={() => setSeats(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Your crop</legend>
            <div className="choices">
              {ALL_SUITS.map((s) => (
                <button
                  key={s}
                  className={`choice${suit === s ? ' choice-on' : ''}`}
                  style={{ ['--seat-pip' as string]: SUIT_META[s].pip }}
                  onClick={() => setSuit(s)}
                >
                  {SUIT_META[s].label}
                </button>
              ))}
            </div>
            <p className="start-note">
              Your neighbours take the remaining crops in printed order:{' '}
              {suits
                .slice(1)
                .map((s) => SUIT_META[s].label)
                .join(', ') || 'none yet'}
              .
            </p>
          </fieldset>

          <fieldset>
            <legend>Neighbours</legend>
            <div className="choices">
              {LADDER.map((r) => (
                <button
                  key={r.id}
                  className={`choice${rung === r.id ? ' choice-on' : ''}`}
                  title={r.blurb}
                  onClick={() => setRung(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="start-note">{LADDER.find((r) => r.id === rung)?.blurb}</p>

            <div className="start-archetypes">
              {suits.slice(1).map((s, i) => {
                const seat = i + 1;
                return (
                  <label key={seat}>
                    <span style={{ color: SUIT_META[s].ink }}>{SUIT_META[s].label} farm is</span>
                    <select
                      value={custom[seat] ?? rung}
                      onChange={(e) => setCustom({ ...custom, [seat]: e.target.value as PolicyId })}
                    >
                      {ARCHETYPES.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label} - {a.blurb}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend>Seed</legend>
            <input value={seed} onChange={(e) => setSeed(e.target.value)} aria-label="game seed" />
            <p className="start-note">
              The whole game is a function of this and the moves played, so the same seed deals the
              same island.
            </p>
          </fieldset>

          <button className="primary start-go" onClick={start}>
            Start the Game
          </button>
        </div>
      </div>
    </div>
  );
}
