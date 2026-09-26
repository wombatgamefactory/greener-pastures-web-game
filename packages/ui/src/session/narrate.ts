/**
 * The event feed: `redactEvents` narrated to English.
 *
 * Ticket 09 found this carries more weight than it looks. A bot's whole turn was
 * followable from the feed alone with no animation, which is the mechanism for
 * the design's own success metric - "did players watch each other's turns, and
 * was there table talk". So the feed is not chrome, it is how the cross-farm
 * circuit becomes visible, and it gets built in the foundation rather than left
 * to the polish pass.
 *
 * Masked ids arrive as `W?`: the suit of a placed or drawn card is public, its
 * identity is not. They are narrated as "a Wheat card", never as a bare `W?`.
 *
 * ⭐ v31. `coins` was the busiest event in the game and it is gone, along with
 * `workerWorked` and `starterUpgraded`. What replaced them is not a rename:
 * `meepleGained` and `meepleSpent` are five discrete colours each worth one
 * specific action, `doorUsed` says which action a visit or a meeple actually
 * bought, and `visited` carries the `self` flag that decides whether a line is
 * about the hook or about somebody playing solitaire.
 */

import type { GameData, Suit } from '@gp/data';
import type { GameEvent, Seat } from '@gp/engine';

import { GLOSSARY } from '../view/glossary';
import { SUIT_META, maskedCardPhrase, seatName, suitArticle } from '../view/suits';
import { doorOf } from '../view/table';

export interface FeedLine {
  readonly text: string;
  /** The seat the line is about, for tinting. Null for table-level events. */
  readonly seat: Seat | null;
  /** Marks the turn boundary and the end trigger, which the feed sets apart. */
  readonly kind: 'normal' | 'boundary' | 'alarm';
}

const SUIT_LETTER: Readonly<Record<string, Suit>> = {
  W: 'wheat',
  V: 'vegetable',
  O: 'orchard',
  A: 'apiary',
  D: 'dairy',
};

/**
 * The six actions, in the words the turn bar uses.
 *
 * ⭐ FIXED 25/09/2026 (B9): `'grow'` was missing, which is `DoorAction`'s sixth
 * member (`packages/data/src/types.ts`) and exactly what the Apiary board
 * power and an Apiary Worker buy - so a visit or a Worker spend that bought a
 * Grow fell through to `event.action` unchanged and printed lower-case
 * "grow" where every other action here is capitalised. Both `narrate()`'s own
 * `visited`/`meepleSpent` lines and the new `summariseTurns` below read this
 * same table, so the fix is one line for both.
 */
const ACTION_WORD: Readonly<Record<string, string>> = {
  harvest: 'Harvest',
  deliver: 'Deliver',
  draw: 'Draw',
  sow: 'Sow',
  build: 'Build',
  grow: 'Grow',
};

function isMasked(id: string): boolean {
  return id.endsWith('?');
}

/** A card as the reader may know it: its name, or its suit if that is all they saw. */
function cardWord(data: GameData, id: string): string {
  if (isMasked(id)) {
    return maskedCardPhrase(SUIT_LETTER[id.charAt(0)]);
  }
  const card = data.cards.catalogue.find((c) => c.id === id);
  return card ? card.name : id;
}

function cardList(data: GameData, ids: readonly string[]): string {
  if (ids.length === 0) return 'nothing';
  if (ids.every(isMasked)) {
    return ids.length === 1 ? cardWord(data, ids[0] as string) : `${ids.length} cards`;
  }
  return ids.map((id) => cardWord(data, id)).join(', ');
}

/**
 * CAUSE BEFORE EFFECT (B10, 25/09/2026).
 *
 * `doVisit` (`packages/engine/src/actions/bonus.ts`) places the visit fee
 * (`cardPlaced`) and only THEN emits the `visited` event that says a visit
 * happened at all - reading that order straight would print "places a card
 * on Y's Notice Board" a line before "X visits Y ... takes Deliver", telling
 * the reader the effect before the thing that caused it. The engine's order
 * is not a bug this file can fix (the engine is not this pass's to edit) - so
 * this reorders just that one adjacent pair before narrating: a `cardPlaced`
 * onto the visited host's board, immediately preceding the `visited` event
 * for the same seat, is moved to sit right AFTER it instead. Nothing else
 * about the events changes - not their content, not any other pair's order -
 * and a placement that is not a visit fee (a sow, a Grow, a hook's own
 * `cardPlaced`) is left exactly where the engine put it, because the
 * `onto.seat === host` and `seat` match has to hold for both events.
 */
function reorderCauseBeforeEffect(events: readonly GameEvent[]): GameEvent[] {
  const out = [...events];
  for (let i = 0; i < out.length; i++) {
    const visited = out[i];
    if (visited === undefined || visited.e !== 'visited') continue;
    for (let j = i - 1; j >= 0; j--) {
      const placed = out[j];
      if (placed === undefined) break;
      if (
        placed.e === 'cardPlaced' &&
        placed.seat === visited.seat &&
        placed.onto.seat === visited.host
      ) {
        out.splice(j, 1);
        // `i` still names the visit's ORIGINAL slot; removing one element
        // before it shifts the visit itself back to `i - 1`, so re-inserting
        // the placement at `i` lands it one after the visit's new position -
        // exactly "cause, then effect".
        out.splice(i, 0, placed);
        break;
      }
      // Stop at the edge of this actor's own run of events - a different
      // seat's line, or a turn boundary - so a placement from several turns
      // back is never dragged forward onto an unrelated visit.
      if ('seat' in placed && placed.seat !== visited.seat) break;
      if (placed.e === 'turnEnded' || placed.e === 'endTriggered' || placed.e === 'gameEnded')
        break;
    }
  }
  return out;
}

/**
 * How a seat is named from another seat's events, shared by `narrate()` and
 * `summariseTurns()` below (25/09/2026, B9) so the two never drift apart on
 * the one sentence fragment they both build from.
 */
function seatWho(suits: readonly (Suit | undefined)[], you: Seat, seat: Seat): string {
  return seatName(suits[seat], seat, you);
}

export function narrate(
  data: GameData,
  event: GameEvent,
  suits: readonly (Suit | undefined)[],
  you: Seat,
): FeedLine | null {
  const who = (seat: Seat): string => seatWho(suits, you, seat);
  const line = (text: string, seat: Seat | null = null, kind: FeedLine['kind'] = 'normal') => ({
    text,
    seat,
    kind,
  });

  switch (event.e) {
    case 'cardPlaced': {
      const target =
        event.onto.seat === event.seat
          ? `their own ${cardWord(data, event.onto.building)}`
          : `${who(event.onto.seat)}'s ${cardWord(data, event.onto.building)}`;
      return line(
        `${who(event.seat)} places ${cardWord(data, event.card)} on ${target}`,
        event.seat,
      );
    }
    case 'cardsToHand':
      return line(`${who(event.seat)} draws ${cardList(data, event.cards)}`, event.seat);
    case 'cardsDiscarded':
      return line(
        `${cardList(data, event.cards)} to the ${SUIT_META[event.suit].label} discard`,
        null,
      );
    case 'deckToBarn':
      return line(
        `${who(event.seat)} takes ${maskedCardPhrase(event.suit)} into the barn`,
        event.seat,
      );
    case 'stackToBarn':
      return line(
        `${who(event.seat)} lifts a card off ${cardWord(data, event.building)} into the barn`,
        event.seat,
      );
    case 'harvested':
      return line(
        `${who(event.seat)} harvests ${cardWord(data, event.building)} (${event.cards.length} card${event.cards.length === 1 ? '' : 's'})`,
        event.seat,
      );
    /*
     * ⚠️ DELIBERATELY SILENT. A door action is always announced by the thing that
     * bought it - `visited` for a card on a Notice Board, `meepleSpent` for a
     * Worker - and both of those already name the action. Narrating this as well
     * would print every door use twice, which on a four-seat table is half the
     * feed saying the same thing.
     */
    case 'doorUsed':
      return null;
    case 'meepleGained':
      // The event's tile is nullable (it was, for the deleted bag-draw balloon),
      // so the sentence has to work without one rather than printing "off
      // island null". Under the shipped island Workers this is always a
      // delivery (`tile` set); a null tile is only reachable through the
      // retired meeple-currency visit arm's own Collect (§5 of the project
      // CLAUDE.md), which is a different, retired component from the shipped
      // delivery Worker. ⭐ FIXED 25/09/2026 (B13): this branch said "meeple"
      // where the very next one already says "Worker" for the same event -
      // CLAUDE.md is explicit that no player-facing text says "meeple" except
      // the delivery Worker, which is what this now reads as, dead branch or
      // not.
      return line(
        event.tile === null
          ? `${who(event.seat)} takes back a ${SUIT_META[event.colour].label} ${GLOSSARY.worker}`
          : `${who(event.seat)} takes the ${SUIT_META[event.colour].label} ${GLOSSARY.worker} off island ${event.tile}`,
        event.seat,
      );
    case 'meepleSpent':
      return line(
        `${who(event.seat)} spends ${suitArticle(SUIT_META[event.colour].label)} ${SUIT_META[event.colour].label} ${GLOSSARY.worker}: ${ACTION_WORD[event.action] ?? event.action}. It leaves the game.`,
        event.seat,
      );
    case 'reshuffled':
      return line(
        `the ${SUIT_META[event.suit].label} discard is reshuffled (${event.count} cards)`,
      );
    case 'built':
      return line(`${who(event.seat)} builds ${cardWord(data, event.card)}`, event.seat);
    case 'demolished':
      return line(`${who(event.seat)} demolishes ${cardWord(data, event.card)}`, event.seat);
    case 'delivered': {
      // ⭐ NAME THE TOKEN TAKEN (18/09/2026): its crop demand, its VP and
      // whether it carried a Worker - all three already sit on the event, so
      // there is nothing to look up.
      const crop = event.crop === 'wild' ? 'wild' : SUIT_META[event.crop].label;
      const worker = event.worker
        ? `, with a ${SUIT_META[event.worker].label} ${GLOSSARY.worker}`
        : '';
      return line(
        `${who(event.seat)} delivers to island ${event.tile}: the ${crop} token, ${event.vp} VP${worker}`,
        event.seat,
      );
    }
    case 'discardToBarn':
      return line(
        `${who(event.seat)} reclaims ${cardWord(data, event.card)} from the discard`,
        event.seat,
      );
    case 'barnDiscarded':
      return line(
        `${who(event.seat)} discards ${cardWord(data, event.card)} from the barn`,
        event.seat,
      );
    case 'barnToHand':
      return line(
        `${who(event.seat)} takes ${maskedCardPhrase(event.suit)} from the barn into hand`,
        event.seat,
      );
    case 'demandSwapped':
      return line(
        `${who(event.seat)} swaps a token on island ${event.a.tile} with one on island ${event.b.tile}`,
        event.seat,
      );
    case 'cardGifted':
      return line(
        `${who(event.from)} gives ${cardWord(data, event.card)} to ${who(event.to)}`,
        event.from,
      );
    case 'handToBarn':
      return line(
        `${who(event.seat)} puts ${cardWord(data, event.card)} into the barn`,
        event.seat,
      );
    /*
     * ⭐ REWRITTEN 18/09/2026 for the shipped rule: self-visiting is BANNED
     * ("Never your own board, either of them", ruled 11/09/2026), so `self`
     * is never true under `visitCurrency: 'noticeBoardPower'` - it stays on
     * the event only because the pre-ban `'card'` control still replays. The
     * hook branch says what a visit actually does now: the card stays on the
     * host's board until they harvest it, never a "clog".
     */
    case 'visited': {
      const action = ACTION_WORD[event.action] ?? event.action;
      return event.self
        ? line(
            `${who(event.seat)} plays a card onto their own Notice Board for ${action} (not the shipped rule: self-visiting is banned)`,
            event.seat,
          )
        : line(
            `${who(event.seat)} visits ${who(event.host)}: a card onto their Notice Board, and takes ${action}. It stays there until they harvest it.`,
            event.seat,
            'alarm',
          );
    }
    case 'endTriggered':
      return line(
        `${who(event.seat)} made their ${data.rules.endGame.deliveriesToTrigger}th delivery - last turn each!`,
        event.seat,
        'alarm',
      );
    case 'turnEnded':
      return line(`${who(event.next)} to play`, event.next, 'boundary');
    case 'gameEnded':
      return line('the game is over', null, 'alarm');
    default:
      return null;
  }
}

export function narrateAll(
  data: GameData,
  events: readonly GameEvent[],
  suits: readonly (Suit | undefined)[],
  you: Seat,
): FeedLine[] {
  return reorderCauseBeforeEffect(events).flatMap((e) => {
    const l = narrate(data, e, suits, you);
    return l ? [l] : [];
  });
}

/**
 * The five door actions by colour, for a tooltip on a Worker. Exported here
 * rather than re-derived at the call site so the feed and the supply agree about
 * what a colour means.
 */
export function meepleActionWord(data: GameData, colour: Suit): string {
  const door = doorOf(data, colour);
  return door.actionLabel;
}

/* -------------------------------------------------------------------------
 * B9, 25/09/2026: "WHILE YOU WERE AWAY".
 *
 * `TurnSummary.tsx` needs one line per RIVAL TURN, not one line per event -
 * the feed already does per-event, and repeating that format in a dismissible
 * strip would just be a second copy of the same list. This groups the raw
 * events between two of YOUR OWN decisions by the seat whose turn they belong
 * to (a `turnEnded` event closes each group) and writes one plain-language
 * sentence per group, joining the turn's notable acts with "then" - the shape
 * the brief's own worked example uses: "Orchard farm visited you (+1 card on
 * your Notice Board), then delivered to island B2 for 6 VP."
 *
 * Deliberately NOT built by re-running `narrateAll` and gluing its sentences
 * together: those sentences are written to stand alone in a scrolling feed
 * ("X visits Y: a card onto their Notice Board..."), and stapling several of
 * them together reads as a list, not a story. This writes its own, shorter
 * clauses instead, and reuses only the small pieces that are already exactly
 * right for it (`cardWord`, `seatWho`, `ACTION_WORD`, `SUIT_META`).
 * ------------------------------------------------------------------------- */

export interface TurnSummaryLine {
  /** The rival whose turn this line is about. */
  readonly seat: Seat;
  readonly text: string;
  /** Suits mentioned, own suit first, for a small inline icon per suit. */
  readonly icons: readonly Suit[];
}

/** One clause of a turn's story, or null for an event this summary is quiet about. */
function turnClause(
  data: GameData,
  event: GameEvent,
  suits: readonly (Suit | undefined)[],
  you: Seat,
): { text: string; suits: readonly Suit[] } | null {
  switch (event.e) {
    // ⛔ Quiet on purpose, same reason as `narrate()`'s own `doorUsed` case:
    // whatever the visit or Worker bought is about to arrive as its OWN
    // event (a `delivered`, a `built`, a `harvested`, cards drawn...), so
    // naming the door here as well would say the same thing twice.
    case 'doorUsed':
      return null;
    case 'visited': {
      const toYou = event.host === you;
      const target = toYou ? 'you' : `${seatWho(suits, you, event.host)}'s board`;
      const possessive = toYou ? 'your' : 'their';
      return {
        text: `visited ${target} (+1 card on ${possessive} Notice Board)`,
        suits: event.host === event.seat ? [] : [suits[event.host]].filter((s): s is Suit => !!s),
      };
    }
    case 'delivered': {
      return {
        text: `delivered to island ${event.tile} for ${event.vp} VP`,
        suits: event.crop === 'wild' ? [] : [event.crop],
      };
    }
    case 'built':
      return { text: `built ${cardWord(data, event.card)}`, suits: [] };
    case 'harvested': {
      const n = event.cards.length;
      return {
        text: `harvested ${cardWord(data, event.building)} (${n} card${n === 1 ? '' : 's'})`,
        suits: [],
      };
    }
    case 'meepleSpent': {
      const label = SUIT_META[event.colour].label;
      return {
        text: `spent ${suitArticle(label)} ${label} ${GLOSSARY.worker} for ${ACTION_WORD[event.action] ?? event.action}`,
        suits: [event.colour],
      };
    }
    case 'cardsToHand': {
      const n = event.cards.length;
      return { text: `drew ${n} card${n === 1 ? '' : 's'}`, suits: [] };
    }
    case 'demolished':
      return { text: `demolished ${cardWord(data, event.card)}`, suits: [] };
    case 'cardGifted':
      return {
        text: `gave ${cardWord(data, event.card)} to ${seatWho(suits, you, event.to)}`,
        suits: [],
      };
    case 'endTriggered':
      return {
        text: `made their ${data.rules.endGame.deliveriesToTrigger}th delivery, triggering the endgame`,
        suits: [],
      };
    default:
      return null;
  }
}

/**
 * One line per rival turn found in `events`. `suits` and `you` are exactly
 * `narrateAll`'s own parameters (`seatSuits(view)` and `YOU`), so a caller
 * that already has both for the feed has both for this too.
 *
 * A group with no seat-bearing event at all (a stray `reshuffled` or
 * `cardsDiscarded` with nothing else around it) is dropped rather than
 * printed as an empty sentence - it belongs to nobody's story.
 */
export function summariseTurns(
  data: GameData,
  events: readonly GameEvent[],
  suits: readonly (Suit | undefined)[],
  you: Seat,
): TurnSummaryLine[] {
  const lines: TurnSummaryLine[] = [];
  let group: GameEvent[] = [];
  let groupSeat: Seat | null = null;

  const flush = () => {
    if (groupSeat !== null && groupSeat !== you) {
      const clauses: { text: string; suits: readonly Suit[] }[] = [];
      for (const e of group) {
        const clause = turnClause(data, e, suits, you);
        if (clause) clauses.push(clause);
      }
      if (clauses.length > 0) {
        const icons: Suit[] = [];
        const ownSuit = suits[groupSeat];
        if (ownSuit) icons.push(ownSuit);
        for (const c of clauses) for (const s of c.suits) if (!icons.includes(s)) icons.push(s);
        lines.push({
          seat: groupSeat,
          text: `${seatWho(suits, you, groupSeat)} ${clauses.map((c) => c.text).join(', then ')}.`,
          icons,
        });
      }
    }
    group = [];
    groupSeat = null;
  };

  for (const event of events) {
    if (groupSeat === null && 'seat' in event) groupSeat = event.seat;
    group.push(event);
    if (event.e === 'turnEnded') flush();
  }
  flush(); // a trailing, not-yet-closed turn (no `turnEnded` seen yet) is still shown

  return lines;
}

/**
 * Everything in `current` that came after `baseline`'s own events, found by
 * OBJECT IDENTITY rather than a count or a timestamp.
 *
 * `Session.snapshot()` (`session/table.ts`) hands out `this.events.slice(-160)`
 * on every call: the same growing array, windowed to its last 160 entries, and
 * never rebuilt or mutated in place. So two snapshots taken further apart than
 * one call to `send` are the same list with more appended, and finding
 * `baseline`'s LAST element inside `current` finds the seam between "what you
 * had already seen" and "what happened since". If the seam cannot be found -
 * only reachable if a single bot round somehow produced over 160 events, which
 * the shipped game has never measured - every current event is treated as new
 * rather than none, on the same principle as `narrate.ts`'s masked-card
 * fallbacks: a slightly over-eager summary is a far smaller fault than a
 * silently empty one.
 */
export function eventsSinceBaseline(
  baseline: readonly GameEvent[],
  current: readonly GameEvent[],
): GameEvent[] {
  if (baseline.length === 0) return [...current];
  const last = baseline[baseline.length - 1] as GameEvent;
  const seam = current.lastIndexOf(last);
  return seam === -1 ? [...current] : current.slice(seam + 1);
}
