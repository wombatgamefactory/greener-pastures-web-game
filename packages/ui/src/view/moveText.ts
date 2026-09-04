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

import type { BuildCost, GameData, Suit } from '@gp/data';
import { isMeepleCurrency } from '@gp/data';
import { revealedIn } from '@gp/engine';
import type { CardId, Move, MoveType, PlayerView, Seat, Task, TaskAnswer } from '@gp/engine';

/** The escape-hatch task, which is the only kind whose answers need it to be read. */
type CardTask = Extract<Task, { t: 'card' }>;

import { buildOffers, pendingTask } from './intent';
import type { PrintedFace } from './printed';
import { SUIT_META, maskedCardPhrase, seatName, suitArticle } from './suits';
import { doorOf, liveThreshold, seatSuits } from './table';

export function cardName(data: GameData, id: string): string {
  if (id.endsWith('?')) {
    const suit = data.cards.suits.find((s) => s.charAt(0).toUpperCase() === id.charAt(0));
    return maskedCardPhrase(suit);
  }
  return data.cards.catalogue.find((c) => c.id === id)?.name ?? id;
}

export function spendText(spend: Partial<Record<Suit, number>>): string {
  const parts = (Object.entries(spend) as [Suit, number][])
    .filter(([, n]) => n > 0)
    .map(([suit, n]) => `${n} ${SUIT_META[suit].label}`);
  return parts.length === 0 ? 'nothing' : parts.join(' + ');
}

/** What a colour's door does, in one word: "Harvest", "Draw", and so on. */
export function doorLabel(data: GameData, colour: Suit): string {
  return doorOf(data, colour).actionLabel;
}

function who(view: PlayerView, seat: Seat): string {
  return seatName(seatSuits(view)[seat], seat, view.seat);
}

function cardList(data: GameData, ids: readonly string[]): string {
  return ids.length === 0 ? 'nothing' : ids.map((id) => cardName(data, id)).join(', ');
}

/**
 * The head task when it is the escape hatch, which is the only kind that is
 * read. `view.tasks[0]` rather than `pendingTask`, deliberately: `pendingTask`
 * returns null for a task belonging to ANOTHER seat, and a move log read from
 * the outside still has to render that seat's move as something - which, for a
 * rival, is the masked form the view already carries.
 */
function headCardTask(view: PlayerView): CardTask | undefined {
  const head = view.tasks[0];
  return head?.t === 'card' ? head : undefined;
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

/**
 * A task answer, said in words.
 *
 * ⭐ `task` IS OPTIONAL AND ONLY THE `card` KIND READS IT.
 *
 * An escape-hatch answer is a bag of riders whose MEANING lives on the task that
 * offered it - `{ suit: 'wheat' }` says four different things depending on which
 * card asked - and until 03/09/2026 this function had no way to tell, so it
 * guessed from the shape of the bag and got some of them wrong. Handing it the
 * task is what makes those answers sayable at all.
 *
 * ⚠️ IT MUST BE THE TASK AS **THIS VIEW** CARRIES IT, never one fetched from
 * anywhere else. `redactTask` masks a card task's riders for every seat but its
 * owner, so a revealed deck top reads `D15` in the owner's copy and `D?` in a
 * rival's - and that is the whole of the entitlement check. Nothing below
 * compares seats or decides who may see what; it renders what the view already
 * holds, which is precisely why it cannot be the place the boundary is got
 * wrong.
 */
export function describeAnswer(data: GameData, answer: TaskAnswer, task?: CardTask): string {
  switch (answer.kind) {
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
      return `island ${answer.tile}, spending ${spendText(answer.spend)}`;
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
      return describeCardPayload(data, answer.payload, task);
    default:
      return answer satisfies never;
  }
}

/**
 * What one `{ suit }` answer means, by the task that offered it.
 *
 * ⚠️ FOUR CARDS PRODUCE THE IDENTICAL PAYLOAD AND NONE OF THEM MEANS THE SAME
 * THING. Until 03/09/2026 this branch printed one sentence for all four -
 * "discard a Vegetable card from your barn", which was V13's meaning and V13 has
 * since been retexted - so every one of them was rendering a rule the game does
 * not have. The bag cannot say which; the task's `kind` can. The default names
 * the crop and claims nothing else, rather than inventing a fifth wrong sentence
 * for a producer somebody adds later.
 */
const SUIT_ANSWER: Readonly<Record<string, (crop: string) => string>> = {
  // The Apiary skim: a card of that crop off the hive, into your barn.
  skimHive: (crop) => `take a ${crop} card off it, into your barn`,
  // A17 The Smoke Pot, and the Dairy deck-to-barn: the top card of that deck.
  smokeBuy: (crop) => `the top ${crop} card, into your barn`,
  deckToBarn: (crop) => `the top ${crop} card, into your barn`,
  // D15 The Grand Creamery, first stage: which deck to turn over.
  creameryFlip: (crop) => `reveal the top card of the ${crop} deck`,
};

/**
 * What one `{ pick }` answer means, by the task that offered it.
 *
 * `name` arrives already masked or not, because it came off the view's own copy
 * of the task - so neither of these decides anything about entitlement either.
 */
const PICK_ANSWER: Readonly<Record<string, (name: string, paying: string) => string>> = {
  // D10 The Scout's Post: build the revealed card, at a discount of 2.
  scout: (name, paying) => `build ${name}, paying ${paying}`,
  // D15 The Grand Creamery: build one of the two revealed cards for nothing.
  creameryPick: (name) => `build ${name} for free`,
};

/**
 * The escape-hatch answer's payload, said in words.
 *
 * A `card` payload is whatever its handler decided, so this cannot be
 * exhaustive and does not pretend to be: it recognises the shapes in play and
 * falls back to the raw JSON, which is what the whole family used to print. The
 * Vegetable rebuild made that fallback unacceptable at the table - the two cards
 * that reach the island's demand tokens are the suit, and `{"a":{"tile":"A5",…}}`
 * is not a choice anybody can make.
 */
function describeCardPayload(
  data: GameData,
  payload: Record<string, unknown>,
  task?: CardTask,
): string {
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
  // The divert seam: a card on its way to a discard, put in the barn instead.
  if (payload.card !== undefined && payload.barn === true) {
    return `put ${cardName(data, String(payload.card))} into your barn instead`;
  }
  /*
   * ⭐ A CHOICE OUT OF LIMBO, ANSWERED BY SLOT (the engine's leak fix,
   * 03/09/2026).
   *
   * D10 The Scout's Post and D15 The Grand Creamery turn deck tops face up into
   * a zone no `PlayerView` models, and their answers used to name the revealed
   * card BY ID - which put a deck top into the unredacted move list every policy
   * reads, and into the replayable move log. They answer `{ pick: 1 }` now, and
   * the id lives only on the task.
   *
   * So the slot is resolved back THROUGH THE TASK, and the entitlement comes
   * free with it: `redactTask` has already masked the riders for every seat but
   * the owner, so the owner's view yields `The Cider House` and a rival's yields
   * `D?`, which `cardName` renders as "a Dairy card". Rendering the raw
   * `{"pick":0}` was meaningless to a player; rendering the old `{"card":"D15"}`
   * WAS the leak. This is the same fix said in the interface.
   *
   * ⚠️ WITH NO TASK IT NAMES NO CARD AT ALL. A caller that cannot supply one has
   * no way to know what the slot refers to, and guessing there is exactly how an
   * id gets in front of somebody not entitled to it.
   */
  if (typeof payload.pick === 'number') {
    const id = task ? revealedIn(task)[payload.pick] : undefined;
    const name = id === undefined ? 'the card in that slot' : cardName(data, id);
    const paying = cardList(data, (payload.payment as CardId[] | undefined) ?? []);
    const say = task ? PICK_ANSWER[task.kind] : undefined;
    return say ? say(name, paying) : `take ${name}`;
  }
  // Four cards, four meanings, one payload: see SUIT_ANSWER.
  if (payload.suit !== undefined) {
    const crop = SUIT_META[payload.suit as Suit].label;
    const say = task ? SUIT_ANSWER[task.kind] : undefined;
    return say ? say(crop) : `the ${crop} crop`;
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

/**
 * ⭐ A SELF-VISIT AND A NEIGHBOUR VISIT NEVER SHARE A SENTENCE.
 *
 * They are the same move with a flag and they are opposite acts: one is the
 * game's whole social hook, the other is solitaire bought with the same
 * currency. `move.host === move.seat` is the only difference in the data, so
 * this is the one place the interface can guarantee they never read alike - and
 * the wording is deliberately blunt about which is which, because the v31 plan's
 * risk 2 is precisely that the solitaire door quietly wins.
 */
export function visitText(
  data: GameData,
  view: PlayerView,
  move: Extract<Move, { type: 'visit' }>,
): string {
  const colour = seatSuits(view)[move.host];
  const door = colour ? doorLabel(data, colour) : 'their';
  // TODO(meeple-loop): owned by the ui pass. A meeple visit names no card.
  const fee = move.fee === null ? 'a meeple' : cardName(data, move.fee);
  return move.host === move.seat
    ? `Your own door: ${fee} onto your own Notice Board, then ${door}. No neighbour involved, and it fills your own board.`
    : `Visit ${who(view, move.host)}: ${fee} onto their Notice Board, then ${door}.`;
}

export function describeMove(data: GameData, view: PlayerView, move: Move): string {
  switch (move.type) {
    case 'task':
      /*
       * The head task AS THIS VIEW CARRIES IT - already redacted for the seat
       * the view belongs to - so an answer naming a slot resolves to a card's
       * name for its owner and to a mask for anybody else, with nothing here
       * having to know which is which.
       */
      return describeAnswer(data, move.answer, headCardTask(view));
    case 'cardMove':
      // A Tier 3 ACTION card is a main action, so it reads as one rather than
      // as an internal move kind. Everything else keeps the generic form.
      return move.kind === 'action'
        ? `${cardName(data, move.card)}: take its ACTION (instead of your action)`
        : `${cardName(data, move.card)}: ${move.kind}`;
    case 'draw':
      return `Draw ${data.rules.turn.baseDraw.see}, keep ${data.rules.turn.baseDraw.keep}`;
    case 'bonusDraw':
      return `Bonus: draw ${data.rules.turn.bonusDraw} off the top of any deck`;
    case 'spendMeeple':
      return `Spend ${suitArticle(SUIT_META[move.colour].label)} ${SUIT_META[move.colour].label} meeple: ${doorLabel(data, move.colour)}. It leaves the game.`;
    case 'build':
      return `Build ${cardName(data, move.card)}, paying ${cardList(data, move.payment)}`;
    case 'grow':
      return `Grow ${cardName(data, move.building)}, paying ${cardName(data, move.payment)}`;
    case 'harvest':
      return `Harvest ${cardName(data, move.building)}`;
    case 'deliver':
      return `Deliver to island ${move.tile}: ${spendText(move.spend)}`;
    case 'moveBalloon':
      return `Bring in the ${balloonWord(move.balloon)} balloon: ${spendText(move.spend)}`;
    case 'visit':
      return visitText(data, view, move);
    // TODO(meeple-loop): owned by the ui pass.
    case 'collect':
      return 'Collect: take the meeples off your own Notice Board, then Draw 1.';
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
    case 'draw':
      return task.revealed.length < task.see
        ? `Turn over a card: pick a deck (${task.revealed.length} of ${task.see} seen).`
        : `Keep ${Math.min(task.keep, task.revealed.length)} of the ${task.revealed.length} you saw.`;
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
      // ⭐ NOT "your barn caps your hand at N" any more (02/09/2026). The limit
      // is one global rule and the Barn prints nothing, so naming the Barn here
      // would point a player at a card that says nothing. It also says WHY now:
      // this is the only moment the limit is checked, and a player who has just
      // been allowed to hold fifteen cards needs telling that the boundary is
      // where it lands.
      return `Your turn ends with a hand of ${task.downTo}. Choose what to discard.`;
    case 'divert':
      return task.fromDraw
        ? `${task.cards.length} card${task.cards.length === 1 ? '' : 's'} heading for the discard: give one to a neighbour, put one in your barn, or let them go.`
        : `${task.cards.length} card${task.cards.length === 1 ? '' : 's'} heading for the discard: put one in your barn, or let them go.`;
    case 'card':
      return `${cardName(data, task.src)}: choose.`;
    default:
      return task satisfies never;
  }
}

// --- the turn bar's families ------------------------------------------------

/**
 * WHERE A FAMILY BELONGS ON THE BAR.
 *
 * The turn is three parts since v31 and the bar says so in the data rather than
 * leaving every call site to infer it:
 *
 *   meeple   spends a MEEPLE from your supply. Any number, one at a time, and
 *            ONLY at the very start of your turn - before the bonus and before
 *            the action. Each one leaves the game.
 *   bonus    spends your BONUS SLOT. One a turn (two with a Helping Hand),
 *            at the start of your turn.
 *   action   spends your MAIN ACTION. Exactly one of these a turn.
 *   exit     spends none of the three: leaving the turn, or leaving a
 *            half-made decision.
 *
 * The order of those four is the order of the turn, and the bar draws them in
 * it, so the shape of a turn is legible off the interface without being taught.
 */
export type TurnZone = 'meeple' | 'action' | 'bonus' | 'exit';

export interface ActionGroup {
  readonly type: MoveType;
  readonly label: string;
  readonly hint: string;
  /** True when clicking it needs a target next rather than playing immediately. */
  readonly needsTarget: boolean;
  /** Which of the turn's parts this family spends. */
  readonly zone: TurnZone;
  /**
   * Distinguishes two families that share a move TYPE. Only the visit uses one:
   * `visit` and `visit-self` are the same move with a different host, and they
   * are opposite acts, so the bar draws two buttons and this is what splits the
   * move list between them.
   */
  readonly key: string;
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
 * The turn's families, in the order the rulebook teaches them. A family with no
 * legal move is still listed, greyed: "what can I not do" is half of learning a
 * turn, and hiding it would make the bar jump about between turns.
 *
 * ⛔ FOUR ROWS LEFT IN v31 AND EVERY ONE WAS A RULE DELETION: `buy` and `market`
 * (both coin sinks in or beside the bonus slot), `upgrade` (the GBP 2 starter
 * flip, which was the bonus slot's fourth option from 19/08/2026) and
 * `workOwnWorker` (activate your own Service, paid to the bank). The first three
 * died with the currency; the fourth is REPLACED rather than deleted, and the
 * replacement is the row marked `visit-self` below - an owner now places a card
 * on their own board exactly as a rival does, which is why it is a visit and not
 * a family of its own.
 */
const FAMILIES: readonly {
  key: string;
  type: MoveType;
  label: string;
  hint: string;
  needsTarget: boolean;
  zone: TurnZone;
  /** Splits a shared move type between two families. Absent means "all of them". */
  match?: (move: Move, view: PlayerView) => boolean;
  /** Is this game playing the rule at all? Absent means "always". */
  inPlay?: (data: GameData) => boolean;
  /** See `ActionGroup.onBoard`. */
  onBoard?: true;
}[] = [
  /*
   * ON THE BOARD, NOT ON THE BAR. A meeple is a wooden piece sitting in your own
   * supply and spending it is picking it up - so the supply carries the
   * affordance and the bar draws no button. It stays in the table because the
   * ZONE is what the bar needs: the meeple phase is a labelled part of the turn
   * whether or not any meeple is currently spendable, and a player has to be
   * able to see the window open and shut.
   */
  {
    key: 'spendMeeple',
    type: 'spendMeeple',
    label: 'Meeples',
    hint: 'Start of turn: spend any number, one at a time. Each leaves the game.',
    needsTarget: true,
    zone: 'meeple',
    onBoard: true,
    inPlay: (data) => !isMeepleCurrency(data),
  },
  {
    key: 'bonusDraw',
    type: 'bonusDraw',
    label: 'Draw 1',
    hint: 'Bonus: the top card of any one deck. Free, and never dead.',
    needsTarget: false,
    zone: 'bonus',
    inPlay: (data) => !isMeepleCurrency(data),
  },
  /*
   * ⭐ COLLECT IS WHAT REPLACED THE FREE DRAW 1 (04/09/2026, R7), and the two
   * are deliberately not the same button wearing a different label. Draw 1 was
   * pure solitaire; Collect is the half of the design that PAYS THE HOST - it
   * sweeps every meeple a neighbour left on your board back into your supply as
   * stored actions, and draws a card on top. Collecting an empty board is legal
   * and reads as a bare Draw 1, which is the solitaire line the bonus mix has to
   * keep counting separately.
   */
  {
    key: 'collect',
    type: 'collect',
    label: 'Collect',
    hint: 'Bonus: take every meeple off your own Notice Board, then Draw 1',
    needsTarget: false,
    zone: 'bonus',
    inPlay: isMeepleCurrency,
  },
  /*
   * ⭐ THE TWO HALVES OF THE VISIT, DRAWN AS TWO BUTTONS. One move type, one
   * flag, and opposite acts: a card on a NEIGHBOUR's board is the hook, a card
   * on your OWN is solitaire that also clogs your own door. Every previous
   * version of this game has had the solitaire option quietly crowd the visit
   * out when the two competed for one slot, so the interface's job is to make
   * sure nobody takes one thinking it is the other. One button, however
   * carefully worded, could not do that.
   */
  {
    key: 'visit',
    type: 'visit',
    label: 'Visit a neighbour',
    hint: "Bonus: onto a neighbour's Notice Board, and you take that colour's action",
    needsTarget: true,
    zone: 'bonus',
    match: (move, view) => move.type === 'visit' && move.host !== view.seat,
  },
  {
    key: 'visit-self',
    type: 'visit',
    label: 'Your own door',
    hint: 'Bonus: 1 card onto your OWN Notice Board for your own action - and it clogs your board',
    needsTarget: true,
    zone: 'bonus',
    match: (move, view) => move.type === 'visit' && move.host === view.seat,
    // ⛔ AND THERE IS NO SELF-VISIT UNDER THE SHIPPED RULES (X5), at any setting
    // of `selfVisitAllowed` - the meeple loop deletes it at the enumerator, so
    // the flag is read only under the v31 card-visit control.
    inPlay: (data) => !isMeepleCurrency(data) && data.rules.turn.selfVisitAllowed,
  },
  {
    key: 'draw',
    type: 'draw',
    label: 'Draw',
    hint: 'Top of any two decks, keep both',
    needsTarget: false,
    zone: 'action',
  },
  {
    key: 'build',
    type: 'build',
    label: 'Build',
    hint: 'Pay cards from hand',
    needsTarget: true,
    zone: 'action',
  },
  {
    key: 'grow',
    type: 'grow',
    label: 'Grow',
    hint: 'Activate one of your buildings',
    needsTarget: true,
    zone: 'action',
  },
  {
    key: 'harvest',
    type: 'harvest',
    label: 'Harvest',
    hint: 'Take a full stack into your barn',
    needsTarget: true,
    zone: 'action',
  },
  {
    key: 'deliver',
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
   * is the balloon.
   */
  {
    key: 'moveBalloon',
    type: 'moveBalloon',
    label: 'Freight',
    hint: 'Bring in a balloon',
    needsTarget: true,
    zone: 'action',
    onBoard: true,
  },
  /*
   * ON THE CARD, NOT ON THE BAR (26/08/2026). A `cardMove` is a standing move a
   * BUILT CARD is offering, so the card is where it is made. "Card power" as a
   * bar button was the interface asking a player to look away from the thing
   * that grants the move and hunt for a generic button that names no card.
   */
  {
    key: 'cardMove',
    type: 'cardMove',
    label: 'Card power',
    hint: 'A standing move on a card',
    needsTarget: false,
    zone: 'exit',
    onBoard: true,
  },
  {
    key: 'pass',
    type: 'pass',
    label: 'Pass',
    hint: 'Nothing else is legal',
    needsTarget: false,
    zone: 'exit',
  },
  {
    key: 'endTurn',
    type: 'endTurn',
    label: 'End turn',
    hint: 'Decline what is left',
    needsTarget: false,
    zone: 'exit',
  },
];

/**
 * Build is the one family reachable from two move types. A card that grants a
 * Build (W7 Golden Field, the Dairy door) offers it as a build TASK, whose moves
 * are `type: 'task'` - so a plain `m.type === family.type` filter greys the
 * Build button at the exact moment the prompt is asking for a build. Every other
 * task is answered in place on a building, a deck or a tile, which is why this
 * stays a one-family exception rather than a general answer-to-family map.
 *
 * `view` is here for the visit split and `data` for `inPlay`. Neither is
 * consulted about legality: the moves list is still the only thing that decides
 * whether a family is enabled.
 */
export function actionGroups(
  data: GameData,
  view: PlayerView,
  moves: readonly Move[],
): ActionGroup[] {
  return FAMILIES.map((family) => ({
    ...family,
    inPlay: family.inPlay?.(data) ?? true,
    onBoard: family.onBoard === true,
    moves: moves.filter(
      (m) =>
        (m.type === family.type && (family.match?.(m, view) ?? true)) ||
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
// reading size, and printing that a second time doubles the reading and teaches
// nothing. What is added is only what the card cannot say about itself:
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
 * ⛔ HIRE and WORK ARE GONE (v31). They were kept through change 6 on the
 * argument that a re-text could bring the Hiring Fair's vocabulary back; there
 * is no Fair, no Working Week, no wage and no Service left for either word to
 * describe, so a gloss for them would now be teaching a game nobody is playing.
 *
 * `means` takes the data so a number that is a knob stays a knob.
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
    means: () =>
      "Your bonus slot: 1 card onto a Notice Board, then take that farm's suit action. Your own board counts, and fills up just the same.",
  },
  {
    term: 'VISITOR',
    pattern: /\bvisitors?\b/i,
    means: (data) =>
      `What anybody gets for placing a card here: your suit's action, and the card stays on the board until you harvest it. Full at ${data.rules.economy.noticeBoardThreshold ?? 2}.`,
  },
];

/**
 * The keywords in one printed ability, expanded once each, in a fixed order.
 *
 * Fixed order rather than order of appearance so the block does not reshuffle
 * itself between two cards that print the same pair of keywords the other way
 * round. Empty for a card with no ability text, which is the Barn's whole answer
 * here and is not a defect.
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
 * here. The coin half went with the currency - the 30 Power and Endgame cards
 * that used to print two coins now cost 2 cards of their own suit, which this
 * already knew how to say.
 */
function buildCostWords(suit: Suit, cost: BuildCost): string {
  const parts: string[] = [];
  if (cost.suit > 0) parts.push(spendText({ [suit]: cost.suit }));
  if (cost.wild > 0) parts.push(`${cost.wild} of any crop`);
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
 * ⛔ THE STARTER LINE IS GONE. It used to read "To flip: GBP 2, in your bonus
 * slot". Starters have one face and there is nothing to buy, so a starter now
 * simply has no cost line - which is the correct answer rather than a gap.
 */
export function glossCost(data: GameData, face: PrintedFace): string[] {
  const card = data.cards.catalogue.find((c) => c.id === face.id);
  const out: string[] = [];

  if (card?.buildCost) {
    out.push(`To build: ${buildCostWords(face.suit, card.buildCost)}.`);
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
        ? `Visitors fill it: ${threshold}, then it clogs until you harvest.`
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
 * crop. So the gap is own-crop first, then any-crop for whatever is still owed
 * after those arrive. The coin term went with the currency.
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

  const parts: string[] = [];
  if (ownShort > 0) parts.push(spendText({ [face.suit]: ownShort }));
  if (anyShort > 0) parts.push(`${anyShort} more card${anyShort === 1 ? '' : 's'}`);
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
   * a pending task builds under its own modifiers, and a spent action means the
   * price was never the problem in the first place.
   */
  const priced = pendingTask(view) === null && !view.turn.actionSpent;
  const short = priced ? shortfallWords(data, face, card.buildCost, view) : null;
  return [
    short === null ? 'You cannot build this yet.' : `You cannot build this yet: ${short} short.`,
  ];
}
