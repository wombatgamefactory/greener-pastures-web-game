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

`npm run check:disclosure:history` scans every blob and commit message reachable from any
ref instead of the working tree. That is the question the default mode cannot answer: the
working-tree scan goes green the moment an offending line is deleted, but the blob is still
served to anyone holding the commit SHA. It is not part of `npm run check` because CI checks
out at `fetch-depth: 1` and would scan one commit and call it clean. Run it locally, and run
it before any change to who can read this repo.

The second time it happened, it was caught by this mode and not the default one.

Widening the forbidden list is cheap. Narrowing it needs a reason.

## `verify-webkit.mjs` - will a Mac see this?

```
npx playwright-core install webkit chromium   # once
npm run build && npm run verify:webkit
```

Renders the table, the island, the hand and one enlarged card in **WebKit** and in
**Chromium** into `reports/webkit/` for a human to compare, and asserts the thing a
screenshot cannot: that no surface is **load-bearing on a browser capability an older
Safari may lack**.

The trap it exists for: Playwright's WebKit tracks Safari Tech Preview, so it is always
_newer_ than the Safari on anybody's Mac. Rendering in it proves the page works on next
year's Safari, not on the one in front of the player. So each fragile capability is
instead switched **off** in a current WebKit and the page is diffed against itself: same
engine, same antialiasing, so the difference is caused by the capability alone. If the
picture changes, a Mac without it sees something else.

Add to `FRAGILE` in the script any property that

- cannot be feature-detected honestly (`paint-order` is the worst kind: `CSS.supports()`
  answers **true** on the very Safari versions that ignore it, so `@supports` cannot gate
  a fallback), or
- degrades into something unreadable rather than something plain.

`reports/` is private (gitignored), so the renders never ship.

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
