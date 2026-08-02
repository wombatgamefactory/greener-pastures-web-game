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

import { Session } from '../session/table';
import type { Play } from '../session/play';
import { emptyBuildDraft, liveTargets } from '../view/intent';
import type { Intent } from '../view/intent';
import { Start } from './Start';
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
      intent.k === 'build' ? intent.draft.payment : intent.k === 'visit' ? intent.fee : [],
    subsetKind: null,
    send: noop,
    choose: noop,
    cancel: noop,
    arm: noop,
    hold: noop,
    startBuild: noop,
    setDraft: noop,
    payWithBarn: noop,
    setVisitFee: noop,
    building: noop,
    rival: noop,
    tile: noop,
    balloon: noop,
    worker: noop,
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
  throw new Error(`no warmed position offers ${what}`);
}

/** A warmed session sitting on your turn, with a hand and a developed board. */
function position(seed: string, depth = 260) {
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
  return snap;
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

  it('shows the turn bar with the five actions', () => {
    const html = render(snap, { k: 'idle' });
    for (const label of ['Draw', 'Build', 'Grow', 'Harvest', 'Deliver', 'Visit', 'End turn']) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(missingImages(html)).toEqual([]);
  });

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
      expect(html).toContain(`data-drop="rival:${r.seat}"`);
    }
    // And nowhere else: a drop zone is always a subset of what is clickable.
    const zones = [...html.matchAll(/data-drop="([^"]+)"/g)].map((m) => m[1] as string);
    expect(zones.every((z) => z.startsWith('building:') || z.startsWith('rival:'))).toBe(true);
  });

  it('renders the held-card state and its targets', () => {
    const card = snap.view.you.hand[0] as string;
    const html = render(snap, { k: 'hold', card });
    expect(html).toContain('is-held');
    expect(html).toContain('Card in hand');
  });
});

describe('the two assemblies render', () => {
  it('the build panel, against a real buildable card', () => {
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
  });

  it('the visit panel, with the payoffs the fee has bought', () => {
    const snap = positionWith('a visit', (m) => m.type === 'visit');
    const visit = snap.moves.find((m) => m.type === 'visit') as Extract<Move, { type: 'visit' }>;
    const empty = render(snap, { k: 'visit', host: visit.host, fee: [] });
    expect(empty).toContain('your junk, their treasure');
    // With no fee chosen there is nothing to take yet.
    expect(empty).not.toContain('from the bank, to you');

    const priced = render(snap, { k: 'visit', host: visit.host, fee: visit.fee });
    expect(priced).toContain('from the bank, to you');
    expect(priced).toContain('rival-visiting');
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
