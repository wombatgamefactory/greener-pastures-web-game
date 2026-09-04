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

/** The five actions, in the words the turn bar uses. */
const ACTION_WORD: Readonly<Record<string, string>> = {
  harvest: 'Harvest',
  deliver: 'Deliver',
  draw: 'Draw',
  sow: 'Sow',
  build: 'Build',
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

export function narrate(
  data: GameData,
  event: GameEvent,
  suits: readonly (Suit | undefined)[],
  you: Seat,
): FeedLine | null {
  const who = (seat: Seat): string => seatName(suits[seat], seat, you);
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
     * meeple - and both of those already name the action. Narrating this as well
     * would print every door use twice, which on a four-seat table is half the
     * feed saying the same thing.
     */
    case 'doorUsed':
      return null;
    case 'meepleGained':
      // A balloon meeple comes from a bag and from no tile, so the sentence has
      // to work without one rather than printing "off island null".
      return line(
        event.tile === null
          ? `${who(event.seat)} draws the ${SUIT_META[event.colour].label} meeple out of the bag`
          : `${who(event.seat)} takes the ${SUIT_META[event.colour].label} meeple off island ${event.tile}`,
        event.seat,
      );
    case 'meepleSpent':
      return line(
        `${who(event.seat)} spends ${suitArticle(SUIT_META[event.colour].label)} ${SUIT_META[event.colour].label} meeple: ${ACTION_WORD[event.action] ?? event.action}. It leaves the game.`,
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
    case 'delivered':
      return line(
        `${who(event.seat)} delivers to island ${event.tile} for ${event.vp} VP`,
        event.seat,
      );
    case 'balloonMoved':
      return line(
        `${who(event.seat)} brings in the ${event.balloon.replace('balloon', '').toLowerCase()} balloon`,
        event.seat,
      );
    case 'discardToBarn':
      return line(
        `${who(event.seat)} reclaims ${cardWord(data, event.card)} from the discard`,
        event.seat,
      );
    case 'demandSwapped':
      return line(
        `${who(event.seat)} swaps the demand on island ${event.a.tile} with island ${event.b.tile}`,
        event.seat,
      );
    case 'demandFaceDown':
      return line(
        `${who(event.seat)} turns a demand token on island ${event.tile} face down: it takes any crop now`,
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
     * ⭐ THE ONE LINE THE WHOLE v31 PASS TURNS ON.
     *
     * A visit and a self-visit are one event with a flag, and they are opposite
     * acts: a card on a neighbour's board is the game's social hook, a card on
     * your own is solitaire that also clogs your own door. `a08-the-hook` counts
     * them separately in the simulator for exactly that reason, and the feed is
     * where a player at the table does the same counting by eye - so the two
     * lines share no phrasing at all, and the self one names the cost.
     */
    case 'visited': {
      const action = ACTION_WORD[event.action] ?? event.action;
      return event.self
        ? line(
            `${who(event.seat)} uses their OWN door for ${action} - a card onto their own Notice Board`,
            event.seat,
          )
        : line(
            `${who(event.seat)} visits ${who(event.host)} and takes ${action}`,
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
  return events.flatMap((e) => {
    const l = narrate(data, e, suits, you);
    return l ? [l] : [];
  });
}

/**
 * The five door actions by colour, for a tooltip on a meeple. Exported here
 * rather than re-derived at the call site so the feed and the supply agree about
 * what a colour means.
 */
export function meepleActionWord(data: GameData, colour: Suit): string {
  const door = doorOf(data, colour);
  return door.actionLabel;
}
