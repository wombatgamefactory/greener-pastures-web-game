/**
 * Google Analytics, and the two questions it exists to answer: has anybody
 * played this, and for how long.
 *
 * The tag itself is injected into index.html by `vite.config.ts`, on a
 * production BUILD only and configured only off localhost, so the dev server,
 * the vitest jsdom runs and `verify:layout` against a local preview never
 * appear in the reports. It is the same GA4 property and the same CookieYes
 * consent banner as wombatgamefactory.com, so the game shows up beside the site
 * rather than in a second account.
 *
 * Every call below is a no-op when `window.gtag` is missing. Tag not injected,
 * consent declined, blocker installed and offline are all the same case here,
 * and none of them may break a game.
 *
 * GA4 counts sessions and engagement time on its own. What it cannot see is
 * whether the visitor got past the start screen, so that is what these two
 * events add: `game_start` when a table is dealt, `game_end` when one is
 * scored. The gap between them is the number worth having - the ratio says
 * whether people finish, and `duration_seconds` says what a real sitting costs.
 */

/** Only the shapes GA4 accepts as event parameters. */
type Params = Record<string, string | number | boolean>;

declare global {
  interface Window {
    gtag?: (command: 'event' | 'config' | 'js', target: string, params?: Params) => void;
  }
}

function track(event: string, params: Params): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', event, params);
}

/**
 * When the current game was dealt, or null if none was - which is also the
 * guard that keeps the query-string sessions out of the numbers. `?autostart`,
 * `?finish=1` and the rest never call `gameStarted`, so their walked-out
 * endings cannot report a `game_end` either, and a duration measured from a
 * table nobody dealt would be meaningless anyway.
 *
 * Module-level rather than a ref in App: it is one clock for one table, and the
 * pairing of the two events is this module's business, not the component's.
 */
let startedAt: number | null = null;

export interface StartFacts {
  readonly seats: number;
  /** The suit in your chair. Seat 0 is always the human. */
  readonly suit: string;
  readonly bots: string;
}

export function gameStarted(facts: StartFacts): void {
  startedAt = Date.now();
  track('game_start', { seats: facts.seats, suit: facts.suit, bots: facts.bots });
}

export interface EndFacts {
  readonly seats: number;
  readonly suit: string;
  /** Moves played, warm-up included. A coarse but honest length-of-game proxy. */
  readonly moves: number;
  /** 1 = you won. */
  readonly rank: number;
  readonly vp: number;
}

export function gameFinished(facts: EndFacts): void {
  if (startedAt === null) return;
  const duration = Math.round((Date.now() - startedAt) / 1000);
  startedAt = null;
  track('game_end', {
    seats: facts.seats,
    suit: facts.suit,
    moves: facts.moves,
    rank: facts.rank,
    vp: facts.vp,
    duration_seconds: duration,
  });
}
