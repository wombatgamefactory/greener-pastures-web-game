# tools

Developer scripts. None of these run in CI, in the browser, or as part of a build.

## `extract_cards.py`

Regenerates `packages/data/data/cards.json` from the designer spreadsheet.

```
python tools/extract_cards.py <path-to-the-sheet>
# or
GP_SHEET=<path-to-the-sheet> python tools/extract_cards.py
```

Needs Python 3 and `openpyxl`.

**The sheet is not in this repo, and its path is not in this script.** The sheet is private
design material, and its filename names the game under a title that is not this one. Supply
the path each time, or set `GP_SHEET` locally.

The generated JSON **is** committed and does ship, because the game cannot run without it.

**Never hand-edit `cards.json`.** The next extract silently overwrites it. If a number is
wrong, either the sheet is wrong (fix the sheet, re-extract) or you are running an
experiment (write a tuning overlay, see below).

**Never edit card text anywhere but the sheet.** The sheet is the single source of truth for
wording, which is what stops the web game and the physical game drifting apart on rules text.
The extractor holds no text overrides and the tuning overlay refuses to set one.

After a re-extract, diff the JSON and read the warnings. The script pins values it expects
(hand sizes per suit, the Notice Board threshold, the shape of each suit) and exits non-zero
when one moves, so a silent sheet edit is caught instead of absorbed. `meta.sourceSha256`
fingerprints the sheet the extract came from.

## `check-disclosure.mjs`

Fails if a private name or path appears in anything git would commit, checking both file
contents and filenames. Part of `npm run check`.

This repo will be made public, and going public exposes the whole history rather than just
the current tree, so a leak has to be caught before the commit rather than after. It has
already happened once.

Widening the forbidden list is cheap. Narrowing it needs a reason.

## Tuning overlays

Not a tool, but this is where the extract's numbers get varied.

An overlay is a flat map of knob path to replacement value, applied over the extract at load.
The extract is never edited to run an experiment.

```
npm run knobs      # every tunable value, its current number, and its type
```

Committed experiments live in `overlays/`: `*.overlay.json` for a single variant,
`*.sweep.json` for a cross product of values. A test keeps them honest against the current
extract, so a knob that disappears fails the build rather than an experiment weeks later.

The rules are in `packages/data/src/overlay.ts`. In short: a path addresses one leaf and
replaces it whole; an unknown path, a missing path, a type mismatch or a schema mismatch all
throw rather than quietly doing nothing; and there is no way to set card text.
