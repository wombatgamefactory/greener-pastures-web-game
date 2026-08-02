/**
 * The interaction layer's rule-free half: what a click means.
 *
 * The constraint ticket 25 hangs on is "one source of legality - the UI
 * enumerates nothing and re-derives no rule". Everything here honours it the
 * same way: a click is resolved by FILTERING the move list the engine handed
 * over, never by constructing a move and hoping. When an assembly narrows to
 * one candidate, the object sent back is the engine's own move, not a rebuilt
 * copy of it, so there is no shape to get subtly wrong.
 *
 * That also means this module needs no rules knowledge at all. It does not know
 * that a Notice Board takes one card or two, that a harvest needs a full
 * building, or that the level gate exists - it knows that some move in the list
 * mentions this building, this seat, this tile. A rules change that moves any
 * of those lands in the engine and arrives here for free.
 *
 * Ticket 23's instruction - "build a visit, do not render the enumeration" -
 * generalises: `visitOffers` and `buildOffers` are progressive filters over
 * families too wide to render (C(hand,2) per host, one build option per way to
 * pay), and the panels drive them one click at a time.
 */

import type { Suit, WorkerAction } from '@gp/data';
import type { CardId, Move, MoveType, PlayerView, Seat, TaskAnswer } from '@gp/engine';

export type TaskMove = Extract<Move, { type: 'task' }>;
export type VisitMove = Extract<Move, { type: 'visit' }>;

/**
 * What the interface is in the middle of.
 *
 * `hold` is the fast path: a card is out of the hand and its destinations light
 * up. `arm` is the guided path: the action bar named a family and its targets
 * light up. `build` and `visit` are the two assemblies. `choose` is the generic
 * fallback for a click that matched more than one move - a spend, a payment, a
 * balloon's differing-suits cost.
 */
export type Intent =
  | { k: 'idle' }
  | { k: 'arm'; type: MoveType }
  | { k: 'hold'; card: CardId }
  | { k: 'build'; draft: BuildDraft }
  | { k: 'visit'; host: Seat; fee: readonly CardId[] }
  | { k: 'choose'; title: string; moves: readonly Move[] };

export const IDLE: Intent = { k: 'idle' };

/** True while the interface is waiting for a specific target rather than browsing. */
export function focused(intent: Intent): boolean {
  return intent.k !== 'idle';
}

// --- small readers over the move list ---------------------------------------

export function taskMoves(moves: readonly Move[]): TaskMove[] {
  return moves.filter((m): m is TaskMove => m.type === 'task');
}

export function answersOfKind<K extends TaskAnswer['kind']>(
  moves: readonly Move[],
  kind: K,
): { move: TaskMove; answer: Extract<TaskAnswer, { kind: K }> }[] {
  return taskMoves(moves).flatMap((move) =>
    move.answer.kind === kind
      ? [{ move, answer: move.answer as Extract<TaskAnswer, { kind: K }> }]
      : [],
  );
}

/** The head task facing this seat, if any. `view.tasks[0]` is the one being answered. */
export function pendingTask(view: PlayerView): PlayerView['tasks'][number] | null {
  const head = view.tasks[0];
  return head && head.pid === view.seat ? head : null;
}

/**
 * Move types the family filter lets through. An armed family narrows to itself;
 * an open assembly closes the board entirely, because while a build or a visit
 * is half-built the only meaningful clicks are inside its panel.
 */
function armed(intent: Intent, type: MoveType): boolean {
  if (intent.k === 'arm') return intent.type === type;
  return intent.k !== 'build' && intent.k !== 'visit';
}

// --- click resolvers --------------------------------------------------------
//
// Each returns every move that click could mean. The caller sends it when there
// is exactly one, and opens a `choose` menu when there is more than one. Zero
// means the thing is not a target right now, which is also what drives the glow.

/** One of YOUR buildings: harvest it, upgrade it, grow it, or answer a task with it. */
export function clickBuilding(moves: readonly Move[], intent: Intent, building: CardId): Move[] {
  const held = intent.k === 'hold' ? intent.card : null;
  const out: Move[] = [];

  for (const { move, answer } of answersOfKind(moves, 'building')) {
    if (answer.card === building) out.push(move);
  }
  for (const { move, answer } of answersOfKind(moves, 'sow')) {
    if (answer.onto !== building) continue;
    if (held !== null && answer.card !== held) continue;
    out.push(move);
  }
  for (const move of moves) {
    if (move.type === 'harvest' && move.building === building && armed(intent, 'harvest')) {
      out.push(move);
    }
    if (move.type === 'upgrade' && move.card === building && armed(intent, 'upgrade')) {
      out.push(move);
    }
    if (move.type === 'grow' && move.building === building && armed(intent, 'grow')) {
      if (held === null || move.payment === held) out.push(move);
    }
  }
  return out;
}

/**
 * A neighbour. Always an intent rather than a move: a visit is assembled, never
 * picked off a list of up to ~90 (ticket 23). Returns null when that seat is
 * not visitable right now.
 */
export function clickRival(moves: readonly Move[], intent: Intent, host: Seat): Intent | null {
  if (intent.k === 'arm' && intent.type !== 'visit') return null;
  if (intent.k === 'build' || intent.k === 'choose') return null;
  const held = intent.k === 'hold' ? intent.card : null;
  const fee = held === null ? [] : [held];
  if (visitOffers(moves, { host, fee }).length === 0) return null;
  return { k: 'visit', host, fee };
}

/** An island tile: the Deliver action, or a deliver task's answer. */
export function clickTile(moves: readonly Move[], intent: Intent, tile: string): Move[] {
  const out: Move[] = moves.filter(
    (m) => m.type === 'deliver' && m.tile === tile && armed(intent, 'deliver'),
  );
  for (const { move, answer } of answersOfKind(moves, 'deliver')) {
    if (answer.tile === tile) out.push(move);
  }
  return out;
}

/** A balloon: the Deliver action's freight branch (DL-12), or a deliver task's balloon answer. */
export function clickBalloon(moves: readonly Move[], intent: Intent, balloon: string): Move[] {
  const out: Move[] = moves.filter(
    (m) => m.type === 'moveBalloon' && m.balloon === balloon && armed(intent, 'moveBalloon'),
  );
  for (const { move, answer } of answersOfKind(moves, 'balloon')) {
    if (answer.balloon === balloon) out.push(move);
  }
  return out;
}

/**
 * A Hired Worker, wherever it is standing: hire it out of the Fair, work your
 * own for free, answer a chooseWorker task with it, or - inside a visit - take
 * it as the payoff.
 */
export function clickWorker(
  moves: readonly Move[],
  intent: Intent,
  workerId: WorkerAction,
): Move[] {
  if (intent.k === 'visit') {
    return visitOffers(moves, intent).filter(
      (m) => m.payoff.mode === 'worker' && m.payoff.workerId === workerId,
    );
  }
  const out: Move[] = [];
  for (const { move, answer } of answersOfKind(moves, 'worker')) {
    if (answer.workerId === workerId) out.push(move);
  }
  for (const move of moves) {
    if (move.type === 'hire' && move.workerId === workerId && armed(intent, 'hire')) out.push(move);
    if (
      move.type === 'workOwnWorker' &&
      move.workerId === workerId &&
      armed(intent, 'workOwnWorker')
    ) {
      out.push(move);
    }
  }
  return out;
}

/** A deck spine, while a draw task is revealing. */
export function clickDeck(moves: readonly Move[], suit: Suit): Move[] {
  return answersOfKind(moves, 'deck')
    .filter(({ answer }) => answer.suit === suit)
    .map(({ move }) => move);
}

// --- what glows -------------------------------------------------------------

export interface Live {
  readonly buildings: ReadonlySet<CardId>;
  readonly hosts: ReadonlySet<Seat>;
  readonly tiles: ReadonlySet<string>;
  readonly balloons: ReadonlySet<string>;
  readonly workers: ReadonlySet<WorkerAction>;
  readonly decks: ReadonlySet<Suit>;
  /** Hand cards worth picking up: they lead somewhere from here. */
  readonly hand: ReadonlySet<CardId>;
}

const EMPTY_LIVE: Live = {
  buildings: new Set(),
  hosts: new Set(),
  tiles: new Set(),
  balloons: new Set(),
  workers: new Set(),
  decks: new Set(),
  hand: new Set(),
};

/**
 * Everything clickable right now, computed by asking the resolvers above rather
 * than by restating their predicates. One source for "is this a target" and
 * "what does clicking it do", so a glow can never disagree with a click.
 *
 * Ticket 09's rule is "glow targets, never sources", which is why the hand set
 * is rendered at a lower intensity than the rest (see play.css): every card in
 * hand is a legal visit fee, so a strong glow on the hand carries no
 * information at all.
 */
export function liveTargets(view: PlayerView, moves: readonly Move[], intent: Intent): Live {
  if (moves.length === 0) return EMPTY_LIVE;
  if (intent.k === 'choose') return EMPTY_LIVE;

  const buildings = new Set<CardId>();
  for (const b of view.you.tableau) {
    if (clickBuilding(moves, intent, b.card).length > 0) buildings.add(b.card);
  }

  // Mid-visit the only host that matters is the one being visited: the panel
  // owns the rest of the decision, and lighting the others invites a click that
  // would silently throw the assembled fee away.
  const hosts = new Set<Seat>();
  if (intent.k === 'visit') {
    hosts.add(intent.host);
  } else {
    for (const rival of view.rivals) {
      if (clickRival(moves, intent, rival.seat) !== null) hosts.add(rival.seat);
    }
  }

  const tiles = new Set<string>();
  for (const tile of view.island.tiles) {
    if (clickTile(moves, intent, tile.tile).length > 0) tiles.add(tile.tile);
  }

  const balloons = new Set<string>();
  for (const balloon of view.aerodrome?.balloons ?? []) {
    if (clickBalloon(moves, intent, balloon.id).length > 0) balloons.add(balloon.id);
  }

  const workers = new Set<WorkerAction>();
  for (const worker of view.fair) {
    if (clickWorker(moves, intent, worker.id).length > 0) workers.add(worker.id);
  }

  const decks = new Set<Suit>();
  for (const suit of view.suitsInPlay) {
    if (clickDeck(moves, suit).length > 0) decks.add(suit);
  }

  return { buildings, hosts, tiles, balloons, workers, decks, hand: liveHand(view, moves, intent) };
}

/**
 * Which hand cards are worth touching. Every branch is a different question, and
 * conflating them is how a hand ends up glowing all the way through a build:
 * mid-assembly the answer is "what could still join this payment", not "what is
 * playable at all".
 */
function liveHand(view: PlayerView, moves: readonly Move[], intent: Intent): Set<CardId> {
  if (intent.k === 'build') return new Set(buildAdditions(moves, intent.draft).hand);
  if (intent.k === 'visit') return visitFeeAdditions(moves, intent);
  // A card is already out of the hand: the question is where it goes, so the
  // rest of the hand goes quiet. Lighting it would be lighting sources, which
  // is the exact thing ticket 09 ruled out.
  if (intent.k === 'hold') return new Set();
  if (intent.k === 'arm') {
    if (intent.type !== 'build') return new Set();
    return new Set(view.you.hand.filter((card) => buildOffers(moves, card).length > 0));
  }
  const out = new Set<CardId>();
  for (const card of view.you.hand) {
    if (holdLeadsSomewhere(view, moves, card)) out.add(card);
  }
  return out;
}

/** Would picking this card up light anything up? Drives the hand's own affordance. */
export function holdLeadsSomewhere(
  view: PlayerView,
  moves: readonly Move[],
  card: CardId,
): boolean {
  const held: Intent = { k: 'hold', card };
  if (view.you.tableau.some((b) => clickBuilding(moves, held, b.card).length > 0)) return true;
  if (view.rivals.some((r) => clickRival(moves, held, r.seat) !== null)) return true;
  return buildOffers(moves, card).length > 0;
}

// --- the two assemblies -----------------------------------------------------

export interface VisitDraft {
  readonly host: Seat;
  readonly fee: readonly CardId[];
}

function sameCards(a: readonly CardId[], b: readonly CardId[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

function contains(whole: readonly CardId[], part: readonly CardId[]): boolean {
  const pool = [...whole];
  return part.every((card) => {
    const i = pool.indexOf(card);
    if (i < 0) return false;
    pool.splice(i, 1);
    return true;
  });
}

/** Visits to this host whose fee still contains everything picked so far. */
export function visitOffers(moves: readonly Move[], draft: VisitDraft): VisitMove[] {
  return moves.filter(
    (m): m is VisitMove =>
      m.type === 'visit' && m.host === draft.host && contains(m.fee, draft.fee),
  );
}

/** Cards that could join the fee from here. The 2-card mode is the only reason there are any. */
export function visitFeeAdditions(moves: readonly Move[], draft: VisitDraft): Set<CardId> {
  const out = new Set<CardId>();
  for (const offer of visitOffers(moves, draft)) {
    if (offer.fee.length <= draft.fee.length) continue;
    for (const card of offer.fee) {
      if (!draft.fee.includes(card)) out.add(card);
    }
  }
  return out;
}

/** The payoffs the fee as assembled can actually buy. Nothing else is offered. */
export function visitPayoffs(moves: readonly Move[], draft: VisitDraft): VisitMove[] {
  if (draft.fee.length === 0) return [];
  return visitOffers(moves, draft).filter((m) => sameCards(m.fee, draft.fee));
}

/**
 * A build, from either side of the fence: the main action's `build` moves and a
 * build TASK's answers are the same decision with the same shape, so the panel
 * is written once and the difference stays in this normalisation.
 */
export interface BuildOffer {
  readonly move: Move;
  readonly card: CardId;
  readonly payment: readonly CardId[];
  readonly barn: Partial<Record<Suit, number>>;
  readonly coinWild: number;
}

export function buildOffers(moves: readonly Move[], card?: CardId): BuildOffer[] {
  const out: BuildOffer[] = [];
  for (const move of moves) {
    if (move.type === 'build') {
      out.push({ move, card: move.card, payment: move.payment, barn: {}, coinWild: 0 });
    } else if (move.type === 'task' && move.answer.kind === 'build') {
      const a = move.answer;
      out.push({
        move,
        card: a.card,
        payment: a.payment,
        barn: a.barn ?? {},
        coinWild: a.coinWild ?? 0,
      });
    }
  }
  return card === undefined ? out : out.filter((o) => o.card === card);
}

export interface BuildDraft {
  readonly card: CardId;
  readonly payment: readonly CardId[];
  readonly barn: Partial<Record<Suit, number>>;
  readonly coinWild: number;
}

export function emptyBuildDraft(card: CardId): BuildDraft {
  return { card, payment: [], barn: {}, coinWild: 0 };
}

function tallyFits(part: Partial<Record<Suit, number>>, whole: Partial<Record<Suit, number>>) {
  return (Object.entries(part) as [Suit, number][]).every(([s, n]) => (whole[s] ?? 0) >= n);
}

function tallyTotal(tally: Partial<Record<Suit, number>>): number {
  return Object.values(tally).reduce((a: number, b) => a + (b ?? 0), 0);
}

/** Offers still reachable from a partly-assembled payment. */
export function buildCandidates(moves: readonly Move[], draft: BuildDraft): BuildOffer[] {
  return buildOffers(moves, draft.card).filter(
    (o) =>
      contains(o.payment, draft.payment) &&
      tallyFits(draft.barn, o.barn) &&
      o.coinWild >= draft.coinWild,
  );
}

/** The one offer the draft has fully specified, if it has. */
export function buildComplete(moves: readonly Move[], draft: BuildDraft): BuildOffer | null {
  const exact = buildCandidates(moves, draft).filter(
    (o) =>
      sameCards(o.payment, draft.payment) &&
      tallyTotal(o.barn) === tallyTotal(draft.barn) &&
      tallyFits(o.barn, draft.barn) &&
      o.coinWild === draft.coinWild,
  );
  return exact[0] ?? null;
}

/** What may still be added to a build payment: hand cards, barn suits, coins. */
export interface BuildAdditions {
  readonly hand: ReadonlySet<CardId>;
  readonly barn: ReadonlySet<Suit>;
  readonly coins: boolean;
  /** Cards still owed, as a range over the surviving candidates. */
  readonly remaining: { readonly min: number; readonly max: number };
}

export function buildAdditions(moves: readonly Move[], draft: BuildDraft): BuildAdditions {
  const hand = new Set<CardId>();
  const barn = new Set<Suit>();
  let coins = false;
  let min = Infinity;
  let max = 0;

  for (const offer of buildCandidates(moves, draft)) {
    const short =
      offer.payment.length -
      draft.payment.length +
      (tallyTotal(offer.barn) - tallyTotal(draft.barn)) +
      (offer.coinWild - draft.coinWild);
    min = Math.min(min, short);
    max = Math.max(max, short);
    const pool = [...offer.payment];
    for (const paid of draft.payment) {
      const i = pool.indexOf(paid);
      if (i >= 0) pool.splice(i, 1);
    }
    for (const card of pool) hand.add(card);
    for (const [suit, n] of Object.entries(offer.barn) as [Suit, number][]) {
      if (n > (draft.barn[suit] ?? 0)) barn.add(suit);
    }
    if (offer.coinWild > draft.coinWild) coins = true;
  }

  return { hand, barn, coins, remaining: { min: min === Infinity ? 0 : min, max } };
}

export function withPayment(draft: BuildDraft, card: CardId): BuildDraft {
  const i = draft.payment.indexOf(card);
  return {
    ...draft,
    payment:
      i >= 0
        ? [...draft.payment.slice(0, i), ...draft.payment.slice(i + 1)]
        : [...draft.payment, card],
  };
}

export function withBarn(draft: BuildDraft, suit: Suit, delta: number): BuildDraft {
  const next = Math.max(0, (draft.barn[suit] ?? 0) + delta);
  const barn = { ...draft.barn };
  if (next === 0) delete barn[suit];
  else barn[suit] = next;
  return { ...draft, barn };
}

// --- subset answers (keep, discard) -----------------------------------------

/**
 * The two tasks answered by choosing a SUBSET of cards: the draw's keep and the
 * end-of-turn discard. Both enumerate every subset, which is a validator rather
 * than a menu once a hand is 6 cards, so the surface is a toggle-and-confirm.
 */
export function subsetAnswer(
  moves: readonly Move[],
  kind: 'keep' | 'discard',
  chosen: readonly CardId[],
): Move | null {
  const found = answersOfKind(moves, kind).find(({ answer }) => sameCards(answer.cards, chosen));
  return found?.move ?? null;
}

/** Cards that may still be added to a keep or discard selection. */
export function subsetAdditions(
  moves: readonly Move[],
  kind: 'keep' | 'discard',
  chosen: readonly CardId[],
): Set<CardId> {
  const out = new Set<CardId>();
  for (const { answer } of answersOfKind(moves, kind)) {
    if (!contains(answer.cards, chosen) || answer.cards.length <= chosen.length) continue;
    for (const card of answer.cards) {
      if (!chosen.includes(card)) out.add(card);
    }
  }
  return out;
}

// --- anti-rot ---------------------------------------------------------------

/**
 * Where each move type is reached from. Not documentation: `intent.test.ts`
 * checks it against the engine's own `MOVE_TYPES`, so a rules change that adds
 * a move type fails the UI build until someone decides which surface offers it.
 * That is the same chain ticket 28 built for the bots' scoring terms.
 */
export const MOVE_ROUTES = {
  task: 'prompt',
  cardMove: 'action-bar',
  draw: 'action-bar',
  build: 'build-panel',
  hire: 'worker',
  upgrade: 'building',
  grow: 'building',
  harvest: 'building',
  deliver: 'island-tile',
  moveBalloon: 'balloon',
  visit: 'visit-panel',
  workOwnWorker: 'worker',
  pass: 'action-bar',
  endTurn: 'action-bar',
} satisfies Record<MoveType, string>;
