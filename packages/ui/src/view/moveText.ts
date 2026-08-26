/**
 * Moves and task answers, in English.
 *
 * Used by three surfaces that must agree: the action bar's family buttons, the
 * disambiguation menu a click opens when it matched more than one move, and the
 * task prompt's fallback list. Writing them once means the fallback is never a
 * dump of JSON - which matters, because the fallback is what guarantees ticket
 * 25's "every task answerable" for a card escape hatch nobody has written a
 * bespoke surface for.
 */

import type { BuildCost, GameData, Suit, WorkerAction } from '@gp/data';
import type { CardId, Move, MoveType, PlayerView, Seat, Task, TaskAnswer } from '@gp/engine';

import { buildOffers, pendingTask } from './intent';
import type { PrintedFace } from './printed';
import { SUIT_META, seatName } from './suits';
import { liveThreshold, seatSuits } from './table';

export function cardName(data: GameData, id: string): string {
  if (id.endsWith('?')) {
    const suit = data.cards.suits.find((s) => s.charAt(0).toUpperCase() === id.charAt(0));
    return suit ? `a ${SUIT_META[suit].label} card` : 'a card';
  }
  return data.cards.catalogue.find((c) => c.id === id)?.name ?? id;
}

export function spendText(spend: Partial<Record<Suit, number>>): string {
  const parts = (Object.entries(spend) as [Suit, number][])
    .filter(([, n]) => n > 0)
    .map(([suit, n]) => `${n} ${SUIT_META[suit].label}`);
  return parts.length === 0 ? 'nothing' : parts.join(' + ');
}

export function workerName(data: GameData, id: WorkerAction): string {
  return data.workers.roster.find((w) => w.id === id)?.name ?? id;
}

function who(view: PlayerView, seat: Seat): string {
  return seatName(seatSuits(view)[seat], seat, view.seat);
}

function cardList(data: GameData, ids: readonly string[]): string {
  return ids.length === 0 ? 'nothing' : ids.map((id) => cardName(data, id)).join(', ');
}

/**
 * V2 The Vegetable Farmstead's head, spelled out on the option. Without it two
 * deliveries to the same tile read identically and one of them silently costs a
 * hand card, which is the difference between the option list explaining the
 * card and the option list hiding it.
 */
function headText(data: GameData, head: readonly string[] | undefined): string {
  if (head === undefined || head.length === 0) return '';
  return ` (loading ${cardList(data, head)} from your hand first)`;
}

/**
 * "on a neighbour's farm", for the two sows that can leave your own tableau
 * (A4's replacement card, A14's placement). `describeAnswer` has no view, so it
 * cannot name the seat; what it must never do is let a cross-table placement
 * read identically to one of your own.
 */
function seatSuffix(ontoSeat: Seat | undefined): string {
  return ontoSeat === undefined ? '' : " on a neighbour's farm";
}

export function describeAnswer(data: GameData, answer: TaskAnswer): string {
  switch (answer.kind) {
    case 'worker':
      return `the ${workerName(data, answer.workerId)}`;
    case 'deck':
      return `the ${SUIT_META[answer.suit].label} deck`;
    case 'keep':
      return `keep ${cardList(data, answer.cards)}`;
    case 'building':
      return cardName(data, answer.card);
    case 'activate':
      return `fire ${cardName(data, answer.card)}`;
    case 'sow':
      return `${cardName(data, answer.card)} onto ${cardName(data, answer.onto)}${seatSuffix(answer.ontoSeat)}`;
    case 'build':
      return `${cardName(data, answer.card)}, paying ${cardList(data, answer.payment)}${
        answer.stacks?.length ? ` + ${cardList(data, answer.stacks)} off your buildings` : ''
      }`;
    case 'deliver':
      return `island ${answer.tile}, spending ${spendText(answer.spend)}${headText(data, answer.head)}`;
    case 'balloon':
      return `the ${balloonWord(answer.balloon)} balloon, spending ${spendText(answer.spend)}`;
    case 'deckSow':
      return `the top ${SUIT_META[answer.suit].label} card onto ${cardName(data, answer.onto)}${seatSuffix(answer.ontoSeat)}`;
    case 'handToBarn':
      return `${cardName(data, answer.card)} into your barn`;
    case 'discard':
      return `discard ${cardList(data, answer.cards)}`;
    case 'skip':
      return 'decline';
    case 'card':
      return describeCardPayload(data, answer.payload);
    default:
      return answer satisfies never;
  }
}

/**
 * The escape-hatch answer, said in words.
 *
 * A `card` payload is whatever its handler decided, so this cannot be
 * exhaustive and does not pretend to be: it recognises the shapes in play and
 * falls back to the raw JSON, which is what the whole family used to print. The
 * Vegetable rebuild made that fallback unacceptable at the table - the two cards
 * that reach the island's demand tokens are the suit, and `{"a":{"tile":"A5",…}}`
 * is not a choice anybody can make.
 */
function describeCardPayload(data: GameData, payload: Record<string, unknown>): string {
  const crate = (ref: unknown): string => {
    const r = ref as { tile?: string; crate?: number };
    return r.tile === undefined ? '?' : `${r.tile} crate ${(r.crate ?? 0) + 1}`;
  };
  // V5: swap two of the island's demand tokens.
  if (payload.a !== undefined && payload.b !== undefined) {
    return `swap the demand on ${crate(payload.a)} with ${crate(payload.b)}`;
  }
  // V6: turn one face down.
  if (payload.tile !== undefined && payload.crate !== undefined) {
    return `turn the demand on ${crate(payload)} face down`;
  }
  // V14: one payment, both receipts.
  if (payload.tile !== undefined && payload.spend !== undefined) {
    return `island ${String(payload.tile)}, spending ${spendText(
      payload.spend as Partial<Record<Suit, number>>,
    )} for BOTH receipts`;
  }
  // V4 / V8: a flight paid out of hand, and V8's choice of cargo.
  if (payload.balloon !== undefined) {
    const cards = payload.cards as string[] | undefined;
    return cards === undefined
      ? `the ${balloonWord(String(payload.balloon))} balloon's reward`
      : `the ${balloonWord(String(payload.balloon))} balloon, discarding ${cardList(data, cards)}`;
  }
  // V2's upgraded Farmstead: a barn card traded for a deck top.
  if (payload.gone !== undefined && payload.into !== undefined) {
    return `swap a ${SUIT_META[payload.gone as Suit].label} card for the top ${
      SUIT_META[payload.into as Suit].label
    } card`;
  }
  // V13: one barn card at a time out, and the deck each one comes back from.
  if (payload.suit !== undefined) {
    return `discard a ${SUIT_META[payload.suit as Suit].label} card from your barn`;
  }
  if (payload.take === true) return 'accept';
  return JSON.stringify(payload);
}

export function balloonWord(id: string): string {
  return (
    id
      .replace(/balloon/i, '')
      .replace(/[-_]/g, ' ')
      .trim()
      .toLowerCase() || id
  );
}

export function describeMove(data: GameData, view: PlayerView, move: Move): string {
  switch (move.type) {
    case 'task':
      return describeAnswer(data, move.answer);
    case 'cardMove':
      // A Tier 3 ACTION card is a main action, so it reads as one rather than
      // as an internal move kind. Everything else keeps the generic form.
      return move.kind === 'action'
        ? `${cardName(data, move.card)}: take its ACTION (instead of your action)`
        : `${cardName(data, move.card)}: ${move.kind}`;
    case 'draw':
      return 'Draw';
    case 'buy':
      return `Buy the top ${SUIT_META[move.suit].label} card for £${data.rules.turn.buyCost ?? 0}`;
    case 'market':
      return `Buy at market: the top ${SUIT_META[move.suit].label} card into your barn, for £${data.rules.turn.marketCost ?? 0}`;
    case 'build':
      return `Build ${cardName(data, move.card)}, paying ${cardList(data, move.payment)}`;
    case 'upgrade':
      return `Upgrade ${cardName(data, move.card)} for £${data.rules.economy.upgradeCostCoins}`;
    case 'grow':
      return `Grow ${cardName(data, move.building)}, paying ${cardName(data, move.payment)}`;
    case 'harvest':
      return `Harvest ${cardName(data, move.building)}`;
    case 'deliver':
      return `Deliver to island ${move.tile}: ${spendText(move.spend)}${headText(data, move.head)}`;
    case 'moveBalloon':
      return `Bring in the ${balloonWord(move.balloon)} balloon: ${spendText(move.spend)}`;
    case 'visit':
      return `Visit ${who(view, move.host)} with ${cardList(data, move.fee)} - ${
        move.payoff.mode === 'coin'
          ? 'take the money'
          : move.payoff.mode === 'special'
            ? 'the Special Orders prize'
            : `work their ${workerName(data, move.payoff.workerId)}`
      }`;
    case 'workOwnWorker':
      return `Work your own ${workerName(data, move.workerId)}`;
    case 'pass':
      return 'Pass';
    case 'endTurn':
      return 'End turn';
    default:
      return move satisfies never;
  }
}

/** What a pending task is asking for, as a prompt line. */
export function describeTask(data: GameData, task: Task): string {
  switch (task.t) {
    case 'chooseWorker':
      return task.owned === 'rival'
        ? "Work one of your neighbours' Hired Workers."
        : 'Choose a Hired Worker to work.';
    case 'draw':
      return task.revealed.length < task.see
        ? `Turn over a card: pick a deck (${task.revealed.length} of ${task.see} seen).`
        : `Keep ${Math.min(task.keep, task.revealed.length)} of the ${task.revealed.length} you saw. The rest go to their discards.`;
    case 'chooseBuilding':
      return 'Choose one of your buildings to harvest.';
    case 'sow':
      return `Sow ${task.remaining} card${task.remaining === 1 ? '' : 's'}: pick one from your hand, then a building to place it on. Any suit will do.`;
    case 'sowFromDeck':
      return `Sow ${task.remaining} card${task.remaining === 1 ? '' : 's'} off a DECK TOP: pick a crop, then a building. The card never touches your hand.`;
    case 'activate':
      return `GROW ${task.remaining} of your buildings WITHOUT PLACING A CARD: pick one and its ability fires. Nothing is paid, nothing is added to its stack, and a full building is a fine target.`;
    case 'handToBarn':
      return `You may put ${task.remaining} card${task.remaining === 1 ? '' : 's'} from your hand into your barn.`;
    case 'build':
      return 'Build a card from your hand.';
    case 'deliver':
      return 'Deliver: choose an island tile, or bring in a balloon.';
    case 'discard':
      return `Your barn caps your hand at ${task.downTo}. Choose what to discard.`;
    case 'divert':
      return task.fromDraw
        ? `${task.cards.length} card${task.cards.length === 1 ? '' : 's'} heading for the discard: give one to a neighbour, buy one into your barn for £1, or let them go.`
        : `${task.cards.length} card${task.cards.length === 1 ? '' : 's'} heading for the discard: buy one into your barn for £1, or let them go.`;
    case 'card':
      return `${cardName(data, task.src)}: choose.`;
    default:
      return task satisfies never;
  }
}

// --- the turn bar's families ------------------------------------------------

/**
 * WHERE A FAMILY BELONGS ON THE BAR (phase 3).
 *
 * The turn is one action plus one bonus slot, and until 26/08 the bar said
 * otherwise: fourteen buttons in one flat row, all the same size, half of them
 * greyed. That is not merely dense, it is a lie about the rules - it reads as
 * fourteen verbs. The zone is how the table states the truth once, in the data,
 * rather than leaving every call site to infer it:
 *
 *   action   spends your MAIN ACTION. Exactly one of these a turn.
 *   bonus    spends your BONUS SLOT. Exactly one of these a turn, at its start.
 *   exit     spends neither: leaving the turn, or leaving a half-made decision.
 *
 * It replaces the old `bonus?: true` boolean, which could only ever answer half
 * the question and left "is End turn an action?" to whoever was rendering.
 */
export type TurnZone = 'action' | 'bonus' | 'exit';

export interface ActionGroup {
  readonly type: MoveType;
  readonly label: string;
  readonly hint: string;
  /** True when clicking it needs a target next rather than playing immediately. */
  readonly needsTarget: boolean;
  /** Which of the turn's three parts this family spends. */
  readonly zone: TurnZone;
  /**
   * False when this game is not playing the rule at all - the knob is null, or
   * the module is not on the table. Distinct from "no legal move right now",
   * which is a property of the POSITION and is what the greyed button says.
   */
  readonly inPlay: boolean;
  /**
   * True when the family's home is a PIECE ON THE BOARD rather than a button.
   * The research is explicit that a board component's move should be made on
   * the component - "players should act on the board like in real life" - so the
   * bar does not draw a button for it and the piece carries the affordance.
   */
  readonly onBoard: boolean;
  readonly moves: Move[];
}

/**
 * The five main actions, the bonus slot and the turn's exits, in the order the
 * rulebook teaches them. A family with no legal move is still listed, greyed:
 * "what can I not do" is half of learning a turn, and hiding it would make the
 * bar jump about between turns.
 *
 * ⚠️ `buy` and `market` STAY IN THIS TABLE. Both rules were deleted on
 * 19/08/2026 and both knobs are null in the shipped data, but they are knobs -
 * `overlays/*.json` flip them back and the paired arms are how the decision gets
 * re-measured. Deleting the rows would take the interface out of that loop; what
 * `inPlay` does instead is stop drawing a permanently dead button while the rule
 * is off, and start drawing it again the moment an overlay turns it on. Which
 * moves EXIST is a rules question, settled elsewhere.
 */
const FAMILIES: readonly {
  type: MoveType;
  label: string;
  hint: string;
  needsTarget: boolean;
  zone: TurnZone;
  /**
   * Is this game playing the rule at all? Absent means "always".
   */
  inPlay?: (data: GameData) => boolean;
  /** See `ActionGroup.onBoard`. */
  onBoard?: true;
}[] = [
  {
    type: 'draw',
    label: 'Draw',
    hint: 'Top of any two decks, keep one',
    needsTarget: false,
    zone: 'action',
  },
  {
    type: 'buy',
    label: 'Buy',
    hint: 'Free, once a turn: £1 for the top card of a neighbouring crop',
    needsTarget: true,
    zone: 'action',
    inPlay: (data) => data.rules.turn.buyCost !== null,
  },
  { type: 'build', label: 'Build', hint: 'Pay cards from hand', needsTarget: true, zone: 'action' },
  {
    type: 'grow',
    label: 'Grow',
    hint: 'Activate one of your buildings',
    needsTarget: true,
    zone: 'action',
  },
  {
    type: 'harvest',
    label: 'Harvest',
    hint: 'Take a full stack into your barn',
    needsTarget: true,
    zone: 'action',
  },
  {
    type: 'deliver',
    label: 'Deliver',
    hint: 'Barn to the island',
    needsTarget: true,
    zone: 'action',
  },
  /*
   * ON THE BOARD, NOT ON THE BAR (26/08/2026) - the single cut that took the
   * main phase from nine buttons to eight, and the one worth arguing.
   *
   * Freight is not one of the game's actions. The five are Draw, Build, Grow,
   * Harvest and Deliver, and `moveBalloon` is the DELIVER action's freight
   * branch: it exists only when Vegetables is at the table, it is one of two
   * destinations for the same action, and `MOVE_ROUTES` has always said its home
   * is the balloon. Drawing it as a permanent sixth verb, greyed on most turns
   * and absent from most games, is the same lie this phase came to fix - a bar
   * claiming more verbs than the rules have.
   *
   * It costs nothing in reach. The Aerodrome is a labelled panel in the commons,
   * every balloon in it is a button, and a balloon you could bring in wears the
   * live glow like any other target - so the move is one click away, on the
   * piece it moves, which is where a player looks for it anyway.
   */
  {
    type: 'moveBalloon',
    label: 'Freight',
    hint: 'Bring in a balloon',
    needsTarget: true,
    zone: 'action',
    onBoard: true,
  },
  {
    type: 'visit',
    label: 'Visit',
    hint: "Bonus: a card on a neighbour's board, for £1 or their power",
    needsTarget: true,
    zone: 'bonus',
  },
  {
    type: 'market',
    label: 'Market',
    hint: 'Bonus: £3 for the top card of any crop, into your barn',
    needsTarget: true,
    zone: 'bonus',
    inPlay: (data) => data.rules.turn.marketCost !== null,
  },
  {
    type: 'workOwnWorker',
    label: 'Work yours',
    hint: 'Bonus: £1 to use your own power. No card, no wage.',
    needsTarget: true,
    zone: 'bonus',
  },
  // Moved down here on 19/08/2026 with the rule: the starter flip stopped being
  // a Build-action branch and became the fourth bonus option.
  {
    type: 'upgrade',
    label: 'Upgrade',
    hint: 'Bonus: £2 to flip a starter. Three of them, once each, all game.',
    needsTarget: true,
    zone: 'bonus',
  },
  /*
   * ON THE CARD, NOT ON THE BAR (26/08/2026). A `cardMove` is a standing move a
   * BUILT CARD is offering - today only the Helping Hand's repeat - so the card
   * is where it is made. "Card power" as a bar button was the interface asking a
   * player to look away from the thing that grants the move and hunt for a
   * generic button that names no card.
   *
   * The row stays here so the table remains the complete list of families and
   * the fallback is one line: drop `onBoard` and it prints in the exits again.
   */
  {
    type: 'cardMove',
    label: 'Card power',
    hint: 'A standing move on a card',
    needsTarget: false,
    zone: 'exit',
    onBoard: true,
  },
  {
    type: 'pass',
    label: 'Pass',
    hint: 'Nothing else is legal',
    needsTarget: false,
    zone: 'exit',
  },
  {
    type: 'endTurn',
    label: 'End turn',
    hint: 'Decline what is left',
    needsTarget: false,
    zone: 'exit',
  },
];

/**
 * Build is the one family reachable from two move types. A card that grants a
 * Build (W7 Golden Field, the Build Worker) offers it as a build TASK, whose
 * moves are `type: 'task'` - so a plain `m.type === family.type` filter greys
 * the Build button at the exact moment the prompt is asking for a build. Every
 * other task is answered in place on a building, a deck or a tile, which is why
 * this stays a one-family exception rather than a general answer-to-family map.
 *
 * `data` is here only for `inPlay`. It is read once per render and never
 * consulted about legality: the moves list is still the only thing that decides
 * whether a family is enabled.
 */
export function actionGroups(data: GameData, moves: readonly Move[]): ActionGroup[] {
  return FAMILIES.map((family) => ({
    ...family,
    inPlay: family.inPlay?.(data) ?? true,
    onBoard: family.onBoard === true,
    moves: moves.filter(
      (m) =>
        m.type === family.type ||
        (family.type === 'build' && m.type === 'task' && m.answer.kind === 'build'),
    ),
  }));
}

// --- the gloss block --------------------------------------------------------
//
// THE THING THE READING REGION IS ACTUALLY FOR.
//
// The region was paid for by shrinking every other card on screen, and a bigger
// picture of the same card would not have been worth that price. What is worth
// it is the Race for the Galaxy lesson: the win there was never the zoom, it was
// that a tap tells you what the icon MEANS, in a sentence, in your own language.
//
// So the block never reprints the card. The card is directly above it at
// reading size and already says "GROW another of your buildings without placing
// a card"; printing that a second time doubles the reading and teaches nothing.
// What is added is only what the card cannot say about itself:
//
//   glossAbility  what its KEYWORDS mean, once each, in plain English
//   glossCost     what it costs, in words rather than in a row of icons
//   glossNow      what you could do with it RIGHT NOW, off the live position
//
// The last of those is the valuable one and the dangerous one. It is the only
// text on this screen a player will act on without checking, so its rule is
// that a wrong reason is worse than no reason: every claim below is either
// derived from the engine's own move list or from arithmetic that has been
// checked against the engine's, and anything else degrades to silence.

/** One keyword and what it means. Rendered as a definition list. */
export interface GlossTerm {
  readonly term: string;
  readonly means: string;
}

/**
 * The keywords worth a sentence, and the sentence.
 *
 * Detection is a word-boundary match on the PRINTED text, case-insensitive,
 * because the sheet is not consistent about capitals: A1 prints "sow the top
 * card", A7 prints "Sow 1 card" and O5 prints "SOW 1 card", and all three are
 * the same keyword to a player who has never met it. The boundaries matter as
 * much as the words - VISIT must not fire on VISITOR, which is the same rule
 * seen from the other side of the table and gets its own line.
 *
 * ⚠️ HIRE and WORK appear on NO card in the current sheet. They are kept
 * because change 6 (20/08/2026) folded the Hiring Fair into the Notice Board
 * and a re-text could bring the words back, and an unglossed keyword is exactly
 * the failure this block exists to prevent. They are worded from the rulebook
 * rather than from the data, which is the honest limit of what can be said
 * about a system the code does not currently run.
 *
 * `means` takes the data so a number that is a knob stays a knob: the visit
 * payout has moved twice this month and a hard-coded "£1" here would be a lie
 * the moment somebody sweeps it.
 */
const KEYWORDS: readonly {
  readonly term: string;
  readonly pattern: RegExp;
  readonly means: (data: GameData) => string;
}[] = [
  {
    term: 'GROW',
    pattern: /\bgrow(s|n|ing)?\b/i,
    means: () =>
      'Activate your own building: pay 1 card of its crop onto its stack, take its ability.',
  },
  {
    term: 'SOW',
    pattern: /\bsow(s|n|ing)?\b/i,
    means: () =>
      'Place a card on a building without activating it. It never has to match the crop.',
  },
  {
    term: 'VISIT',
    pattern: /\bvisit(s|ed|ing)?\b/i,
    means: (data) =>
      `Your bonus slot: 1 card onto a neighbour's Notice Board, for £${data.rules.economy.visitPayout.base} or their Service's action.`,
  },
  {
    term: 'VISITOR',
    pattern: /\bvisitors?\b/i,
    means: () => 'What a neighbour gets for visiting you. You never visit your own farm.',
  },
  {
    term: 'HIRE',
    // Deliberately narrower than the others: "Hired Worker" is the NAME of a
    // component and appears wherever workers do, so matching "hired" would
    // gloss the noun every time the card merely mentioned one.
    pattern: /\bhires?\b/i,
    means: () => 'Build a Hired Worker out of the centre, paying the bank. One to a farm.',
  },
  {
    term: 'WORK',
    pattern: /\bwork(s|ed|ing)?\b/i,
    means: () => "Take a Hired Worker's action, and advance it one space along its Working Week.",
  },
];

/**
 * The keywords in one printed ability, expanded once each, in a fixed order.
 *
 * Fixed order rather than order of appearance so the block does not reshuffle
 * itself between two cards that print the same pair of keywords the other way
 * round. Empty for a card with no ability text, which is the Barn and the
 * Farmstead's whole answer here and is not a defect.
 */
export function glossAbility(data: GameData, text: string): GlossTerm[] {
  if (text.trim() === '') return [];
  return KEYWORDS.filter((k) => k.pattern.test(text)).map((k) => ({
    term: k.term,
    means: k.means(data),
  }));
}

function slotOf(data: GameData, id: CardId): string | undefined {
  return data.cards.catalogue.find((c) => c.id === id)?.slot;
}

/**
 * A build cost as a sentence rather than as a row of icons.
 *
 * `spendText` does the crop half, deliberately: it is the formatter the action
 * bar, the disambiguation menu and the task prompt already share, so a suit
 * renamed in `SUIT_META` cannot come out one way on a button and another way
 * here. The wild and coin halves have no equivalent, because no other surface
 * has ever had to name them.
 */
function buildCostWords(suit: Suit, cost: BuildCost): string {
  const parts: string[] = [];
  if (cost.suit > 0) parts.push(spendText({ [suit]: cost.suit }));
  if (cost.wild > 0) parts.push(`${cost.wild} of any crop`);
  if (cost.coins > 0) parts.push(`£${cost.coins}`);
  return parts.length === 0 ? 'nothing' : parts.join(' + ');
}

/**
 * What this face costs and what its stack does, in words.
 *
 * Three lines at most, and every one of them is a property of the CARD rather
 * than of the position, so this is the half of the block that reads the same
 * whether or not there is a game going on. That is why it is separate from
 * `glossNow`: the read-only render path and the rival inspector still get it.
 *
 * The starter is the one shape that needs its own line. It has no build cost -
 * you begin with it - so its icons print the £2 that FLIPS it, and calling that
 * "to build" would teach a rule the game does not have.
 */
export function glossCost(data: GameData, face: PrintedFace): string[] {
  const card = data.cards.catalogue.find((c) => c.id === face.id);
  const out: string[] = [];

  if (card?.buildCost) {
    out.push(`To build: ${buildCostWords(face.suit, card.buildCost)}.`);
  } else if (card?.type === 'starter' && !face.upgraded) {
    const price = card.upgradeCostCoins ?? data.rules.economy.upgradeCostCoins;
    out.push(`To flip: £${price}, in your bonus slot. Once each, all game.`);
  }

  const noticeBoard = card?.slot === 'noticeboard';
  // A Notice Board is filled by VISITORS and is never a GROW target (the engine
  // excludes it by slot in `growOptions`), so printing its activation cost here
  // would be offering a move that does not exist.
  if (face.activation !== null && !noticeBoard) {
    out.push(
      face.activation === 'wild'
        ? 'To GROW: 1 card of any crop onto its stack.'
        : `To GROW: ${spendText({ [face.activation]: 1 })} onto its stack.`,
    );
  }

  const threshold = liveThreshold(data, face.id, face.threshold);
  if (threshold !== null) {
    out.push(
      noticeBoard
        ? `Neighbours fill it: ${threshold}, then it clogs until you harvest.`
        : `Holds ${threshold}; full, it clogs until you harvest.`,
    );
  }

  return out;
}

/**
 * THE SHORTFALL, and why it is computed rather than asked for.
 *
 * The engine hands over the moves that ARE legal and says nothing about the
 * ones that are not, so "why can I not build this" has to be worked out here.
 * That is only safe because the MAIN Build action carries no modifiers -
 * `game.ts` calls `buildOptions` with an empty `mods`, so the printed cost is
 * the real price - and because the guards in `glossNow` refuse to run this
 * unless the position is one where the printed cost is the whole story.
 *
 * The rule the engine actually enforces (`paymentsFor`): pay `suit + wild`
 * cards out of hand, of which at least `suit` must really be the built card's
 * crop, and hold `coins`. So the gap is own-crop first, then any-crop for
 * whatever is still owed after those arrive, then coins.
 *
 * Returns null when the arithmetic says the build should be affordable and the
 * engine says otherwise. That is not an error to hide - it is the case where we
 * have no reason we trust, and the caller prints the plain "not yet" instead of
 * inventing one.
 */
function shortfallWords(
  data: GameData,
  face: PrintedFace,
  cost: BuildCost,
  view: PlayerView,
): string | null {
  const rest = [...view.you.hand];
  const self = rest.indexOf(face.id);
  if (self >= 0) rest.splice(self, 1);

  const own = rest.filter(
    (id) => data.cards.catalogue.find((c) => c.id === id)?.suit === face.suit,
  ).length;
  const ownShort = Math.max(0, cost.suit - own);
  const anyShort = Math.max(0, cost.suit + cost.wild - rest.length - ownShort);
  const coinShort = Math.max(0, cost.coins - view.you.coins);

  const parts: string[] = [];
  if (ownShort > 0) parts.push(spendText({ [face.suit]: ownShort }));
  if (anyShort > 0) parts.push(`${anyShort} more card${anyShort === 1 ? '' : 's'}`);
  if (coinShort > 0) parts.push(`£${coinShort}`);
  return parts.length === 0 ? null : parts.join(' + ');
}

/**
 * What you could do with this card RIGHT NOW. The most valuable line in the
 * block, and the only one that is allowed to be silent.
 *
 * Three shapes, in the order a player meets them:
 *
 *   in your tableau   how full it is, and whether GROW is on offer
 *   in your hand      buildable, or not yet and by how much
 *   anywhere else     nothing at all
 *
 * That last one is not laziness. A deck top, a neighbour's building and a card
 * in the inspector are all things you cannot act on from here, and a line
 * saying so would be noise on every card you ever browse.
 *
 * Legality is read off the move list, never re-derived: `buildOffers` is the
 * same filter the build panel uses, and GROW is matched by move type, so a
 * rules change that closes a door closes this sentence with it.
 */
export function glossNow(
  data: GameData,
  face: PrintedFace,
  view: PlayerView,
  moves: readonly Move[],
  active: boolean,
): string[] {
  const mine = view.you.tableau.find((b) => b.card === face.id);
  if (mine) {
    /*
     * ONE LINE, and the length is the reason rather than the style.
     *
     * The block gets 66px at 1600 and 63px at 1366, which is four lines, and it
     * has three sections to fit into them. The fill and the GROW verdict are one
     * thought - "two of three on it, and you cannot add to it this turn" - so
     * they are one sentence, which is a whole line back for the sections above.
     */
    const threshold = liveThreshold(data, face.id, face.threshold);
    if (threshold === null) return [];
    if (mine.stack.length >= threshold) {
      // No GROW clause on a full building. `growOptions` requires `canTakeCard`,
      // so full and unGROWable are the same fact, and "harvest it" is already
      // the answer to both.
      return [`Full at ${mine.stack.length} of ${threshold}. Harvest to take the stack.`];
    }
    /*
     * A VERDICT ONLY WHERE THERE IS A QUESTION. The Barn and the Farmstead have
     * no activation at all and the Notice Board is excluded by slot, so none of
     * the three can EVER be grown. "No GROW this turn" on one of them is worse
     * than saying nothing: it is true, and it teaches a player to keep coming
     * back to check a door that does not exist.
     *
     * Where there IS a question the answer is a bare yes or no. Every reason a
     * GROW might be missing - action spent, no card of the crop in hand, the
     * building already fired this turn - is a different sentence, and we cannot
     * tell which from the move list alone.
     */
    const growable = face.activation !== null && slotOf(data, face.id) !== 'noticeboard';
    const verdict =
      !active || !growable
        ? ''
        : moves.some((m) => m.type === 'grow' && m.building === face.id)
          ? ' You can GROW it now.'
          : ' No GROW this turn.';
    return [`Stack: ${mine.stack.length} of ${threshold}.${verdict}`];
  }

  if (buildOffers(moves, face.id).length > 0) return ['You can build this now.'];

  const card = data.cards.catalogue.find((c) => c.id === face.id);
  if (!card?.buildCost || !view.you.hand.includes(face.id)) return [];
  if (!active) return [];

  /*
   * THE GUARDS ON THE REASON, not on the claim.
   *
   * "You cannot build this yet" is safe to say about any unbuildable card in
   * your hand. The REASON is only safe when the printed cost is the price being
   * charged, which is exactly when the main Build action is the thing on offer:
   * a pending task builds under its own modifiers (a discount, a substitution,
   * cards off a stack), and a spent action means the price was never the
   * problem in the first place. In both of those the honest answer is nothing.
   */
  const priced = pendingTask(view) === null && !view.turn.actionSpent;
  const short = priced ? shortfallWords(data, face, card.buildCost, view) : null;
  return [
    short === null ? 'You cannot build this yet.' : `You cannot build this yet: ${short} short.`,
  ];
}
