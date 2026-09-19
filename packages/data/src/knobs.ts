/**
 * The knob registry: the declared balance surface.
 *
 * A tuning overlay may write to a path only if a template here covers it. That
 * restriction is the point. Without it a typo'd path is a silent no-op, and a
 * balance run quietly measures the baseline while claiming to measure a change.
 *
 * Templates use `{}` for a wildcard segment. Expansion happens against the real
 * data, so the legal values of a wildcard are whatever is actually there: no
 * separate list of card ids to keep in sync, and a card that leaves the game
 * takes its knobs with it.
 *
 * Adding a knob is one line here. Adding a knob that has no home in the data is
 * a design change first, not a tuning change.
 *
 * ⭐ v31 (02/09/2026) removed fourteen templates in one edit and added six. Every
 * one of the fourteen was a coin, a starter upgrade, a hand limit or a printed
 * face - `startingCoins`, `buyCost`, `marketCost`, `upgradeIsBonus`,
 * `upgradeCostCoins`, `coinPityDivisor`, the four `visitPayout` branches,
 * `giftDiscardCoins`, `serviceThreshold`, `ownerActivationCost`, `visitWage`,
 * `handToBarn`, `buildCost.coins`, `faces.{}.threshold`, `faces.{}.handSize`.
 * The six new ones are the levers v31 introduced and nobody has ever swept:
 * `bonusDraw`, `selfVisitAllowed`, and the four `island.meeples` knobs.
 *
 * ⭐ ONE OF THE FOURTEEN CAME STRAIGHT BACK, and not at the same path.
 * `rules.turn.handLimit` reinstates the hand limit on the same day it was
 * deleted, as ONE GLOBAL NUMBER rather than as `faces.{}.handSize` - five
 * printed per-suit values. That is the whole difference between the old knob and
 * this one: the old one was a card value with five expansions and no way to
 * sweep the rule itself, this one is a single lever and the Barn still prints
 * nothing. What the deletion measured is on the template below, and it is the
 * most useful paragraph in this file to read before touching a draw knob.
 *
 * Every meeple template stays, at a value that is now
 * subjectless, because the standing rule of this project is that A BRANCH WHOSE
 * ONLY PRODUCER IS A KNOB AT ITS SHIPPED VALUE IS NOT DELETED: the meeple loop
 * and the meeple economy are controls, and the knobs are how they are reached.
 * A description that says "read only under X" is doing the work a deletion would
 * have done, and it keeps the reasoning.
 *
 * ⭐ THE COMMONS AND ITS EIGHT TEMPLATES (the six `commons*` knobs,
 * `unclaimedBoardsToCentre` and `actionUnderCommons`) WERE DELETED ON 13/09/2026
 * (Dean).
 *
 * ⭐ 16/09/2026: THE BALLOONS, THE AERODROME, THE VILLAGE STORE COIN, THE
 * CLOSING DRAW AND THE ISLAND WILD SUBSTITUTION WERE DELETED (Dean, rulings R1,
 * R2, R4 and R5). Every `aerodrome.*` template went, and so did
 * `rules.turn.closingDrawPerCrate`, `island.cardsPerSubstitution`, the six Store
 * leaves and the two dead coin knobs `endgameCoinCost` and `farmsteadCoinPower`.
 *
 * ⭐ THE NOTICE BOARD VISIT (Dean, 10/09/2026) ADDS ONE TEMPLATE, RENAMES FOUR
 * AND DELETES NONE. `rules.economy.noticeBoardBlocks` is the new one and it is
 * the `3+` rule's off switch (S8): false makes the board's threshold a MINIMUM
 * to harvest at rather than a maximum to clog at, true is the paired control
 * that makes it an ordinary clogging building so the stall can be measured. The
 * four renamed ones are `rules.economy.farmsteadPower.*` becoming
 * `rules.economy.noticeBoardPower.*`, with a fifth number added: the powers left
 * the Farmstead and went to the Notice Boards, and A KNOB WHOSE NAME NO LONGER
 * DESCRIBES IT IS WORSE THAN A NEW ONE. ⚠️ A RENAME IS THE ONE REGISTRY EDIT
 * THAT CAN BREAK A SAVED OVERLAY, which is the point of it: an overlay still
 * naming `rules.economy.farmsteadPower.dairyDiscount` now fails loudly instead
 * of setting a number the game has stopped reading. ⛔ AND ONE BASE VALUE MOVED
 * BESIDE THEM, which is not a registry change but is the thing to check first:
 * `rules.economy.noticeBoardThreshold` is 3 where it was 2, so
 * `overlays/v31-card-visit.overlay.json` pins 2 by name and `data.test.ts` has
 * the regression test that says it still does.
 *
 * ⭐ DEAN'S TWO-BOARD FIX (11/09/2026) ADDS ONE TEMPLATE AND IT IS THE FIRST
 * PER-SEAT-COUNT MAP THIS FILE HAS OUTSIDE `island.*`.
 * `rules.economy.noticeBoardsBySeats.{}` says how many Notice Boards each player
 * lays out, shipped at one each so the base changes nothing, and the arm sets
 * two at two seats only. It is a MAP rather than a boolean deliberately: it
 * matches `island.decksInPlayBySeats.{}` and `island.tokens.wildBySeats.{}`,
 * which is how this codebase has always spelled a per-seat-count quantity, and a
 * later pass can sweep a third seat count without another knob. ⛔ THE LESSON IT
 * CARRIES IS THE ONE THE UNCLAIMED-BOARDS ARM MEASURED: there are only ever four
 * targets in a bonus slot, and every target added that is NOT a person dilutes
 * the person, so this one adds targets that ARE people. See the template for the
 * 2x2 behind it and for the arithmetic ceiling on what the map can ask for.
 *
 * ⭐ S17, THE HOST DRAW (Dean, 11/09/2026), ADDS ONE TEMPLATE AND IS THE FIRST
 * KNOB IN THIS FILE WHOSE PROVENANCE IS A TABLE RATHER THAN A RUN.
 * `rules.turn.hostDrawOnVisit` is how many cards the OWNER of a Notice Board
 * draws when somebody else visits it, shipped at 0 so the base changes nothing
 * and set to 1 by `overlays/notice-board-visit-host-draw-v1.overlay.json`. It
 * amends S7, which said the card left on the board was the payment and there was
 * no other. ⛔ AND IT CARRIES A CAVEAT NO OTHER TEMPLATE HERE DOES: THE
 * SIMULATOR CANNOT MEASURE THE EFFECT DEAN LIKED, because the hand limit of 7 is
 * the instrument's bound and the table plays with none, so a run of the arm
 * answers the rate, the glut, the length, the deliveries and the hook and
 * answers NOTHING about whether the game feels less tight.
 *
 * ⭐ THE DELIVERY MEEPLE (Dean, 12/09/2026, ledger A151) ADDED
 * `meepleSpendTiming`, `meepleSpendPerTurn` and `meepleSpendDistinctColours`.
 * They ship at their arm values ('afterAction', 1, false) since 14/09/2026, and
 * every overlay that should not move pins the old inert values by name
 * (`'start'` and `null`, not the build handoff's `'none'` and 0, which would
 * delete the v31 control's turn-start spend).
 *
 * ⭐ 16/09/2026: THE TOKEN ISLAND (Dean, R3) DELETED `island.vpByDeliveryOrder`,
 * `island.demandTokensBySeats.*`, `island.meeples.perDeliverySpace`,
 * `island.meeples.seededSpaces`, `rules.turn.deliveryMeepleSpace` and
 * `rules.turn.deliverySpaceChoice`, and added `island.tokens.vpValues`,
 * `island.tokens.workerOnVp` and `island.tokens.wildBySeats.{}`. The two board
 * retexts (R9, R10) added `noticeBoardPower.vegetableWildCards` and replaced
 * `noticeBoardPower.dairyGrowsBuilt` with `noticeBoardPower.dairyDiscount`.
 * An overlay still naming a deleted path now fails loudly, which is the point.
 */

import { flatten } from './paths.js';
import type { Leaf } from './paths.js';

/**
 * `int` and `number` are self-explanatory. `intOrNull` covers the knobs whose
 * null disables a rule outright (a threshold override, an unthresholded card). `intArray` covers the island's token values, which are
 * replaced whole. `boolean` covers the enable flags and the two turn-structure
 * switches.
 *
 * `cropOrWild` is the one and only string-valued type, added 2026-08-16 for the
 * Tier 3 wild-activation arm. It is NOT a general string knob: its legal values
 * are the five crop names, `wild` and null, and nothing else, so it can name a
 * GROW payment rule and can never carry a word a player would read. The ban
 * below stands unweakened - the overlay may still never override card TEXT,
 * because the sheet is the single source of truth for wording and that is what
 * stops the web game and the physical game drifting apart on rules text.
 *
 * Every string type since has kept that shape: a CLOSED set, defined once in
 * `overlay.ts` beside `typeMatches` so it cannot pass validation on one side of
 * the codebase and fail on the other.
 *
 * `meepleSpendTiming` (12/09/2026) is the newest: `'none'`, `'start'` and
 * `'afterAction'`, the window in which a held meeple may be spent. ⛔ Its
 * shipped value is `'start'` and NOT `'none'`, because the v31 control spends
 * meeples at the start of the turn and a fixture replays against it.
 */
export type KnobType =
  | 'int'
  | 'number'
  | 'intOrNull'
  | 'intArray'
  | 'boolean'
  | 'cropOrWild'
  | 'bonusTiming'
  | 'visitCurrency'
  | 'meepleDestination'
  | 'meepleSpendTiming'
  | 'apiaryPower'
  | 'wheatHarvestGate'
  | 'paymentHostChoice'
  | 'firstPlayer'
  | 'endOfGame';

export interface KnobTemplate {
  /** Dotted path, `{}` for a wildcard segment. */
  readonly template: string;
  readonly type: KnobType;
  readonly description: string;
}

export interface Knob {
  readonly path: string;
  readonly type: KnobType;
  readonly description: string;
  readonly baseValue: Leaf;
}

export const KNOB_TEMPLATES: readonly KnobTemplate[] = [
  // --- Setup and turn structure -------------------------------------------
  {
    template: 'rules.setup.startingHand',
    type: 'int',
    description:
      'Cards drawn to hand at setup, from your own suit deck. Lowered 5 -> 4 by v31, in the same ' +
      'pass that removed the hand limit and made the plain Draw keep both cards - so the opening ' +
      'hand is smaller but grows faster, and the two changes have never been measured apart. This ' +
      'is the dial if the first three turns feel like a stall.',
  },
  {
    template: 'rules.setup.startingBarnCards',
    type: 'int',
    description:
      'Cards seeded into each barn at setup. 0 since v31: the barn starts empty, so the first ' +
      'delivery is strictly later than it used to be and the opening is a card-gathering phase ' +
      'whether the seat wants one or not.',
  },
  { template: 'rules.turn.actionsPerTurn', type: 'int', description: 'Main actions per turn.' },
  {
    template: 'rules.turn.bonusSlotsPerTurn',
    type: 'int',
    description:
      'Bonus options per turn. Under the COMMONS (09/09/2026) one bonus is one card played onto ' +
      'one central board for that board\'s action, so this number is "how many cards may leave ' +
      'your hand for the centre in a turn" - which is exactly what A Helping Hand grants a second ' +
      'of, and overlays/bonus-both-v1.overlay.json is therefore "every seat holds a Helping ' +
      'Hand". ⚠️ IT IS THE MOST DIRECT DIAL ON DEAN\'S 30-60% BAND and the crudest: it raises the ' +
      'ceiling on the bonus rate rather than the appetite for it. Historically it read "Draw 1, ' +
      'or place a card on a Notice Board and take that suit action", and under the v31 control it ' +
      'still means one of each rather than two of either.',
  },
  {
    template: 'rules.turn.baseDraw.see',
    type: 'int',
    description: 'Cards a plain Draw action reveals.',
  },
  {
    template: 'rules.turn.baseDraw.keep',
    type: 'int',
    description:
      'Cards a plain Draw action keeps. Equal to `see` since v31 - Draw 2, keep both, discard ' +
      'nothing. Setting it below `see` restores the v13 draw-and-discard.',
  },
  {
    template: 'rules.turn.bonusDraw',
    type: 'int',
    description:
      '⛔ IT HAS NO SUBJECT IN THE SHIPPED GAME AND HAS NOT HAD ONE SINCE 04/09/2026, so a sweep ' +
      'of it measures nothing. Under the meeple loop the standalone free Draw 1 was deleted and ' +
      'this number survived as what COLLECT draws; under the COMMONS (09/09/2026, C9) there is ' +
      'no Collect either - the bonus slot holds exactly one option, playing a card onto a ' +
      'central board, and an unspent slot is a turn that chose not to pay. It stays at 1 ' +
      'because overlays/v31-card-visit.overlay.json and the two meeple controls read it. ' +
      'IT IS STILL THE FIRST THING TO CHECK IF A FREE OPTION EVER RETURNS TO THE SLOT: every ' +
      'version of this game that offered one watched it eat the slot (67.6% of turns as the free ' +
      'Draw 1, 54.2% as the empty-board Collect). The original note follows. ' +
      '⭐ THE YARDSTICK EVERY DOOR HAS TO BEAT. Cards the free bonus option gives, taken instead ' +
      'of placing a card on a Notice Board. It exists so the bonus slot is never dead (an empty ' +
      'hand has no card to place), and it silently prices all five doors: a door costs 1 card, so ' +
      'it must return more than this plus one to be worth taking. Raising it is the cheapest way ' +
      'to kill every door in the game at once, and the Orchard door at Draw 3 is the only one with ' +
      'a margin worth reading. Sweep it with the Orchard door, never alone.',
  },
  {
    template: 'rules.turn.handLimit',
    type: 'intOrNull',
    description:
      "⭐ 7 IS THE SIMULATOR'S BOUND, NOT A GAME RULE (Dean, 09/09/2026, C7), AND EVERY REPORT " +
      'THAT QUOTES A HAND NUMBER MUST SAY SO. The table plays with NO hand limit and Dean found ' +
      'that positive. The engine keeps 7 because the legal-move enumerator cannot cost an ' +
      'end-of-turn discard without a ceiling - the paragraph below is what happened the one time ' +
      'it had none - so nothing measured under this number describes the hand Dean is playing ' +
      'with. ⚠️ THE CONSEQUENCE FOR THE hand-limit-* ARMS: they now sweep the INSTRUMENT as much ' +
      'as the game, and a bot-side discard heuristic in place of the rule is what a future ' +
      "session needs before the table's hand can be measured at all. Nobody has designed one. " +
      'The history, which is still the reason the number exists: ' +
      '⭐ THE HAND LIMIT, ONE GLOBAL RULE AT 7 (Dean: reinstated at 12 on 02/09/2026, reversing one v31 ' +
      'change on evidence, then cut to 7 the same day). Cards you may still hold when your turn ENDS; you may exceed it ' +
      'mid-turn and the overflow discards at the boundary. null restores v31 no-limit, which is ' +
      'the control arm and should not be run without reading what it measured: deleting the limit ' +
      'also deleted the only bound on the legal-move enumerator, and a 2-seat position reached ' +
      '43,879 legal moves (43,845 of them build payments) at hands of 34, taking a game from ~0.1s ' +
      'to 1-15 minutes and reducing the whole watch-list suite to n=8. It is a knob rather than a ' +
      'constant because 12 is a guess: three turns of accumulation above the 4-card opening hand. ' +
      'SWEEP IT WITH THE THING IT PRICES, never alone - a hand limit is a diminishing return on ' +
      'drawing, so it is the brake on rules.turn.bonusDraw and on every door that draws. Read the ' +
      'bonus mix and the median hand together; overlays/hand-limit.sweep.json is the ladder.',
  },
  {
    template: 'rules.turn.selfVisitAllowed',
    type: 'boolean',
    description:
      '⭐ SHIPPED false SINCE 13/09/2026, ruled the default when the commons was deleted; ' +
      'overlays that relied on the old true now pin it. ' +
      '⭐ ALIVE AGAIN AND RULED ON (Dean, 10/09/2026, S6 of ' +
      'docs/notice-board-visit-handoff-2026-09-10-v2.md), WHICH REVERSES THE BAN OF 04/09/2026. ' +
      "Under visitCurrency 'noticeBoardPower' every player owns a Notice Board again and true " +
      "means you MAY play your bonus card onto your own board and take your own suit's power. " +
      '⭐ WHY IT IS SAFE NOW AND WAS NOT IN v31, WHICH IS THE WHOLE OF THE DIFFERENCE: in v31 ' +
      'every Notice Board printed the SAME thing, so a self-visit was strictly better than a ' +
      'visit - same benefit, no gift, no travel - and it took 22.2% OF TURNS and was banned ' +
      'within two days. Here the five boards print five DIFFERENT powers, so your own board is ' +
      'one option of five and it is the one that never has what you have not got: if your board ' +
      'draws and you need to deliver, the vegetable farm is the only place to get it. It also ' +
      'answers the predecessor\'s largest dislike cluster, "reverse engine building" - about ten ' +
      'of 887 BGG comments - because a power you can use yourself cannot draw that charge. ' +
      '⛔ AND IT IS THE HEADLINE RISK OF THE PASS. Paying a card to your OWN board is cheaper ' +
      "than paying it to a rival's, because you harvest it back, so if the self-visit share " +
      'runs much above 22.2% the variety argument is wrong, the interaction is decoration and ' +
      'the design has failed the way v31 failed. Read it BY SEAT COUNT: it should be worst at ' +
      "two players, where a neighbour's gift is closest to zero-sum. " +
      'overlays/notice-board-visit-no-self-v1.overlay.json is the control and the single most ' +
      'important sub-arm in the plan. ⚠️ THE KNOB IS NOT RENAMED: the handoff calls it ' +
      'rules.turn.selfVisit and the data has always called it selfVisitAllowed, so the existing ' +
      'path stands and no overlay has to be re-pinned. The 09/09/2026 note follows, unchanged. ' +
      '⛔ SUBJECTLESS TWICE OVER, AND READ ONLY BY overlays/v31-card-visit.overlay.json. The ' +
      'meeple loop made a self-visit impossible by construction (X5, 04/09/2026) whatever this ' +
      'flag says; under the COMMONS (09/09/2026) NOBODY OWNS A BOARD - all five sit in the ' +
      'centre - so there is no such thing as visiting yourself and nothing left for the flag to ' +
      'permit. It stays true in the data so the v31 control needs no pin for it. ⭐ THE FINDING ' +
      'IT LEAVES BEHIND IS THE ONE WORTH CARRYING: risk 2 predicted the self-visit would eat the ' +
      'bonus slot and it took 22.2% of turns, but the slot was eaten by the FREE DRAW 1 (67.6%) ' +
      'and then by the empty-board COLLECT (54.2%). The solitaire option wins whichever one it ' +
      'happens to be, so the question to ask of the commons is not "can you visit yourself" but ' +
      '"what is the cheapest thing the slot can buy". The original note follows. ' +
      '⭐ RISK 2 OF v31. True: you may place your bonus card on your OWN Notice Board and take ' +
      "your own suit action. It is a solitaire door bought with the interaction door's currency, " +
      'which is the exact shape that has crowded the visit out in every previous version of this ' +
      'game; its only brake is that your card clogs your own board in two placements and shuts ' +
      'your own door. FALSE IS THE PAIRED CONTROL. Read the bonus mix four ways - Draw 1 / visit a ' +
      'neighbour / visit yourself / slot unspent - and never let an assertion pool the two visits.',
  },
  {
    template: 'rules.turn.hostDrawOnVisit',
    type: 'int',
    description:
      '⭐ S17, THE HOST DRAW, AND ITS PROVENANCE IS A TABLE RATHER THAN A SIMULATION (Dean, ruled ' +
      '11/09/2026): WHEN A NEIGHBOUR VISITS YOU, YOU DRAW THIS MANY CARDS, immediately, off a deck. ' +
      "SHIPPED AT 0, which changes nothing, and READ ONLY UNDER visitCurrency 'noticeBoardPower'. " +
      'overlays/notice-board-visit-host-draw-v1.overlay.json sets 1 and is the arm; ' +
      'overlays/notice-board-visit-two-boards-v1.overlay.json is its control and its paired arm. ' +
      '⭐ DEAN PLAYED THE TWO-BOARD ARM AT A TWO-PLAYER TABLE ON 11/09/2026 AND HOUSE-RULED THIS IN ' +
      'DURING THE SESSION, which is why it is here at all. His verdict: the visiting worked well, ' +
      'everyone visited, every Notice Board was used at some stage, and "the rule that the person who ' +
      'gets visited draws a card led to a lot of extra cards in play, which relieved the tightness of ' +
      'the game in a useful way". He has now ruled it in. ' +
      '⛔ IT AMENDS S7 OF docs/notice-board-visit-handoff-2026-09-10-v2.md, WHICH SAID THE OPPOSITE ' +
      'IN AS MANY WORDS: S7 reads that the card stays on the board it was played to and its owner ' +
      'harvests it into their barn, "and that is the payment and there is no other". Under S17 there ' +
      'is now one other and it is paid INSTANTLY, so the host is paid twice - once in a card drawn ' +
      'now, once in material harvested later. Do not quote S7 forward without this amendment. ' +
      '⭐ WHY IT IS DEFENSIBLE, AND BOTH HALVES ARE ON THE RECORD. (1) IT IS THE SANCTIONED SHAPE ' +
      'RATHER THAN A BANNED ONE: this project banned RESTOCK as "a per-interaction bank faucet", and ' +
      'the standing rule beside that ban reads "if a give-cards effect returns, it pays in draws". A ' +
      'host draw comes off a DECK and never off a bank. (2) THE DESIGN LENS PREDICTS IT: the fault ' +
      'named in all seven previous versions of this bonus slot is PAY THE GIVER IN THE SAME ACT, OR ' +
      'THE GIVER DRAWS THE CHARGE, and S7 pays the host in DEFERRED material they must harvest and ' +
      'then deliver where S17 pays them in the same act. It is a closer fit to the lens than the rule ' +
      'it amends. ' +
      '⚠️ AND THE COST IS REAL: EVERY VISIT NOW ADDS A CARD TO THE GAME. At two seats under the ' +
      'control arm there are about 14.4 visits received per player per game, so this is a substantial ' +
      'new faucet and it is the first thing a run has to price. Read it with the barn glut and the ' +
      'game length, never alone. ' +
      '⛔ A SELF-VISIT MUST NEVER PAY IT. rules.turn.selfVisitAllowed is false on the arm that ' +
      'matters, so it has no subject there, but the knob is defined for the case and the rule is ' +
      'explicit: a card drawn for visiting yourself is a PURE FAUCET, paid by nobody, and it would be ' +
      'the solitaire option eating the bonus slot for the fourth time in this project. ' +
      '⛔ AND THE SIMULATOR CANNOT MEASURE THE EFFECT DEAN ACTUALLY LIKED. The engine caps hands at ' +
      "7 as an INSTRUMENT BOUND (C7) while the table plays with NO HAND LIMIT AT ALL, and this rule's " +
      'principal effect is more cards in hand, so the instrument clips exactly the thing the table ' +
      "enjoyed. A run can honestly answer whether the bonus rate leaves Dean's 30% to 60% band, and " +
      'what happens to the barn glut, game length, deliveries and the hook. IT CANNOT ANSWER WHETHER ' +
      'THE GAME FEELS LESS TIGHT, and no report of this arm may be quoted as evidence that it does. ' +
      '⚠️ AN INTEGER RATHER THAN A BOOLEAN, so the size can be swept later without another knob, ' +
      "which is this project's established preference. " +
      '⚠️ TWO ENGINE RULINGS ARE OWED AND NEITHER IS A LEAF: WHICH DECK the host draws from ' +
      "(their own suit's, or the top of any deck in play as a plain Draw allows), and what happens " +
      'when A Helping Hand sends a SECOND visit to the same owner in one turn, which at two seats ' +
      'under the two-board arm is reachable because the one rival holds two boards.',
  },
  {
    template: 'rules.turn.hostDrawCapPerRound',
    type: 'boolean',
    description:
      '⭐ THE HOST-DRAW CAP: A HOST IS PAID AT MOST ONCE BETWEEN THEIR OWN TURNS, however many ' +
      'neighbours visit them in the meantime. SHIPPED false, which changes nothing, and read only ' +
      'when rules.turn.hostDrawOnVisit is above 0. ' +
      "⛔ IT IS A SECOND LEAF AND NOT A CHANGE OF hostDrawOnVisit'S MEANING, AND THAT IS " +
      'DELIBERATE: re-pointing the existing knob at a per-round quantity would silently redefine ' +
      'every number already published against it - the 17:23 report, a21-host-draw, the host-draw ' +
      "overlay's own description - and this project has twice paid for a quantity that changed " +
      'underneath a published reading (a17 judged on plays per turn, 09/09/2026; the meeple cap ' +
      'that shipped as a passenger, 05/09/2026). hostDrawOnVisit keeps meaning CARDS PER PAYMENT. ' +
      'This says HOW OFTEN A PAYMENT MAY HAPPEN. ' +
      '⚠️ "PER ROUND" MEANS PER THE HOST\'S OWN TURN CYCLE AND NOT PER THE VISITOR\'S TURN, AND ' +
      "THE DISTINCTION IS THE WHOLE POINT OF THE KNOB. A cap on the VISITOR'S turn would bite only " +
      'when one visitor sends TWO visits to the same host in a single turn, which is reachable at ' +
      'two seats alone (A Helping Hand, against a rival holding two boards), and would leave FOUR ' +
      "SEATS - the only seat count that breaches - untouched. The latch is cleared when the HOST'S " +
      'own turn begins, and it therefore lives on the SEAT rather than on TurnState, which turn ' +
      'end replaces wholesale. ' +
      '⛔ WHY IT EXISTS: THE FOUR-SEAT BREACH. With hostDrawOnVisit 1 the bonus slot reads 64.9% ' +
      "of turns at four seats against Dean's 60% ceiling, where its one-leaf control reads 59.9%. " +
      'The faucet scales with the number of rivals, and a cap per host per round is the shape that ' +
      'stops it scaling. ' +
      '⚠️ AND IT IS EXPECTED TO BE INSUFFICIENT ON ITS OWN, WRITTEN DOWN BEFORE THE RUN SO THE ' +
      'PREDICTION CAN BE SCORED: measured host draws per host per round are 0.489 / 0.553 / 0.787 ' +
      'by seat count, so a cap of one removes only the rounds that carried two or more - at most ' +
      '21% / 24% / 31% of the faucet on a Poisson upper bound, and less in truth because bots ' +
      'spread visits across targets rather than piling on. The faucet buys 5.0 points at four ' +
      'seats, so a 31% cut returns about 1.5 and lands near 63.4%, still over the ceiling. IF THE ' +
      'RUN READS MUCH BETTER THAN THAT, the arrival distribution is more clustered than Poisson ' +
      'and THAT is the finding. ' +
      'overlays/notice-board-visit-host-draw-capped-v1.overlay.json is the arm and ' +
      'overlays/notice-board-visit-host-draw-v1.overlay.json is its one-leaf control.',
  },
  {
    template: 'rules.turn.hostDrawOnVisitBySeats.{}',
    type: 'intOrNull',
    description:
      '⭐ THE HOST DRAW BY SEAT COUNT: AN OVERRIDE ON rules.turn.hostDrawOnVisit, KEYED BY SEAT ' +
      'COUNT, in the idiom of island.decksInPlayBySeats and rules.economy.noticeBoardsBySeats. ' +
      '⛔ THE PRECEDENCE RULE: a NON-NULL slot wins, a NULL slot DEFERS to the scalar, and every ' +
      'slot SHIPS NULL - so this changes nothing until a slot is set, and ' +
      'overlays/notice-board-visit-host-draw-v1.overlay.json (which sets the scalar to 1 and no ' +
      'slot) still pays 1 at every seat count exactly as it did when it was measured. Ask it ' +
      'through hostDrawOnVisitAt(data, seats), which is the one spelling every rule must use; a ' +
      'branch of play that reads the scalar directly is right until somebody sets a slot and ' +
      'silently wrong after. ' +
      '⛔ WHY IT EXISTS: THE FOUR-SEAT BREACH, AND EVERY CHEAPER LEVER IS NOW MEASURED AND DEAD. ' +
      "S17 takes the bonus slot out of Dean's band at FOUR SEATS ALONE - 64.9% of turns against " +
      'a 60% ceiling, where its control reads 59.9% and two and three seats barely move. THE CAP ' +
      'WAS BUILT AND RUN ON 11/09/2026 AND IT DID NOT WORK: one payment per host per round ' +
      'removed 28.7% of the payments at four seats (98.7% of visits paid falling to 70.0%, the ' +
      'per-turn faucet 0.787 to 0.550) and returned only 0.5 points of rate, landing at 64.4% ' +
      'and still out of band. ' +
      '⭐ AND THE FINDING THAT FORCED THIS SHAPE IS WORTH MORE THAN THE KNOB: THE BONUS RATE IS ' +
      'NEARLY INSENSITIVE TO THE SIZE OF THE FAUCET. Cutting 30% of it bought back a TENTH of ' +
      'the rise. Extrapolated linearly, removing the faucet entirely recovers about 1.7 of the ' +
      '5.0 points S17 adds at four seats, so NO VERSION OF "MAKE THE HOST DRAW SMALLER" REACHES ' +
      '60% AT FOUR SEATS. Pricing this faucet is a dead lever, measured rather than argued. What ' +
      'is left is turning it OFF where there is no headroom, which is what this map does. ' +
      "⚠️ THE COST IS A SEAT-COUNT-DEPENDENT RULE AT THE TABLE, against this project's " +
      'five-minute teach target. It is not unprecedented - noticeBoardsBySeats already shapes ' +
      'the board count 2/1/1 - but TWO seat-count-dependent rules in one bonus slot is a thing ' +
      'to look at whole before ruling in, not a thing to notice afterwards. ' +
      '⚠️ AND THE CONTROL HAS NO HEADROOM EITHER: it reads 59.9% at four seats, one tenth of a ' +
      'point inside the ceiling, so the honest reading may be that NO card faucet fits at four ' +
      'seats rather than that this one is mis-sized. ' +
      'overlays/notice-board-visit-host-draw-by-seats-v1.overlay.json is the arm and ' +
      'overlays/notice-board-visit-host-draw-v1.overlay.json is its one-leaf control.',
  },
  {
    template: 'rules.turn.bonusTiming',
    type: 'bonusTiming',
    description:
      "⭐ 'start' IS THE RULE AGAIN SINCE 09/09/2026 (Dean, C2), AND THAT IS A REVERSAL OF THE " +
      "03/09/2026 RULING RECORDED BELOW, ON DEAN'S OWN CALL. His reason in full: A TURN VISIBLY " +
      'ENDS ON THE MAIN ACTION. So the commons turn is (1) the bonus - play a card onto a central ' +
      "board and take its action - then (2) your core action. 'end' is now the paired control at " +
      'overlays/commons-bonus-last.overlay.json, and overlays/bonus-first.overlay.json became a ' +
      'no-op on the flip and is retired. ⚠️ QUOTE THE TWO RULINGS TOGETHER OR NEITHER: this is a ' +
      'reversal and not a drift, and the 03/09 argument below is exactly what it gives up - ' +
      "under 'end' the action can SET THE DOOR UP (fill a building, then Harvest it through the " +
      'Wheat board; harvest into your barn, then Deliver through the Vegetable one), and those ' +
      'are the two boards every version of this game has found underused. ⭐ AND THE COMMONS ' +
      "SHARPENS IT, because under 'start' a bought Harvest of a central pile FUELS the main " +
      'action that follows, which is a bigger fuel line than any door has ever had. Read the ' +
      'DOOR MIX first and the bonus rate second. The 03/09/2026 note follows, unchanged. ' +
      '⭐ WHEN THE BONUS OPTION MAY BE TAKEN, and a CORRECTION rather than an experiment ' +
      "(Dean, 03/09/2026). 'end' IS THE RULE: meeples, then your core action, then the bonus. " +
      "The engine and both design docs carried 'start' from 19/08/2026 and were wrong about the " +
      "game. 'start' is now the paired control (overlays/bonus-first.overlay.json) and 'any' is " +
      "v14's once-per-turn-any-point (overlays/bonus-any-time.overlay.json). " +
      '⚠️ THE THREE ARE NOT ORDERABLE BY POWER, so do not read this as a buff or a nerf. ' +
      "Under 'start' a door can FUEL the action after it (Orchard door for Draw 3, then Build " +
      "with the cards); under 'end' the action can SET THE DOOR UP (fill a building, then " +
      'Harvest it through the Wheat door; harvest into the barn, then Deliver through the ' +
      'Vegetable one). The doors whose value is conditional on the turn so far - Wheat and ' +
      'Vegetable - gain most, and those are the two the door mix says are underused, so watch ' +
      'the DOOR MIX and not only the visit rate. SLOT UNSPENT still reads the window, but its ' +
      'absolute is a rational floor a bot cannot fail and only the delta between arms means ' +
      'anything.',
  },

  {
    template: 'rules.turn.visitCurrency',
    type: 'visitCurrency',
    description:
      "⭐ SHIPPED 'noticeBoardPower' SINCE 13/09/2026, ruled the default when the commons was " +
      "deleted outright; 'card' and 'meeple' remain as controls. " +
      "⭐ FOUR VALUES SINCE 10/09/2026, AND 'noticeBoardPower' IS THE NEW ARM (Dean, " +
      'docs/notice-board-visit-handoff-2026-09-10-v2.md, rules S1-S16). THE CENTRE IS DELETED ' +
      "AND THE NOTICE BOARDS COME HOME: the five Notice Board cards go back to their owners' " +
      'farms and are BUILDINGS again, and the bonus is to play ONE card from your hand onto ANY ' +
      "player's Notice Board - YOUR OWN INCLUDED (S6) - and immediately take that board's " +
      "PRINTED POWER. The card stays on the host's board and the host harvests it into their " +
      "barn later: THAT IS THE HOST'S WHOLE PAYMENT AND THERE IS NO OTHER, which is the " +
      "predecessor's own answer to the fault every one of the seven previous bonus slots had - " +
      'pay the giver in the same act, or the giver draws the charge. THE FIVE POWERS (S12, as ' +
      'amended by rulings C88 and C89 the same evening): Orchard "Draw 4"; Dairy "Build. You may ' +
      'spend cards of any crops"; Wheat "Harvest one of your buildings, then put 1 card from ' +
      'your hand into your barn"; Apiary "Sow 2 cards from your hand onto YOUR buildings"; ' +
      'Vegetable "Deliver. If you cannot, put 2 cards from your hand into your barn". The bonus ' +
      "still comes FIRST. The board's threshold is 3 and it is a MINIMUM, not a maximum " +
      '(rules.economy.noticeBoardThreshold 3 with rules.economy.noticeBoardBlocks false), so a ' +
      'board never blocks and nothing ever refuses a play. ' +
      '⛔ IT IS A FOURTH VALUE AND NOT A REPOINTING OF card, DELIBERATELY, AND THIS IS THE ' +
      "REASON: 'card' is the v31 control and carries THREE PASSENGERS this design does not want " +
      '- a BLOCKING Notice Board threshold of 2, the standalone free Draw 1 in the bonus slot, ' +
      'and the turn-start meeple spend. Repointing it would silently change one of the three ' +
      'named controls this arm is read against, which is the 05/09/2026 failure in a new ' +
      'costume. overlays/notice-board-visit-v1.overlay.json is the arm and pins every passenger ' +
      'by name; -no-self-v1, -blocking-v1, -threshold-2-v1 and -threshold-4-v1 are its ' +
      "sub-arms. ⚠️ THE READING THAT DECIDES IT IS THE SELF-VISIT SHARE, against v31's 22.2%, " +
      'and the bonus rate on the TURN measure against 30-60%. The 09/09/2026 note follows, ' +
      '(The commons, the shipped game of 09/09 to 13/09/2026, is deleted.) ' +
      "⛔ 'card' AND 'meeple' ARE CONTROLS AND THEIR CODE IS NOT DEAD. 'card' is the v31 game " +
      '(overlays/v31-card-visit.overlay.json); ' +
      "'meeple' is the loop (overlays/meeple-loop-v1.overlay.json) and, with meepleAsCard on, " +
      'the meeple ECONOMY that reference-v14 was cut against ' +
      '(overlays/meeple-economy-v1.overlay.json). All three must stay bit-reproducible: every ' +
      'delta this project has measured is read against one of them on identical seeds. ' +
      'The 04/09/2026 note follows, unchanged, and its "card is the DEFAULT" is now two flips ' +
      'out of date. ' +
      '⭐ THE MEEPLE-LOOP ARM, AND THE ONE KNOB THE WHOLE 04/09/2026 DESIGN HIDES BEHIND ' +
      "(Dean, docs/meeple-loop-visit-handoff-2026-09-04-v1.md). 'card' is the shipped v31 game " +
      'and the DEFAULT: a visit costs one card from your hand onto any Notice Board, your own ' +
      "included, and the board is an ordinary building with a threshold. 'meeple' replaces all " +
      'of that: a visit costs a MEEPLE placed in the colour slot of a NEIGHBOUR’s board, ' +
      'the board is not a building at all, the other bonus option is COLLECT (take your ' +
      'meeples back and Draw 1), the turn-start meeple spend and the standalone free Draw 1 ' +
      'are both gone, and two meeples may be spent as one of any colour. ' +
      'READ FIRST: the arm exists because the v31 hook fails on AVAILABILITY and on the HOST ' +
      'SIDE, not on price - at n=1580 the shipped game reads a rival visit on 40.4% of turns ' +
      'against a free Draw 1 on 67.8%, hook 0.41 against a floor of 0.5, and giving every seat ' +
      'both options (bonus-both-v1) moved it only to 0.44. ' +
      "⚠️ 'card' MUST STAY BIT-REPRODUCIBLE - it is the control every arm number is a " +
      'delta against on identical seeds. Sweep it against nothing else in the same overlay, or ' +
      'the delta stops being readable.',
  },
  {
    template: 'rules.turn.startingMeeplesPerColour',
    type: 'int',
    description:
      '⭐ 0 SINCE 09/09/2026, AND IT MEANS THERE ARE NO MEEPLES IN THIS GAME AT ALL (C6), not ' +
      'that the supply starts empty. No starting five, no meeple on the island, no spend, no ' +
      'Collect, no component. ⚠️ THE TWO MEEPLE CONTROLS MUST PIN 1 AND DO, because 0 is not a ' +
      'neutral value there: the arm with no starting meeples reads a hook of 0.09 against 0.37 ' +
      'and an empty-board Collect on 87% of turns, so an unpinned control would have measured ' +
      'the wrong game and looked plausible doing it. That is the 05/09/2026 passenger lesson in ' +
      'one knob. The original note follows. ' +
      "Meeples of EACH colour a seat starts with under visitCurrency 'meeple' (rule R3); the " +
      "'card' game never reads it and starts every supply empty. 1 primes the loop before " +
      'anybody has delivered, so a visit is available on turn one at every seat. They are NOT ' +
      'drawn from the island bag. 0 is the paired control and asks how much of the traffic is ' +
      'the starting meeples rather than the rule; sweep it with meepleCapPerColour, never ' +
      'against it.',
  },
  {
    template: 'rules.turn.meepleCapPerColour',
    type: 'intOrNull',
    description:
      '⛔ SUBJECTLESS UNDER THE COMMONS (09/09/2026): with no meeples in the game there is ' +
      'nothing to cap, so the shipped null means "no subject" and not "the cap was removed". ' +
      'Those are two different readings landing on one value and a report has to say which it ' +
      "means. It is read only under visitCurrency 'meeple', where the answer is still null and " +
      "still Dean's ruling of 05/09/2026 - overlays/meeple-economy-v1.overlay.json is that game " +
      'and pins nothing here, while the v1 loop and the v31 control pin their own number. ' +
      '⚠️ THE CAP SWEEP ITSELF IS RETIRED to overlays/retired/ (the three -cap- cells under R17 ' +
      'and the two under the v1 loop): the sweep is finished, its answer is in the paragraph ' +
      'below, and a sweep of a number whose rule has no subject would have needed the whole ' +
      'meeple-economy set pinned beneath it to mean anything. The 05/09/2026 note follows. ' +
      "⭐ THE SUPPLY CAP (rule R4), read only under 'meeple'. ⭐ IT SHIPS AS null, WHICH IS NO " +
      'CAP AT ALL (Dean, 05/09/2026: "let\'s just remove the cap completely - there is no limit ' +
      'to how many or what colour meeple you can hold"). Nothing a seat gains is ever refused, ' +
      'and the only things that remove a meeple from the game are the two tolls. A NUMBER is a ' +
      'ceiling per colour, kept as a knob because both the v1 loop and the v31 control pin one ' +
      'and because it is the only way to ask what a ceiling was doing. Under a NUMBER you may ' +
      'never hold more than that many meeples of one colour; a gain over it is boxed - removed ' +
      'from the game - and the engine emits meepleBoxed instead of meepleGained, with the source ' +
      "('collect' or 'island') on the event so the loss is countable. " +
      '⛔ THE HISTORY, BECAUSE IT IS THREE RULINGS IN TWO DAYS AND A FUTURE SESSION WILL ' +
      'OTHERWISE RE-DERIVE HALF OF IT. 04/09/2026: Dean ruled the cap at ONE against its own ' +
      'sweep, on teach simplicity. 04/09 evening: the amended R4 set it to 2 inside the handoff ' +
      'v2 arm as a processing bound. 05/09: R17 was ruled in AS MEASURED and the 2 shipped with ' +
      'it, as a passenger nobody argued for. 05/09, same day, once that was pointed out: Dean ' +
      'removed the cap outright. ⭐ WHY IT COSTS ALMOST NOTHING TO REMOVE: under the meeple ' +
      'economy a resource spend no longer leaves the game, so the cap of 2 was boxing only 1.14 ' +
      'meeples a game against 13.45 under the v1 loop - it had already stopped doing economic ' +
      'work, and what was left was a rule a player had to remember. ⚠️ WHAT TO WATCH INSTEAD, ' +
      'because the anti-pile argument is now unguarded: the median supply held in the last ' +
      'third, and the branching factor, since every extra meeple in a supply multiplies the ways ' +
      'to pay for a build. The sweep was overlays/meeple-on-board-cap-one-v1, -cap-two-v1 and ' +
      '-cap-three-v1, all three now in overlays/retired/ and all three needing the ' +
      'meeple-economy pins re-added before they would measure anything again.',
  },
  {
    template: 'rules.turn.meepleAsCard',
    type: 'boolean',
    description:
      '⛔ SUBJECTLESS UNDER THE COMMONS (09/09/2026) AND SHIPPED false: there are no meeples to ' +
      'spend as anything. It was true and the shipped rule from 05/09 to 09/09/2026, and ' +
      'overlays/meeple-economy-v1.overlay.json is that game. ⭐ THE FINDING IT CARRIES OUTLIVES ' +
      'THE RULE AND IS THE MOST REUSABLE THING THIS PROJECT HAS MEASURED: a currency that ' +
      'LEAVES the game is a drain however good the reason for spending it, and closing the loop ' +
      '(meepleAsCardGoesTo board) is what made a second use affordable. Anybody proposing a ' +
      'sink for any future currency should read that pair before designing it. ' +
      '⭐ R15, THE MEEPLE-AS-CARD ARM (Dean, 04/09/2026 evening, handoff v2). Read only under ' +
      "visitCurrency 'meeple'. ⭐ TRUE IS THE DEFAULT SINCE 05/09/2026, when Dean ruled R17 in and this " +
      'knob shipped with it. FALSE is the v1 loop of 04/09/2026 and is one flag away at ' +
      'overlays/meeple-loop-v1.overlay.json - it is the loop where a meeple only ever buys ' +
      "its colour's action through a neighbour's board and is never a payment. " +
      'TRUE lets a meeple of a colour pay wherever a card of that ' +
      'colour would: build costs (including n-of-suit and the 2-own-suit Power/Endgame cost), a ' +
      "Grow's activation payment, and a delivery crate. ⚠️ WHERE THAT MEEPLE ENDS UP IS " +
      "meepleAsCardGoesTo, NOT THIS KNOB, and the shipped answer is a neighbour's board. Either way a " +
      'meeple never touches a hand, a barn, a stack or the hand limit - and two meeples still pay as ' +
      "one card of any colour (R10's wild pair, reused). A meeple paid into a Grow never joins " +
      'the stack or counts toward the threshold, so it can activate an already-full building. ' +
      'It exists because a meeple with no competing use under v1 is a coupon, not a cost: with ' +
      'nothing else to spend it on, spending one is not a decision.',
  },
  {
    template: 'rules.turn.meepleAsCardGoesTo',
    type: 'meepleDestination',
    description:
      '⛔ SUBJECTLESS UNDER THE COMMONS (09/09/2026), and LEFT AT board RATHER THAN RESET: with ' +
      'meepleAsCard false nothing reads it, and leaving the 05/09/2026 ruling in place is what ' +
      'lets overlays/meeple-economy-v1.overlay.json reproduce the reference-v14 game without ' +
      'pinning it. Read only under meepleAsCard true. ' +
      '⭐ R17, WHERE A MEEPLE SPENT AS A CARD GOES (Dean, 05/09/2026). Read only under ' +
      "meepleAsCard true. ⭐ 'board' IS THE DEFAULT: it is the shipped game since 05/09/2026. 'box' is the handoff " +
      "v2 arm, where a resource spend leaves the game and the pool drains. 'board' closes that " +
      "drain: the meeple is placed on ANOTHER PLAYER's Notice Board, in its own colour's slot, " +
      'exactly as a visit does, and the host collects it. It buys the payer NOTHING beyond what ' +
      'it paid for - no door action, and it is not a visit - so the bonus slot is untouched. The ' +
      'v2 measurement is the reason it exists: meeples left the game 18.27 times a game against ' +
      '9.44 visits, median supply in the last third hit 0.0 and the hook collapsed to 0.09, so ' +
      'the resource use was not competing with the loop, it was emptying it.',
  },
  {
    template: 'rules.turn.paymentSlotToll',
    type: 'int',
    description:
      '⛔ SUBJECTLESS UNDER THE COMMONS (09/09/2026): no meeples, no placement, no toll. Left ' +
      'at 1, the ruled value, for the same reason as meepleAsCardGoesTo above - so the ' +
      'meeple-economy control needs no pin for it. ' +
      "⭐ THE PAYMENT TOLL (Dean, 05/09/2026), read only under meepleAsCardGoesTo 'board'. " +
      'Placing a paid meeple onto a slot that ALREADY HOLDS one costs this many extra meeples of ' +
      'any colour, and the extras go to the BOX. ⚠️ IT IS FLAT, NOT PER OCCUPANT, and that ' +
      'is the one place it differs from slotToll: a slot holding three still costs one extra to ' +
      'place on. Dean ruled it flat so the rule is one sentence and a deep slot can never make a ' +
      'build unpayable. The toll is the only drain left once resource spends stop being boxed, so ' +
      'read it beside the pool-by-round line.',
  },
  {
    template: 'rules.turn.paymentHostChoice',
    type: 'paymentHostChoice',
    description:
      '⛔ SUBJECTLESS UNDER THE COMMONS (09/09/2026). ⭐ THE DESIGN QUESTION IT LEAVES BEHIND ' +
      "IS WORTH KEEPING: this knob priced WHO YOU FEED, which was R17's own new decision and " +
      'which no bot could ever see (C64). The commons removes the question by construction - a ' +
      'card played to the centre feeds the table, and whoever Harvests that pile takes it - so ' +
      'the interaction is now open rather than directed, and nobody has measured whether an ' +
      'open one is noticed at a table any more than a directed one was. Left at perPayment, the ' +
      'ruled value. ' +
      "⭐ WHO RECEIVES A MEEPLE PAYMENT (R17), read only under meepleAsCardGoesTo 'board'. " +
      "⚠️ 'perPayment' IS THE DEFAULT AND THE SHIPPED RULE, and this description said the opposite " +
      "until 05/09/2026. 'perMeeple' was Dean's first ruling that day and he ruled it back the same day on " +
      'the branching factor: the payer picks a host for ' +
      'EACH meeple, so one payment may feed several neighbours. ⚠️ IT IS ALSO THE ' +
      'BRANCHING FACTOR - it multiplies the build enumerator by roughly hosts^meeples, and ' +
      'measured at 25,827 ways to pay for one building at four seats against 841 with the box. ' +
      "'perPayment', the shipped rule, is the measured alternative: the whole payment lands on ONE chosen host, " +
      'which keeps the choice of who to feed (and how much) while collapsing the factor to the ' +
      'number of hosts.',
  },
  {
    template: 'rules.turn.slotToll',
    type: 'intOrNull',
    description:
      '⛔ SUBJECTLESS UNDER THE COMMONS (09/09/2026) AND SHIPPED null: a central board has no ' +
      'slots and no threshold, so NOTHING IN THE COMMONS IS EVER PRICED OR REFUSED (C4) and the ' +
      'only knob that could change that is rules.economy.commonsThreshold. It was 1 and the ' +
      'shipped rule from 05/09 to 09/09/2026. ⚠️ null HERE IS THE v1 BLOCK, NOT "no toll": ' +
      'under the meeple controls null means a slot holding a meeple REFUSES that colour, which ' +
      'is the opposite of permissive. Two readings, one value, again. ' +
      '⭐ THE AMENDED R6, THE PRICED SLOT (Dean, 04/09/2026 evening, handoff v2). Read only under ' +
      "visitCurrency 'meeple'. ⭐ IT SHIPS AT 1 SINCE 05/09/2026, ruled in with R17, so NOTHING IS EVER " +
      'REFUSED and a slot is PRICED. NULL is the v1 rule and survives in ' +
      'overlays/meeple-loop-v1.overlay.json and in the v31 control - it is the rule as it stood on ' +
      '04/09/2026: a slot holding any meeple is BLOCKED and refuses that colour until the ' +
      'owner Collects. The number n prices the block instead: nothing is ever refused, ' +
      'but visiting a slot already holding k meeples costs n*k EXTRA meeples of any colours, on ' +
      'top of the acting meeple, and the toll goes straight to the box, never to the host. A slot ' +
      'holding two meeples under slotToll 1 costs three to visit: one into the slot, two boxed. A ' +
      'wild pair in a slot counts as two occupants. Dean\'s framing: it "might be a good way of ' +
      'sinking surplus meeples" once the cap is loosened - sweep it with meepleCapPerColour, never ' +
      'alone.',
  },
  {
    template: 'rules.turn.meepleSpendTiming',
    type: 'meepleSpendTiming',
    description:
      '⭐ WHEN A HELD MEEPLE MAY BE SPENT (M4, Dean 12/09/2026, ledger A151). ' +
      "'afterAction' is the arm: after your main action you may discard one meeple to take the " +
      'PLAIN action of its colour, and the meeple then leaves the game. ' +
      "⛔ IT SHIPS 'start' AND NOT 'none', WHICH DIFFERS FROM SECTION 3 OF " +
      'docs/village-store-coins-handoff-2026-09-12-v1.md DELIBERATELY AND ON INERTNESS GROUNDS. ' +
      "'none' would DELETE A PHASE THAT IS LIVE IN A NAMED CONTROL: " +
      'overlays/v31-card-visit.overlay.json sets startingMeeplesPerColour 1 beside visitCurrency ' +
      "'card', under which meepleOptions (packages/engine/src/actions.ts) returns a real list and " +
      "the turn-start spend runs, exactly as turnflow.ts's own header documents the v31 turn " +
      '("spend any number of MEEPLES, one at a time"), and packages/sim/fixtures/2p-v31-opening.json ' +
      "replays against it. So 'start' IS the current behaviour and is therefore the inert value, " +
      "and 'none' stays reachable as a third value for anybody who wants the phase gone. A shipped " +
      'value that silently changes a control is the 05/09/2026 passenger lesson in a new costume, ' +
      'and a control that moves is not a control. ' +
      '⛔ THE PLAIN ACTION AND NEVER THE NOTICE BOARD POWER (M6): the Orchard board is Draw 4 ' +
      'where the plain action is Draw 2, and the two stopped being the same thing on 10/09/2026. ' +
      'The colour mapping is wheat Harvest, vegetable Deliver, orchard Draw 2 keep both, apiary ' +
      'GROW and dairy Build (M7) - GROW AND NOT SOW, because Sow is not a core action and orange ' +
      'meaning one thing in one place and another elsewhere has cost this project a day before. ' +
      '⚠️ AND THE ARM REVERSES THE REASON THE BONUS SITS AT THE FRONT: the bonus was moved to the ' +
      'start of the turn on Dean’s own reasoning that a turn visibly ends on the main action ' +
      '(C2, 09/09/2026). Mild, because most turns will have no meeple to spend, but it is a direct ' +
      'tension with a deliberate ruling. ' +
      '⚠️ TWO ENGINE RULINGS ARE OWED AND NEITHER IS A LEAF: whether the spend is legal on a turn ' +
      'whose main action was PASSED rather than taken (D7), and whether the standing rule that an ' +
      'illegal action is not offered applies here, which would make a meeple UNDISCARDABLE (D8, ' +
      '"yes" indicated).',
  },
  {
    template: 'rules.turn.meepleSpendPerTurn',
    type: 'intOrNull',
    description:
      '⭐ HOW MANY MEEPLES ONE SEAT MAY SPEND IN ONE TURN (M5, Dean 12/09/2026, ledger A151). The ' +
      "arm is 1, which is Dean's ruling. " +
      '⛔ null MEANS UNLIMITED AND IS THE SHIPPED VALUE, WHICH ALSO DIFFERS FROM THE HANDOFF’S ' +
      'TABLE DELIBERATELY: it ships 0, and 0 would delete the phase, because there is no per-turn ' +
      'cap in the game today (turnflow.ts documents the v31 turn as "spend any number of MEEPLES, ' +
      'one at a time"). null is the established idiom of commonsThreshold, commonsHarvestTake and ' +
      'meepleCapPerColour, where null is "no rule here" rather than "zero of it". ' +
      '⚠️ THE CAP OF 1 REMOVES THE THING DEAN’S OWN TABLE ENJOYED, WHICH IS WHY C112 EXISTS. ' +
      'It was adopted against a branching-explosion worry, and the worry shrank when it was ' +
      'measured: at about 1.8 meeples a player a game, "as many as you like" almost never means ' +
      'more than two, while the combo burst is what the 11/09/2026 table liked. ' +
      '⛔ AND IT CANNOT REACH C112’S ALTERNATIVE ON ITS OWN. "No two of the same colour" is ' +
      'not an integer, so it is rules.turn.meepleSpendDistinctColours, a second leaf, and the two ' +
      'are orthogonal: the arm as ruled is 1 with that false, the C112 variant is null with that ' +
      'true. ⚠️ Read either against actions per turn, which passes at only 1.61 against a target ' +
      'of 1.5 and to which every meeple spent adds an action.',
  },
  {
    template: 'rules.turn.meepleSpendDistinctColours',
    type: 'boolean',
    description:
      "⭐ C112'S ALTERNATIVE TO THE PER-TURN CAP: MAY NO TWO MEEPLES SPENT IN ONE TURN SHARE A " +
      'COLOUR? SHIPPED false, which is inert, because no such restriction exists today. ' +
      '⛔ IT IS A SECOND LEAF RATHER THAN A MAGIC VALUE OF rules.turn.meepleSpendPerTurn, AND THAT ' +
      'IS DELIBERATE. "No two of the same colour" is not expressible as an integer, so the cap ' +
      'alone cannot reach it, and re-pointing the cap at a rule of a different shape would ' +
      'redefine a published quantity underneath its own readings - which this project has paid ' +
      'for twice (a17 judged on plays per turn, 09/09/2026; the meeple cap that shipped as a ' +
      'passenger, 05/09/2026). meepleSpendPerTurn keeps meaning HOW MANY; this says WHICH ONES MAY ' +
      'BE COMBINED. ' +
      '⭐ THE TWO ARMS C112 ASKS FOR, one run apart: the rule as Dean ruled it is ' +
      'meepleSpendPerTurn 1 with this false, and the C112 variant is meepleSpendPerTurn null with ' +
      'this true (overlays/delivery-meeple-distinct-colours-v1.overlay.json). ' +
      '⚠️ WHY IT HAS TO BE MEASURED RATHER THAN ARGUED: the cap of 1 removes exactly the combo ' +
      "burst Dean's own table enjoyed on 11/09/2026, and a table finding discarded on a manager's " +
      'say-so is worth less than a run. ⚠️ Read it beside actions per turn (1.61 against a target ' +
      'of 1.5) and beside the branching bench, since it is the looser of the two rules.',
  },

  // --- Economy -------------------------------------------------------------
  {
    template: 'rules.economy.noticeBoardThreshold',
    type: 'intOrNull',
    description:
      '⭐ 3 SINCE 10/09/2026, AND UNDER visitCurrency noticeBoardPower IT IS A MINIMUM RATHER ' +
      'THAN A MAXIMUM (Dean, S8). Three is the fewest cards a Notice Board must hold before its ' +
      'OWNER may harvest it; with rules.economy.noticeBoardBlocks false the board goes on ' +
      'accepting cards for ever, so isFull and canTakeCard stop being the same question for the ' +
      'first time in this codebase. ⚠️ THE FACE MUST PRINT 3+, NOT 3, because the plus sign is ' +
      'the only thing that says floor rather than ceiling. ⛔ THE BASE MOVE FROM 2 TO 3 CHANGES ' +
      'THE v31 CONTROL UNLESS THE CONTROL PINS IT, so overlays/v31-card-visit.overlay.json now ' +
      "sets this to 2 by name: under 'card' the board is a BLOCKING building at 2 and that arm " +
      'has to stay bit-reproducible. data.test.ts carries the regression test. ⚠️ AND THE ' +
      'PRINTED FACE STILL SAYS 2 until Isle-of-Farms-v36.xlsm, so the override and the print ' +
      'disagree again for the first time since v31 closed the old 5-versus-2 drift; the face is ' +
      'what has to catch up. ⚠️ overlays/noticeboard-threshold-3.overlay.json is now a no-op ' +
      "against the base and was already subjectless under the commons; the arm's own sweep is " +
      'overlays/notice-board-visit-threshold-2-v1 and -threshold-4-v1, which are the two ' +
      "candidates Dean named: at 2 the owner's harvest is barely worth an action, at 4 they are " +
      'paid too late. The 09/09/2026 note follows, unchanged. ' +
      '⛔ NO LONGER THE ONLY ECONOMY NUMBER, AND READ ONLY BY overlays/v31-card-visit.overlay.json ' +
      'SINCE 04/09/2026. Under the meeple loop the Notice Board stopped being a building; under ' +
      'the COMMONS (09/09/2026, C4) a central board has NO threshold at all - any number of ' +
      'cards, never full, never clogged - so clog as a denial tool has had no subject in the ' +
      'shipped game for two versions running. The commons knob that CAN cap a pile is ' +
      'rules.economy.commonsThreshold, and it is a different rule: a full central board shuts ' +
      'one of five boards to EVERYBODY, and any player may empty it with a Harvest. ' +
      "⭐ THE ONLY ECONOMY NUMBER LEFT, AND THE BALANCE LEVER. The door's threshold: how many " +
      'cards a Notice Board holds before it clogs and the farm shuts to visitors - and, since v31, ' +
      'to its owner too. An OVERRIDE of the printed face, kept as one because the value is a ' +
      'ruling and the face is generated; null hands the number back to the card, which now prints ' +
      '2 as well. The only lever ever measured to move the suit balance: t=4 gave Orchard 80.8%, ' +
      't=3 62.8%, t=2 42.0% against an even share of 36.4% on the two-building surface, and on the ' +
      'single-door surface t=5 clogged 2.3% of turn boundaries, t=3 5%, t=2 11%. In v31 it also ' +
      'throttles self-visits, so it is doing more work than any arm has measured.',
  },
  {
    template: 'rules.economy.noticeBoardBlocks',
    type: 'boolean',
    description:
      '⭐ THE 3+ RULE, AND THE FIRST TIME "harvestable" AND "accepts a card" HAVE BEEN SEPARATE ' +
      'QUESTIONS IN THIS CODEBASE (Dean, 10/09/2026, S8). SHIPPED false AND READ ONLY UNDER ' +
      "visitCurrency 'noticeBoardPower'. false IS THE RULE: rules.economy.noticeBoardThreshold " +
      'is a MINIMUM, the owner may harvest at or above it, cards may ALWAYS be added, nothing ' +
      'ever blocks, and nobody can shut a board by declining to harvest. true IS THE PAIRED ' +
      'CONTROL: the board becomes an ordinary clogging building, full at its threshold and ' +
      'refusing every card until its owner harvests. ⭐ IT EXISTS SO THE STALL IS MEASURED ' +
      'RATHER THAN ARGUED, and the question is not hypothetical - the stall is a DOCUMENTED ' +
      'FAILURE IN THE PREDECESSOR, where the game stops when nobody wants to load, and a ' +
      'blocking board hands an owner a denial he is paid nothing for. ⚠️ READ IT HARDEST AT TWO ' +
      'PLAYERS, where there are only two boards on the table and a shut one is total denial ' +
      'rather than a race. overlays/notice-board-visit-blocking-v1.overlay.json is the arm and ' +
      'it changes exactly this one leaf against the main arm.',
  },
  {
    template: 'rules.economy.noticeBoardsBySeats.{}',
    type: 'int',
    description:
      '⭐ SHIPPED {"2": 2, "3": 1, "4": 1} SINCE 13/09/2026, ruled the default when the commons ' +
      'was deleted; overlays that relied on the old "2": 1 now pin it. ' +
      "⭐ DEAN'S TWO-BOARD FIX (ruled 11/09/2026): HOW MANY NOTICE BOARDS EACH PLAYER LAYS OUT, " +
      "keyed by SEAT COUNT. Read only under visitCurrency 'noticeBoardPower' with " +
      'rules.turn.selfVisitAllowed false, exactly as noticeBoardBlocks beside it is. ' +
      'The arm set {"2": 2, "3": 1, "4": 1}. At 2 each player lays out ' +
      "TWO boards - their own suit's, plus one more drawn AT RANDOM from the suits nobody is " +
      'farming - and the fifth board is not used. At three and four seats the arm IS ' +
      'overlays/notice-board-visit-no-self-v1.overlay.json, so the pair differs AT TWO SEATS ' +
      'ONLY and those two columns must reproduce the control on identical seeds. ' +
      '⭐ A MAP RATHER THAN A BOOLEAN, DELIBERATELY: it matches how this codebase already ' +
      'expresses a per-seat-count quantity (island.decksInPlayBySeats, ' +
      'island.tokens.wildBySeats) and it lets a later pass sweep "what if three seats also got ' +
      'two?" without another knob. ' +
      '⭐ WHY IT EXISTS, MEASURED RATHER THAN ARGUED. Four corners of a 2x2 ran at 4,820 games ' +
      'each on 11/09/2026: self-visits ON with no centre read a bonus rate of 71.2% and a hook ' +
      'of 0.44 (FAIL), self-visits ON with the centre 78.4% and 0.23 (FAIL), self-visits OFF ' +
      'with the centre 64.7% and 0.31 (FAIL), and self-visits OFF with NO centre 46.1% and ' +
      '0.54, THE ONLY CORNER THAT PASSES THE HOOK and therefore the only version in which the ' +
      "design's own thesis - a visit pays the person visited - actually works. ⛔ AND THAT " +
      'CORNER STARVES AT TWO PLAYERS: the bonus is used on 28.8% of turns against a 30% floor, ' +
      'and 17.9% of two-player turns begin with cards in hand and NO LEGAL VISIT, because with ' +
      'self-visiting banned and one board each there is exactly ONE board a seat may visit. ' +
      'Adding ownerless central boards fixed the rate and DESTROYED the cross-table traffic: at ' +
      'two players only 14.7% of plays reached a person. THE STRUCTURAL LESSON IS THE REASON ' +
      'FOR THIS KNOB - THERE ARE ONLY EVER FOUR TARGETS, AND EVERY TARGET ADDED THAT IS NOT A ' +
      'PERSON DILUTES THE PERSON. ' +
      '⭐ SO EVERY TARGET THIS ADDS IS A PERSON, WHICH IS THE WHOLE POINT AND THE THING THE ' +
      'CENTRAL-BOARDS VARIANT GOT WRONG. Targets become 2 / 2 / 3 by seat count: at 2 seats one ' +
      'rival holding two boards, at 3 seats two rivals holding one each, at 4 seats three ' +
      'rivals holding one each. A seat still may never visit its own board, either of them. ' +
      '⭐ AND THE RANDOM BOARD PAYS ITS OWNER: its power is usable only by rivals, but every fee ' +
      'paid onto it rests there until its OWNER harvests it into their barn, so a popular board ' +
      "is income. That is this design's core loop, arriving on a board whose power its owner can " +
      'never use. ' +
      '⚠️ IT HAS AN ARITHMETIC CEILING NOBODY HAS PRICED: the suits nobody is farming number ' +
      '(5 - seats), so n boards each is only realisable where seats x (n - 1) is at most ' +
      '(5 - seats) - which is 2 at two seats (2 drawn from 3, one left over) and 1 at three and ' +
      'four seats. A sweep of {"3": 2} asks for six boards out of five, and what an engine does ' +
      'with an infeasible value is an ENGINE ruling that has not been made. ' +
      '⚠️ AND A REAL CONSEQUENCE NOBODY HAS PRICED: at two seats a player owns TWO boards, so ' +
      'they have two income streams to harvest and twice the harvesting to do, and A21 The Wax ' +
      'Hall (1 VP for each of your buildings holding a card) can count TWO Notice Boards rather ' +
      'than one. rules.economy.noticeBoardThreshold applies to each board separately, so a ' +
      "seat's fee traffic splits across two boards and each fills at half the rate, which points " +
      'the a20 stall reading at a new subject. ' +
      'overlays/notice-board-visit-two-boards-v1.overlay.json is the arm and ' +
      'overlays/notice-board-visit-no-self-v1.overlay.json is its control.',
  },
  {
    template: 'rules.economy.grandGranaryCap',
    type: 'intOrNull',
    description:
      "A cap on W20 The Grand Granary's end-game VP. SHIPPED 5 (18/09/2026): the v44 sheet " +
      'prints the cap on the card face itself, "Game end: 1 VP for each building you have ' +
      'built (Max 5VP)", so the arm of 16/09/2026 (tested because W20 averaged 8-15 VP and ' +
      'switching it off cost Wheat 12.6 points of win rate on reference-v20) is now the ' +
      'default rather than an experiment. null is the v42 card with no cap, kept as the ' +
      'control.',
  },
  {
    template: 'rules.economy.honeyHallCap',
    type: 'intOrNull',
    description:
      "A cap on A19 The Honey Hall's end-game VP. SHIPPED 5 (19/09/2026, v45): the sheet " +
      'prints "(Max 5)" on the card face itself, "Game end: 1 VP for each non-Apiary ' +
      'building you have built. (Max 5)". Added on the grandGranaryCap pattern (R9, ' +
      'tasks/v45-rulings-v1.md) as its own knob, not shared with apiaristsGuildCap, ' +
      'because the two cards count different things. null is the pre-v45 card with no cap.',
  },
  {
    template: 'rules.economy.apiaristsGuildCap',
    type: 'intOrNull',
    description:
      "A cap on A20 The Apiarist's Guild's end-game VP. SHIPPED 5 (19/09/2026, v45): the " +
      'sheet prints "(Max 5)" on the card face itself, "Game end: 1 VP for each 1VP ' +
      'building you have built. (Max 5)". Added on the grandGranaryCap pattern (R9, ' +
      'tasks/v45-rulings-v1.md) as its own knob, not shared with honeyHallCap, because ' +
      'the two cards count different things. null is the pre-v45 card with no cap.',
  },
  {
    template: 'rules.economy.cropScorerOnBarn',
    type: 'boolean',
    description:
      '⭐ THE BARN AND FARMSTEAD SWAP (Dean, 13/09/2026, from the v39 sheet). true puts the ' +
      'own-crop end-game scorer ("Game end: 1 VP for each CROP card you have built") on the BARN ' +
      'and makes the FARMSTEAD the receipt tray; false keeps the scorer on the Farmstead. ' +
      '⭐ SCORE-NEUTRAL UNDER THE COMMONS - the Barn scores exactly what the Farmstead did, so ' +
      'no total moves and only the printing card changes. ⛔ NOT NEUTRAL UNDER THE COINS ARM, ' +
      'where the scorer landed nowhere (K13) and this would add VP, so pre-ruling overlays pin it ' +
      'false. The notice-board visit arm moves it to the Barn on its own (S1) regardless.',
  },
  {
    template: 'rules.economy.noticeBoardPower.orchardDraw',
    type: 'int',
    description:
      '⭐ THE ORCHARD NOTICE BOARD DRAWS THIS MANY (Dean, 10/09/2026, S12: "Draw 4."), UP FROM ' +
      "THE MORNING'S 3. Read under visitCurrency 'noticeBoardPower'. ⭐ THE BLOCK IS RENAMED " +
      'FROM rules.economy.farmsteadPower AND THIS NUMBER IS REPOINTED WITH IT: the powers left ' +
      'the Farmstead and went to the Notice Boards, and a knob whose name no longer describes ' +
      'it is worse than a new one. ⚠️ IT IS NOT THE RETIRED DRAW-3 DOOR AND MUST NOT BE ARGUED ' +
      'AGAINST AS ONE: that ruling was about a FREE bonus door and died twice over, most ' +
      'recently because a door that hands back cards feeds the slot that bought it. This power ' +
      "costs a card OFF YOUR HAND AND ONTO SOMEBODY ELSE'S BOARD, so it nets +3 rather than " +
      '+4 and the card it spends is one a rival may end up harvesting. ⭐ IT IS THE ONE POWER ' +
      'THAT CAN NEVER BE DEAD, because the decks are always there, and it collides with nothing ' +
      'on the sheet - which is why it is the only one of the five S13 did not have to re-cut. ' +
      'Sweep it against vegetableFallback first: Draw against Deliver is the imbalance Dean ' +
      'raised by name, and the visit spread is where it shows.',
  },
  {
    template: 'rules.economy.noticeBoardPower.apiarySows',
    type: 'int',
    description:
      '⭐ CARDS THE APIARY NOTICE BOARD SOWS FROM YOUR HAND (Dean, 10/09/2026, S12: "Sow 2 ' +
      'cards from your hand onto your buildings."). Read under visitCurrency ' +
      "'noticeBoardPower'. ⭐ A SOW AND NOT A GROW, WHICH IS WHY THE KEY IS NO LONGER " +
      'apiaryGrows: nothing is activated and no ability fires, so the power can never become a ' +
      'better A12 The Honey Hut or A5 The Meadow Hive, and it stays the suit verb Apiary has ' +
      'owned since 03/07/2026. ⛔ RULING C89, ONTO YOUR OWN BUILDINGS ONLY: S12 said "onto any ' +
      'buildings", which read literally reaches across the table, and Dean ruled it ' +
      'self-contained on 10/09/2026. So EVERY POWER IS SOLITAIRE AND THE VISIT ITSELF IS THE ' +
      'ONLY CROSS-TABLE ACT IN THE DESIGN, which is what keeps the interaction budget readable ' +
      'and leaves the sow-match and DL-63 questions with no subject. ⚠️ Raising it raises the ' +
      "board's worth faster than any other number here, because a sow needs no matching suit " +
      'and pays no activation.',
  },
  {
    template: 'rules.economy.noticeBoardPower.apiaryPower',
    type: 'apiaryPower',
    description:
      '⭐⭐ WHICH POWER THE APIARY NOTICE BOARD PRINTS. RULED BY DEAN, 14/09/2026: THE BASE IS ' +
      '\'deckGrowWild\', "Grow a building using the top card of any deck": GROW one of your own ' +
      'non-full buildings with its activation card paid off the top of a deck in play, so the ' +
      'ability FIRES, the stack advances and the clog brake survives, and the deck card pays ANY ' +
      'activation cost ("a way of bypassing the suit requirements"). \'deckGrow\' is the ' +
      "rejected literal reading, the deck's crop matching the cost. 'sow' is the S12 power of " +
      '10-13/09/2026, "Sow 2 cards from your hand onto your buildings", reading apiarySows, and ' +
      'every overlay that predates the ruling pins it. Measured on reference-v17 seeds: Dairy ' +
      'win rate 36.6% to 50.4%, Apiary 40.2% to 25.9%. ⚠️ ' +
      'EITHER GROW REVERSES THE REASONING OF C89, which kept the power a SOW so it could never ' +
      'be a better A12 The Honey Hut or A5 The Meadow Hive. Read the Apiary win rate, the ' +
      'door mix and a06 together.',
  },
  {
    template: 'rules.economy.noticeBoardPower.vegetableFallback',
    type: 'int',
    description:
      '⭐ CARDS THE VEGETABLE NOTICE BOARD PUTS INTO YOUR BARN WHEN YOU CANNOT DELIVER (Dean, ' +
      '10/09/2026, S12: "Deliver. If you cannot, put 2 cards from your hand into your barn."). ' +
      "Read under visitCurrency 'noticeBoardPower'. ⚠️ IT IS NOT A COUNT OF DELIVERIES AND THE " +
      'KEY IS NO LONGER vegetableDeliveries: delivering twice was V15 The International Port ' +
      'word for word, and S13 killed it so the card keeps its identity. ⭐ THE FALLBACK IS WHAT ' +
      'MAKES THE BOARD NEVER DEAD, and it is the standing answer to the oldest availability ' +
      'problem in the door set: Deliver is the scoring action, and the Vegetable board has ' +
      'taken 11% of plays and 8-18% of door uses under every version this project has measured, ' +
      'because DELIVER IS WORTH NOTHING TO A PAYER WITH AN EMPTY BARN. A fallback that fills ' +
      'the barn sets the NEXT delivery up instead of failing. Read it beside deliveries per ' +
      'player and the barn glut, never alone.',
  },
  {
    template: 'rules.economy.noticeBoardPower.vegetableWildCards',
    type: 'int',
    description:
      '⭐ THE VEGETABLE NOTICE BOARD’S RELAXATION (Dean, ruling R9, 16/09/2026): "Deliver - 2 ' +
      'of the cards may be any crop. If you cannot, put 2 cards from your hand into your ' +
      'Barn." SHIPPED 2: in that one delivery up to this many of the 4 cards may be of any ' +
      'crop. 0 is the plain Deliver. ⚠️ BUILDER DEFAULT, NOT RULED: on a second delivery the ' +
      'relaxed cards may also cover the remaining token’s pair, so all 4 may be any crop. The ' +
      'fallback (vegetableFallback) fires only when no delivery can be paid even with this.',
  },
  {
    template: 'rules.economy.noticeBoardPower.dairyWild',
    type: 'boolean',
    description:
      '⭐ THE DAIRY NOTICE BOARD WAIVES THE CROP REQUIREMENTS ON A BUILD (Dean, 10/09/2026, ' +
      'S12: "Build. You may spend cards of any crops."). SHIPPED true and read under ' +
      "visitCurrency 'noticeBoardPower'. ⭐ A FLAG AND NOT A DISCOUNT, WHICH IS WHY IT REPLACES " +
      'dairyDiscount: a build at a discount of 1 ALREADY waives crop requirements, so the ' +
      "morning's Dairy power was D4 The Milking Shed exactly and S13 killed it. The full cost " +
      'is still paid here; only the n-of-suit requirement goes. ' +
      '⛔ NAME IT AS A PASSENGER IN EVERY WRITE-UP, BECAUSE IT IS THE BIGGEST ONE THE ARM ' +
      'CARRIES: this waives what CLAUDE.md calls "the natural gate" on building - build costs\' ' +
      'n-of-suit requirements are the only thing rationing which cards a hand can turn into a ' +
      'tableau - and it waives it FREE, FOR EVERY PLAYER, EVERY TURN, for the price of the ' +
      'bonus. Dean ruled on 10/09/2026 to KEEP it and MEASURE it rather than to soften it. ' +
      '⚠️ THE READING THAT JUDGES IT IS THE OWN-CROP BUILD SHARE, 82.6% before v31 and 83.3% ' +
      'after, over 38,012 builds and never re-read since. A large fall says the gate was doing ' +
      'the monoculture work nobody had credited it with; no move at all says the gate was never ' +
      'binding and the power is weaker than it reads. false is the control that answers it.',
  },
  {
    template: 'rules.economy.noticeBoardPower.dairyDiscount',
    type: 'int',
    description:
      '⭐ THE DAIRY NOTICE BOARD’S DISCOUNT (Dean, ruling R10, v41, 16/09/2026; CUT v44, ' +
      '18/09/2026): "Build, spending cards of any crops, with a discount of 1." SHIPPED 1. ' +
      'The build costs this many cards fewer, and any discount above 0 also waives the ' +
      'n-of-suit requirement in the engine’s pricer. 0 is the full-price, waiver-only board of ' +
      '10-15/09/2026; 2 is the v41 opening value, cut on the v44 sheet because a discount of 2 ' +
      'was D10 The Scout’s Post’s and W7 Golden Field’s price on a free action. It REPLACES ' +
      "dairyGrowsBuilt ('paidWild' and its siblings), deleted 16/09/2026: the board no longer " +
      'Grows the building it builds. Read the Dairy win rate and the build count per seat ' +
      'before quoting anything about the board.',
  },
  {
    template: 'rules.economy.noticeBoardPower.wheatHarvestGate',
    type: 'wheatHarvestGate',
    description:
      '⭐⭐ WHICH BUILDINGS THE WHEAT NOTICE BOARD MAY HARVEST. RULED BY DEAN, 19/09/2026, ' +
      'SHEET v44: *"Harvest one of your buildings, even if it is 1 card short of full."* ' +
      "SHIPS AT 'nearFull' - a stack at or above threshold minus one. 'loaded' is the value " +
      'this knob carried for its first few hours on the same day (any building of yours ' +
      'holding one or more cards, the engine reading ledger C97 flagged as never ruled, which ' +
      'reaches your own `3+` Notice Board at a single card) and is now the PRE-RETEXT control - ' +
      "every overlay and testkit helper pinning the pre-19/09 game pins it here by name. 'full' " +
      'is the ordinary Harvest gate and excludes a `3+` board entirely, because such a board is ' +
      'never full. ' +
      '⭐⭐⭐ THE NOTICE-BOARD-AT-2 REVERSAL: Dean read "1 card short of full" against a `3+` ' +
      'board by treating its 3 as the fill level, so `wheatHarvestable` resolves it at 2 cards ' +
      '(`threshold - 1`), needing no special case. **THIS REVERSES THE STANDING RULE OF ' +
      '15/09/2026** ("the Wheat board harvests only a full building or a 3+ Notice Board"; "a ' +
      'Notice Board is never harvested below 3 by any card") FOR THIS POWER SPECIFICALLY - that ' +
      'sentence stays true everywhere else (the plain Harvest action, every other card). ⛔ ' +
      "'nearFull' is also NARROWER than 'loaded' for an ordinary building (threshold minus one " +
      "or more, not one or more), so it closes C97's reading there while narrowing rather than " +
      'closing it for the board itself - C97 stays open. ⛔ PAIRED WITH wheatBarn: the retext ' +
      'prints no hand-to-barn rider, so it ships at 0 beside this at "nearFull", and an overlay ' +
      'that wants only one half of the retext (`wheat-gate-nearfull-v1`, `wheat-no-barn-rider-v1`) ' +
      'is a DECOMPOSITION ARM, not the shipped game.',
  },
  {
    template: 'rules.economy.noticeBoardPower.wheatBarn',
    type: 'int',
    description:
      '⛔⛔ RETIRED 19/09/2026, SHEET v44, AND SHIPS AT 0: Dean retexted the Wheat Notice Board ' +
      'to *"Harvest one of your buildings, even if it is 1 card short of full"*, which prints ' +
      'no hand-to-barn clause, so this key now describes nothing on the printed card and only ' +
      'exists for the overlays and testkit helpers that pin 1 to keep replaying the pre-19/09 ' +
      'game (see `wheatHarvestGate` beside it for the paired pin). The engine guards the push ' +
      'on `> 0` rather than deleting it (`packages/engine/src/workers.ts`, the `wheat` case of ' +
      '`fireNoticeBoardPower`) precisely so that pin still works: `handToBarn` does not consult ' +
      '`remaining` before offering every hand card, so an unconditional push at 0 would hand a ' +
      'seat a live, pointless prompt instead of being auto-skipped.' +
      '\n\n' +
      'CARDS THE WHEAT NOTICE BOARD PUT INTO YOUR BARN AFTER ITS HARVEST, UNTIL TODAY (Dean, ' +
      '10/09/2026, RULING C88: "Harvest one of your buildings, then put 1 card from your hand ' +
      'into your barn."). ⛔ THE RULING IS WHY THE KEY EXISTED AT ALL: S12\'s Wheat power was ' +
      '"Harvest any one of your buildings, however many cards are on it", which is W11 The ' +
      'Bakehouse WORD FOR WORD, and Dean ruled that the POWER moves and the CARD keeps its ' +
      "identity - S13's own precedent, the one that killed the morning's Dairy and Vegetable " +
      'powers for duplicating D4 and V15, applied a third time. So the board harvested plainly ' +
      'and paid a card into the barn on top. ⭐ THE BARN CARD WAS ALSO THE AVAILABILITY FIX: a ' +
      'seat with nothing full to harvest still got something for its card, which was the same ' +
      "job D6 did for the commons wheat board. The retext's own availability answer is the " +
      "relaxed gate itself (a board is offered whenever SOME building reaches 'nearFull', which " +
      'is a lower bar than full), so the second leg stopped being load-bearing rather than being ' +
      'deleted out from under a dead power.',
  },
  {
    template: 'rules.endGame.furtherTurnsEach',
    type: 'int',
    description:
      "Turns each other player takes after the game-end trigger. Read only under endOfGame 'oneMoreTurnEach', and only 1 is implemented.",
  },
  {
    template: 'rules.endGame.endOfGame',
    type: 'endOfGame',
    description:
      "⭐ HOW A TRIGGERED GAME ENDS. RULED BY DEAN, 15/09/2026: 'finishRound', play on until the " +
      'round is complete, so the game ends when the seat about to play would be the first player ' +
      "(GameState.firstPlayer). 'oneMoreTurnEach' is every game before the ruling: every other " +
      'player takes one more turn and the game ends when the trigger seat would play again. Every ' +
      'overlay describing an older game pins the old value by name.',
  },
  {
    template: 'rules.setup.firstPlayer',
    type: 'firstPlayer',
    description:
      "⭐ WHO OPENS. RULED BY DEAN, 15/09/2026: 'random', drawn from the game's seeded RNG after " +
      "every setup shuffle and recorded as GameState.firstPlayer. 'seat0' is every game before the " +
      'ruling and makes no RNG call, so an overlay that pins it replays its old game move for move.',
  },
  {
    template: 'rules.endGame.deliveriesToTrigger',
    type: 'int',
    description:
      '⭐ THE FIRST KNOB TO SWEEP AFTER v31. Island deliveries by one seat that fire the end of ' +
      'the game. The whole clock of the flat island, and flat across seat counts - at 6 that is ' +
      'half the 2-seat board, a third of the 3-seat and a quarter of the 4-seat. v31 makes a turn ' +
      'materially more powerful (the bonus slot buys a whole core action for one card, and meeples ' +
      'add uncapped free ones), so the same 6 deliveries arrive sooner: expect a shorter game and ' +
      'higher scores before anything is dialled. overlays/end-trigger-8.overlay.json is the arm.',
  },

  // --- The five doors ------------------------------------------------------
  {
    template: 'workers.roster.{}.draw.see',
    type: 'int',
    description:
      'Cards the Orchard door looks at. 2 since 09/09/2026, moving with `keep` - see it for the ' +
      'whole of the argument.',
  },
  {
    template: 'workers.roster.{}.draw.keep',
    type: 'int',
    description:
      '⭐ 2 SINCE 09/09/2026, AND IT IS A CHOICE DEAN MADE RATHER THAN A CONSEQUENCE (C3: "Dean ' +
      'chose 2 over 3; Draw 3 is a paired arm"). It was 3 for the whole life of the card visit, ' +
      'and under the commons it is the ONE CONTESTED NUMBER IN THE DOOR SET. ' +
      '⚠️ READ WHY THE OLD ARGUMENT ONLY HALF-DIES. The self-cancellation law said a door priced ' +
      "in its own output currency has to over-deliver, because the slot's alternative was a FREE " +
      'Draw 1 - and there is no free option in the commons, so that half has no subject. But the ' +
      'commons PUTS THE FEE BACK: a play costs one card, so a Draw 2 board returns 2 for 1 and ' +
      'nets +1, where every other board hands back a whole action for the same card. That is the ' +
      'thinnest return in the set. THE PREDICTION IS THEREFORE SHARP AND FALSIFIABLE: the Orchard ' +
      'board should take the least traffic of the five, and overlays/commons-draw-three.overlay.json ' +
      'is the arm that says whether 3 rescues it. Read the DOOR MIX, not the bonus rate. ' +
      '⛔ THE v31 CONTROL PINS 3/3 and must keep pinning it: the card visit measured with the ' +
      'exception in place, and overlays/orchard-door-draw-two-v1.overlay.json - which used to be ' +
      'the arm that removed it - is now a NO-OP against the shipped data, kept only because ' +
      'reports name it. ⚠️ AND THE PRINTED actionText NOW SAYS "Draw 2.", so under the v31 ' +
      'control the card face and the rule disagree by one; an overlay may never override text, ' +
      'which is a divergence that control already documents.',
  },
  {
    template: 'workers.roster.{}.drawUnderMeepleCurrency.see',
    type: 'int',
    description:
      'Cards the Orchard door looks at UNDER THE MEEPLE ARM only. A second printed payload ' +
      'rather than an edit to `draw`, so the shipped Draw 3 cannot move when the arm does.',
  },
  {
    template: 'workers.roster.{}.drawUnderMeepleCurrency.keep',
    type: 'int',
    description:
      '⭐ THE EXCEPTION DISSOLVES UNDER THE MEEPLE ARM, AT 2. Draw 3 exists only because a ' +
      'visit costs a CARD and the slot’s alternative is a free Draw 1, so a card-producing ' +
      'door had to over-deliver or buying it was net zero. A meeple visit costs no card and ' +
      'there is no standalone free Draw, so the self-cancellation law has nothing to bite on ' +
      'and all five doors are the plain base action again. Set it back to 3 as a control if ' +
      'the Orchard slot takes an implausible share of visits.',
  },
  {
    template: 'workers.roster.{}.sow.amount',
    type: 'int',
    description:
      'Cards the Apiary door sows. It sows FROM THE HAND in v31, so a visitor pays 2 cards for 1 ' +
      'threshold step and this is the weakest door on the table by some distance - ruled that way ' +
      'knowingly. If the Apiary board takes no traffic, the fix is the source (back to a deck top), ' +
      'not this number.',
  },

  // --- The island ----------------------------------------------------------
  {
    template: 'island.tileRule.crates',
    type: 'int',
    description:
      'Tokens dealt onto every island card at setup (2). The token pool must fill the tiles ' +
      'exactly (data.test.ts), so moving this means moving the token set in the same overlay.',
  },
  {
    template: 'island.tileRule.cardsPerCrate',
    type: 'int',
    description:
      "Cards one token's demand asks for (2). A delivery always costs crates times this, 4 " +
      'barn cards, and a second delivery pays the last token plus this many cards of any crops.',
  },
  {
    template: 'island.tokens.vpValues',
    type: 'intArray',
    description:
      '⭐ THE TOKEN VALUES (Dean, ruling R3, 16/09/2026): one token per crop in play at each ' +
      'value, 6 / 5 / 4 / 3, plus the wild tokens. Replaced whole. The length times the crops in ' +
      'play plus the wild count must equal the tokens the tiles hold, so a change here needs a ' +
      'matching change to wildBySeats or slotsBySeats.',
  },
  {
    template: 'island.tokens.workerOnVp',
    type: 'intArray',
    description:
      '⭐ WHICH TOKEN VALUES CARRY A WORKER (the delivery meeple), printed 3 and 4. A first ' +
      'deliverer chooses between a higher VP token and a lower one with a free plain action. ' +
      '[] seeds no Worker at all, which is the game without the delivery meeple.',
  },
  {
    template: 'island.tokens.wildBySeats.{}',
    type: 'int',
    description:
      'Wild tokens (any 2 cards) in the pool at this seat count: 0 / 2 / 4. ⚠️ BUILDER ' +
      'DEFAULT: below the number of VP values, which wild values are used is drawn at random. ' +
      'Raising it loosens the colour puzzle.',
  },
  {
    template: 'island.meeples.perColour',
    type: 'int',
    description:
      "Workers of each colour in the bag. 5 was chosen because 25 is the smallest flat pool that covers a 4-seat board's 24 old delivery spaces, which is a component argument rather than a design one. Under the token island at most 12 Workers are dealt, so the bag is never close to exhausted. Move `poolSize` with this or the two disagree and data.test.ts fails, which is what that assertion is for.",
  },
  {
    template: 'island.meeples.poolSize',
    type: 'int',
    description:
      'Total Workers in the bag. Stored rather than derived precisely so that an overlay cannot half-change the pool: it must equal perColour times the number of colours, and the test says so.',
  },
  {
    template: 'island.meeples.faceUpAtSetup',
    type: 'boolean',
    description:
      'Recorded and read by nothing: Workers are placed face up on their tokens, so the whole table can read which actions the island offers.',
  },
  {
    template: 'island.slotsBySeats.{}.{}',
    type: 'int',
    description: 'Tiles in play at this seat count and level. Sets the length of the game.',
  },
  {
    template: 'island.decksInPlayBySeats.{}',
    type: 'int',
    description:
      'Suit decks on the table at this seat count, which is also the number of crops the token pool is dealt from.',
  },

  // --- Per-card ------------------------------------------------------------
  {
    template: 'cards.catalogue.{}.enabled',
    type: 'boolean',
    description:
      'Whether this card is in the game at all. Setting it false is how a paired comparison run asks whether the game is better without the card.',
  },
  {
    template: 'cards.catalogue.{}.threshold',
    type: 'intOrNull',
    description:
      'Cards a building holds before it is full and clogged. Flat since v31: starters print one face, so a Notice Board threshold is one path and not two.',
  },
  {
    template: 'cards.catalogue.{}.activationType',
    type: 'cropOrWild',
    description:
      "The crop a GROW must pay into this building, or 'wild' for any card. null is a card " +
      'that cannot be grown at all, and setting a null one is a design change wearing a ' +
      "knob's clothes - the extractor reads null threshold plus null activation as the ACTION " +
      'card, and this knob does not move the threshold with it.',
  },
  {
    template: 'cards.catalogue.{}.printedVp',
    type: 'int',
    description: 'VP printed on a built card. 0 on all fifteen starters since v31.',
  },
  {
    template: 'cards.catalogue.{}.buildCost.suit',
    type: 'int',
    description:
      'Own-suit cards in a build cost. Since v31 this is also how the 30 Power and Endgame cards ' +
      'are paid for: their two coin icons became two crop icons of their own suit, which is one ' +
      'of the two pulls behind risk 3, the monoculture problem.',
  },
  {
    template: 'cards.catalogue.{}.buildCost.wild',
    type: 'int',
    description: 'Any-suit cards in a build cost.',
  },
];

function templateToRegExp(template: string): RegExp {
  const pattern = template
    .split('.')
    .map((segment) => (segment === '{}' ? '[^.]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('\\.');
  return new RegExp(`^${pattern}$`);
}

/**
 * Expand the templates against real data. Every returned knob addresses a leaf
 * that exists, so an empty expansion for a template means that template is dead
 * and should be deleted, not that the caller did something wrong.
 */
export function listKnobs(data: unknown): Knob[] {
  const leaves = flatten(data);
  const knobs: Knob[] = [];
  const claimed = new Set<string>();

  for (const spec of KNOB_TEMPLATES) {
    const re = templateToRegExp(spec.template);
    for (const [path, baseValue] of leaves) {
      if (!re.test(path) || claimed.has(path)) continue;
      claimed.add(path);
      knobs.push({ path, type: spec.type, description: spec.description, baseValue });
    }
  }
  return knobs;
}

/** Templates that matched nothing. A dead template is a stale registry entry. */
export function deadTemplates(data: unknown): string[] {
  const leaves = [...flatten(data).keys()];
  return KNOB_TEMPLATES.filter((spec) => {
    const re = templateToRegExp(spec.template);
    return !leaves.some((path) => re.test(path));
  }).map((spec) => spec.template);
}
