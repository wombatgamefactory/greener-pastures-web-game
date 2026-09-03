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
 * that a Notice Board takes two cards, that a harvest needs a full building, or
 * that a tile takes two deliveries - it knows that some move in the list
 * mentions this building, this seat, this tile. A rules change that moves any of
 * those lands in the engine and arrives here for free.
 *
 * ⭐ v31 SHRANK THIS FILE, and every deletion is a rule deletion rather than a
 * tidy: `clickWorker` went with the Services, the `buy` and `market` branches of
 * `clickDeck` went with the currency that bought them, and the `upgrade` branch
 * of `clickBuilding` went with the second printed faces. What arrived is smaller
 * still - a visit now costs exactly ONE card, so the fee is a card or nothing
 * and the progressive filter it used to need is gone.
 */

import type { Suit } from '@gp/data';
import type { CardId, Move, MoveType, PlayerView, Seat, TaskAnswer } from '@gp/engine';

export type TaskMove = Extract<Move, { type: 'task' }>;
export type VisitMove = Extract<Move, { type: 'visit' }>;

/**
 * What the interface is in the middle of.
 *
 * `hold` is the fast path: a card is out of the hand and its destinations light
 * up. `arm` is the guided path: the action bar named a family and its targets
 * light up. `build` and `visit` are the two assemblies. `choose` is the generic
 * fallback for a click that matched more than one move.
 *
 * ⭐ `arm` CARRIES A `self` FLAG AND ONLY THE VISIT READS IT. A visit and a
 * self-visit are the same move type with a different host, and they are opposite
 * acts - one is the game's whole social hook, the other is solitaire. The turn
 * bar therefore offers them as two separate buttons, and this is what tells the
 * glow which set of doors that button armed. Undefined means "either", which is
 * what any other family means by it.
 */
export type Intent =
  | { k: 'idle' }
  | { k: 'arm'; type: MoveType; self?: boolean }
  | { k: 'hold'; card: CardId }
  | { k: 'build'; draft: BuildDraft }
  | { k: 'visit'; host: Seat; fee: CardId | null }
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

/**
 * ⚡ ONE PASS, NO INTERMEDIATE. This was `taskMoves(moves).flatMap(...)`, which
 * allocates a full copy of every task move and then a one-element array per
 * match, and it is called several times per resolver and several resolvers deep
 * inside `liveTargets` - so a render was allocating a multiple of the move list
 * just to find the handful of answers of one kind.
 *
 * It matters more since v31 than it ever did: there is no hand limit, so a
 * mid-game hand of twenty makes `buildOptions` enumerate payments and move lists
 * run to the thousands where they used to run to the hundreds. Same results, in
 * the same order, without the copies.
 */
export function answersOfKind<K extends TaskAnswer['kind']>(
  moves: readonly Move[],
  kind: K,
): { move: TaskMove; answer: Extract<TaskAnswer, { kind: K }> }[] {
  const out: { move: TaskMove; answer: Extract<TaskAnswer, { kind: K }> }[] = [];
  for (const move of moves) {
    if (move.type !== 'task' || move.answer.kind !== kind) continue;
    out.push({ move, answer: move.answer as Extract<TaskAnswer, { kind: K }> });
  }
  return out;
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

/** Does an armed visit family cover this host? `self` undefined means either. */
function armedHost(intent: Intent, host: Seat, you: Seat): boolean {
  if (intent.k !== 'arm') return true;
  if (intent.self === undefined) return true;
  return intent.self === (host === you);
}

// --- click resolvers --------------------------------------------------------
//
// Each returns every move that click could mean. The caller sends it when there
// is exactly one, and opens a `choose` menu when there is more than one. Zero
// means the thing is not a target right now, which is also what drives the glow.

/**
 * One of YOUR buildings: harvest it, grow it, or answer a task with it.
 *
 * ⚡ ONE PASS OVER `moves`, AND THE REASON IS `liveTargets`. This used to be four
 * passes with three `answersOfKind` calls, each of which allocates two
 * intermediate arrays over the whole move list - and the glow calls it once per
 * building on every render, so a 14-building farm meant 56 scans and 84 throwaway
 * arrays for one frame. Measured on 02/09/2026 at 2.5ms per `liveTargets` in a
 * mid-game position, which is a third of a 60fps frame spent deciding what to
 * outline. Same predicates, same order of results, same single source of truth
 * for "what does clicking this mean" - just without the allocations.
 */
export function clickBuilding(moves: readonly Move[], intent: Intent, building: CardId): Move[] {
  const held = intent.k === 'hold' ? intent.card : null;
  // Kept in the original order - building answers, then activates, then sows,
  // then the two main actions - because `resolve` sends a single candidate and
  // a menu lists them in the order they arrive.
  const answers: Move[] = [];
  const activates: Move[] = [];
  const sows: Move[] = [];
  const actions: Move[] = [];
  const canHarvest = armed(intent, 'harvest');
  const canGrow = armed(intent, 'grow');

  for (const move of moves) {
    if (move.type === 'task') {
      const answer = move.answer;
      if (answer.kind === 'building') {
        if (answer.card === building) answers.push(move);
      } else if (answer.kind === 'activate') {
        // GROW WITHOUT PLACING (A5, A12): clicking the building fires it.
        // Nothing is held and nothing is placed, so it needs no armed intent -
        // the task is the only thing on offer while it is pending.
        if (answer.card === building) activates.push(move);
      } else if (answer.kind === 'sow') {
        if (answer.onto === building && (held === null || answer.card === held)) sows.push(move);
      }
      continue;
    }
    if (move.type === 'harvest') {
      if (canHarvest && move.building === building) actions.push(move);
    } else if (move.type === 'grow') {
      if (canGrow && move.building === building && (held === null || move.payment === held)) {
        actions.push(move);
      }
    }
  }
  return [...answers, ...activates, ...sows, ...actions];
}

/**
 * A STANDING MOVE OFFERED BY A BUILT CARD, made on the card that offers it.
 *
 * The research is blunt about the alternative: a move a board component grants
 * should be made on the component, the way it would be at the table. So the
 * tableau draws a badge on the card and this is what the badge asks.
 *
 * NO INTENT FILTER, deliberately. The engine's list is the whole of the
 * legality, and a standing move can become legal in the middle of something
 * else, so gating it behind an armed family would be inventing a rule.
 */
export function clickCardPower(moves: readonly Move[], card: CardId): Move[] {
  return moves.filter((m) => m.type === 'cardMove' && m.card === card);
}

/**
 * A FARM'S NOTICE BOARD as a visit target - a neighbour's, or since v31 your
 * own. Always an intent rather than a move: the host is half the decision and
 * the fee is the other half, so the panel takes them one at a time.
 *
 * Returns null when that seat is not visitable right now.
 *
 * ⚠️ `host` MAY BE THE VIEWER'S OWN SEAT and the caller must not assume
 * otherwise. That is the v31 self-visit, and it is deliberately reached through
 * the SAME resolver as a neighbour's board: they are one move with one flag, so
 * a second code path here would be the first place the two could drift. What
 * makes them read differently is everything downstream - two turn-bar buttons,
 * a differently-titled panel and a differently-worded feed line.
 */
export function clickHost(
  view: PlayerView,
  moves: readonly Move[],
  intent: Intent,
  host: Seat,
): Intent | null {
  if (intent.k === 'arm' && intent.type !== 'visit') return null;
  if (intent.k === 'build' || intent.k === 'choose') return null;
  if (!armedHost(intent, host, view.seat)) return null;
  const held = intent.k === 'hold' ? intent.card : null;
  if (visitOffers(moves, { host, fee: held }).length === 0) return null;
  return { k: 'visit', host, fee: held };
}

/**
 * An island tile: the Deliver action, or a deliver task's answer.
 *
 * ⚡ One pass, like `clickBuilding`. The action and the task answer used to be
 * two sweeps of the move list with two allocations, and `liveTargets` calls this
 * once per tile - twelve times a render at four seats.
 */
export function clickTile(moves: readonly Move[], intent: Intent, tile: string): Move[] {
  const canDeliver = armed(intent, 'deliver');
  const actions: Move[] = [];
  const answers: Move[] = [];
  for (const move of moves) {
    if (move.type === 'deliver') {
      if (canDeliver && move.tile === tile) actions.push(move);
    } else if (move.type === 'task' && move.answer.kind === 'deliver') {
      if (move.answer.tile === tile) answers.push(move);
    }
  }
  return [...actions, ...answers];
}

/** A balloon: the Deliver action's freight branch (DL-12), or a deliver task's balloon answer. */
export function clickBalloon(moves: readonly Move[], intent: Intent, balloon: string): Move[] {
  const canMove = armed(intent, 'moveBalloon');
  const actions: Move[] = [];
  const answers: Move[] = [];
  for (const move of moves) {
    if (move.type === 'moveBalloon') {
      if (canMove && move.balloon === balloon) actions.push(move);
    } else if (move.type === 'task' && move.answer.kind === 'balloon') {
      if (move.answer.balloon === balloon) answers.push(move);
    }
  }
  return [...actions, ...answers];
}

/**
 * ONE MEEPLE OF THIS COLOUR, spent (v31). Made on the meeple in your own supply,
 * for the same reason a card power is made on the card: it is a component in
 * front of you and the gesture is picking it up.
 *
 * It carries no intent filter and needs none. `spendMeeple` is legal only in the
 * start-of-turn window, so the engine's list is already the whole gate, and
 * arming a family to reach a piece you are looking straight at would be a click
 * spent on nothing.
 */
export function clickMeeple(moves: readonly Move[], colour: Suit): Move[] {
  return moves.filter((m) => m.type === 'spendMeeple' && m.colour === colour);
}

/**
 * A deck spine. Since v31 a deck is a draw target and nothing else: the £1 buy
 * and the £3 market both went with the currency, so a click here can only ever
 * be a revealing draw task's answer.
 */
export function clickDeck(moves: readonly Move[], _intent: Intent, suit: Suit): Move[] {
  const out: Move[] = [];
  for (const move of moves) {
    if (move.type === 'task' && move.answer.kind === 'deck' && move.answer.suit === suit) {
      out.push(move);
    }
  }
  return out;
}

// --- what glows -------------------------------------------------------------

export interface Live {
  readonly buildings: ReadonlySet<CardId>;
  /**
   * Seats whose Notice Board is a legal visit target. ⚠️ MAY CONTAIN YOUR OWN
   * SEAT (v31): the rail draws the neighbours in it and your own farm draws
   * itself, and the two must be told apart on screen even though they are one
   * set here.
   */
  readonly hosts: ReadonlySet<Seat>;
  readonly tiles: ReadonlySet<string>;
  readonly balloons: ReadonlySet<string>;
  /** Meeple colours in your supply that can be spent right now. */
  readonly meeples: ReadonlySet<Suit>;
  readonly decks: ReadonlySet<Suit>;
  /** Hand cards worth picking up: they lead somewhere from here. */
  readonly hand: ReadonlySet<CardId>;
}

const EMPTY_LIVE: Live = {
  buildings: new Set(),
  hosts: new Set(),
  tiles: new Set(),
  balloons: new Set(),
  meeples: new Set(),
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
    // Every seat, yours included - the self-visit is a real door and the farm
    // has to be able to light it.
    for (let seat = 0; seat < view.seats; seat++) {
      if (clickHost(view, moves, intent, seat) !== null) hosts.add(seat);
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

  const meeples = new Set<Suit>();
  for (const colour of Object.keys(view.you.meeples) as Suit[]) {
    if (clickMeeple(moves, colour).length > 0) meeples.add(colour);
  }

  const decks = new Set<Suit>();
  for (const suit of view.suitsInPlay) {
    if (clickDeck(moves, intent, suit).length > 0) decks.add(suit);
  }

  return {
    buildings,
    hosts,
    tiles,
    balloons,
    meeples,
    decks,
    hand: liveHand(view, moves, intent),
  };
}

/**
 * Which hand cards are worth touching. Every branch is a different question, and
 * conflating them is how a hand ends up glowing all the way through a build:
 * mid-assembly the answer is "what could still join this payment", not "what is
 * playable at all".
 */
function liveHand(view: PlayerView, moves: readonly Move[], intent: Intent): Set<CardId> {
  if (intent.k === 'build') return new Set(buildAdditions(moves, intent.draft).hand);
  if (intent.k === 'visit') return visitFeeOptions(moves, intent.host);
  // A card is already out of the hand: the question is where it goes, so the
  // rest of the hand goes quiet. Lighting it would be lighting sources, which
  // is the exact thing ticket 09 ruled out.
  if (intent.k === 'hold') return new Set();
  if (intent.k === 'arm') {
    if (intent.type === 'visit') return visitFeeOptions(moves, null, view.seat, intent.self);
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
  for (let seat = 0; seat < view.seats; seat++) {
    if (clickHost(view, moves, held, seat) !== null) return true;
  }
  return buildOffers(moves, card).length > 0;
}

// --- the visit --------------------------------------------------------------

/**
 * A part-made visit: whose board, and which card is going on it.
 *
 * ⭐ `fee` IS ONE CARD OR NONE (v31), where it used to be a list. The upgraded
 * Notice Board's "2 cards, take GBP 3" was the only route that ever placed two,
 * and it went with the second printed faces - so `legalMoves` now offers exactly
 * one visit per (host, hand card) pair and the progressive subset filter this
 * used to need has nothing left to narrow.
 */
export interface VisitDraft {
  readonly host: Seat;
  readonly fee: CardId | null;
}

/** Visits to this host, narrowed to the fee if one has been chosen. */
export function visitOffers(moves: readonly Move[], draft: VisitDraft): VisitMove[] {
  return moves.filter(
    (m): m is VisitMove =>
      m.type === 'visit' && m.host === draft.host && (draft.fee === null || m.fee === draft.fee),
  );
}

/**
 * Cards that could pay for a visit. With a host, the fees that host will accept;
 * without one, every fee that buys SOME door - filtered to neighbours or to your
 * own board when the turn bar armed one of the two.
 */
export function visitFeeOptions(
  moves: readonly Move[],
  host: Seat | null,
  you?: Seat,
  self?: boolean,
): Set<CardId> {
  const out = new Set<CardId>();
  for (const move of moves) {
    if (move.type !== 'visit') continue;
    if (host !== null && move.host !== host) continue;
    if (host === null && self !== undefined && you !== undefined) {
      if (self !== (move.host === you)) continue;
    }
    out.add(move.fee);
  }
  return out;
}

/** The one move a fully-specified draft names, if it names one. */
export function visitComplete(moves: readonly Move[], draft: VisitDraft): VisitMove | null {
  if (draft.fee === null) return null;
  return visitOffers(moves, draft)[0] ?? null;
}

/** The distinct hosts a visit family could still be aimed at. */
export function visitHosts(moves: readonly Move[]): Seat[] {
  const out = new Set<Seat>();
  for (const move of moves) {
    if (move.type === 'visit') out.add(move.host);
  }
  return [...out].sort((a, b) => a - b);
}

// --- the build assembly -----------------------------------------------------

/**
 * A build, from either side of the fence: the main action's `build` moves and a
 * build TASK's answers are the same decision with the same shape, so the panel
 * is written once and the difference stays in this normalisation.
 */
export interface BuildOffer {
  readonly move: Move;
  readonly card: CardId;
  readonly payment: readonly CardId[];
  /** D7 The Versatile Shed: cards taken off the seat's own buildings to pay. */
  readonly stacks: readonly CardId[];
}

export function buildOffers(moves: readonly Move[], card?: CardId): BuildOffer[] {
  const out: BuildOffer[] = [];
  for (const move of moves) {
    if (move.type === 'build') {
      out.push({ move, card: move.card, payment: move.payment, stacks: [] });
    } else if (move.type === 'task' && move.answer.kind === 'build') {
      const a = move.answer;
      out.push({ move, card: a.card, payment: a.payment, stacks: a.stacks ?? [] });
    }
  }
  return card === undefined ? out : out.filter((o) => o.card === card);
}

/**
 * A part-assembled build. Two lists of card IDS since the Dairy rebuild
 * (2026-08-10), where there used to be a hand list, a per-suit barn TALLY and a
 * coin count. The panel is a card-toggle surface rather than a card-toggle plus
 * two steppers.
 */
export interface BuildDraft {
  readonly card: CardId;
  readonly payment: readonly CardId[];
  readonly stacks: readonly CardId[];
}

export function emptyBuildDraft(card: CardId): BuildDraft {
  return { card, payment: [], stacks: [] };
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

/** Offers still reachable from a partly-assembled payment. */
export function buildCandidates(moves: readonly Move[], draft: BuildDraft): BuildOffer[] {
  return buildOffers(moves, draft.card).filter(
    (o) => contains(o.payment, draft.payment) && contains(o.stacks, draft.stacks),
  );
}

/** The one offer the draft has fully specified, if it has. */
export function buildComplete(moves: readonly Move[], draft: BuildDraft): BuildOffer | null {
  const exact = buildCandidates(moves, draft).filter(
    (o) => sameCards(o.payment, draft.payment) && sameCards(o.stacks, draft.stacks),
  );
  return exact[0] ?? null;
}

/** What may still be added to a build payment: hand cards and stack cards. */
export interface BuildAdditions {
  readonly hand: ReadonlySet<CardId>;
  readonly stacks: ReadonlySet<CardId>;
  /** Cards still owed, as a range over the surviving candidates. */
  readonly remaining: { readonly min: number; readonly max: number };
}

export function buildAdditions(moves: readonly Move[], draft: BuildDraft): BuildAdditions {
  const hand = new Set<CardId>();
  const stacks = new Set<CardId>();
  let min = Infinity;
  let max = 0;

  for (const offer of buildCandidates(moves, draft)) {
    const short =
      offer.payment.length - draft.payment.length + (offer.stacks.length - draft.stacks.length);
    min = Math.min(min, short);
    max = Math.max(max, short);
    addRemainder(hand, offer.payment, draft.payment);
    addRemainder(stacks, offer.stacks, draft.stacks);
  }

  return { hand, stacks, remaining: { min: min === Infinity ? 0 : min, max } };
}

/** Cards of `offer` this draft has not yet claimed, added to `out`. */
function addRemainder(out: Set<CardId>, offer: readonly CardId[], chosen: readonly CardId[]): void {
  const pool = [...offer];
  for (const paid of chosen) {
    const i = pool.indexOf(paid);
    if (i >= 0) pool.splice(i, 1);
  }
  for (const card of pool) out.add(card);
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

/** Toggle one of your own stack cards into or out of the payment (D7). */
export function withStackPayment(draft: BuildDraft, card: CardId): BuildDraft {
  const i = draft.stacks.indexOf(card);
  return {
    ...draft,
    stacks:
      i >= 0
        ? [...draft.stacks.slice(0, i), ...draft.stacks.slice(i + 1)]
        : [...draft.stacks, card],
  };
}

// --- subset answers ---------------------------------------------------------

/**
 * The two tasks answered by choosing a SUBSET of cards: the draw's keep, and the
 * turn-boundary DISCARD.
 *
 * ⭐ The discard half is back with the hand limit (02/09/2026), and it is the
 * half that carries a real choice: v31's Draw is see 2, keep 2, so a keep offers
 * exactly one subset - the lot - and the surface plays it on the first click. An
 * overflow of two from a hand of fourteen offers C(14, 2) = 91, every one of them
 * a decision, which is why the toggle-and-confirm machinery exists at all.
 *
 * ⚠️ THE TWO ARE THE SAME SHAPE AND OPPOSITE IN SIGN - a keep names what you
 * are taking, a discard names what you are losing - so the surface must say which
 * it is asking (`taskPrompt` does) and must never share a highlight style between
 * them.
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
  cardMove: 'building-badge',
  draw: 'action-bar',
  bonusDraw: 'action-bar',
  spendMeeple: 'meeple-supply',
  build: 'build-panel',
  grow: 'building',
  harvest: 'building',
  deliver: 'island-tile',
  moveBalloon: 'balloon',
  visit: 'visit-panel',
  pass: 'action-bar',
  endTurn: 'action-bar',
} satisfies Record<MoveType, string>;
