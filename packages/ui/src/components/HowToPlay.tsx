/**
 * HOW TO PLAY (25/09/2026, UI polish WP4, item B14a).
 *
 * A first-time player, or a publisher opening the link cold, gets the whole
 * game in five short pages: the turn in three beats, the five Notice Board
 * powers, the five actions, the island and a delivery, and how the game ends
 * and scores. It is reachable in one click from the start screen, and it is
 * EXPORTED on its own so the turn bar can mount a "?" beside the exits later
 * without touching this file (`<HowToPlay data={data} open onClose={...} />`).
 *
 * ⭐ THE FIVE POWERS ARE READ OFF THE CARD DATA, never retyped here. Each suit's
 * Notice Board is a starter with the id `<letter>3` (W3, V3, O3, A3, D3), and
 * `printedFace` returns its printed `abilityText`, so a retext on the sheet
 * reaches this page with the next extract - the same rule `VisitPanel.tsx`
 * follows for the visit's own hint. What IS written here is the rules prose,
 * checked against Rule book v7 and CLAUDE.md §0 on 25/09/2026: the visit first,
 * one action, then an optional Worker; a delivery is 4 barn cards; the first to
 * an island card pays both tokens' demands and chooses, the second pays the
 * remaining token plus 2 of any crop; six receipts end the game and the round
 * is finished.
 *
 * ⛔ NOTHING RETIRED IS TAUGHT: no balloons, no Aerodrome, no Store coin, no
 * wild substitution, no 6 / 3 VP delivery spaces and no closing draw (all
 * deleted 16/09/2026). If a page here ever needs one of those words, the page
 * is wrong, not the rule.
 *
 * No link to the rule book PDF: nothing in the repository publishes it at a
 * public URL (checked 25/09/2026), and a link to a file on Dean's disk would be
 * dead for everyone else. Add one here when it is hosted.
 *
 * It is a real dialog: `role="dialog"`, `aria-modal`, focus moves in on open,
 * Tab is kept inside, Escape closes, and focus goes back to whatever opened it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { GameData, Suit } from '@gp/data';

import { useEscapeKey } from '../session/escape';
import { cropIcon, islandTileArt, islandTokenArt, token } from '../view/art';
import { printedFace } from '../view/printed';
import type { PrintedFace } from '../view/printed';
import { SUIT_META } from '../view/suits';
import { Card } from './Card';

/** The painted vignettes from the player aid's icon sheet (256px). */
function vignette(name: string): string {
  return `${import.meta.env.BASE_URL}art/icons/${name}.webp`;
}

/**
 * Each suit's plain action: the colour a Worker of that suit performs and the
 * verb its Notice Board amplifies (CLAUDE.md §2.2, the colour reference). A
 * rules fact rather than card text, so it is written here.
 */
const SUIT_ORDER: readonly { suit: Suit; letter: string; verb: string }[] = [
  { suit: 'orchard', letter: 'O', verb: 'Draw' },
  { suit: 'dairy', letter: 'D', verb: 'Build' },
  { suit: 'apiary', letter: 'A', verb: 'Grow' },
  { suit: 'wheat', letter: 'W', verb: 'Harvest' },
  { suit: 'vegetable', letter: 'V', verb: 'Deliver' },
];

/** A suit's Notice Board face, or null if a future extract renames the starter. */
function boardFace(data: GameData, letter: string): PrintedFace | null {
  try {
    return printedFace(data, `${letter}3`);
  } catch {
    return null;
  }
}

interface Page {
  readonly id: string;
  readonly title: string;
  readonly body: ReactNode;
}

function pages(data: GameData): Page[] {
  return [
    {
      id: 'turn',
      title: 'Your turn',
      body: (
        <>
          <p className="htp-lead">
            You cannot run your farm alone. Every turn has three beats, always in this order.
          </p>
          <ol className="htp-beats">
            <li>
              <img src={vignette('visit')} alt="" />
              <div>
                <h4>
                  <span className="htp-num">1</span> Visit a neighbour{' '}
                  <small>optional, first</small>
                </h4>
                <p>
                  Pay one card from your hand onto a <b>rival&rsquo;s</b> Notice Board and take its
                  power at once. Any card pays. It stays on their board, and when they harvest it,
                  it is theirs. Never your own board.
                </p>
              </div>
            </li>
            <li>
              <img src={vignette('draw')} alt="" />
              <div>
                <h4>
                  <span className="htp-num">2</span> Take one action <small>required</small>
                </h4>
                <p>Draw 2, Build, Grow, Harvest or Deliver to the island.</p>
              </div>
            </li>
            <li>
              <img className="htp-token" src={islandTokenArt('wheat', 4)} alt="" />
              <div>
                <h4>
                  <span className="htp-num">3</span> Spend a Worker <small>optional, after</small>
                </h4>
                <p>
                  If you hold a Worker, spend one for the plain action of its colour. Then it leaves
                  the game. One per turn.
                </p>
              </div>
            </li>
          </ol>
          <p className="htp-note">
            At two players each farm lays out a second Notice Board, so you always have two boards
            to choose from. There is no hand limit.
          </p>
        </>
      ),
    },
    {
      id: 'boards',
      title: 'The five Notice Boards',
      body: (
        <>
          <p className="htp-lead">
            Each farm grows one crop and owns that crop&rsquo;s Notice Board. Its power is a bigger
            version of the crop&rsquo;s plain action, so you can guess it from the colour.
          </p>
          <ul className="htp-boards">
            {SUIT_ORDER.map(({ suit, letter, verb }) => {
              const face = boardFace(data, letter);
              const meta = SUIT_META[suit];
              return (
                <li key={suit} style={{ ['--htp-suit' as string]: meta.pip }}>
                  {face && <Card face={face} width={132} />}
                  <div>
                    <h4>
                      <img src={cropIcon(suit)} alt="" />
                      {meta.label}
                      <span className="htp-verb">{verb}</span>
                    </h4>
                    <p>{face ? face.abilityText : verb}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="htp-note">
            A board shows <b>3+</b>: its owner may harvest it once 3 or more cards are on it, and
            there is no maximum. You may only visit a board whose power you can use right now.
          </p>
        </>
      ),
    },
    {
      id: 'actions',
      title: 'The five actions',
      body: (
        <>
          <p className="htp-lead">Take exactly one each turn, after your visit.</p>
          <ul className="htp-actions">
            <li>
              <img src={vignette('draw')} alt="" />
              <h4>Draw</h4>
              <p>Draw 2 cards, one at a time, from any decks in play. Keep both.</p>
            </li>
            <li>
              <img src={vignette('build')} alt="" />
              <h4>Build</h4>
              <p>
                Put a card from your hand into your farm, paying its cost with other cards from your
                hand.
              </p>
            </li>
            <li>
              <img src={vignette('grow')} alt="" />
              <h4>Grow</h4>
              <p>
                Pay 1 matching card onto one of your buildings that is not full, and use its
                ability.
              </p>
            </li>
            <li>
              <img src={vignette('harvest')} alt="" />
              <h4>Harvest</h4>
              <p>Move all the cards on one of your full buildings into your barn.</p>
            </li>
            <li>
              <img src={vignette('deliver')} alt="" />
              <h4>Deliver</h4>
              <p>Pay 4 cards from your barn to an island card and take a token.</p>
            </li>
          </ul>
          <p className="htp-note">
            A building is full when its stack reaches its number, and a full building takes no more
            cards until you harvest it. Your barn is what pays the island.
          </p>
        </>
      ),
    },
    {
      id: 'island',
      title: 'The island',
      body: (
        <>
          <div className="htp-island">
            <img className="htp-island-art" src={islandTileArt('a1')} alt="" />
            <div className="htp-tokens">
              <img src={islandTokenArt('orchard', 6)} alt="an orchard token worth 6 VP" />
              <img
                src={islandTokenArt('wild', 4)}
                alt="a wild token worth 4 VP, carrying a Worker"
              />
            </div>
          </div>
          <p className="htp-lead">
            Every island card holds <b>two tokens</b>. Each asks for 2 cards (a pair of one crop, or
            any 2 on a wild token) and is worth 3 to 6 VP.
          </p>
          <ul className="htp-steps">
            <li>
              A delivery is always <b>4 cards from your barn</b>.
            </li>
            <li>
              <b>First to an island card:</b> pay both tokens&rsquo; demands, then choose which
              token to take.
            </li>
            <li>
              <b>Second:</b> pay the demand of the token that is left, plus 2 cards of any crop.
            </li>
            <li>
              The token is your <b>receipt</b>: it goes on your Farmstead. Tokens worth 3 and 4 VP
              carry a Worker, and you take it too.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: 'end',
      title: 'End and scoring',
      body: (
        <>
          <div className="htp-end">
            <img src={token('receipt')} alt="" />
            <p className="htp-lead">
              When a player places their <b>sixth receipt</b> and fills their Farmstead, the round
              is finished and the game ends.
            </p>
          </div>
          <ol className="htp-score">
            <li>
              <b>Island receipts:</b> the VP on every token you took.
            </li>
            <li>
              <b>Printed VP:</b> on every card you built.
            </li>
            <li>
              <b>End-game cards:</b> each one you built scores as it says, and so does your
              Barn&rsquo;s own scorer, 1 VP for each card of your crop you built.
            </li>
          </ol>
          <p className="htp-note">
            Workers and the cards in your hand score nothing. A tie goes to the player with the most
            cards in hand and barn.
          </p>
        </>
      ),
    },
  ];
}

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function HowToPlay({
  data,
  open,
  onClose,
}: {
  data: GameData;
  open: boolean;
  onClose(): void;
}) {
  const [at, setAt] = useState(0);
  const panel = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);

  // Focus in on open, and back to the opener on close. Captured at open time,
  // because by the time the effect's cleanup runs the opener is still the
  // element that was focused when the dialog appeared.
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    setAt(0);
    const first = panel.current?.querySelector<HTMLElement>('.htp-close');
    first?.focus();
    return () => {
      const back = opener.current;
      if (back instanceof HTMLElement) back.focus();
    };
  }, [open]);

  // 25/09/2026 (WP5 item 3): Escape used to be answered right here, in the
  // React `onKeyDown` below - a BUBBLE-phase handler that React attaches at
  // the document root. It never fired in the deployed build once CookieYes's
  // own capture-phase `document` listener started calling `stopPropagation()`
  // on a real Escape (`session/escape.ts`'s header has the full story): the
  // event never got past capture to reach a bubble handler at all, on THIS
  // dialog exactly as on `TurnSummary`'s old `window` listener. `useEscapeKey`
  // wins the race outright instead of relying on bubbling.
  useEscapeKey(onClose, open);

  const onKey = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') setAt((i) => Math.min(i + 1, 4));
    if (e.key === 'ArrowLeft') setAt((i) => Math.max(i - 1, 0));
    if (e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) return null;
  const all = pages(data);
  const page = all[at] ?? all[0]!;

  return (
    <div
      className="overlay htp-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className="htp"
        role="dialog"
        aria-modal="true"
        aria-labelledby="htp-title"
        onKeyDown={onKey}
      >
        <header className="htp-head">
          <h2 id="htp-title">How to play</h2>
          <button type="button" className="htp-close" onClick={onClose}>
            Close
          </button>
        </header>

        <nav className="htp-nav" aria-label="How to play pages">
          {all.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={`htp-tab${i === at ? ' htp-tab-on' : ''}`}
              aria-current={i === at ? 'step' : undefined}
              onClick={() => setAt(i)}
            >
              <span className="htp-tab-num">{i + 1}</span>
              {p.title}
            </button>
          ))}
        </nav>

        <section className="htp-page" aria-labelledby={`htp-${page.id}`}>
          <h3 id={`htp-${page.id}`}>{page.title}</h3>
          {page.body}
        </section>

        <footer className="htp-foot">
          <button
            type="button"
            className="htp-back"
            disabled={at === 0}
            onClick={() => setAt(at - 1)}
          >
            Back
          </button>
          <span className="htp-count">
            {at + 1} of {all.length}
          </span>
          {at < all.length - 1 ? (
            <button type="button" className="primary htp-next" onClick={() => setAt(at + 1)}>
              Next: {all[at + 1]!.title}
            </button>
          ) : (
            <button type="button" className="primary htp-next" onClick={onClose}>
              Got it
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
