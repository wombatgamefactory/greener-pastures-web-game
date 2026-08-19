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
 */

import type { GameData, Suit } from '@gp/data';
import type { GameEvent, Seat } from '@gp/engine';

import { SUIT_META, seatName } from '../view/suits';

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

function isMasked(id: string): boolean {
  return id.endsWith('?');
}

/** A card as the reader may know it: its name, or its suit if that is all they saw. */
function cardWord(data: GameData, id: string): string {
  if (isMasked(id)) {
    const suit = SUIT_LETTER[id.charAt(0)];
    return suit ? `a ${SUIT_META[suit].label} card` : 'a card';
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
    case 'coins':
      return line(
        `${who(event.seat)} ${event.delta >= 0 ? 'takes' : 'pays'} £${Math.abs(event.delta)} (${event.why})`,
        event.seat,
      );
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
        `${who(event.seat)} takes a ${SUIT_META[event.suit].label} card into the barn`,
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
    case 'workerWorked':
      return line(
        `${who(event.seat)} uses the ${event.workerId} Service${event.free ? ' for free' : ''}`,
        event.seat,
      );
    case 'reshuffled':
      return line(
        `the ${SUIT_META[event.suit].label} discard is reshuffled (${event.count} cards)`,
      );
    case 'built':
      return line(`${who(event.seat)} builds ${cardWord(data, event.card)}`, event.seat);
    case 'covered':
      return line(`${who(event.seat)} builds over ${cardWord(data, event.card)}`, event.seat);
    case 'demolished':
      return line(`${who(event.seat)} demolishes ${cardWord(data, event.card)}`, event.seat);
    case 'starterUpgraded':
      // Every flip is a £2 purchase now (2026-08-12), so the Farmstead is told
      // apart by its slot rather than by a `free` flag. It keeps the alarm: the
      // upgraded suit power is still the moment a farm changes gear.
      return data.cards.catalogue.find((c) => c.id === event.card)?.slot === 'farmstead'
        ? line(
            `${who(event.seat)} flips the Farmstead - the upgraded suit power is live`,
            event.seat,
            'alarm',
          )
        : line(`${who(event.seat)} upgrades ${cardWord(data, event.card)}`, event.seat);
    case 'delivered':
      return line(
        `${who(event.seat)} delivers to island ${event.tile}: ${event.vp} VP and £${event.coins}`,
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
    case 'visited': {
      const payoff =
        event.mode === 'coin'
          ? 'and takes the money'
          : event.mode === 'special'
            ? 'with two cards, for the bigger prize'
            : 'and puts their Worker to work';
      return line(`${who(event.seat)} visits ${who(event.host)} ${payoff}`, event.seat);
    }
    case 'endTriggered':
      return line(`${who(event.seat)} reached Level 3 - last turn each!`, event.seat, 'alarm');
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
