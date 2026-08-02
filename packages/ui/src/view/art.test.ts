/**
 * Asset paths. Two things go wrong here and both are invisible in dev:
 * a path that skips BASE_URL works locally and 404s on GitHub Pages, and a path
 * that keeps the sheet's capitalisation works on Windows and 404s on a real web
 * server. Both are pinned.
 */

import { describe, expect, it } from 'vitest';

import {
  balloonArt,
  cardArt,
  cardArtZoom,
  cropIcon,
  deckBack,
  demandTokenLayers,
  frame,
  islandTileArt,
  starterIcon,
  token,
  workerArt,
} from './art';

const BASE: string = import.meta.env.BASE_URL;

describe('art paths', () => {
  it('puts every path behind BASE_URL', () => {
    for (const url of [
      cardArt('W7'),
      cardArtZoom('W7'),
      deckBack('wheat'),
      workerArt('draw'),
      islandTileArt('A1'),
      token('coin'),
      frame('vp'),
      balloonArt('balloonDraw'),
    ]) {
      expect(url.startsWith(`${BASE}art/`)).toBe(true);
    }
  });

  it('lowercases card ids, because the sheet does not and a web server cares', () => {
    expect(cardArt('W7')).toBe(`${BASE}art/cards/w7.webp`);
    expect(cardArt('A1', true)).toBe(`${BASE}art/cards/a1u.webp`);
    expect(cardArtZoom('D11')).toBe(`${BASE}art/cards/zoom/d11.webp`);
    expect(islandTileArt('C3')).toBe(`${BASE}art/island/c3.webp`);
  });

  it('reads the two art tiers from the same id', () => {
    expect(cardArt('V4')).toContain('/cards/v4.webp');
    expect(cardArtZoom('V4')).toContain('/cards/zoom/v4.webp');
  });

  it('draws every demand, wild included, as one painted token (ticket 33)', () => {
    expect(demandTokenLayers('wheat')).toEqual([`${BASE}art/tokens/demand-wheat.webp`]);
    expect(demandTokenLayers('wild')).toEqual([`${BASE}art/tokens/demand-wild.webp`]);
  });

  it('has a distinct icon for the generic starting building and for a crop', () => {
    expect(starterIcon()).toContain('card_starter');
    expect(cropIcon('dairy')).toContain('suit_dairy');
    expect(cropIcon('wild')).toContain('suit_wild');
  });
});
