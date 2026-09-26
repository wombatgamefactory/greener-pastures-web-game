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
 *
 * ⭐ 25/09/2026 (UI polish WP4, items B14 and B15): A FIRST-RUN SCREEN, NOT A
 * FORM. The appraisal found a publisher opening the link met a "Seed" field and
 * bot "tastes" before anything told them what the game was. Now the screen asks
 * three things in plain words (how many players, your crop, how strong your
 * neighbours are), offers "How to play" one click from the hook, and folds the
 * seed and each neighbour's personality under "More options", with the guided
 * first turn as a checkbox there too. The card grows to at least 900px at the
 * 2400+ steps and its type grows with it (`onboarding.css`), and it still fits
 * the 1024x700 floor.
 */

import { useId, useState } from 'react';
import type { GameData, Suit } from '@gp/data';
import type { PolicyId } from '@gp/bots';

import { logoArt } from '../view/art';
import { SUIT_META } from '../view/suits';
import { data as sessionData } from '../session/table';
import type { SessionOptions } from '../session/table';
import { isFirstGame, startCoach } from './Coach';
import { HowToPlay } from './HowToPlay';

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
    blurb: 'Plays at random, but always delivers to the island when it can. A gentle first game.',
  },
  {
    id: 'balanced',
    label: 'Normal',
    blurb: 'Weighs up every move it could make and plays the best one.',
  },
];

const ARCHETYPES: readonly { id: PolicyId; label: string; blurb: string }[] = [
  { id: 'balanced', label: 'even-handed', blurb: 'no particular habits' },
  { id: 'socialite', label: 'a socialite', blurb: 'lives on your Notice Board' },
  { id: 'hermit', label: 'a hermit', blurb: 'never visits anybody' },
  { id: 'loyalist', label: 'a loyalist', blurb: 'builds their own crop and little else' },
  { id: 'racer', label: 'a racer', blurb: 'runs at the island' },
];

/** Suits for a table: yours first, then the rest in printed order. */
function suitsFor(yours: Suit, seats: number): Suit[] {
  return [yours, ...ALL_SUITS.filter((s) => s !== yours)].slice(0, seats);
}

/**
 * `data` defaults to the session's own game data, the same object `App.tsx`
 * plays with; it is a prop so a test (or a tuning overlay) can hand in another,
 * which is the rule every component follows (`boundary.test.ts`).
 */
export function Start({
  onStart,
  data = sessionData,
}: {
  onStart(options: SessionOptions): void;
  data?: GameData;
}) {
  const [seats, setSeats] = useState(3);
  const [more, setMore] = useState(false);
  const [help, setHelp] = useState(false);
  // The guided first turn: on for a browser that has never finished or skipped
  // it, and switchable under More options for anyone who wants it again.
  const [guide, setGuide] = useState(() => isFirstGame());
  const moreId = useId();
  const [suit, setSuit] = useState<Suit>('wheat');
  const [rung, setRung] = useState<PolicyId>('balanced');
  const [custom, setCustom] = useState<Record<number, PolicyId>>({});
  const [seed, setSeed] = useState('greener-pastures');

  const suits = suitsFor(suit, seats);
  const start = () => {
    const opponents: PolicyId[] = [];
    for (let s = 0; s < seats; s++) opponents.push(s === 0 ? rung : (custom[s] ?? rung));
    if (guide) startCoach(true);
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
          <button type="button" className="start-help" onClick={() => setHelp(true)}>
            <span aria-hidden="true">?</span> How to play
          </button>
          <p className="start-facts">You play against computer neighbours, 2 to 4 farms in all.</p>
        </div>

        <div className="start-form">
          <fieldset>
            <legend>Players</legend>
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
              Your neighbours will farm{' '}
              {suits
                .slice(1)
                .map((s) => SUIT_META[s].label)
                .join(' and ') || 'nothing yet'}
              .
            </p>
          </fieldset>

          <fieldset>
            <legend>Your neighbours play</legend>
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
          </fieldset>

          {/* ⭐ MORE OPTIONS (25/09/2026, B14c). The seed and each neighbour's
              personality are for a second game, not a first one, so they wait
              behind a disclosure. Collapsed, the fields are not rendered at
              all, so nothing hidden can take focus. */}
          <div className="start-more">
            <button
              type="button"
              className="start-more-toggle"
              aria-expanded={more}
              aria-controls={moreId}
              onClick={() => setMore(!more)}
            >
              <span className="start-more-caret" aria-hidden="true">
                {more ? '▾' : '▸'}
              </span>
              More options
            </button>
            {more && (
              <div className="start-more-body" id={moreId}>
                <fieldset>
                  <legend>Each neighbour&rsquo;s personality</legend>
                  <div className="start-archetypes">
                    {suits.slice(1).map((s, i) => {
                      const seat = i + 1;
                      return (
                        <label key={seat}>
                          <span style={{ color: SUIT_META[s].ink }}>
                            {SUIT_META[s].label} farm is
                          </span>
                          <select
                            value={custom[seat] ?? rung}
                            onChange={(e) =>
                              setCustom({ ...custom, [seat]: e.target.value as PolicyId })
                            }
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
                  <legend>Game number</legend>
                  <input
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                    aria-label="game number (seed)"
                  />
                  <p className="start-note">
                    The same game number with the same moves deals the same game, so two people can
                    compare notes on one deal.
                  </p>
                </fieldset>

                <label className="start-guide">
                  <input
                    type="checkbox"
                    checked={guide}
                    onChange={(e) => setGuide(e.target.checked)}
                  />
                  Guide me through my first turn
                </label>
              </div>
            )}
          </div>

          <button className="primary start-go" onClick={start}>
            Start the game
          </button>
        </div>
      </div>
      <HowToPlay data={data} open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
