# Retired overlays

**These files are history. Nothing runs them and nothing validates them.**

`packages/sim/src/overlays.test.ts` reads the overlay directory with a
non-recursive `readdirSync`, so **a subfolder escapes validation entirely**: an
overlay in here that names a knob the extract no longer has will never fail a
test. That is the point - these arms describe games the engine no longer ships,
and pinning them back into validity would mean maintaining them - but it is also
the trap. **Do not move a file back out of `retired/` without re-reading every
path in it against `npm run sim -- --list-knobs`.**

## Why they were retired (09/09/2026, the commons flip)

Dean ruled the commons in as the engine default
(`docs/commons-handoff-2026-09-09-v1.md`), which moved four leaves at once:
`rules.turn.visitCurrency` to `'commons'`, `rules.turn.bonusTiming` to
`'start'`, `rules.turn.startingMeeplesPerColour` to 0, and the Orchard door's
printed draw to 2/2. Every overlay in the repository was then audited, one at a
time, for the passengers that flip had handed it - the 05/09/2026 lesson written
down: **an arm that pins only what it is named for stops being the arm it is
called, silently.**

Each file below failed that audit in the same way. **Its `set` is a single
number whose RULE no longer has a subject** - a supply cap or a slot toll in a
game with no meeples, or a turn order that is now the default - so pinning it
back into meaning would have meant adding the entire meeple-economy set beneath
it, at which point it is not the arm it was either. They were sweep cells, and
the sweep they belonged to is finished and reported.

| File                                                           | What it was                                                                                   | Why it is here                                                                                                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bonus-first.overlay.json`                                     | `bonusTiming: 'start'`, the paired control for the 03/09/2026 turn-order correction           | **A no-op.** `'start'` is the shipped rule again (C2), so this sets what is already set. The arm now points the other way: `overlays/commons-bonus-last.overlay.json`.  |
| `meeple-no-cap-v1.overlay.json`                                | `meepleCapPerColour: null` on the capped meeple economy - the arm Dean ruled in on 05/09/2026 | Its result BECAME the shipped meeple game, and that game is reproduced whole by `overlays/meeple-economy-v1.overlay.json`. As one leaf it now says nothing.             |
| `meeple-on-board-cap-one-v1` · `-cap-two-v1` · `-cap-three-v1` | the supply-cap sweep under R17                                                                | The cap sweep is finished (the largest supply any seat ever reached with no cap was nine meeples, never more than three of one colour) and there are no meeples to cap. |
| `meeple-loop-cap-two-v1` · `meeple-loop-cap-three-v1`          | the same sweep under the v1 loop                                                              | Same. These are the arms behind Dean's cap-of-one ruling of 04/09/2026, which the cap removal of 05/09 superseded.                                                      |
| `meeple-as-card-cap-one-v1` · `-cap-three-v1` · `-toll-two-v1` | cap and toll cells inside the handoff-v2 (`goesTo: 'box'`) arm                                | The arm they vary is itself a control now (`overlays/meeple-as-card-v1.overlay.json`), and it is kept only because it is the pair that proved R17. Its cells are not.   |
| `meeple-as-card-off-v1.overlay.json`                           | R15 off, inside the box arm                                                                   | Duplicates what `meeple-loop-v1` says more clearly.                                                                                                                     |

## What is still live, and why

The three games this project has shipped all stay reproducible, because **a
branch whose only producer is a knob at its shipped value is not deleted** and
these overlays are the only things exercising those branches at scale:

- `overlays/v31-card-visit.overlay.json` - the v31 card visit (02-04/09/2026)
- `overlays/meeple-loop-v1.overlay.json` - the v1 meeple loop (04/09/2026)
- `overlays/meeple-economy-v1.overlay.json` - the meeple economy (05/09/2026),
  which is the **reference-v14** game and the last rules any report quotes
- `overlays/meeple-as-card-v1.overlay.json` - R17's own control, the same rules
  with the BOX as the destination. The pair is the whole argument for R17 (hook
  0.09 against 0.31)
- `overlays/meeple-on-board-v1.overlay.json` - the R17 arm as measured, with the
  cap of two, which is the control the cap removal was read against
- `overlays/meeple-on-board-per-meeple-v1.overlay.json` - a host per meeple,
  Dean's ruling of 05/09/2026 that he ruled back the same day. Named in
  CLAUDE.md as a standing decision and still unrun
- `overlays/meeple-loop-no-starting-meeples-v1.overlay.json` and
  `overlays/meeple-loop-orchard-draw-three-v1.overlay.json` - both cited
  measurements

## Known stale references

Prose elsewhere still names three of these files at their old paths, because the
files that carry it are outside the data layer's scope. None of them is a code
path; all are descriptions a future session will rewrite when the assertions
themselves are re-cut for the commons:

- `packages/sim/src/reference.ts` names `overlays/bonus-first.overlay.json`
- `packages/sim/src/assertions/a02-generosity.ts`, `a05-clog-denial.ts` and
  `a15-meeple-economy.ts` name `overlays/meeple-loop-cap-two-v1.overlay.json`
- `packages/sim/src/reference.ts` names the report
  `...-reference-v13-meeple-no-cap-v1.txt`, which is a filename in `reports/`
  and is correct: the report is not moving.

## Retired 16/09/2026, with the token island and the board retexts

Dean ruled the token island (R3) and retexted the Vegetable and Dairy boards
(R9, R10). Six arms lost their only subject:

| File                                                         | What it was                                                                           | Why it is here                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `dairy-grow-built-free-v1` · `-paid-v1` · `-paid-wild-v1`    | the three values of `noticeBoardPower.dairyGrowsBuilt` (12/09/2026)                   | The leaf is deleted: the Dairy board now reads "Build, spending cards of any crops, with a discount of 2" and Grows nothing.    |
| `flat-receipts.overlay.json`                                 | `island.vpByDeliveryOrder` [5, 4] against the shipped [6, 3]                          | The VP-by-arrival schedule is deleted. VP is printed on each token now.                                                         |
| `delivery-meeple-no-choice-v1` · `delivery-meeple-choice-v1` | the 14/09/2026 decomposition of the delivery meeple with and without the space choice | `deliverySpaceChoice` and `deliveryMeepleSpace` are deleted with the delivery spaces, so the two arms had become the same game. |
