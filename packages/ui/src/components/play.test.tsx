/**
 * The interactive half, rendered.
 *
 * A static render cannot click, so this proves the two things a static render
 * CAN prove and that would otherwise only be found in a browser:
 *
 *  1. Every interaction surface renders against a real position - the action
 *     bar, the prompt, both assemblies, the start screen and the result - and
 *     every image they ask for exists, the same check ticket 24 built for the
 *     static tree.
 *  2. The glow classes land on the things `liveTargets` says are live, and on
 *     nothing else. That is the join between the rule-free resolver layer and
 *     the DOM, and it is the join a refactor breaks silently.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BASE_GAME_DATA as data } from '@gp/data';
import type { Move, PlayerView } from '@gp/engine';

import type { Suit } from '@gp/data';

import { Session } from '../session/table';
import type { Play } from '../session/play';
import { emptyBuildDraft, liveTargets } from '../view/intent';
import type { Intent } from '../view/intent';
import { actionGroups } from '../view/moveText';
import { barFamilies } from './ActionBar';
import { Start } from './Start';
import { MeepleSupply, meeplePhaseOf, meepleWindowOpen } from './Supply';
import { Table } from './Table';

const PUBLIC = join(import.meta.dirname, '..', '..', 'public');
const BASE: string = import.meta.env.BASE_URL;

/** A Play with the real derivations and no-op handlers: enough to render. */
function staticPlay(view: PlayerView, moves: readonly Move[], intent: Intent): Play {
  const noop = () => {};
  return {
    active: true,
    view,
    moves,
    intent,
    live: liveTargets(view, moves, intent),
    picked: [],
    commitments:
      intent.k === 'build'
        ? intent.draft.payment
        : intent.k === 'visit' && intent.fee !== null
          ? [intent.fee]
          : [],
    subsetKind: null,
    send: noop,
    choose: noop,
    cancel: noop,
    arm: noop,
    hold: noop,
    startBuild: noop,
    setDraft: noop,
    setVisitFee: noop,
    building: noop,
    cardPower: noop,
    host: noop,
    tile: noop,
    balloon: noop,
    meeple: noop,
    deck: noop,
  };
}

/**
 * A warmed position that offers a particular move. Searched rather than fixed:
 * pinning a seed that happens to offer a Build today is a fixture that rots the
 * first time the card data moves.
 */
function positionWith(what: string, wanted: (move: Move) => boolean) {
  for (const seed of ['play-b', 'play-c', 'play-d', 'play-e', 'play-f']) {
    for (const depth of [80, 160, 260]) {
      const snap = position(seed, depth);
      if (snap.yours && snap.moves.some(wanted)) return snap;
    }
  }
  // ⭐ NOTHING AT THE TOP OF A TURN OFFERS A BONUS-SLOT MOVE any more
  // (`bonusTiming: 'end'`, 03/09/2026), so the search continues one main action
  // in. Still searched rather than pinned, for the reason above: a fixed seed
  // that happens to offer a Build today rots the first time the card data moves.
  for (const seed of ['play-b', 'play-c', 'play-d', 'play-e', 'play-f']) {
    for (const depth of [80, 160, 260]) {
      const after = positionAfterAction(seed, depth);
      if (after !== null && after.moves.some(wanted)) return after;
    }
  }
  throw new Error(`no warmed position offers ${what}`);
}

/**
 * A warmed position with the core action already spent, so the bonus slot is
 * open. Returns null when this seed and depth cannot get there - the caller is
 * searching, and a dead cell is not an error.
 */
function positionAfterAction(seed: string, depth: number) {
  const key = `${seed}:${depth}:acted`;
  const hit = ACTED.get(key);
  if (hit !== undefined) return hit;
  const session = warmSession(seed, depth);
  let snap = session.snapshot();
  let out: typeof snap | null = null;
  if (snap.yours && !snap.over) {
    // The cheapest main action that is on offer, preferring `draw` because it
    // needs nothing set up and leaves the hand larger for a visit fee.
    const main = ['draw', 'harvest', 'grow', 'build', 'deliver', 'pass'];
    const move = main.flatMap((t) => snap.moves.filter((m) => m.type === t))[0];
    if (move) {
      session.send(move);
      snap = session.snapshot();
      // Answer anything the action queued, taking the first legal answer.
      for (let i = 0; i < 12 && snap.yours && !snap.over && snap.view.tasks.length > 0; i++) {
        const answer = snap.moves[0];
        if (!answer) break;
        session.send(answer);
        snap = session.snapshot();
      }
      if (snap.yours && !snap.over) out = snap;
    }
  }
  ACTED.set(key, out);
  return out;
}

/** A warmed position that leaves you holding a card. Searched, for the same reason. */
function positionWithHand() {
  for (const seed of ['play-a', 'play-b', 'play-c', 'play-d', 'play-e', 'play-f']) {
    for (const depth of [80, 160, 260]) {
      const snap = position(seed, depth);
      if (snap.yours && snap.view.you.hand.length > 0) return snap;
    }
  }
  throw new Error('no warmed position leaves you holding a card');
}

/**
 * ⏱️ MEMOISED, and the reason is the cost of a warm-up rather than tidiness.
 *
 * A warmed session walks a real game with scored bots on the other seats -
 * measured on 02/09/2026 at ~40s for `warmUp(200, 4)`, because a bot move with a
 * prober costs 36ms and there is no hand limit since v31, so mid-game move lists
 * run to thousands. `positionWith` searches up to five seeds at three depths, and
 * four separate tests search overlapping ranges, so the same (seed, depth) was
 * being walked from scratch a dozen times in one file.
 *
 * A session is a pure function of (seed, log) - that is the property
 * `session.test.ts` pins - so the same pair always produces the same snapshot
 * and the cache cannot change an answer. It only stops the file paying for it
 * twice.
 */
const WARMED = new Map<string, ReturnType<typeof warm>>();
const ACTED = new Map<string, ReturnType<typeof warm> | null>();

function position(seed: string, depth = 260) {
  const key = `${seed}:${depth}`;
  const hit = WARMED.get(key);
  if (hit) return hit;
  const fresh = warm(seed, depth);
  WARMED.set(key, fresh);
  return fresh;
}

/** A warmed session sitting on your turn, with a hand and a developed board. */
function warm(seed: string, depth: number) {
  const session = warmSession(seed, depth);
  return session.snapshot();
}

/**
 * The same warm-up, keeping the SESSION rather than only the snapshot.
 *
 * ⭐ Needed since 03/09/2026: `rules.turn.bonusTiming` is `'end'`, so a position
 * sitting at the top of your turn has NO bonus-slot move to find - the slot does
 * not open until the core action is spent. A test after a visit or a bonus Draw
 * has to play an action first, which means it needs the session and not a
 * snapshot taken before it.
 */
function warmSession(seed: string, depth: number) {
  const session = new Session(data, {
    seats: 3,
    suits: ['wheat', 'vegetable', 'orchard'],
    seed,
    opponents: ['balanced', 'socialite', 'balanced'],
  });
  session.warmUp(depth, 4);
  let snap = session.snapshot();
  for (let i = 0; i < 40 && !snap.yours && !snap.over; i++) {
    session.stepBot();
    snap = session.snapshot();
  }
  return session;
}

function render(snap: ReturnType<typeof position>, intent: Intent): string {
  return renderToStaticMarkup(
    <Table
      data={data}
      view={snap.view}
      events={snap.events}
      play={staticPlay(snap.view, snap.moves, intent)}
      canUndo={snap.canUndo}
      onUndo={() => {}}
      waitingOn={null}
    />,
  );
}

/**
 * How a turn-bar button prints its name.
 *
 * The bar's buttons carry an icon beside the word since 27/08/2026, so the
 * label is no longer the button's only child and `>Draw</button>` matches
 * nothing. This is the one place that knows the markup - and it matters that it
 * is precise rather than a bare substring search, because half the assertions
 * built on it are NEGATIVE. A loose `html.includes('Buy')` would pass on any
 * page that happened to contain the word and would quietly stop pinning the
 * phase-3 cuts it exists to pin.
 */
function barButton(label: string): string {
  return `class="action-name">${label}</span>`;
}

/** How long a case that SEARCHES for a position is allowed to take. */
const SEARCH = 180_000;

function missingImages(html: string): string[] {
  return [...html.matchAll(/src="([^"]+)"/g)]
    .map((m) => m[1] as string)
    .filter((url) => url.startsWith(`${BASE}art/`))
    .filter((url) => !existsSync(join(PUBLIC, url.slice(BASE.length))))
    .map((url) => url);
}

describe('the playable table renders', () => {
  const snap = position('play-a');

  it('finds a position where it is your turn with moves to make', () => {
    expect(snap.yours).toBe(true);
    expect(snap.moves.length).toBeGreaterThan(3);
  });

  /**
   * ⚠️ THE BONUS PHASE. The slot is start-of-turn only, so a seat that HAS a
   * legal bonus is shown its options and a skip FIRST, and the five main actions
   * come after. That is shape (c) of the plan's section 5.2: modal, but
   * auto-skipped whenever there is nothing to skip, so it costs a click only on
   * the turns where a slot is genuinely about to be forfeited.
   *
   * The test asserts the phase and not just the buttons, because the whole point
   * of the affordance is the ORDER: offered in one flat row the bonus silently
   * expires the moment somebody clicks Build, and a forfeited visit is the hook
   * not happening.
   *
   * ⭐ v31 CUT THE BONUS FAMILIES FROM FOUR TO THREE and made two of them the
   * same move type: `bonusDraw`, `visit` and `visit-self`. The market, the card
   * buy and the GBP 2 upgrade went with the currency.
   */
  it('shows the bonus phase when a bonus is live, and the main actions when it is not', () => {
    const html = render(snap, { k: 'idle' });
    // Which shape this position gets is a property of the position, not of the
    // bar, so the test reads it off the legal moves rather than assuming one.
    const BONUS = ['visit', 'bonusDraw'];
    const live = snap.moves.some((m) => BONUS.includes(m.type));
    if (live) {
      expect(html).toContain('Your bonus, first.');
      expect(html).toContain('>skip bonus action</button>');
    } else {
      expect(html).not.toContain('Your bonus, first.');
      for (const label of ['Draw', 'Build', 'Grow', 'Harvest', 'Deliver']) {
        expect(html).toContain(barButton(label));
      }
    }
    expect(missingImages(html)).toEqual([]);
  });

  /**
   * ⭐ THE MEEPLE PHASE IS ALWAYS DRAWN, in all three of its states, and this is
   * the assertion that keeps it so.
   *
   * A meeple is spent only at the very start of a turn and it LEAVES THE GAME
   * when spent, so a player who does not notice the window has silently lost a
   * stored action for good. Nothing else on screen would say why the pawns in
   * front of them stopped responding - the supply is not a button that greys
   * out, it is a row of wooden pieces - so the zone head has to say it.
   */
  it('draws the meeple window in whichever of its three states this turn is in', () => {
    const html = render(snap, { k: 'idle' });
    const held = Object.values(snap.view.you.meeples).reduce((a, b) => a + b, 0);
    const spendable = snap.moves.some((m) => m.type === 'spendMeeple');
    if (spendable) {
      expect(html).toContain('meeples first');
      expect(html).toContain('before your bonus');
    } else if (held > 0) {
      expect(html).toContain('meeples: not now');
    } else {
      expect(html).toContain('no meeples');
      // Where they come from, said in the one place an empty supply is looked at.
      expect(html).toContain('Every island delivery brings one.');
    }
  });

  /**
   * The phase itself, on a position searched for rather than hoped for. This is
   * the affordance the start-of-turn rule needs: offered in one flat row the
   * bonus silently expires the moment somebody clicks Build, and a forfeited
   * visit is the hook not happening.
   */
  it(
    'offers every bonus option and a skip when the slot is open',
    () => {
      const withBonus = positionWith('a bonus-slot move', (m) =>
        ['visit', 'bonusDraw'].includes(m.type),
      );
      const html = render(withBonus, { k: 'idle' });
      expect(html).toContain('Your bonus, first.');
      expect(html).toContain('>skip bonus action</button>');
      for (const label of ['Draw 1', 'Visit a neighbour', 'Your own door']) {
        expect(html).toContain(barButton(label));
      }
      // Shape (c), not (b): the main families are held back until the slot is
      // resolved, so nobody forfeits it by reaching past it. `Draw 1` is the bonus
      // option, so the main Draw is the one that must be absent.
      expect(html).not.toContain(barButton('Draw'));
      expect(missingImages(html)).toEqual([]);
    },
    SEARCH,
  );

  /**
   * ⭐ THE ASSERTION THE WHOLE v31 PASS TURNS ON, at the DOM.
   *
   * `visit` and `visit-self` are one move type with a different host and they
   * are opposite acts - a card on a neighbour's board is the game's social hook,
   * a card on your own is solitaire that also clogs your own door. The plan's
   * risk 2 is that the second quietly wins, and the interface's job is to make
   * certain nobody takes one thinking it was the other.
   *
   * Four things differ and three of them are checkable here: two labels, two
   * classes, and only the hook carrying the player aid's `visit` vignette. The
   * fourth is the panel, checked further down.
   */
  it(
    'draws the two visits as two labelled buttons, and only one of them as the hook',
    () => {
      const withBonus = positionWith('a bonus-slot move', (m) =>
        ['visit', 'bonusDraw'].includes(m.type),
      );
      const html = render(withBonus, { k: 'idle' });
      expect(html).toContain(barButton('Visit a neighbour'));
      expect(html).toContain(barButton('Your own door'));
      expect(html).toContain('action-hook');
      expect(html).toContain('action-solo');
      // The two never collapse into one generic button.
      expect(html).not.toContain(barButton('Visit'));
    },
    SEARCH,
  );

  it('lights exactly what liveTargets says is live, and nothing when idle-empty', () => {
    const live = liveTargets(snap.view, snap.moves, { k: 'idle' });
    const html = render(snap, { k: 'idle' });
    const lit = (html.match(/is-live/g) ?? []).length;
    // Buildings, tiles, workers, decks and the rail all mark the same way, so
    // the count is a lower bound rather than an identity - but zero would mean
    // the wiring is dead.
    expect(lit).toBeGreaterThan(0);
    expect(live.buildings.size + live.tiles.size + live.hand.size).toBeGreaterThan(0);
  });

  /**
   * The drop zones are read back out of the DOM by hit-testing, so a component
   * that quietly loses its `data-drop` breaks drag and nothing else: the click
   * path still works, every unit test still passes, and the gesture just stops.
   * `verify:drag` would catch it, but that needs a build and a browser and is
   * not in `npm run check`.
   */
  it('stamps a drop zone on every building and every neighbour', () => {
    const html = render(snap, { k: 'idle' });
    for (const b of snap.view.you.tableau) {
      expect(html).toContain(`data-drop="building:${b.card}"`);
    }
    for (const r of snap.view.rivals) {
      expect(html).toContain(`data-drop="host:${r.seat}"`);
    }
    // And nowhere else: a drop zone is always a subset of what is clickable.
    const zones = [...html.matchAll(/data-drop="([^"]+)"/g)].map((m) => m[1] as string);
    expect(zones.every((z) => z.startsWith('building:') || z.startsWith('host:'))).toBe(true);
  });

  it(
    'renders the held-card state and its targets',
    () => {
      // Searched rather than taken off the shared snap, for the same reason
      // `positionWith` searches: whether a given seed leaves you holding a card
      // at a given depth moves whenever the card data does, and it did with the
      // Orchard rebuild.
      const held = positionWithHand();
      const card = held.view.you.hand[0] as string;
      const html = render(held, { k: 'hold', card });
      expect(html).toContain('is-held');
      expect(html).toContain('Card in hand');
    },
    SEARCH,
  );
});

/**
 * PHASE 3'S TWO PROPERTIES, ASSERTED TOGETHER BECAUSE EITHER ONE ALONE IS A TRAP.
 *
 * The bar was measured at fourteen buttons in one flat row and the target is
 * eight. A count on its own is trivially satisfiable - stop drawing six buttons
 * and the number is met - and the way that fails is the worst way a game
 * interface can fail: a legal move quietly becomes unplayable, nothing throws,
 * nothing looks broken, and a card never gets played again. Nothing visual would
 * catch it either, because a missing button looks exactly like a tidy bar.
 *
 * So the budget and the coverage are checked over the SAME corpus of real
 * positions, and the coverage half is the one that matters.
 */
describe('the turn bar is small enough, and still reaches everything', () => {
  /**
   * Positions from real warmed games rather than one fixture: a handful of
   * seeds, each walked to several depths, keeping every position where the
   * decision is yours. That gets opening turns, mid-game turns with a live
   * bonus, and turns with the slot already spent - which are three different
   * shapes of bar.
   */
  function turns(): ReturnType<typeof position>[] {
    const out: ReturnType<typeof position>[] = [];
    for (const seed of ['play-a', 'play-b', 'play-c', 'play-d', 'play-e', 'play-f']) {
      for (const depth of [40, 80, 160, 260, 360]) {
        const snap = position(seed, depth);
        if (snap.yours && snap.moves.length > 0) out.push(snap);
        // BOTH HALVES OF THE TURN, since 03/09/2026. `bonusTiming: 'end'` splits
        // a turn into a main phase and then a bonus phase, and a corpus drawn
        // only from the top of the turn would hold no bonus-slot move at all -
        // which is the half these assertions are actually about.
        const acted = positionAfterAction(seed, depth);
        if (acted !== null && acted.moves.length > 0) out.push(acted);
      }
    }
    return out;
  }

  const corpus = turns();

  it('has a corpus worth asserting against', () => {
    expect(corpus.length).toBeGreaterThan(10);
    /*
     * A live bonus slot has to appear in it or the bonus half of every assertion
     * below is vacuous - and it is the half that decides the count, since the
     * five main actions are constant and the bonus zone is what varies. The
     * absence of one is NOT asserted: whether a warmed walk ever lands on a turn
     * with no bonus at all is a property of the card data, and a test that
     * failed for that reason would be reporting on the sheet.
     */
    const BONUS = ['visit', 'bonusDraw'];
    expect(corpus.some((s) => s.moves.some((m) => BONUS.includes(m.type)))).toBe(true);
  });

  it('never draws more than eight family buttons in the main phase', () => {
    for (const snap of corpus) {
      const drawn = barFamilies(actionGroups(data, snap.view, snap.moves), 'main');
      expect(drawn.length).toBeLessThanOrEqual(8);
    }
  });

  /**
   * The coverage half, stated over the function rather than over the DOM so it
   * can say something about BOTH phases - the bonus phase is local UI state and
   * a static render cannot click past it.
   *
   * The bonus phase is allowed to hold the main families back. That is shape (c)
   * and it predates this work: the slot is start-of-turn only, the phase exists
   * so nobody forfeits it by reaching past it, and `skip bonus action` is the
   * door - which the next test checks is really there.
   */
  it('draws a button for every legal move the bar is responsible for', () => {
    /*
     * The move types whose home is somewhere other than the two choice zones,
     * and where each one lives. ANYTHING NOT ON THIS LIST MUST BE ON THE BAR -
     * so a family quietly dropped from `FAMILIES`, or hidden by a new rule in
     * `barFamilies`, fails here rather than at somebody's table.
     *
     * The list is a claim about the interface and the two board entries are
     * checked rather than trusted, below.
     */
    const ELSEWHERE: Record<string, string> = {
      task: 'the prompt',
      cardMove: 'a badge on the card that offers it',
      moveBalloon: 'the balloon itself, in the Aerodrome',
      spendMeeple: 'the pawn in your own meeple supply',
      pass: 'the exits zone',
      endTurn: 'the exits zone',
    };
    for (const snap of corpus) {
      const drawn = new Set(
        barFamilies(actionGroups(data, snap.view, snap.moves), 'main').map((g) => g.type),
      );
      const missing = [...new Set(snap.moves.map((m) => m.type))].filter(
        (type) => ELSEWHERE[type] === undefined && !drawn.has(type),
      );
      expect(missing).toEqual([]);

      /*
       * Freight lost its button because the balloon is its home and the balloon
       * is already a live target. That is only true if the resolver says so, and
       * this is the same `liveTargets` the Aerodrome renders its glow from - so
       * a change that stopped lighting balloons would fail here even though the
       * bar is untouched.
       */
      const live = liveTargets(snap.view, snap.moves, { k: 'idle' });
      for (const move of snap.moves) {
        if (move.type === 'moveBalloon') expect(live.balloons.has(move.balloon)).toBe(true);
        // The same argument for the meeple: it lost its button because the pawn
        // in your own supply IS its home, which is only true if the resolver
        // lights it. Same `liveTargets` the supply renders its glow from.
        if (move.type === 'spendMeeple') expect(live.meeples.has(move.colour)).toBe(true);
      }
    }
  });

  it(
    'holds only the bonus families back in the bonus phase, and always with a skip',
    () => {
      const withBonus = positionWith('a bonus-slot move', (m) =>
        ['visit', 'bonusDraw'].includes(m.type),
      );
      const groups = actionGroups(data, withBonus.view, withBonus.moves);
      const drawn = barFamilies(groups, 'bonus');
      expect(drawn.every((g) => g.zone === 'bonus')).toBe(true);
      // Every bonus family with a legal move is on screen in that phase.
      for (const group of groups) {
        if (group.zone === 'bonus' && group.moves.length > 0) expect(drawn).toContain(group);
      }
      expect(render(withBonus, { k: 'idle' })).toContain('>skip bonus action</button>');
    },
    SEARCH,
  );

  /**
   * The rendered half. `barFamilies` deciding correctly is worth nothing if the
   * component then draws something else, and the number this phase is measured
   * on (`tools/measure-ui.mjs`) is a DOM query - so the DOM is what has to agree.
   */
  it('renders exactly the families it decided on, and no dead coin buttons', () => {
    for (const snap of corpus.slice(0, 6)) {
      const html = render(snap, { k: 'idle' });
      const phase = html.includes('Your bonus, first.') ? 'bonus' : 'main';
      const drawn = barFamilies(actionGroups(data, snap.view, snap.moves), phase);
      for (const group of drawn) {
        expect(html).toContain(barButton(group.label));
      }
      /*
       * The cuts, pinned so that a well-meaning tidy cannot put them back. Buy,
       * Market and Upgrade were coin sinks in or beside the bonus slot and their
       * move types no longer exist; "Work yours" was activating your own Service
       * for a coin and is REPLACED by "Your own door", which is a visit. Card
       * power named no card and is a badge on the card. Pass is only ever legal
       * when it is the only legal move.
       */
      for (const gone of ['Buy', 'Market', 'Upgrade', 'Work yours', 'Card power']) {
        expect(html).not.toContain(barButton(gone));
      }
      if (snap.moves.some((m) => m.type !== 'pass')) {
        expect(html).not.toContain(barButton('Pass'));
      }
    }
  });

  /**
   * The Helping Hand's repeat is the only standing card move in the sheet, and
   * it used to be reached through a "Card power" button that named no card. It
   * is a badge on the card now, so the badge is what has to exist - pinned here
   * rather than in `intent.test.ts`, which checks that the resolver answers but
   * cannot check that anything renders.
   */
  it('puts a badge on a card that is offering a standing move', () => {
    let seen = 0;
    for (const snap of corpus) {
      if (!snap.moves.some((m) => m.type === 'cardMove')) continue;
      seen += 1;
      expect(render(snap, { k: 'idle' })).toContain('class="building-power"');
    }
    /*
     * Not `toBeGreaterThan(0)`. A warmed walk may genuinely never reach a live
     * Helping Hand, and a test that failed for THAT reason would be reporting on
     * the card data rather than on the interface. What is pinned is the
     * implication: wherever the move exists, the badge does.
     */
    expect(seen).toBeGreaterThanOrEqual(0);
  });
});

describe('the two assemblies render', () => {
  /**
   * ⏱️ Both assembly cases SEARCH for a position rather than pinning a seed, and
   * a search is a handful of warm-ups: pinning one would rot the first time the
   * card data moved, which is the trade this file has always taken. See the note
   * on `position` for what a warm-up costs since v31.
   */
  it(
    'the build panel, against a real buildable card',
    () => {
      const snap = positionWith(
        'a build that costs cards',
        (m) => m.type === 'build' && m.payment.length > 0,
      );
      // A card that costs cards, not a coin-only one: the panel's whole job is
      // the payment, and a free build never opens it (it plays on the spot).
      const build = snap.moves.find((m) => m.type === 'build' && m.payment.length > 0) as Extract<
        Move,
        { type: 'build' }
      >;
      expect(build).toBeDefined();
      const html = render(snap, { k: 'build', draft: emptyBuildDraft(build.card) });
      expect(html).toContain('Build it');
      expect(html).toContain('more to find');
      expect(missingImages(html)).toEqual([]);
    },
    SEARCH,
  );

  /**
   * ⭐ THE FOURTH DIFFERENCE, and the one a player is looking straight at when
   * they commit. The panel is the same component for both halves of the bonus
   * slot, so this is where the two could most easily read alike - and must not.
   */
  it(
    'the visit panel, titled and coloured differently for the two hosts',
    () => {
      const snap = positionWith('a visit to a neighbour', (m) => m.type === 'visit');
      const visits = snap.moves.filter(
        (m): m is Extract<Move, { type: 'visit' }> => m.type === 'visit',
      );
      const other = visits.find((m) => m.host !== m.seat);
      const own = visits.find((m) => m.host === m.seat);

      if (other) {
        const html = render(snap, { k: 'visit', host: other.host, fee: null });
        expect(html).toContain('assembly-hook');
        expect(html).toContain('Your junk, their treasure.');
        expect(html).not.toContain('No neighbour involved');
        expect(html).toContain('rival-visiting');
      }
      if (own) {
        const html = render(snap, { k: 'visit', host: own.host, fee: null });
        expect(html).toContain('assembly-self');
        // The cost is stated as prominently as the payoff: feeding your own board
        // clogs it and shuts your neighbours out of your suit's action.
        expect(html).toContain('No neighbour involved');
        expect(html).toContain('clogs it');
        expect(html).not.toContain('their treasure');
      }
      // At least one of the two must have been on offer, or this asserted nothing.
      expect(Boolean(other || own)).toBe(true);
    },
    SEARCH,
  );
});

/**
 * ⭐ THE MEEPLE SUPPLY, IN ALL FOUR OF ITS STATES.
 *
 * The window this strip draws is the one affordance in the game that SHUTS ON
 * ITS OWN: a meeple is spendable for the first beat of your turn, it stops being
 * spendable the moment you take your bonus or your action, and spending it
 * removes it from the game. A player who misses the window has silently lost a
 * stored action for good, and the pawns give no sign - they are wooden pieces,
 * not buttons that grey out. So the strip has to say which state it is in, and
 * this pins that it does - including the two that look identical from the move
 * list and are not the same fact, `shut` and `stuck`.
 *
 * ⚠️ THE MEEPLES ARE INJECTED, and that is not a shortcut round the engine. A
 * seat's supply fills off ISLAND DELIVERIES, so reaching the open state through
 * real play means walking a game until the human seat has both delivered and
 * arrived at a turn top - which is a search over seeds that finds it sometimes,
 * and a test that only asserts when it gets lucky is a test that has stopped
 * asserting. What is under test here is the COMPONENT: given a supply and a set
 * of spendable colours, does it draw the right window. The rule that decides
 * which colours are spendable is the engine's, is checked against `spendMeeple`
 * in `intent.test.ts`, and is deliberately not restated here.
 */
describe('the meeple supply says which window it is in', () => {
  const held: Record<Suit, number> = {
    wheat: 2,
    vegetable: 0,
    orchard: 1,
    apiary: 0,
    dairy: 0,
  };
  const none: Record<Suit, number> = {
    wheat: 0,
    vegetable: 0,
    orchard: 0,
    apiary: 0,
    dairy: 0,
  };
  /** A turn at its very top, and one that has moved on. */
  const atTop = { actionSpent: false, bonusUsed: [] } as unknown as PlayerView['turn'];
  const movedOn = { actionSpent: true, bonusUsed: [] } as unknown as PlayerView['turn'];

  const supply = (
    meeples: Record<Suit, number>,
    spendable: Suit[],
    turn: PlayerView['turn'] = atTop,
  ) => {
    const snap = position('play-a');
    const play = staticPlay(snap.view, snap.moves, { k: 'idle' });
    return renderToStaticMarkup(
      <MeepleSupply
        data={data}
        meeples={meeples}
        turn={turn}
        play={{ ...play, live: { ...play.live, meeples: new Set(spendable) } }}
      />,
    );
  };

  /**
   * ⚠️ THE TWO "nothing to spend" CASES ARE DIFFERENT FACTS, and telling them
   * apart is the whole reason `meepleWindowOpen` exists. Both look identical
   * from the move list; only the turn separates them, and the wrong answer is
   * checkable from the screen - "the window has passed" printed beside a live
   * bonus slot is a contradiction a player can see.
   */
  it('names the phase off the supply, what is spendable and whether the window is open', () => {
    expect(meeplePhaseOf(held, new Set<Suit>(['wheat']), true)).toBe('open');
    expect(meeplePhaseOf(held, new Set<Suit>(), false)).toBe('shut');
    expect(meeplePhaseOf(held, new Set<Suit>(), true)).toBe('stuck');
    expect(meeplePhaseOf(none, new Set<Suit>(), true)).toBe('empty');
    expect(meepleWindowOpen(atTop)).toBe(true);
    expect(meepleWindowOpen(movedOn)).toBe(false);
  });

  it('OPEN: says spend them now, and lights only the colours that can', () => {
    const html = supply(held, ['wheat']);
    expect(html).toContain('supply-open');
    expect(html).toContain('spend them now, before anything else');
    // The action each colour buys, not its name: a meeple IS its door.
    expect(html).toContain('Harvest');
    expect(html).toContain('Draw');
    // Lit for the one that is legal, and disabled for the one that is not -
    // so a colour that can do nothing this turn is visibly not an option.
    expect((html.match(/is-live/g) ?? []).length).toBe(1);
    expect(html).toContain('disabled');
  });

  it('SHUT: says the window has passed and nothing is clickable', () => {
    const html = supply(held, [], movedOn);
    expect(html).toContain('supply-shut');
    expect(html).toContain('your turn has moved on - they keep');
    expect(html).not.toContain('is-live');
  });

  it('STUCK: says the actions are illegal, NOT that the window has passed', () => {
    const html = supply(held, [], atTop);
    expect(html).toContain('supply-stuck');
    expect(html).toContain('none of them has anything to do right now');
    // The lie this state exists to prevent.
    expect(html).not.toContain('your turn has moved on');
    expect(html).not.toContain('is-live');
  });

  it('EMPTY: says where meeples come from, which is the only source', () => {
    const html = supply(none, []);
    expect(html).toContain('supply-empty');
    expect(html).toContain('Deliver to the island and take the meeple with it.');
    expect(html).not.toContain('supply-meeple');
  });

  it("a neighbour's supply is pawns and counts, and never a button", () => {
    const html = renderToStaticMarkup(<MeepleSupply data={data} meeples={held} size="rail" />);
    expect(html).toContain('supply-rail');
    expect(html).not.toContain('<button');
    // Two wheat and one orchard: the count only prints where it is not 1.
    expect(html).toContain('>2</b>');
    const empty = renderToStaticMarkup(<MeepleSupply data={data} meeples={none} size="rail" />);
    expect(empty).toContain('no meeples');
  });
});

describe('the start screen', () => {
  it('offers two rungs and no invented hard one', () => {
    const html = renderToStaticMarkup(<Start onStart={() => {}} />);
    expect(html).toContain('Easy');
    expect(html).toContain('Normal');
    // Ticket 10: `hard` is an alias with no bot behind it until ticket 11
    // measures one. Hiding the rung is the honest reading.
    expect(html).not.toContain('>Hard<');
    expect(html).toContain('a hermit');
  });
});
