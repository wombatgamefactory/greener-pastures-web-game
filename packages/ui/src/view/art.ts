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

/**
 * Play tier, 520x375.
 *
 * ⛔ THE `upgraded` ARGUMENT IS GONE (v31). It appended a `u` to the filename to
 * fetch a starter's second printed face; starters have one face now, so the
 * fifteen `*u.webp` files on disk have no reader. They are left in `public/`
 * rather than deleted: nothing fetches them, so they cost a browser nothing, and
 * they are the only surviving picture of what the upgrade layer looked like.
 */
export function cardArt(id: string): string {
  return art(`cards/${id.toLowerCase()}.webp`);
}

/** Zoom tier, 1040x750. Fetched only when a card is actually being read. */
export function cardArtZoom(id: string): string {
  return art(`cards/zoom/${id.toLowerCase()}.webp`);
}

/** A face-down card: the deck back for its suit. */
export function deckBack(suit: Suit): string {
  return art(`backs/${suit}.webp`);
}

/**
 * The painting for one of the five DOOR actions. These were the Service cards'
 * art and the files are unchanged; what they illustrate now is the action a
 * colour's Notice Board grants and a meeple of that colour performs.
 */
export function doorArt(action: WorkerAction): string {
  return art(`workers/${action}.webp`);
}

export function islandTileArt(tile: string): string {
  return art(`island/${tile.toLowerCase()}.webp`);
}

export function islandTileArtZoom(tile: string): string {
  return art(`island/zoom/${tile.toLowerCase()}.webp`);
}

/** The box cover, 800x800. The start screen's hero, and its own backdrop. */
export function logoArt(): string {
  return art('logo.webp');
}

export function token(name: string): string {
  return art(`tokens/${name}.webp`);
}

export function frame(layer: string): string {
  return art(`frame/${layer}.webp`);
}

/**
 * ONE TOKEN ISLAND TOKEN'S PRINTED FACE (16/09/2026 rulings R3/R7; sliced from
 * the printed sheet 18/09/2026): the crop pair (or the cornucopia pair for
 * `'wild'`), the VP wreath and, on the 4 and 3 VP faces only, the Worker
 * silhouette - all one piece, 238x256. This is what `Island.tsx` draws for a
 * tile's tokens.
 *
 * ⛔ `demandTokenLayers` IS GONE (19/09/2026, 2.4.1/2.4): it composed a demand
 * icon over a bare VP circle, which this single painted face superseded on
 * 18/09/2026, and by then nothing called it any more - `view/art.test.ts` was
 * the function's only remaining reader. The six `demand-<crop>.webp` /
 * `demand-wild.webp` files it drew from had no other reader either and went
 * with it (`public/art/tokens/`).
 */
export function islandTokenArt(demand: Suit | 'wild', vp: number): string {
  return art(`tokens/island/${demand}-${vp}.webp`);
}

/** Zoom tier, 476x512. Used for a token read at the island's enlarged size. */
export function islandTokenArtZoom(demand: Suit | 'wild', vp: number): string {
  return art(`tokens/island/zoom/${demand}-${vp}.webp`);
}

/** The crop icon a card prints: its suit's sheaf/apple/etc, or the wild cornucopia. */
export function cropIcon(suit: Suit | 'wild'): string {
  return frame(suit === 'wild' ? 'suit_wild' : `suit_${suit}`);
}

/** The generic starting-building icon every base starter face prints (ticket 07). */
export function starterIcon(): string {
  return frame('card_starter');
}

/**
 * THE SIX ACTION ICONS, cut out of the printed player aid.
 *
 * `tools/extract_action_icons.py` crops them from
 * `frame/player_aid_actions.webp` and writes them here, so the button in the
 * turn bar carries the SAME painting as the card a player has in front of them
 * on the table. That is the whole argument for using the aid rather than
 * commissioning a fresh icon set: a second drawing of "Harvest" would be one
 * more thing to learn, and the aid's vignettes are already the game's own visual
 * vocabulary for its five verbs.
 *
 * ⚠️ THEY ARE UPSCALED FROM 56px TILES and are soft above about 32px. Fine at
 * the sizes `--action-icon` draws them at, and the reason that token is capped
 * rather than tracking the rest of the ladder up to 4K. If painted icons are
 * ever commissioned, they land in the same six filenames and nothing here or in
 * the bar changes.
 *
 * Returns `null` rather than a fallback path for a family with no icon. Three
 * families deliberately have none - End turn, undo and cancel - because they are
 * EXITS rather than actions, and phase 3 separated them on purpose. Inventing a
 * glyph for them would put them back in the same visual class as Build. A
 * missing icon must therefore be a legal, quiet outcome, not a broken image.
 */
const ACTION_ICONS = new Set(['draw', 'build', 'grow', 'harvest', 'deliver', 'visit']);

export function actionIcon(type: string): string | null {
  return ACTION_ICONS.has(type) ? art(`actions/${type}.webp`) : null;
}
