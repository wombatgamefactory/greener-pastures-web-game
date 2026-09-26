/**
 * The player-facing glossary (B13, 25/09/2026).
 *
 * One small object so a term never drifts between two files that both spell
 * it out by hand - which is exactly how "meeple" survived in `narrate.ts`
 * line 138 for a week after every other string had already moved to
 * "Worker" (the appraisal's B6 finding). `moveText.ts`, `narrate.ts`,
 * `Prompt.tsx` and `VisitPanel.tsx` all read a player-facing noun from here
 * rather than typing it again.
 *
 * Not every string in this pass routes through it - a full sweep of every
 * literal would have been a much larger, riskier diff than a copy pass owes,
 * and several of the strings fixed this pass (the visit note, the draw
 * prompt) are full sentences rather than a single reusable noun. What is
 * here is the small set of NOUNS that recur across files and are exactly the
 * ones a future retext could get out of sync again: the piece, the board,
 * where cards live, and the two "never say this" jargon words the project's
 * CLAUDE.md names outright (§0: "Never say 'the commons', ... 'a meeple'
 * ... 'a door' ... about the current game").
 */

export const GLOSSARY = {
  /** The piece a delivery brings. Never "meeple" in anything a player reads. */
  worker: 'Worker',
  workers: 'Workers',
  /** The building a visit's fee lands on. Never "the door" - that is this
   *  project's internal shorthand for a suit's plain action, in `doorOf`/
   *  `doorLabel`, and a player never needs the word to play. */
  noticeBoard: 'Notice Board',
  /** Where a harvested or delivered card ends up before it scores. */
  barn: 'barn',
} as const;
