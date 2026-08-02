/**
 * Every path into `public/art/`, in one place.
 *
 * Two rules the rest of the UI must not have to remember:
 *
 *  1. **Everything goes through BASE_URL.** GitHub Pages serves this from
 *     `/greener-pastures-web-game/`, so a hard-coded `/art/...` 404s in
 *     production while working perfectly in dev. Ticket 12 verified the base
 *     path for the bundle; `public/` assets are not rewritten by Vite at all,
 *     so they only stay correct if they are built here.
 *  2. **Filenames are lowercased card ids** (ticket 32). The sheet spells
 *     `W7` and `ability_bg_Wheat.png`; the disk is lowercase. Windows does not
 *     care, a web server does.
 */

import type { Suit, WorkerAction } from '@gp/data';

const BASE: string = import.meta.env.BASE_URL;

function art(path: string): string {
  return `${BASE}art/${path}`;
}

/** Play tier, 520x375. `upgraded` selects the starter's second printed face. */
export function cardArt(id: string, upgraded = false): string {
  return art(`cards/${id.toLowerCase()}${upgraded ? 'u' : ''}.webp`);
}

/** Zoom tier, 1040x750. Fetched only when a card is actually being read. */
export function cardArtZoom(id: string, upgraded = false): string {
  return art(`cards/zoom/${id.toLowerCase()}${upgraded ? 'u' : ''}.webp`);
}

/** A face-down card: the deck back for its suit. */
export function deckBack(suit: Suit): string {
  return art(`backs/${suit}.webp`);
}

export function workerArt(action: WorkerAction): string {
  return art(`workers/${action}.webp`);
}

export function workerArtZoom(action: WorkerAction): string {
  return art(`workers/zoom/${action}.webp`);
}

export function islandTileArt(tile: string): string {
  return art(`island/${tile.toLowerCase()}.webp`);
}

export function islandTileArtZoom(tile: string): string {
  return art(`island/zoom/${tile.toLowerCase()}.webp`);
}

export function aerodromeArt(): string {
  return art('aerodrome/board.webp');
}

export function token(name: string): string {
  return art(`tokens/${name}.webp`);
}

export function frame(layer: string): string {
  return art(`frame/${layer}.webp`);
}

/**
 * A demand token's layers, bottom first.
 *
 * The five crop tokens are single printed pieces. The **cornucopia (wild) token
 * has no art** - ticket 33 - so it is composed here from the empty crate slot
 * plus the cornucopia icon the cost bars already use. That is a real component
 * standing in for itself, not a placeholder rectangle, and it needs no code
 * change when the painted token lands: only this function.
 */
export function demandTokenLayers(demand: Suit | 'wild'): string[] {
  // The wild demand used to be composed from the cost bar's cornucopia over an
  // empty crate slot, because no cornucopia token art existed. Ticket 33 built
  // the real one, so all six demands are now one painted token.
  return [token(`demand-${demand}`)];
}

export function balloonArt(balloonId: string): string {
  return token(`balloon-${balloonId}`);
}

/** The crop icon a card prints: its suit's sheaf/apple/etc, or the wild cornucopia. */
export function cropIcon(suit: Suit | 'wild'): string {
  return frame(suit === 'wild' ? 'suit_wild' : `suit_${suit}`);
}

/** The generic starting-building icon every base starter face prints (ticket 07). */
export function starterIcon(): string {
  return frame('card_starter');
}
