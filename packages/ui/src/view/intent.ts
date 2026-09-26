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
 *
 * --- THE DRAFT TYPES, FOR THE THREE OTHER PASSES READING THIS FILE (18/09/2026) --------
 *
 * Three multi-click decisions each get a part-assembled draft type, a set of
 * pure functions over it, and an `Intent` variant that carries it. All three
 * follow the same shape: `emptyXDraft`, `xCandidates` (offers still reachable),
 * `xComplete` (the one move a full draft names), and `withX...` toggles that
 * return a new draft. Nothing here ever builds a `Move` - `xComplete` only ever
 * returns an object that came out of the engine's own list.
 *
 *   `BuildDraft`    a card plus the hand/stack cards paying for it. Rendered by
 *                   `BuildPanel.tsx`.
 *   `VisitDraft`    a host seat, WHICH of their Notice Boards (`board`, absent
 *                   for every seat but a two-player host holding two - see
 *                   `visitBoards`), and the fee card. Rendered by
 *                   `VisitPanel.tsx` (owned by another pass).
 *   `DeliverDraft`  a tile, which TOKEN it takes when the tile still offers a
 *                   choice, and how many cards of each crop are committed so
 *                   far - a count, never a card id, because a barn's identity
 *                   is inert (`deliver.ts`, the engine). Rendered by
 *                   `DeliverPanel` in `BuildPanel.tsx`; `Island.tsx` (owned by
 *                   another pass) may also drive it directly through
 *                   `play.setDeliverDraft`.
 *
 * A fourth kind of multi-click answer has no draft at all: `grow` (the Apiary
 * board's deck-paid Grow, and the Apiary Worker's card-paid one) and `deckSow`
 * both resolve through `clickBuilding`/`clickDeck` the same way `sow` already
 * did - a building click and a deck click (or a held hand card and a building
 * click) each narrow the move list, and the caller sends the one survivor or
 * opens the generic menu. `handToBarn` narrows even further: naming a hand card
 * IS the whole answer, so picking the card up (`clickHandCard`, wired into
 * `Play.hold`) resolves it directly with no assembly at all.
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
  | { k: 'visit'; host: Seat; board?: CardId; fee: CardId | null }
  | { k: 'deliver'; draft: DeliverDraft }
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
  return intent.k !== 'build' && intent.k !== 'visit' && intent.k !== 'deliver';
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
  // then grow-task answers, then the two main actions - because `resolve`
  // sends a single candidate and a menu lists them in the order they arrive.
  const answers: Move[] = [];
  const activates: Move[] = [];
  const sows: Move[] = [];
  const growAnswers: Move[] = [];
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
      } else if (answer.kind === 'deckSow') {
        // ⭐ ROUTED 18/09/2026 (2.2.3): off a deck top rather than the hand
        // (A4, A13, A18 and the Apiary Service), so there is no card to hold
        // first - the building click alone narrows to it, exactly like `sow`
        // with `held === null`. `clickDeck` finishes it from the other end.
        if (answer.onto === building) sows.push(move);
      } else if (answer.kind === 'grow' && answer.building === building) {
        // ⭐ ROUTED 18/09/2026 (2.2.5), TAKING `grow` OFF
        // `UNROUTED_TASK_ANSWERS`. Two shapes share the kind:
        if (answer.deckSuit !== undefined) {
          // The Apiary retext's deck-paid Grow: no hand card either, so a
          // building click alone narrows to it (a deck click, `clickDeck`,
          // finishes it) and resolves alone when only one deck is live.
          growAnswers.push(move);
        } else if (held === null || answer.payment === held) {
          // A card-paid Grow task (the Apiary Worker's plain action, M7):
          // names a building AND the hand card that pays for it, so it takes
          // the same hold-a-card-then-click-the-building gesture as `sow`.
          growAnswers.push(move);
        }
      }
      continue;
    }
    if (move.type === 'harvest') {
      if (canHarvest && move.building === building) actions.push(move);
    } else if (move.type === 'grow') {
      // ⚠️ R15's MEEPLE-PAID GROW HAS NO CARD TO DRAG, so it is not reachable
      // from the hold-a-card-and-drop-it model at all and is filtered out here.
      // The engine still offers it to `legalMoves`, which is what the simulator
      // arm measures. Recorded rather than hidden: if v2 is ruled in, this line
      // owes a UI design - a meeple has to become something a hand can pick up.
      if (
        canGrow &&
        move.building === building &&
        move.payment !== null &&
        (held === null || move.payment === held)
      ) {
        actions.push(move);
      }
    }
  }
  return [...answers, ...activates, ...sows, ...growAnswers, ...actions];
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
 *
 * ⭐ `board` NAMES WHICH OF THE HOST'S NOTICE BOARDS (18/09/2026, 2.2.1):
 * absent for every seat but a two-player host holding two (`visitBoards` lists
 * the ids on offer). Passing none is still a legal call - it is how the rail's
 * per-seat glow probes "is this host visitable at all" before a board is
 * chosen - but `visitOffers` narrows by it exactly like the fee, so a draft
 * that never names one on a two-board host can still find more than one
 * surviving move; the caller (`Play.host`) is what must eventually supply it.
 */
export function clickHost(
  view: PlayerView,
  moves: readonly Move[],
  intent: Intent,
  host: Seat,
  board?: CardId,
): Intent | null {
  if (intent.k === 'arm' && intent.type !== 'visit') return null;
  if (intent.k === 'build' || intent.k === 'choose' || intent.k === 'deliver') return null;
  if (!armedHost(intent, host, view.seat)) return null;
  const held = intent.k === 'hold' ? intent.card : null;
  const draft: VisitDraft = { host, fee: held, ...(board !== undefined ? { board } : {}) };
  if (visitOffers(moves, draft).length === 0) return null;
  return { k: 'visit', ...draft };
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

/**
 * ONE WORKER OF THIS COLOUR, spent. Made on the Worker in your own supply, for
 * the same reason a card power is made on the card: it is a component in front
 * of you and the gesture is picking it up.
 *
 * It carries no intent filter and needs none. ⭐ `spendMeeple` IS LEGAL ONLY
 * AFTER THE MAIN ACTION, AT MOST ONE PER TURN (`rules.turn.meepleSpendTiming` /
 * `meepleSpendPerTurn`, shipped 14/09/2026 evening) - a change from the v31
 * start-of-turn window this comment used to describe. Both the timing and the
 * per-turn cap are read straight off the engine's own move list, which is
 * already the whole gate, so arming a family to reach a piece you are looking
 * straight at would be a click spent on nothing.
 */
export function clickMeeple(moves: readonly Move[], colour: Suit): Move[] {
  return moves.filter((m) => m.type === 'spendMeeple' && m.colour === colour);
}

/**
 * A deck spine. Since v31 a deck is a draw target and nothing else: the £1 buy
 * and the £3 market both went with the currency, so a click here can only ever
 * be a revealing draw task's answer.
 *
 * ⭐ ROUTED 18/09/2026 (2.2.3, 2.2.5): a deck is also where a `deckSow` answer
 * or the Apiary retext's deck-paid `grow` answer names its deck. Neither
 * carries a hand card, so - unlike `sow`/`grow` from a building - a deck click
 * needs no held-card filter; when more than one of the seat's buildings could
 * take the sow or Grow, the caller opens the generic menu the same way
 * `clickBuilding` does starting from the other end.
 */
export function clickDeck(moves: readonly Move[], _intent: Intent, suit: Suit): Move[] {
  const out: Move[] = [];
  for (const move of moves) {
    if (move.type !== 'task') continue;
    const answer = move.answer;
    if (answer.kind === 'deck' && answer.suit === suit) out.push(move);
    else if (answer.kind === 'deckSow' && answer.suit === suit) out.push(move);
    else if (answer.kind === 'grow' && answer.deckSuit === suit) out.push(move);
  }
  return out;
}

/**
 * A HAND CARD AS A `handToBarn` ANSWER (2.2.2, the Wheat and Vegetable boards'
 * follow-up): the task names the card by id and nothing else, so picking it up
 * IS the whole answer - there is no destination to choose afterwards, unlike a
 * build or a sow. `Play.hold` checks this before falling back to "pick the card
 * up", the same way `armBuildTask` pre-empts a build task's hold.
 */
export function clickHandCard(moves: readonly Move[], card: CardId): Move[] {
  const out: Move[] = [];
  for (const { move, answer } of answersOfKind(moves, 'handToBarn')) {
    if (answer.card === card) out.push(move);
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
  // ⚠️ RIVAL BUILDINGS TOO, ADDED 19/09/2026 - a pre-existing gap, not new
  // behaviour. `clickBuilding` has matched a `sow`/`deckSow` answer's `onto`
  // by card id alone, regardless of owner, since the Apiary suit rebuild gave
  // A10, A11 and A13 a cross-table sow onto a neighbour's building - but this
  // loop only ever fed it YOUR OWN tableau, so a rival building's DOM element
  // could never actually light up or accept a drop, even though clicking it
  // (the non-drag path) already worked. Caught by `drop.test.ts`'s "every sow
  // answer" sweep once a bot corpus happened to reach a position exercising
  // one of these cards; nothing about the fix is specific to that card.
  for (const rival of view.rivals) {
    for (const b of rival.tableau) {
      if (clickBuilding(moves, intent, b.card).length > 0) buildings.add(b.card);
    }
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

  // Mid-delivery the only tile that matters is the one being assembled, for
  // the same reason as the visit's `hosts` above: the panel owns the rest of
  // the decision, and lighting the others invites a click that would abandon
  // the draft rather than add to it.
  const tiles = new Set<string>();
  if (intent.k === 'deliver') {
    tiles.add(intent.draft.tile);
  } else {
    for (const tile of view.island.tiles) {
      if (clickTile(moves, intent, tile.tile).length > 0) tiles.add(tile.tile);
    }
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
  if (intent.k === 'visit')
    return visitFeeOptions(moves, intent.host, undefined, undefined, intent.board);
  // A delivery is paid from the barn, never the hand (2.5.1) - the same reason
  // `DROP_FAMILIES` marks tiles `null` - so the hand has nothing to say while
  // one is being assembled.
  if (intent.k === 'deliver') return new Set();
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
  // handToBarn (2.2.2): naming the card is the whole answer, with no building
  // or host to carry it to, so it has to be checked here directly rather than
  // falling out of one of the two loops above.
  if (clickHandCard(moves, card).length > 0) return true;
  return buildOffers(moves, card).length > 0;
}

// --- the visit --------------------------------------------------------------

/**
 * A part-made visit: whose board, WHICH of their boards, and which card is
 * going on it.
 *
 * ⭐ `fee` IS ONE CARD OR NONE (v31), where it used to be a list. The upgraded
 * Notice Board's "2 cards, take GBP 3" was the only route that ever placed two,
 * and it went with the second printed faces - so `legalMoves` now offers exactly
 * one visit per (host, hand card) pair and the progressive subset filter this
 * used to need has nothing left to narrow.
 *
 * ⭐ `board` NAMES ONE OF THE HOST'S NOTICE BOARDS (18/09/2026, 2.2.1), the
 * two-board fix's own optionality: absent for every seat but a two-player host
 * holding two (`visitBoards` lists the ids a host actually offers). A draft
 * left without one on a two-board host can still narrow the fee, but
 * `visitComplete` will not resolve past it - two boards means two different
 * powers, so the panel has to ask.
 */
export interface VisitDraft {
  readonly host: Seat;
  readonly board?: CardId;
  readonly fee: CardId | null;
}

/** Visits to this host (and board, once chosen), narrowed to the fee if one has been chosen. */
export function visitOffers(moves: readonly Move[], draft: VisitDraft): VisitMove[] {
  return moves.filter(
    (m): m is VisitMove =>
      m.type === 'visit' &&
      m.host === draft.host &&
      (draft.board === undefined || m.board === draft.board) &&
      (draft.fee === null || m.fee === draft.fee),
  );
}

/**
 * Cards that could pay for a visit. With a host, the fees that host will accept;
 * without one, every fee that buys SOME door - filtered to neighbours or to your
 * own board when the turn bar armed one of the two, and further to one board
 * when the host has more than one and it has been chosen.
 */
export function visitFeeOptions(
  moves: readonly Move[],
  host: Seat | null,
  you?: Seat,
  self?: boolean,
  board?: CardId,
): Set<CardId> {
  const out = new Set<CardId>();
  for (const move of moves) {
    if (move.type !== 'visit') continue;
    if (host !== null && move.host !== host) continue;
    if (board !== undefined && move.board !== board) continue;
    if (host === null && self !== undefined && you !== undefined) {
      if (self !== (move.host === you)) continue;
    }
    // `fee` is null under the retired meeple-currency visit arm: a visit
    // spends meeples there, not a card, so no hand card is ever a live drag
    // source for one. Never null under the shipped rival-board-power visit,
    // which is always paid with one card.
    if (move.fee !== null) out.add(move.fee);
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

/**
 * The distinct Notice Boards this host offers, by card id (18/09/2026, 2.2.1).
 * Empty for every seat but a two-player host holding two: the move's `board`
 * field is absent whenever a host has only one, which is what keeps every
 * other seat count byte-identical to a game that has never heard of the fix.
 * An empty result therefore means "this host's one board is unambiguous", not
 * "this host cannot be visited" - `visitOffers`/`clickHost` need no board at
 * all in that case.
 */
export function visitBoards(moves: readonly Move[], host: Seat): CardId[] {
  const out = new Set<CardId>();
  for (const move of moves) {
    if (move.type === 'visit' && move.host === host && move.board !== undefined) {
      out.add(move.board);
    }
  }
  return [...out].sort();
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

// --- the deliver assembly ----------------------------------------------------
//
// ⭐ ADDED 18/09/2026 (2.5.1, 2.5.2). Before this, a tile click resolved
// through the generic `resolve()` menu, which meant listing every enumerated
// crop-multiset the barn could pay in English - workable at the crate island's
// fixed cost, but the token island lets a first delivery choose a TOKEN too
// (`token`, an index into the tile's own array - see `state.ts`), and the
// Vegetable board's and a second delivery's wild allowance can each let up to
// two cards be ANY crop, which multiplies the enumeration the same way a wide
// build payment does. So it gets the same treatment build already has: a
// narrowing draft instead of a flat menu.
//
// ⭐ THE ANY-CROP RELAXATION NEEDS NO SPECIAL CASE (2.5.2). `spend` is a count
// per suit, never a card id (barn identity is inert - `deliver.ts`, the
// engine), and `deliverCandidates` only ever asks "which suits could still
// take one more card, given what is already committed" - an answer the
// engine's own enumeration already bakes the wildcard allowance into. A picker
// that offers exactly `deliverAdditions(...).suits` is therefore already
// letting a loose card be any crop the barn holds; nothing here has to know
// which cards are the "named" ones and which are the "any" ones.

/**
 * A part-assembled delivery: which tile, which TOKEN (when the tile still
 * offers a choice - absent until chosen, and irrelevant once only one
 * survives), and how many cards of each crop are committed so far.
 */
export interface DeliverDraft {
  readonly tile: string;
  readonly token: number | null;
  readonly spend: Partial<Record<Suit, number>>;
}

export function emptyDeliverDraft(tile: string): DeliverDraft {
  return { tile, token: null, spend: {} };
}

/** A delivery, from either side of the fence, normalised the way `BuildOffer` normalises a build. */
export interface DeliverOffer {
  readonly move: Move;
  readonly tile: string;
  readonly token: number | undefined;
  readonly spend: Partial<Record<Suit, number>>;
}

export function deliverOffers(moves: readonly Move[], tile?: string): DeliverOffer[] {
  const out: DeliverOffer[] = [];
  for (const move of moves) {
    if (move.type === 'deliver') {
      if (tile !== undefined && move.tile !== tile) continue;
      out.push({ move, tile: move.tile, token: move.token, spend: move.spend });
    } else if (move.type === 'task' && move.answer.kind === 'deliver') {
      const a = move.answer;
      if (tile !== undefined && a.tile !== tile) continue;
      out.push({ move, tile: a.tile, token: a.token, spend: a.spend });
    }
  }
  return out;
}

/** Is every suit `draft.spend` names covered by at least that many in `spend`? */
function spendWithin(
  spend: Partial<Record<Suit, number>>,
  draft: Partial<Record<Suit, number>>,
): boolean {
  for (const [suit, n] of Object.entries(draft) as [Suit, number][]) {
    if ((spend[suit] ?? 0) < n) return false;
  }
  return true;
}

function spendEqual(a: Partial<Record<Suit, number>>, b: Partial<Record<Suit, number>>): boolean {
  const suits = new Set([...Object.keys(a), ...Object.keys(b)] as Suit[]);
  for (const suit of suits) if ((a[suit] ?? 0) !== (b[suit] ?? 0)) return false;
  return true;
}

function spendTotal(spend: Partial<Record<Suit, number>>): number {
  let total = 0;
  for (const n of Object.values(spend)) total += n ?? 0;
  return total;
}

/** Offers still reachable from a partly-assembled draft. */
export function deliverCandidates(moves: readonly Move[], draft: DeliverDraft): DeliverOffer[] {
  return deliverOffers(moves, draft.tile).filter(
    (o) => (draft.token === null || o.token === draft.token) && spendWithin(o.spend, draft.spend),
  );
}

/** The one offer the draft has fully specified, if it has. */
export function deliverComplete(moves: readonly Move[], draft: DeliverDraft): DeliverOffer | null {
  const exact = deliverCandidates(moves, draft).filter((o) => spendEqual(o.spend, draft.spend));
  return exact[0] ?? null;
}

/** What may still be added to a delivery: which tokens, which suits, and how many more cards. */
export interface DeliverAdditions {
  /** Token indices still open. Empty once the tile offers no choice at all. */
  readonly tokens: readonly number[];
  /** Suits that could still take another card - the any-crop relaxation lives entirely in this set (2.5.2). */
  readonly suits: ReadonlySet<Suit>;
  readonly remaining: { readonly min: number; readonly max: number };
}

export function deliverAdditions(moves: readonly Move[], draft: DeliverDraft): DeliverAdditions {
  const tokens = new Set<number>();
  const suits = new Set<Suit>();
  const committed = spendTotal(draft.spend);
  let min = Infinity;
  let max = 0;

  for (const offer of deliverCandidates(moves, draft)) {
    if (offer.token !== undefined) tokens.add(offer.token);
    const short = spendTotal(offer.spend) - committed;
    min = Math.min(min, short);
    max = Math.max(max, short);
    for (const [suit, n] of Object.entries(offer.spend) as [Suit, number][]) {
      if (n > (draft.spend[suit] ?? 0)) suits.add(suit);
    }
  }

  return {
    tokens: [...tokens].sort((a, b) => a - b),
    suits,
    remaining: { min: min === Infinity ? 0 : min, max },
  };
}

export function withDeliverToken(draft: DeliverDraft, token: number): DeliverDraft {
  return { ...draft, token: draft.token === token ? null : token };
}

/** Add one card of this crop to the payment. */
export function withDeliverCard(draft: DeliverDraft, suit: Suit): DeliverDraft {
  return { ...draft, spend: { ...draft.spend, [suit]: (draft.spend[suit] ?? 0) + 1 } };
}

/** Take one card of this crop back off the payment. */
export function withoutDeliverCard(draft: DeliverDraft, suit: Suit): DeliverDraft {
  const n = (draft.spend[suit] ?? 0) - 1;
  const spend = { ...draft.spend };
  if (n <= 0) delete spend[suit];
  else spend[suit] = n;
  return { ...draft, spend };
}

/**
 * Start (or restart) a delivery: sends immediately when the tile names only
 * one legal delivery, opens the assembly otherwise. Null when the tile is not
 * a target at all right now. Mirrors `startBuild` in `session/play.ts`.
 */
export function deliverStart(
  moves: readonly Move[],
  tile: string,
): { move: Move } | { draft: DeliverDraft } | null {
  const draft = emptyDeliverDraft(tile);
  const complete = deliverComplete(moves, draft);
  if (complete) return { move: complete.move };
  return deliverCandidates(moves, draft).length > 0 ? { draft } : null;
}

/**
 * A draft that already names a whole offer's tile, token and spend (B4,
 * 25/09/2026). Used to pre-fill the deliver assembly for a single-candidate
 * Deliver rather than sending it straight away - see `ActionBar.tsx`'s
 * `onGroup`, which used to let a lone legal delivery play itself the moment
 * the Deliver button was clicked, spending a whole barn (often 4 cards) with
 * no assembly and no way back. The draft this returns is already `deliverComplete`,
 * so the panel opens showing every chip paid and a live confirm button - the
 * player still has to click it.
 */
export function deliverDraftFromOffer(offer: DeliverOffer): DeliverDraft {
  return { tile: offer.tile, token: offer.token ?? null, spend: { ...offer.spend } };
}

/**
 * How many cards a move spends in one click, for the same B4 rule: a lone
 * legal candidate that spends 2 or more cards must not fire from a single
 * button press with nothing shown first. Grow's one card and Harvest's none
 * never trip it; Build already never reaches the shortcut this guards
 * (`onGroup` excludes it, and `startBuild` only auto-sends a free build) and
 * Deliver is the one family that does.
 */
export function cardsSpent(move: Move): number {
  switch (move.type) {
    // A raw `build` move never carries `stacks` - that field only exists on a
    // build TASK's answer (`BuildOffer.stacks`), and a task answer is not what
    // this guards: Build is excluded from the shortcut before `cardsSpent` is
    // ever asked (see `ActionBar.tsx`'s `onGroup`).
    case 'build':
      return move.payment.length;
    case 'grow':
      return move.payment === null ? 0 : 1;
    case 'deliver':
      return Object.values(move.spend).reduce((a: number, b) => a + (b ?? 0), 0);
    case 'visit':
      return move.fee === null ? 0 : 1;
    default:
      return 0;
  }
}

/**
 * What clicking the Deliver family button on the turn bar should do (B4,
 * 25/09/2026). Factored out of `ActionBar.tsx`'s `onGroup` so the rule is
 * unit-testable on its own: with more than one legal delivery, arm the
 * family exactly as any other multi-candidate family does; with exactly one
 * and it spends 2 or more cards, open the assembly PRE-FILLED with that
 * offer rather than sending it (the appraisal's `deliver-armed-1600.png`:
 * a lone legal delivery used to spend a whole barn, often 4 cards, the
 * instant the button was clicked, with nothing shown first and no way back);
 * with one spending fewer than 2, send it straight away like any other
 * cheap single-target family (Grow, Harvest).
 */
export function deliverFamilyClick(
  moves: readonly Move[],
): { k: 'send'; move: Move } | { k: 'prefill'; draft: DeliverDraft } | { k: 'arm' } {
  if (moves.length !== 1) return { k: 'arm' };
  const move = moves[0] as Move;
  if (cardsSpent(move) >= 2) {
    const offer = deliverOffers(moves)[0];
    if (offer) return { k: 'prefill', draft: deliverDraftFromOffer(offer) };
  }
  return { k: 'send', move };
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
 * ⛔ TASK ANSWER KINDS THIS INTERFACE KNOWINGLY CANNOT RESOLVE (ledger C59).
 *
 * ⭐ EMPTY SINCE 18/09/2026 (2.2.5). `grow` used to sit here: a Grow task
 * answer names a building AND either a hand card or a deck, which used to be
 * two clicks the prompt had no shape for. `clickBuilding` and `clickDeck` now
 * resolve both (a building-then-deck path for the Apiary retext's deck-paid
 * Grow, the existing hold-a-card-then-click-the-building gesture `sow` already
 * used for the card-paid one), so nothing is left admitted here. The list
 * stays rather than being deleted outright - the anti-rot policing below is
 * worth keeping wired for whatever the next rules change turns up unclickable.
 *
 * ⚠️ POLICED THE SAME WAY. `intent.test.ts` asserts that no position in the
 * UI's own corpus offers a kind named here, so the day this package's data can
 * produce one the list fails rather than silently hiding an unclickable rule.
 */
export const UNROUTED_TASK_ANSWERS = [] as const satisfies readonly TaskAnswer['kind'][];

/** A task answer kind this interface admits it cannot resolve. */
export type UnroutedTaskAnswer = (typeof UNROUTED_TASK_ANSWERS)[number];

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
  // ⚠️ `bonusDrawOpen` (engine `actions/bonus.ts`) already returns false under
  // `isNoticeBoardPower(data)` - the shipped default (2.2.7, ledger C59) - so
  // no `bonusDraw` move reaches this package's `moves` list once the game data
  // is actually pinned to it. The route entry stays for exhaustiveness
  // (`intent.test.ts` checks this object against the engine's own
  // `MOVE_TYPES`) and for the v31/meeple arms this package's own tests may
  // still exercise, not because the shipped bonus slot offers a button here.
  bonusDraw: 'action-bar',
  spendMeeple: 'meeple-supply',
  build: 'build-panel',
  grow: 'building',
  harvest: 'building',
  // ⭐ ALSO `deliver-panel` SINCE 18/09/2026 (2.5.1): a tile click starts the
  // assembly (`deliverStart`), and its token/spend buttons live in
  // `DeliverPanel` (`components/BuildPanel.tsx`) via `Play.setDeliverDraft`.
  deliver: 'island-tile',
  visit: 'visit-panel',
  // `collect` is a bonus-slot button beside Draw 1 under the retired
  // meeple-currency visit, so it routes where `bonusDraw` routes. Neither is a
  // button the shipped bonus slot draws (S5: it holds one option, the visit).
  collect: 'action-bar',
  pass: 'action-bar',
  endTurn: 'action-bar',
} satisfies Record<MoveType, string>;
