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
import { isMeepleCurrency, isNoticeBoardPower } from '@gp/data';
import { revealedIn } from '@gp/engine';
import type { CardId, Move, MoveType, PlayerView, Seat, Task, TaskAnswer } from '@gp/engine';

/** The escape-hatch task, which is the only kind whose answers need it to be read. */
type CardTask = Extract<Task, { t: 'card' }>;

import { GLOSSARY } from './glossary';
import { buildOffers, deliverOffers, pendingTask, visitHosts } from './intent';
import type { PrintedFace } from './printed';
import { SUIT_META, maskedCardPhrase, seatName, suitArticle } from './suits';
import { doorOf, farmOf, liveThreshold, noticeBoardsOf, seatSuits } from './table';

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
 * owner, so a revealed deck top reads `W5` in the owner's copy and `W?` in a
 * rival's - and that is the whole of the entitlement check. Nothing below
 * compares seats or decides who may see what; it renders what the view already
 * holds, which is precisely why it cannot be the place the boundary is got
 * wrong.
 */
export function describeAnswer(
  data: GameData,
  answer: TaskAnswer,
  task?: CardTask,
  view?: PlayerView,
): string {
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
    case 'deckSow':
      return `the top ${SUIT_META[answer.suit].label} card onto ${cardName(data, answer.onto)}${seatSuffix(answer.ontoSeat)}`;
    case 'handToBarn':
      return `${cardName(data, answer.card)} into your barn`;
    case 'discard':
      return `discard ${cardList(data, answer.cards)}`;
    case 'skip':
      return 'decline';
    case 'card':
      return describeCardPayload(data, answer.payload, task, view);
    // A door-bought Grow (a standalone `t: 'grow'` task, e.g. a Notice Board
    // power) OR, since v48, O13 The Seed Bank's hand-paid Grow, offered
    // through the `t: 'card'` escape hatch but sharing this answer shape.
    // Spelled as its own case rather than folded into a `default`, so the
    // next answer kind the engine adds is a compile error here and not a
    // silent sentence.
    case 'grow':
      /*
       * ⚠️ `payment` is nullable for exactly one live reason: the Apiary
       * retext's deck Grow (`deckSuit` set, 14/09/2026). The Village Store
       * coin's nullable-payment Grow (V8) was deleted with the coin on
       * 16/09/2026, and the engine no longer constructs this answer with
       * `payment: null` and no `deckSuit` - so that branch is unreachable and
       * says so rather than naming a component that no longer exists.
       * ⭐ "UNSUPPORTED IN THIS INTERFACE, C59" IS GONE (24/09/2026): a bought
       * Grow left `UNROUTED_TASK_ANSWERS` on 18/09/2026 (`intent.ts`, 2.2.5) -
       * `clickBuilding` and `clickDeck` resolve it same as any other Grow -
       * and O13 The Seed Bank's v48 retext now reaches this same case for an
       * ordinary hand-paid Grow, for which the old suffix was never even true.
       */
      return `${cardName(data, answer.building)}, paying ${
        answer.deckSuit !== undefined
          ? `the top ${SUIT_META[answer.deckSuit].label} card`
          : answer.payment !== null
            ? cardName(data, answer.payment)
            : 'nothing (unreachable under the shipped rules)'
      }`;
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
  // D10 The Scout's Post, first stage since v47: which deck to turn over.
  // `creameryFlip` (D15 The Grand Creamery's old first stage) is retired with
  // the card's whole reveal-and-pick shape; the deck-choice SENTENCE moves
  // here unchanged, onto D10's `scoutDeck` task (tasks/v47-rulings-v1.md
  // housekeeping note).
  scoutDeck: (crop) => `reveal the top card of the ${crop} deck`,
  // V18 A Helping Hand (v48): the receipt names more than one crop still
  // actionable right now, and the owner picks which plain action it grants.
  v18Crop: (crop) => `take your ${crop} action`,
  // The shared barn-discard step (`barnDiscardTask`, buildings.ts): V6, V8,
  // V10, V12 and V15 all fire it, and it always means the same thing for
  // every one of them - a barn card leaving for its own crop's discard pile -
  // so one sentence is correct for the whole family, not just V6.
  barnDiscard: (crop) => `discard a ${crop} card from your barn`,
  // V12 The Auction House (v45): the barn only names which Notice Board
  // powers are on offer; the power itself is free, so the sentence names the
  // power, not a cost.
  auctionSuit: (crop) => `perform the ${crop} Notice Board power`,
  // W15 The Patisserie: 3 cards off the top of one chosen deck, into the barn.
  patisserieDeck: (crop) => `put the top 3 ${crop} cards into your barn`,
  // W16 The Granary: an ordinary draw of 1, off a deck the owner names.
  granaryDraw: (crop) => `draw the top ${crop} card`,
};

/**
 * What one `{ pick }` answer means, by the task that offered it.
 *
 * `name` arrives already masked or not, because it came off the view's own copy
 * of the task - so neither of these decides anything about entitlement either.
 */
const PICK_ANSWER: Readonly<Record<string, (name: string, paying: string) => string>> = {
  // D10 The Scout's Post: build the revealed card, at a discount of 2. v47
  // reveals exactly one card (chosen deck first, via `scoutDeck` above), so
  // the slot is always 0, but the shape - and this rendering - is unchanged.
  scout: (name, paying) => `build ${name}, paying ${paying}`,
  // ⛔ `creameryPick` (D15 The Grand Creamery's old "build one of the two
  // revealed cards for nothing") is retired with the card's whole reveal
  // shape: v47's D15 is "Build a card from your hand for free", an ordinary
  // `build` task (see the `case 'build'` branch above), never a `card`/pick
  // task. There is nothing left in this table for D15 to key off.
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
  view?: PlayerView,
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
  /*
   * ⚠️ THREE CARDS NOW SHARE `{ tile, spend }` (v48 added the second and
   * third), AND THEY DO NOT MEAN THE SAME THING - the same trap SUIT_ANSWER
   * and PICK_ANSWER already guard against, so the task's `kind` disambiguates
   * here too rather than reading the bag alone.
   */
  // V14: one payment, both receipts.
  if (task?.kind === 'sweepDeliver' && payload.tile !== undefined && payload.spend !== undefined) {
    return `island ${String(payload.tile)}, spending ${spendText(
      payload.spend as Partial<Record<Suit, number>>,
    )} for BOTH receipts`;
  }
  // O12 The Fruit Press: a plain delivery, with at most one hand card of a
  // named crop bridging a barn that is exactly one short (v48).
  if (
    task?.kind === 'fruitPressDeliver' &&
    payload.tile !== undefined &&
    payload.spend !== undefined
  ) {
    const bridge =
      payload.handCrop === undefined
        ? ''
        : ` (plus a ${SUIT_META[payload.handCrop as Suit].label} card from your hand)`;
    return `island ${String(payload.tile)}, spending ${spendText(
      payload.spend as Partial<Record<Suit, number>>,
    )}${bridge}`;
  }
  // A8 The Wild Hive, step 1: which delivery, over the pooled barn-plus-
  // full-buildings tally (v48). Step 2 (below) then sources any contested card.
  if (task?.kind === 'wildDeliver' && payload.tile !== undefined && payload.spend !== undefined) {
    return `island ${String(payload.tile)}, spending ${spendText(
      payload.spend as Partial<Record<Suit, number>>,
    )}`;
  }
  // A8, step 2: one contested card, sourced from the barn or a named building.
  if (task?.kind === 'wildDeliver' && payload.from !== undefined) {
    return payload.from === 'barn'
      ? 'take the next card from your barn'
      : `take the next card off ${cardName(data, String(payload.from))}`;
  }
  // A10 The Cross-Pollinator (v48): the extra visit R9 grants, paid off a
  // deck top rather than a hand card. No seat name here, in the same register
  // `seatSuffix` uses above - describeCardPayload has no view to name one.
  if (task?.kind === 'crossVisit' && payload.board !== undefined) {
    const crop = SUIT_META[payload.suit as Suit].label;
    return `visit a rival's ${cardName(data, String(payload.board))}, paying with the top ${crop} card`;
  }
  // A15 The Royal Apiary (v48): discard a Tier card from hand and carry out
  // its activated line directly (R1/R6).
  if (task?.kind === 'royalDiscard' && payload.card !== undefined) {
    return `discard ${cardName(data, String(payload.card))} and activate it`;
  }
  // D7 The Versatile Shed (v48): place one of this Build's spent cards into
  // your barn - the D5 shape below is the sow version of the same idea.
  if (task?.kind === 'reclaimSpent' && payload.card !== undefined) {
    return `put ${cardName(data, String(payload.card))} into your barn`;
  }
  // D5 The Churning Shed (v47): sow one of this Build's spent cards onto the
  // building just built, the sow twin of D7's reclaimSpent above. `built`
  // rides on the task, not the answer, because it names the SAME building
  // for every answer this task offers.
  if (task?.kind === 'sowSpent' && payload.card !== undefined) {
    return `sow ${cardName(data, String(payload.card))} onto ${cardName(
      data,
      String(task.riders.built),
    )}`;
  }
  // O9 The Fruit Stand (v47): give a chosen hand card to a chosen player.
  // `to` is a seat, said the same way every other cross-table move names one
  // (`who`, via the view) - falling back to a bare seat number only when no
  // view is available to name it.
  if (task?.kind === 'give' && payload.card !== undefined && payload.to !== undefined) {
    const to = payload.to as Seat;
    const name = view ? who(view, to) : `seat ${to}`;
    return `give ${cardName(data, String(payload.card))} to ${name}`;
  }
  // D18 A Helping Hand (Dairy): "Whenever you build a card that costs 3 or
  // more resources, add 1 of those cards to your Barn." Same shape and same
  // sentence as D7's reclaimSpent above - both are "one spent card, into the
  // barn", just triggered by a different card.
  if (task?.kind === 'd18Barn' && payload.card !== undefined) {
    return `put ${cardName(data, String(payload.card))} into your barn`;
  }
  // D14 The Refinery: demolish one of your own buildings (never a starter),
  // discarding its stack, in exchange for deck cards into the barn.
  if (task?.kind === 'refine' && payload.card !== undefined) {
    return `demolish ${cardName(data, String(payload.card))}`;
  }
  // O14 The Conservatory: SOW every card in your hand onto your buildings.
  // Same shape as the generic `sow` answer kind (card onto building), but
  // offered through the escape hatch because the mandatory "sow everything,
  // then Draw 4 once nothing more can be placed" shape needed a `skip` that
  // means something other than decline.
  if (task?.kind === 'sowAll' && payload.card !== undefined && payload.onto !== undefined) {
    return `sow ${cardName(data, String(payload.card))} onto ${cardName(data, String(payload.onto))}`;
  }
  // V15 The International Port: build a card of the discarded crop from hand,
  // free - no payment task, because nothing is paid.
  if (task?.kind === 'freeBuild' && payload.card !== undefined) {
    return `build ${cardName(data, String(payload.card))} for free`;
  }
  // A6 The Garden Hive: GROW another of your buildings with a card of ANY
  // crop, offered through the escape hatch (`growAnyAnswers`, buildings.ts)
  // rather than the standalone `grow` answer kind, because O13's OLD shape
  // used to share this helper too (superseded - see the `case 'grow'` note
  // above). Same words as that generic case: the building, then what paid it.
  if (task?.kind === 'growAny' && payload.building !== undefined) {
    return `${cardName(data, String(payload.building))}, paying ${
      payload.payment !== null && payload.payment !== undefined
        ? cardName(data, String(payload.payment))
        : 'nothing'
    }`;
  }
  // A17 The Smoke Pot (v49 sheet retext, 26/09/2026): at the end of your turn,
  // move a card off one of your own Notice Boards into your barn (an ordinary
  // building is no longer a legal source). Named BY CROP, never by id - a
  // stack is shown to its own owner as suit letters only (`buildingView`,
  // view.ts), so any card of that crop is the same move.
  if (
    task?.kind === 'smokePotMove' &&
    payload.building !== undefined &&
    payload.crop !== undefined
  ) {
    return `move a ${SUIT_META[payload.crop as Suit].label} card off ${cardName(
      data,
      String(payload.building),
    )} into your barn`;
  }
  // The divert seam: a card on its way to a discard, put in the barn instead.
  if (payload.card !== undefined && payload.barn === true) {
    return `put ${cardName(data, String(payload.card))} into your barn instead`;
  }
  /*
   * ⭐ A CHOICE OUT OF LIMBO, ANSWERED BY SLOT (the engine's leak fix,
   * 03/09/2026).
   *
   * D10 The Scout's Post turns a deck top face up into a zone no `PlayerView`
   * models, and its answer used to name the revealed card BY ID - which put a
   * deck top into the unredacted move list every policy reads, and into the
   * replayable move log. It answers `{ pick: 0 }` now (v47: one deck, chosen
   * first, so there is only ever one slot), and the id lives only on the task.
   * ⛔ D15 The Grand Creamery used to share this exact shape (two deck tops,
   * `{ pick: 0 | 1 }`); v47 retexted it to an ordinary free Build straight off
   * the hand, so it left this branch entirely and is handled by the plain
   * `case 'build'` above instead.
   *
   * So the slot is resolved back THROUGH THE TASK, and the entitlement comes
   * free with it: `redactTask` has already masked the riders for every seat but
   * the owner, so the owner's view yields `Rye Field` and a rival's yields
   * `W?`, which `cardName` renders as "a Wheat card". Rendering the raw
   * `{"pick":0}` was meaningless to a player; rendering the old `{"card":"W5"}`
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
  /*
   * ⛔ THIS MUST NEVER REACH A PLAYER AS RAW JSON. Every shape above is a
   * payload this function has learned to say in words; anything that falls
   * this far is a card task nobody has written a sentence for yet - exactly
   * the D5/O9 gap `ui-recon-2026-09-25-v1.md` found, closed above, but the
   * fallback stays as the net for the NEXT one, so a missing branch degrades
   * to a vague-but-clickable prompt instead of `{"card":"D5-14"}`. Warn loudly
   * in dev so the gap is not silent for whoever writes the next card.
   */
  if (import.meta.env.DEV) {
    console.warn(`moveText: no sentence for a "${task?.kind ?? '?'}" card task`, payload);
  }
  return 'Choose this option';
}

/**
 * "a yellow Worker", or "yellow and cream Workers as one wild" for a pair
 * (R10). The UI has no Worker-drag affordance yet, so this text is the only
 * place a Worker payment is legible to a human at all.
 *
 * ⚠️ SAID "meeple" UNTIL 25/09/2026 (B13): the piece is called a Worker
 * everywhere a player reads it (CLAUDE.md §2.8, §0's "delivery meeples are
 * called Workers"); "meeple" survives only in identifiers this pass does not
 * rename (`meeples` on the move and view shapes).
 */
function meepleWords(meeples: readonly Suit[]): string {
  const labels = meeples.map((m) => SUIT_META[m].label);
  const first = labels[0];
  if (first === undefined) return `no ${GLOSSARY.worker}`;
  if (labels.length === 1) return `${suitArticle(first)} ${first} ${GLOSSARY.worker}`;
  return `${labels.join(' and ')} ${GLOSSARY.workers} as one wild`;
}

/** "2 yellow, 1 cream Workers" - a build or delivery payment, a count per colour. */
function meepleTally(counts: Partial<Record<Suit, number>>): string {
  const parts = (Object.entries(counts) as [Suit, number][])
    .filter(([, n]) => n > 0)
    .map(([suit, n]) => `${n} ${SUIT_META[suit].label}`);
  return `${parts.join(', ')} ${parts.length === 1 ? GLOSSARY.worker : GLOSSARY.workers}`;
}

/**
 * ⭐ REWRITTEN 18/09/2026 for the shipped rule: self-visiting is BANNED
 * ("Never your own board, either of them", ruled 11/09/2026), so a visit only
 * ever reads one way - one card from your hand onto a named RIVAL's Notice
 * Board, taking that board's printed power at once. The card stays there
 * until its owner harvests it.
 *
 * At two players a host farms TWO boards (their own suit's, plus one drawn at
 * random from an unfarmed suit) and they print different powers, so `move`
 * carries an optional `board` naming which one the fee lands on - resolved
 * through `noticeBoardsOf` rather than through the host's own suit, because
 * the second board's power is never the host's own.
 */
export function visitText(
  data: GameData,
  view: PlayerView,
  move: Extract<Move, { type: 'visit' }>,
): string {
  const boards = noticeBoardsOf(data, farmOf(view, move.host));
  const board =
    (move.board ? boards.find((b) => b.building.card === move.board) : boards[0]) ?? boards[0];
  /*
   * `fee` is null only under the retired meeple-loop visit arm
   * (`overlays/meeple-loop-v1.overlay.json` and its siblings, project
   * CLAUDE.md §5) - a different, retired component from the shipped delivery
   * Worker, and never reachable under the shipped rival-board-power visit,
   * which is always paid with one card. ⚠️ CLAUDE.md's "never say 'a meeple'"
   * rule is worded for a player reading the shipped game, so this dead branch
   * is worded to match rather than left naming a component no current table
   * has (25/09/2026, B13).
   */
  const fee = move.fee === null ? 'a Worker' : cardName(data, move.fee);
  return board
    ? `Visit ${who(view, move.host)}: ${fee} onto their Notice Board, for ${board.actionLabel}. It stays there until they harvest it.`
    : `Visit ${who(view, move.host)}: ${fee} onto their Notice Board.`;
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
      return describeAnswer(data, move.answer, headCardTask(view), view);
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
      return `Spend ${suitArticle(SUIT_META[move.colour].label)} ${SUIT_META[move.colour].label} Worker: ${doorLabel(data, move.colour)}. It leaves the game.`;
    case 'build':
      return move.meeples === undefined
        ? `Build ${cardName(data, move.card)}, paying ${cardList(data, move.payment)}`
        : `Build ${cardName(data, move.card)}, paying ${
            move.payment.length > 0 ? `${cardList(data, move.payment)} and ` : ''
          }${meepleTally(move.meeples)}`;
    case 'grow':
      // R15: a meeple may pay instead of a card, and then nothing is placed -
      // the meeple goes to the box and the building's stack is untouched, which
      // is why a FULL building can be a target. Say both halves, because "grow a
      // full building" reads as a bug until the sentence explains itself.
      return move.payment === null
        ? `Grow ${cardName(data, move.building)}, paying ${meepleWords(move.meeples ?? [])} to the box`
        : `Grow ${cardName(data, move.building)}, paying ${cardName(data, move.payment)}`;
    case 'harvest':
      return `Harvest ${cardName(data, move.building)}`;
    case 'deliver': {
      // ⭐ NAME THE TOKEN TAKEN (18/09/2026): its crop demand, its VP and
      // whether it carried a Worker, resolved off the tile's own state rather
      // than guessed, because a first delivery chooses between two tokens and
      // `move.spend` alone says nothing about which.
      const tile = view.island.tiles.find((t) => t.tile === move.tile);
      const token = move.token !== undefined ? tile?.tokens[move.token] : undefined;
      const tokenWords = token
        ? `the ${token.demand === 'wild' ? 'wild' : SUIT_META[token.demand].label} token, ${token.vp} VP${
            token.worker ? `, with a ${SUIT_META[token.worker].label} Worker` : ''
          }`
        : 'a token';
      return `Deliver to island ${move.tile}: ${spendText(move.spend)}, for ${tokenWords}`;
    }
    case 'visit':
      return visitText(data, view, move);
    /*
     * `collect` and its meeples are the retired meeple-currency visit arm
     * (`overlays/meeple-loop-v1.overlay.json` and its siblings, project
     * CLAUDE.md §5) - a different component from the delivery Worker, and
     * never offered under the shipped rival-board-power visit. Kept, and
     * spelled out, only because the engine still defines the move type.
     */
    case 'collect':
      return `Collect: take the ${GLOSSARY.workers} off your own ${GLOSSARY.noticeBoard}, then Draw 1.`;
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
    case 'draw': {
      // ⭐ REWORDED 25/09/2026 (B13): named the card you are about to see by
      // its place in the draw ("your first card", "your second") rather than
      // the flatter "seen" count, which read as a progress bar rather than an
      // instruction.
      if (task.revealed.length >= task.see) {
        return `Keep ${Math.min(task.keep, task.revealed.length)} of the ${task.revealed.length} you saw.`;
      }
      const nth = task.revealed.length + 1;
      const ordinal = nth === 1 ? 'first' : nth === 2 ? 'second' : `${nth}th`;
      return `Draw ${task.see}: pick a deck for your ${ordinal} card (${nth} of ${task.see}).`;
    }
    case 'chooseBuilding':
      return 'Choose one of your buildings to harvest.';
    case 'sow':
      return `Sow ${task.remaining} card${task.remaining === 1 ? '' : 's'}: pick one from your hand, then a building to place it on. Any suit will do.`;
    case 'sowFromDeck':
      return `Sow ${task.remaining} card${task.remaining === 1 ? '' : 's'} off a DECK TOP: pick a crop, then a building. The card never touches your hand.`;
    case 'activate':
      return `GROW ${task.remaining} of your buildings WITHOUT PLACING A CARD: pick one and its ability fires. Nothing is paid, nothing is added to its stack, and a full building is a fine target.`;
    case 'handToBarn': {
      // ⭐ FIXED 25/09/2026 (B12, B13): every `handToBarn` task the engine
      // pushes today is MANDATORY (`orchard.test.ts`: "Mandatory: which card,
      // never whether"), so "You may put..." was a standing copy bug - it told
      // a player they could decline a task with no skip answer in the move
      // list at all. `task.optional` is read rather than assumed false
      // forever: the field exists on the task shape for a future card that
      // genuinely offers the choice, and this stays honest either way.
      const n = `${task.remaining} card${task.remaining === 1 ? '' : 's'}`;
      return task.optional
        ? `You may put ${n} from your hand into your barn.`
        : `Put ${n} from your hand into your barn.`;
    }
    case 'build':
      return 'Build a card from your hand.';
    case 'deliver':
      return 'Deliver: choose an island tile.';
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
    // A door-bought Grow (e.g. a Notice Board power). ⭐ Resolvable in this
    // prompt since 18/09/2026 (`clickBuilding` / `clickDeck`, `intent.ts`
    // 2.2.5, `UNROUTED_TASK_ANSWERS` emptied) - the old "unsupported, C59"
    // wording is gone. Kept as an explicit case, so a genuinely new task kind
    // still fails the build here.
    case 'grow':
      return 'GROW one of your buildings, paying a matching card.';
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
    label: 'Workers',
    hint: 'After your action: spend one Worker for the plain action of its colour.',
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
    // ⚠️ FIXED 18/09/2026: this used to read `!isMeepleCurrency(data)` alone,
    // which is true under the shipped rival-board-power visit and drew a
    // permanently-greyed "Draw 1" button with a false "never dead" hint on
    // every game. The engine's own `bonusDrawOpen` (`actions/bonus.ts`)
    // closes the free Draw under BOTH arms - S5, 10/09/2026: the bonus slot
    // holds one option, the visit, and a free solitaire Draw is exactly what
    // killed v31 at 67.6%. This now agrees with the engine.
    inPlay: (data) => !isMeepleCurrency(data) && !isNoticeBoardPower(data),
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
    hint: `Bonus: take every ${GLOSSARY.worker} off your own ${GLOSSARY.noticeBoard}, then Draw 1`,
    needsTarget: false,
    zone: 'bonus',
    inPlay: isMeepleCurrency,
  },
  /*
   * ⭐ THE TWO HALVES OF THE VISIT, DRAWN AS TWO BUTTONS. One move type, one
   * flag. `visit` is the hook, and it is the only one of the two that is ever
   * `inPlay` under the shipped rules: self-visiting is BANNED ("Never your
   * own board, either of them", ruled 11/09/2026), so `visit-self` below only
   * ever activates under the pre-ban `'card'` control (`selfVisitAllowed:
   * true`), kept so that control still replays. The split survives from when
   * both were live, so that neither button can be mistaken for the other on
   * an arm where they both still are.
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
    // ⭐ WAS "Your own door" UNTIL 25/09/2026 (B13): "door" is the internal
    // shorthand for a suit's plain action (`doorOf`, `doorLabel`) and never a
    // word a player should have to learn. Renamed to name the thing the card
    // actually lands on.
    label: 'Your own board',
    hint: 'Bonus: 1 card onto your OWN Notice Board for your own action. It still counts toward the 3+, but a board never blocks - there is always room for the next card.',
    needsTarget: true,
    zone: 'bonus',
    match: (move, view) => move.type === 'visit' && move.host === view.seat,
    // ⛔ THERE IS NO SELF-VISIT UNDER THE SHIPPED RULES (X5), at any setting
    // of `selfVisitAllowed` - the meeple loop deletes it at the enumerator, so
    // the flag is read only under the pre-ban `'card'` control.
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

/**
 * One honest sentence about a turn-bar family, live or disabled (B11,
 * 25/09/2026). Used for both the button's `title` (a hover tooltip) and a
 * hidden span an `aria-describedby` points at, so a mouse and a screen reader
 * are told the same thing.
 *
 * ⚠️ EVERY NUMBER HERE IS A FACT ALREADY ON THE VIEW OR THE MOVE LIST, NEVER A
 * RULE THIS FILE WORKED OUT ITSELF. "The UI enumerates nothing and re-derives
 * no rule" (the file banner) applies to a disabled reason exactly as much as
 * to a click: a Deliver's true crate size is a rule fact this layer is not
 * entitled to assert, so the disabled sentence names what IS knowable without
 * it - how many cards sit in the barn right now - rather than inventing a
 * number like "needs 4" that a future card or a different tile could make a
 * lie.
 */
export function actionReason(view: PlayerView, moves: readonly Move[], group: ActionGroup): string {
  const live = group.moves.length > 0;
  const label = group.label;
  switch (group.type) {
    case 'draw':
      return live
        ? `${label}: the top of two decks, free.`
        : `${label}: every deck and its discard is empty right now.`;
    case 'build': {
      if (live) {
        const n = new Set(view.you.hand.filter((c) => buildOffers(moves, c).length > 0)).size;
        return `${label}: ${n} card${n === 1 ? '' : 's'} in hand can be built right now.`;
      }
      return view.you.hand.length === 0
        ? `${label}: your hand is empty.`
        : `${label}: none of your ${view.you.hand.length} card${view.you.hand.length === 1 ? '' : 's'} in hand meets a building's cost right now.`;
    }
    case 'grow': {
      const buildings = new Set(
        moves
          .filter((m) => m.type === 'grow')
          .map((m) => (m as Extract<Move, { type: 'grow' }>).building),
      );
      if (live) {
        return `${label}: ${buildings.size} of your buildings can take a card right now.`;
      }
      return view.you.tableau.length === 0
        ? `${label}: you have no buildings yet.`
        : `${label}: none of your buildings can take a card right now.`;
    }
    case 'harvest': {
      const buildings = new Set(
        moves
          .filter((m) => m.type === 'harvest')
          .map((m) => (m as Extract<Move, { type: 'harvest' }>).building),
      );
      if (live) {
        return `${label}: ${buildings.size} of your building${buildings.size === 1 ? ' is' : 's are'} full and ready.`;
      }
      return `${label}: none of your buildings is full yet.`;
    }
    case 'deliver': {
      const barnTotal = Object.values(view.you.barn).reduce((a: number, b) => a + (b ?? 0), 0);
      const barnWords = `your barn holds ${barnTotal} card${barnTotal === 1 ? '' : 's'}`;
      if (live) {
        const tiles = new Set(deliverOffers(moves).map((o) => o.tile)).size;
        return `${label}: ${barnWords} - ${tiles} island tile${tiles === 1 ? '' : 's'} would take a delivery right now.`;
      }
      return `${label}: ${barnWords} - no island tile can be paid with that yet.`;
    }
    case 'visit': {
      if (live) {
        const hosts = visitHosts(moves).length;
        return `${label}: a card from your hand buys ${hosts} neighbour${hosts === 1 ? "'s" : "s'"} board power right now.`;
      }
      return view.you.hand.length === 0
        ? `${label}: you have no card to spend.`
        : `${label}: no neighbour's board can be bought with a card in your hand right now.`;
    }
    case 'bonusDraw':
      return live
        ? `${label}: the top card of any deck, free, and never dead.`
        : `${label}: not offered under this game's rules.`;
    case 'collect':
      return live
        ? `${label}: sweep the ${GLOSSARY.workers} off your own ${GLOSSARY.noticeBoard}, then draw 1.`
        : `${label}: nothing on your ${GLOSSARY.noticeBoard} to collect right now.`;
    case 'pass':
      return live
        ? `${label}: nothing else is legal this turn.`
        : `${label}: something else is still legal, so Pass is not offered.`;
    case 'endTurn':
      return live ? `${label}: closes your turn.` : `${label}: finish what is pending first.`;
    default:
      return live ? `${label}: available right now.` : `${label}: not available right now.`;
  }
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
 * the same keyword to a player who has never met it.
 *
 * ⛔ HIRE and WORK ARE GONE (v31). They were kept through change 6 on the
 * argument that a re-text could bring the Hiring Fair's vocabulary back; there
 * is no Fair, no Working Week, no wage and no Service left for either word to
 * describe, so a gloss for them would now be teaching a game nobody is playing.
 *
 * ⛔ VISITOR IS GONE TOO (18/09/2026, 2.6.2). It used to get its own line so
 * that VISIT would not fire on VISITOR at the same word boundary - but no v42
 * or v44 card text prints "visitor" at all (checked against `cards.json`),
 * only "visit"/"visits"/"visited" on W17, A17 and O16, so the VISITOR term
 * never once matched a real card and existed only to explain the Notice
 * Board's OWN printed threshold - which this glossary cannot reach anyway,
 * since `glossAbility` is only ever called with a card's own `abilityText`
 * and a Notice Board's text never mentions itself. Its explanation (what a
 * card placed here buys, and that the board is never full - S8) now lives in
 * `glossCost`, which already renders on every Notice Board face. Folded into
 * VISIT's own sentence instead, since a keyword set of GROW/VISIT/SOW is the
 * whole vocabulary this game has (project CLAUDE.md, "Keywords: Visit vs
 * Gift").
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
      "Play 1 card from your hand onto a RIVAL's Notice Board and take that board's printed power at once. Never your own board. The card stays there until they harvest it.",
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
export function buildCostWords(suit: Suit, cost: BuildCost): string {
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
  // A Notice Board is filled by VISITS and is never a GROW target (the engine
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
      // ⚠️ A Notice Board's threshold is a MINIMUM, never a maximum (S8,
      // 13/09/2026): it never clogs and always accepts another card. An
      // ordinary building genuinely clogs at its threshold, so only this
      // branch changed.
      noticeBoard
        ? `A visit fills it: ${threshold}+ before you may harvest. Never blocks - another card is always welcome.`
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
    const noticeBoard = slotOf(data, face.id) === 'noticeboard';
    if (mine.stack.length >= threshold) {
      // ⚠️ A NOTICE BOARD NEVER CLOGS (S8): `threshold` is a minimum a visitor
      // has already cleared, not a maximum, so it stays open to the next
      // visit rather than reading as "full". Every OTHER building genuinely
      // clogs here - `growOptions` requires `canTakeCard`, so full and
      // unGROWable are the same fact for those, and "harvest it" is already
      // the answer to both.
      return noticeBoard
        ? [
            `${mine.stack.length} of ${threshold}+, ready to harvest. Still open to visits - another card is always welcome.`,
          ]
        : [`Full at ${mine.stack.length} of ${threshold}. Harvest to take the stack.`];
    }
    /*
     * A VERDICT ONLY WHERE THERE IS A QUESTION. The Barn and the Farmstead have
     * no activation at all and the Notice Board is excluded by slot, so none of
     * the three can EVER be grown. "No GROW this turn" on one of them is worse
     * than saying nothing: it is true, and it teaches a player to keep coming
     * back to check a door that does not exist.
     */
    const growable = face.activation !== null && !noticeBoard;
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
