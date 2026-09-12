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
 * ⭐ THE COMMONS (09/09/2026) ADDED FIVE TEMPLATES AND DELETED NONE, WHICH IS
 * THE SHAPE THIS REGISTRY IS SUPPOSED TO HAVE. `rules.economy.commonsThreshold`
 * and `rules.economy.commonsColourMatch` are the two fallback knobs the new
 * bonus ships OFF (C10), `workers.roster.{}.actionUnderCommons` is the
 * Apiary board's Grow, and `rules.economy.commonsHarvestMin` and
 * `rules.economy.commonsHarvestTake` are the two harvest knobs Dean asked for
 * later the same day - the three commons knobs now ration three different
 * things, and the descriptions say which is which so nobody sweeps two at once. Every meeple template stays, at a value that is now
 * subjectless, because the standing rule of this project is that A BRANCH WHOSE
 * ONLY PRODUCER IS A KNOB AT ITS SHIPPED VALUE IS NOT DELETED: the meeple loop
 * and the meeple economy are controls, and the knobs are how they are reached.
 * A description that says "read only under X" is doing the work a deletion would
 * have done, and it keeps the reasoning.
 *
 * ⭐ THE COMMONS WITH COINS (Dean, 10/09/2026) ADDS SEVEN TEMPLATES AND DELETES
 * NONE, and every one of them ships at the value that turns the arm OFF.
 * `rules.economy.commonsWildPair` is D5/D7 of the commons pass finally built,
 * `rules.economy.endgameCoinCost` and `rules.economy.farmsteadCoinPower` are the
 * arm's only two coin SINKS, and the four `rules.economy.farmsteadPower.*`
 * numbers are the suit powers behind the second of them. ⚠️ THAT BLOCK WAS
 * RENAMED `rules.economy.noticeBoardPower.*` ON 10/09/2026, SO THE COINS ARM'S
 * HANDLER READS A BLOCK THAT HAS MOVED; see the note below on the notice-board
 * visit. ⛔ SOME OF THE FOURTEEN
 * TEMPLATES v31 DELETED ARE THEREFORE ADJACENT AGAIN, AND THE DIFFERENCE MATTERS:
 * `startingCoins`, `buyCost`, `marketCost`, `coinPityDivisor` and the four
 * `visitPayout` branches were FAUCETS AND A PITY RATE, which is what every coin
 * economy in this project has died of. Nothing added here mints a coin at all -
 * the only mint is `rules.turn.commonsTake` at `'coins'`, and these are two
 * sinks and four numbers. If a future session finds itself adding a second mint
 * or a third use, that is the failure repeating, not a tuning.
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
 * ⭐ DEAN'S UNCLAIMED-BOARDS VARIANT (11/09/2026) ADDS ONE TEMPLATE, RENAMES
 * NOTHING AND DELETES NOTHING. `rules.economy.unclaimedBoardsToCentre` sends the
 * Notice Board of every suit nobody is farming to the CENTRE of the table,
 * ownerless, so that with self-visiting banned every seat faces exactly FOUR
 * targets at every player count. ⭐ AND IT IS ONE TEMPLATE RATHER THAN FOUR
 * BECAUSE IT REUSES THE COMMONS: a central pile's `3+` rule is already
 * expressible as `commonsThreshold` null, `commonsHarvestMin` 3 and
 * `commonsHarvestTake` null under `rules.turn.commonsTake` `'harvest'`, so the
 * two new overlays PIN those four rather than adding leaves that would say the
 * same thing twice. A new knob that duplicates an old one is a defect, and the
 * check that it does not is in `data.test.ts`.
 *
 * ⭐ DEAN'S TWO-BOARD FIX (11/09/2026) ADDS ONE TEMPLATE AND IT IS THE FIRST
 * PER-SEAT-COUNT MAP THIS FILE HAS OUTSIDE `island.*`.
 * `rules.economy.noticeBoardsBySeats.{}` says how many Notice Boards each player
 * lays out, shipped at one each so the base changes nothing, and the arm sets
 * two at two seats only. It is a MAP rather than a boolean deliberately: it
 * matches `island.decksInPlayBySeats.{}` and `island.demandTokensBySeats.{}.*`,
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
 * ⭐ THE VILLAGE STORE COIN AND THE DELIVERY MEEPLE (Dean, 12/09/2026, ledger
 * A150 and A151) ADD TEN TEMPLATES, RENAME NOTHING AND DELETE NOTHING, AND
 * EVERY ONE OF THEM SHIPS AT THE VALUE THAT CHANGES NOTHING. Six are the coin -
 * `rules.economy.storeCoinsPerCard` and `rules.economy.coinSupplyPerPlayer` are
 * the mint and its shared supply, and `coinPaysBuild`, `coinPaysSuitCost`,
 * `coinPaysGrow` and `coinGrowOnFullBuilding` are the two sinks split into four
 * switches. Four are the meeple - `rules.turn.deliveryMeepleSpace`,
 * `meepleSpendTiming`, `meepleSpendPerTurn` and `meepleSpendDistinctColours`.
 *
 * ⛔ THREE OF THE TEN SHIP AT A VALUE THE BUILD HANDOFF GOT WRONG, AND THE
 * CORRECTION IS THE POINT OF THE SLICE. `docs/village-store-coins-handoff-2026-09-12-v1.md`
 * section 3 ships `meepleSpendTiming` at `'none'`, `meepleSpendPerTurn` at `0`
 * and reads `deliveryMeepleSpace`'s null as "no meeples". All three would have
 * changed the shipped game: `'none'` and `0` delete the v31 control's
 * turn-start meeple spend, which `packages/sim/fixtures/2p-v31-opening.json`
 * replays against, and a null that meant "none" would re-point the island's
 * seeding. `'start'`, `null` and "defer to `meeplesPerTile()`" are the inert
 * values, and INERT IS THE ONLY THING A SHIPPED VALUE IS FOR.
 *
 * ⛔ AND FOUR SWITCHES FOR TWO SINKS IS THE 05/09/2026 LESSON APPLIED BEFORE THE
 * FACT. Coins-for-Build and coins-for-Grow are two different bets, the
 * n-of-suit half is a third question and the full-building clause is the
 * strongest clause in the package; bundled, an arm that reads badly cannot say
 * which half did it. ⚠️ Nothing here is a second MINT, which is what every coin
 * economy in this project has died of: `storeCoinsPerCard` is the only faucet,
 * and if a future session finds itself adding another, that is the failure
 * repeating rather than a tuning.
 */

import { flatten } from './paths.js';
import type { Leaf } from './paths.js';

/**
 * `int` and `number` are self-explanatory. `intOrNull` covers the knobs whose
 * null disables a rule outright (the wild substitution, a threshold override, an
 * unthresholded card). `intArray` covers the island's VP schedule, which is
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
 * the codebase and fail on the other. `doorAction` (09/09/2026) was the five
 * core actions plus `grow`, which is the commons Apiary board.
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
  | 'dairyGrowsBuilt'
  | 'paymentHostChoice'
  | 'balloonReward'
  | 'doorAction'
  | 'commonsTake';

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
      'unchanged, and its "three games" is now four. ' +
      "⭐ WHICH OF THREE GAMES THIS IS, AND 'commons' IS THE SHIPPED ONE SINCE 09/09/2026 " +
      '(Dean, docs/commons-handoff-2026-09-09-v1.md, rules C1-C10). THE FIVE NOTICE BOARDS SIT ' +
      'OWNERLESS IN THE CENTRE OF THE TABLE, all five whatever suits are in play, and the bonus ' +
      "is to play any ONE card from your hand onto one of them and take that board's action: " +
      'wheat Harvest, vegetable Deliver, orchard Draw 2, apiary GROW, dairy Build. Any card, no ' +
      'colour matching, the fee EXTRA in every case, taken FIRST, and a board whose action you ' +
      'cannot legally perform is not offered. No player has a Notice Board; a farm is a ' +
      'Farmstead and a Barn. A central pile has NO THRESHOLD, so nothing is ever refused, and ' +
      'HARVEST may take a whole pile into your barn including one you fed this turn. THERE ARE ' +
      'NO MEEPLES ANYWHERE. ' +
      '⭐ WHY IT EXISTS, AND IT IS THE ONLY READING IN THIS PROJECT THAT CAME FROM A TABLE ' +
      'RATHER THAN FROM THE SIMULATOR: the meeple visit FAILED at the table. Dean, 09/09/2026 - ' +
      '"with a meeple always available the bonus was basically free". A bonus that is always ' +
      'affordable is not a decision, and the simulator had been reporting that as a healthy ' +
      "visit rate. ⚠️ SO READ THE NEW RATE AGAINST DEAN'S BAND, 30% to 60% of turns, and treat " +
      'a high number as the FAILURE MODE and not as the hook working. ' +
      "⛔ THE OTHER TWO VALUES ARE CONTROLS AND THEIR CODE IS NOT DEAD. 'card' is the v31 game " +
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
    template: 'rules.turn.commonsTake',
    type: 'commonsTake',
    description:
      "⭐ DEAN'S VARIANT (Dean, 09/09/2026), READ ONLY UNDER visitCurrency 'commons' and SHIPPED " +
      'AT harvest, the C5 rule, WHICH MUST STAY BIT-REPRODUCIBLE. His words to the engine ' +
      'session: "Your bonus action can be to place 1 card in the centre [and take that board\'s ' +
      'action], OR take all the cards on one pile (without playing a card). If you take the ' +
      'pile of cards, instead of going into the barn, they go into your HAND. So we remove the ' +
      'rule that a harvest takes the cards from one central card. Effectively we change the ' +
      'bonus action into a draw instead of a harvest." ' +
      "'harvest' is the shipped game: a central pile is reached only through the Harvest " +
      'action (own full building, or any non-empty pile per C5), whole pile into the ' +
      "harvester's BARN, rationed by commonsHarvestMin and commonsHarvestTake. " +
      "'bonus' is the variant, unrun before this pass, at " +
      'overlays/commons-take-to-hand-v1.overlay.json. TWO CHANGES, NOT ONE: (1) Harvest never ' +
      'reaches the centre - harvestOptions returns own full buildings only, so the wheat board ' +
      'is offered only when the seat already has one, and commonsHarvestMin / commonsHarvestTake ' +
      'have no subject; (2) a NEW bonus move, commonsTake { seat, board }, takes the WHOLE of one ' +
      "central pile straight to the taker's HAND, no card played, no action bought, no fee. It is " +
      "the bonus slot's other free half under 'bonus', on the same shape as bonusDraw under " +
      "'card' and collect under 'meeple': it counts as a bonus use exactly as a commons play " +
      "does, so A Helping Hand's second slot lets a seat play twice, take twice, or one of " +
      'each, never three, and under bonusTiming "start" it is only offered before the main ' +
      'action. ⭐ WHY IT EXISTS: a17 now has to watch THREE shares of a turn - PLAY (paid), TAKE ' +
      '(free) and SLOT UNSPENT - because commonsTake is a free option sharing the slot with the ' +
      'paid commons play, which is the solitaire law this project has measured under every ' +
      'currency it has shipped (a free option in the bonus slot crowds out the paid one). Watch ' +
      "the free option's share of USED slots (play + take), not of all turns, for that reading. " +
      "'spend' IS THE THIRD VALUE (Dean, 09/09/2026), READ ONLY UNDER visitCurrency 'commons' and " +
      'unrun before this pass, at overlays/commons-take-to-spend-v1.overlay.json. It REUSES THE ' +
      "SAME commonsTake MOVE as 'bonus' - no fee, no card played - but the resolution now depends " +
      'on WHICH BOARD is taken, because Dean\'s own words describe five fates, not one: "You can ' +
      'play a card to a centre card to do the bonus action. OR, you can take all the cards from a ' +
      'central pile and then use those cards to pay for a bonus action of the matching type. So, ' +
      'if you take all the cards from the Draw card, they go into your hand. All the cards on the ' +
      'Harvest go into your barn. All the cards on the Build action can be spent to do a Build. ' +
      'All the cards on the Deliver action can immediately be used to deliver (this is one to ' +
      'watch, this could be crazy). All the cards on the Grow action are used to SOW (not grow, ' +
      'that would be crazy). Any cards that cannot be used are discarded. So, if there are 3 cards ' +
      'on the build action and you build a card that costs 1, the excess are discarded - they ' +
      "don't go into your hand.\" Orchard to HAND (as 'bonus'); wheat to BARN instead of hand, " +
      'still no Harvest (D-S4); dairy ONE card from hand, paid FROM THE PILE ONLY (D-S1); ' +
      'vegetable ONE crate to a tile with room, paid FROM THE PILE ONLY, the wild substitution ' +
      'applying within the pile (D-S1 again); apiary the WHOLE pile SOWN, one card at a time in ' +
      "pile order onto the taker's own non-full buildings, a card with no legal building discarded. " +
      "Every card the chosen action does not use is DISCARDED to its own suit's pile (D-S2), never " +
      "kept, never boxed. THE FOUR BUILDER DEFAULTS, none of them Dean's ruling, named so a future " +
      'session does not mistake them for rulings: D-S1 a dairy/vegetable spend never tops up from ' +
      'hand or barn, pile only; D-S2 every unusable card is discarded, per its own suit; D-S3 a ' +
      'board is offered only if it can do something (the standing "a door that can do nothing is ' +
      'not offered" ruling) - orchard/wheat whenever non-empty, dairy only if some hand card is ' +
      'payable from the pile, vegetable only if the pile can pay a crate for a tile with a free ' +
      'space, apiary only if the taker has a non-full building; D-S4 Harvest, main or bought, ' +
      "never reaches the centre under 'spend', exactly as under 'bonus'. ⭐ EVENTS: commonsTaken " +
      "fires for the orchard and wheat legs exactly as it does under 'bonus' (board tells hand from " +
      'barn); every board, including those two, ALSO emits commonsSpent { seat, board, taken, used, ' +
      'discarded, deliveredFromCentre } once its resolution completes, which is what a17 and a18 ' +
      'read for the three-way tally and the taken/used/discarded accounting. ⚠️ BOT BLINDNESS, ' +
      'named rather than fixed: the dairy/vegetable/apiary legs reuse the plain build/deliver/sow ' +
      'task-answer kinds so their gain is priced through the normal built/delivered/cardPlaced ' +
      'events, but the SAME reuse means handSpend and barnSpend cannot tell a pile-sourced payment ' +
      'from a hand- or barn-sourced one and charge it as if it were - the same admitted ' +
      'over-valuation this file already carries for a sow from hand against a sow from a deck top. ' +
      'The wheat leg is priced correctly (the harvest rate, off commonsTaken) because it has no ' +
      'task to hide behind. ' +
      "'paid' IS THE FOURTH VALUE (Dean, 09/09/2026, dated), READ ONLY UNDER visitCurrency " +
      "'commons' and unrun before this pass, at overlays/commons-take-paid-v1.overlay.json. " +
      'Dean\'s own words: "Play a card to take a bonus action. Then play a card to take all the ' +
      'cards from a pile. The take-a-pile action just gives you all the cards on a pile into your ' +
      "hand. The card you pay goes to the discard pile.\" It is 'bonus' EXACTLY - Harvest never " +
      "reaches the centre, a take always lands the whole pile in the taker's HAND - with ONE " +
      "change: the commonsTake move now carries an optional fee, and under 'paid' that fee is " +
      "REQUIRED. One card from the hand is discarded to ITS OWN suit's pile BEFORE the take " +
      'resolves, never onto the pile it is paying to take and never boxed - so the fee can never ' +
      'be one of the taken cards, and enumerateCommonsTake offers one move per (non-empty board, ' +
      'card in hand) pair, the same shape enumerateCommons walks for the paid play. ⭐ WHY IT ' +
      "MATTERS: it is the FIRST PER-USE SINK anywhere in the commons line. 'bonus' keeps the take " +
      "free and 'spend' keeps everything the pile itself pays for, so neither ever removes a card " +
      "that was not already headed to the centre; 'paid' is the first value to burn a card that " +
      'never touches a central pile at all, on every single take. a17 keeps its PLAY / TAKE / ' +
      "SLOT UNSPENT tally (the take is still the free half's shape, just no longer free of " +
      'charge - "the take is PAID (one card to the discard) so there is no free option in the ' +
      "slot\" replaces the 'bonus' detail line about a free option), and a18 gains a TAKE FEES " +
      'DISCARDED reading and a second conservation identity: cards paid as take fees = discarded. ' +
      "Farm bypass reads 0% by construction, exactly as under 'bonus', because Harvest still " +
      'never reaches the centre. ' +
      "'coins' IS THE FIFTH VALUE (Dean, 10/09/2026, K3/K4 of " +
      "docs/commons-coins-handoff-2026-09-10-v2.md), READ ONLY UNDER visitCurrency 'commons' and " +
      'UNBUILT AND UNRUN BEFORE THIS PASS, at overlays/commons-coins-v1.overlay.json. The rule: ' +
      "the bonus slot's second option is DISCARD EVERY CARD ON ONE CENTRAL PILE to their suits' " +
      'discard piles and TAKE ONE COIN PER CARD. No card is paid, and a coin take is not offered ' +
      'on an empty pile (K5, the standing door ruling). Harvest never reaches the centre (K4, ' +
      "reversing C5), exactly as under 'bonus', 'spend' and 'paid', so commonsHarvestMin and " +
      'commonsHarvestTake have no subject and the farm bypass reads 0% by construction. ' +
      '⭐ WHY IT IS DIFFERENT FROM THE OTHER THREE TAKES, WHICH IS THE WHOLE REASON IT EXISTS. ' +
      "'bonus', 'spend' and 'paid' all sent the pile's cards somewhere a player could use them, " +
      'and every one of them ran the bonus at 74% to 89% of turns, because the cards taken paid ' +
      'for the next play. This take sends the cards OUT OF THE GAME and hands back a currency ' +
      'that cannot buy a play at all, which is the one shape none of the four measured variants ' +
      'had. Read the PLAY / COIN TAKE / SLOT UNSPENT tally a17 prints, on TURNS, against ' +
      "Dean's 30-60% band. ⛔ IT IS ALSO THE ONLY KNOB IN THIS REGISTRY THAT MINTS A CURRENCY, " +
      'and coins were deleted from this game on 02/09/2026 because every coin economy this ' +
      'project has had died of a second faucet or a pity rate. So the arm ships with EXACTLY ONE ' +
      'MINT (this) and EXACTLY TWO SINKS (rules.economy.farmsteadCoinPower and ' +
      'rules.economy.endgameCoinCost); coins score nothing, break no ties, buy no ordinary card, ' +
      'and leftover coins are dead. ⚠️ NEVER SET THIS ALONE. On its own it mints a currency ' +
      'with nothing to spend it on, which measures a slot with a free option in it and nothing ' +
      'else; the arm overlay pins both sinks, the colour gate, the wild pair, the bonus timing ' +
      'and the currency by name, which is the 05/09/2026 passenger lesson applied.',
  },
  {
    template: 'rules.turn.deliveryMeepleSpace',
    type: 'intOrNull',
    description:
      '⭐ M1 OF THE DELIVERY MEEPLE (Dean, ruled 12/09/2026, ledger A151, section 5 of ' +
      "docs/village-store-coins-2026-09-12-v2.md): WHICH OF A TILE'S DELIVERY SPACES CARRIES A " +
      'MEEPLE AT SETUP. 1 is the rule as ruled - a random meeple on every 3 VP space, index 1 and ' +
      'never index 0 - and claiming that space’s receipt claims the meeple. ' +
      '⛔ null IS THE SHIPPED VALUE AND IT DOES NOT MEAN "NO MEEPLES". It means FALL THROUGH TO ' +
      'THE EXISTING meeplesPerTile() SEEDING, UNCHANGED: the commons and the notice-board visit ' +
      'seed none, the v31 control seeds one per delivery space and the meeple loop seeds ' +
      'island.meeples.seededSpaces. That is the whole of its inertness, and a reader who assumes ' +
      'null means "none" will read this leaf as already doing half the job when it does none of ' +
      'it. ' +
      '⛔ NO BRANCH OF PLAY MAY READ THE RAW LEAF: ask tileMeepleSpaces(data), which carries the ' +
      'precedence (a non-null value wins outright, null defers to the existing seeding) and is the ' +
      'one spelling every rule must use, exactly as hostDrawOnVisitAt is for the host draw. ' +
      '⚠️ AN INDEX RATHER THAN A BOOLEAN, so space 0 can be swept if anybody ever asks. ' +
      '⭐ THE CLAIM HALF IS ALREADY BUILT, WHICH IS WHY THIS IS ONE LEAF AND NOT A SUBSYSTEM: ' +
      'IslandTileState.meeples is parallel to deliveredBy BY INDEX, so the seat at deliveredBy[i] ' +
      'took meeples[i], and Dean’s rule is the 04/09/2026 island seed meeple narrowed to ' +
      'space 1. ' +
      '⭐ WHY IT EXISTS: THE ISLAND HAS NO DECISION IN IT. Every tile is mechanically identical, ' +
      'no levels and no ascending VP, so the only island choice is "take 6 before 3" and it is the ' +
      'same every time. A random reward on the second space makes taking second a real choice ' +
      'whose value changes over the game, AND IT RESTORES THE ONLY CATCH-UP TERM THIS DESIGN EVER ' +
      "HAD, deleted with the island's seed meeple on 09/09/2026 and never replaced. " +
      '⛔ IT IS NOT THE MEEPLE THAT DIED AT A TABLE ON 09/09/2026 AND THERE IS A NUMBER FOR THAT: ' +
      'second deliveries are 37.5% of receipts and players make about 4.7 deliveries a game, so ' +
      'this mints roughly 1.8 meeples per player per game, each EARNED by taking second at a tile, ' +
      'where the rejected version seeded five per player at setup and the complaint was precisely ' +
      'that the bonus was always available. overlays/delivery-meeple-v1.overlay.json is the arm.',
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
    template: 'rules.economy.unclaimedBoardsToCentre',
    type: 'boolean',
    description:
      "⭐ DEAN'S VARIANT OF THE NOTICE BOARD VISIT (Dean, ruled 11/09/2026), SHIPPED false AND " +
      "READ ONLY UNDER visitCurrency 'noticeBoardPower', exactly as noticeBoardBlocks beside it " +
      'is. false is the shipped value: every Notice Board belongs to a player, so a suit nobody ' +
      'is farming has no board on the table at all. true SENDS THE UNCLAIMED ONES TO THE CENTRE: ' +
      'the Notice Board of every suit no player is farming sits in the middle of the table, ' +
      'ownerless, with a face-up public pile, and any seat may play a card onto it. ' +
      '⭐ IT IS RULED TOGETHER WITH A BAN ON SELF-VISITING (rules.turn.selfVisitAllowed false) ' +
      'AND THE PAIR IS ARITHMETIC RATHER THAN TASTE: five boards exist, you may never visit your ' +
      'own, so EVERY SEAT FACES EXACTLY FOUR TARGETS AT EVERY PLAYER COUNT, solo included - ' +
      "1 player 1 own / 0 rivals' / 4 central, 2 players 1 / 1 / 3, 3 players 1 / 2 / 2, " +
      '4 players 1 / 3 / 1. ' +
      '⭐ WHY IT EXISTS, MEASURED RATHER THAN ARGUED. The notice board visit was measured on ' +
      '10/09/2026 at 4,820 games per arm and the bonus slot was used on 71.2% OF TURNS against ' +
      "Dean's band of 30% to 60%, OUT OF BAND AT EVERY SEAT COUNT, with 44.4% of all visits " +
      "going to the visitor's OWN board (58.4% at two players) against v31's 22.2%. The control " +
      'that bans self-visiting fixes exactly that - 46.4% pooled, and cross-table traffic nearly ' +
      'doubles - but STARVES AT TWO PLAYERS at 29.1% of turns, below the 30% floor, because with ' +
      'self-visiting banned and only two suits in play there is exactly ONE board a seat may ' +
      'visit. This knob is the fix for the starve and it fixes it by arithmetic. ' +
      '⭐ AND IT RESTORES A STANDING DEAN RULING THE BUILT DESIGN SILENTLY BROKE: all five ' +
      'actions must exist in every game, which fails today because at two players only two ' +
      'Notice Boards are in play at all. ' +
      '⛔ THE HEADLINE RISK, AND IT IS THE NUMBER THAT DECIDES THE VARIANT: A CENTRAL BOARD ' +
      "IS SOCIALLY FREE AND A RIVAL'S BOARD IS NOT, so there is a standing incentive to prefer " +
      "the centre, and this design's whole thesis is that YOU PAY THE GIVER. If cross-table " +
      'visits FALL rather than rise, the variant has recreated the village green with an extra ' +
      'step. Read visits received per player and the own/rival/central split of every play, by ' +
      'seat count, before reading the rate. ' +
      "⚠️ IT ADDS NO CENTRE MACHINERY, WHICH IS THE POINT. A play onto a rival's board " +
      'stays the visit move and a play onto a central board is the EXISTING commons move, so the ' +
      '`3+` rule on a central pile is spelled with the commons knobs already here: ' +
      'commonsThreshold null (no cap, nothing ever refuses a play), commonsHarvestMin 3 (any ' +
      'player may harvest a pile of three cards or more and nobody may touch it below that), ' +
      "commonsHarvestTake null (the whole pile) and rules.turn.commonsTake 'harvest' (Harvest " +
      'reaches the centre at all). A HARVEST IS A HARVEST (D1, reaffirmed 11/09/2026): main ' +
      'action or bought through the Wheat board, no rules exception either way, which was ' +
      "Dean's explicit reason. " +
      '⚠️ NEVER SET IT ALONE. overlays/notice-board-visit-unclaimed-v1.overlay.json is ' +
      "Dean's variant (self-visiting OFF) and " +
      'overlays/notice-board-visit-unclaimed-self-v1.overlay.json is its paired arm (self-visiting ' +
      'ON): the variant moves TWO knobs at once, ruling in a bundle rules in the bundle ' +
      '(05/09/2026), and the four overlays form a 2x2 with notice-board-visit-v1 and ' +
      '-no-self-v1 so the two can be separated.',
  },
  {
    template: 'rules.economy.noticeBoardsBySeats.{}',
    type: 'int',
    description:
      "⭐ DEAN'S TWO-BOARD FIX (ruled 11/09/2026): HOW MANY NOTICE BOARDS EACH PLAYER LAYS OUT, " +
      "keyed by SEAT COUNT. Read only under visitCurrency 'noticeBoardPower' with " +
      'rules.turn.selfVisitAllowed false, exactly as noticeBoardBlocks and ' +
      'unclaimedBoardsToCentre beside it are. SHIPPED AT ONE EACH AT EVERY SEAT COUNT, so the ' +
      'base changes nothing; the arm sets {"2": 2, "3": 1, "4": 1}. At 2 each player lays out ' +
      "TWO boards - their own suit's, plus one more drawn AT RANDOM from the suits nobody is " +
      'farming - and the fifth board is not used. At three and four seats the arm IS ' +
      'overlays/notice-board-visit-no-self-v1.overlay.json, so the pair differs AT TWO SEATS ' +
      'ONLY and those two columns must reproduce the control on identical seeds. ' +
      '⭐ A MAP RATHER THAN A BOOLEAN, DELIBERATELY: it matches how this codebase already ' +
      'expresses a per-seat-count quantity (island.decksInPlayBySeats, ' +
      'island.demandTokensBySeats) and it lets a later pass sweep "what if three seats also got ' +
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
    template: 'rules.economy.commonsThreshold',
    type: 'intOrNull',
    description:
      '⭐ THE FIRST FALLBACK KNOB OF THE COMMONS (Dean, 09/09/2026, C10), SHIPPED OFF AT null AND ' +
      "READ ONLY UNDER visitCurrency 'commons'. null is NO CAP: a central pile takes any number " +
      'of cards, is never full, never clogs, and NOTHING IN THE GAME REFUSES A PLAY. A number n ' +
      'refuses a play onto a board already holding n cards, which makes this the only rule in ' +
      'the commons that can refuse anything - so turning it on is a real change to C4 and not a ' +
      'tuning. ⭐ WHY IT EXISTS UNRUN, WHICH IS THE WHOLE POINT OF IT: the failure the commons is ' +
      'most likely to repeat is the one the meeple visit died of at the table - the bonus reading ' +
      'AUTOMATIC. A meeple visit at least needed a meeple; a card play needs a card, and a hand ' +
      "almost always has one. Dean's band is 30% to 60% of turns, so if a17 reads above 60% - at " +
      'TWO PLAYERS first, which is where every rate in this game runs hottest - this is the ' +
      'number that answers it without redesigning the slot. ' +
      'overlays/commons-threshold-2.overlay.json is the arm. ⚠️ IT IS NOT THE v31 CLOG COMING ' +
      'BACK: a full central board shuts one of five boards to EVERYBODY including whoever filled ' +
      'it, and any player may empty it with a Harvest, which is the opposite of a board its owner ' +
      'sat on to deny the table. Sweep it with the bonus rate and the door mix together, never ' +
      'with commonsColourMatch in the same overlay - the two ration different things and a joint ' +
      'move is unattributable.',
  },
  {
    template: 'rules.economy.commonsColourMatch',
    type: 'boolean',
    description:
      '⭐ THE SECOND FALLBACK KNOB OF THE COMMONS (Dean, 09/09/2026, C10), SHIPPED OFF AND READ ' +
      "ONLY UNDER visitCurrency 'commons'. false is the shipped rule: ANY card from your hand " +
      'pays for ANY board, which is the sentence that makes the bonus one line of teach. true ' +
      "demands the card MATCH the board's suit, with two cards of any suits standing in for one " +
      "of the board's colour - the island's wild substitution rate reused rather than re-rated " +
      '(D5). ⭐ IT RATIONS A DIFFERENT THING FROM commonsThreshold, and that is why there are ' +
      'two: a threshold rations HOW OFTEN the centre can be used, matching rations WHICH BOARD a ' +
      "given hand can afford. So this is the one to reach for if the bonus RATE is inside Dean's " +
      'band but the DOOR MIX is not - today a hand of Wheat buys any board, so the mix is a taste ' +
      'rather than a constraint, and the door mix has been the reading this project has moved ' +
      'most often. ⚠️ IT PUSHES HARD ON THE MONOCULTURE FINDING (v31 risk 3): under matching, an ' +
      'own-suit hand can only ever afford its own board, so an own-crop build share already at ' +
      '83% would be the first thing to re-read. overlays/commons-colour-match-v1.overlay.json is ' +
      'the arm.',
  },
  {
    template: 'rules.economy.commonsWildPair',
    type: 'boolean',
    description:
      '⭐ THE WILD PAIR, BUILT AT LAST (Dean, 10/09/2026, K3), SHIPPED OFF AND READ ONLY UNDER ' +
      "visitCurrency 'commons' WITH commonsColourMatch ON. It means nothing on its own: with any " +
      'card paying for any board there is no colour to stand in for. false is the shipped value ' +
      'AND it is how the colour-match arm was actually measured on 09/09/2026 - D5 said two ' +
      "cards of any colours count as one card of the board's colour at the island's own " +
      'substitution rate, and D7 recorded that the arm shipped WITHOUT it, so the 34.4% of turns ' +
      'that arm read is that rule AT ITS HARSHEST and the rule Dean would write reads somewhere ' +
      'between 34.4% and the shipped 58.9%. true builds it: two cards of any colours pay one ' +
      "board of any colour and BOTH land on that board's pile, so the pile grows by two and the " +
      'payer is down two cards. ⭐ IT IS THE HIGHEST-VALUE SINGLE RUN ON THE LIST AND HAS BEEN ' +
      'SINCE 09/09/2026: it is the only way anybody has of landing the bonus rate in the MIDDLE ' +
      "of the band rather than at one end of it. ⚠️ READ THE PAIR'S SHARE OF ALL PLAYS as the " +
      'pressure gauge rather than the rate alone - under about a fifth and the colour keying is ' +
      'doing its work, over about half and the matching rule is a tax everybody is paying ' +
      "around. ⚠️ AND WATCH BRANCHING: pairs are C(h,2) per board, so at the engine's hand " +
      'bound of 7 that is 21 per board and 105 a turn, well under the build enumerator but not ' +
      'nothing. overlays/commons-coins-v1.overlay.json turns it on and ' +
      'overlays/commons-coins-no-wild-v1.overlay.json is the paired arm that says what it is ' +
      'worth.',
  },
  {
    template: 'rules.economy.endgameCoinCost',
    type: 'intOrNull',
    description:
      "⭐ THE FIRST OF THE ARM'S TWO COIN SINKS (Dean, 10/09/2026, K15), SHIPPED OFF AT null AND " +
      "READ ONLY UNDER commonsTake 'coins', which is the only thing that mints a coin. null is " +
      'the shipped rule: the fifteen Endgame cards cost two cards of their own suit, exactly as ' +
      'v31 priced them and exactly as the fifteen Power cards still do, so each currency ends up ' +
      'with one kind of card. A number n prices an Endgame card at n COINS and no cards at all; ' +
      "the arm sets 3, which is Dean's proposed starting price rather than a measured one, and " +
      'overlays/commons-coins-endgame-price.sweep.json prices it at 2, 3 and 4. ' +
      '⛔ THE PRICE IS A RULES KNOB AND NEVER A CARD FIELD. cards.catalogue.{}.buildCost has ' +
      'exactly suit and wild and must keep having exactly those two - the coin third of it went ' +
      'with the currency on 02/09/2026, and putting it back would mean a coin price could arrive ' +
      'from a re-extract rather than from a ruling. data.test.ts asserts that shape and is the ' +
      'thing that keeps it. ⭐ WHAT IT BUYS THE DESIGN: the second monoculture pull leaves with ' +
      "it. K13 moves the Farmstead's own-crop scorer to the BARN rather than deleting it, so " +
      'this cost is the ONLY pull that goes and the prediction is a SMALL move off the 82.6% to ' +
      '83.3% own-crop build share, not a large one; a large move means the coin economy did it ' +
      'rather than the price. overlays/commons-coins-endgame-cards-v1.overlay.json is the paired ' +
      'arm that turns it back off.',
  },
  {
    template: 'rules.economy.farmsteadCoinPower',
    type: 'boolean',
    description:
      "⭐ THE SECOND OF THE ARM'S TWO COIN SINKS AND THE BIGGER RULES CHANGE (Dean, 10/09/2026, " +
      "K10-K14), SHIPPED OFF AND READ ONLY UNDER commonsTake 'coins'. false is the shipped rule: " +
      'the Farmstead is an ordinary starter that prints "Game end: 1 VP for each <CROP> card you ' +
      'have built" and does nothing during play. true makes it a BUILDING WITH NO THRESHOLD ' +
      'whose activation cost is ONE COIN - thresholdOf returns null, it is never full and never ' +
      'a sow target - and using it is a GROW taken as your MAIN ACTION, once per turn, with ' +
      'nothing placed on it: "spend a coin instead of a card". Each suit has a unique power ' +
      'worth about two plain actions, because it costs the action AND the coin. ⚠️ THE FOUR ' +
      'NUMBERS BEHIND THEM HAVE MOVED: rules.economy.farmsteadPower was renamed ' +
      'rules.economy.noticeBoardPower on 10/09/2026 and repointed to the five NOTICE BOARD ' +
      'powers, so this arm reads a block that no longer describes it and its numbers have to be ' +
      're-argued rather than inherited. ⛔ NO RENT (K14): a rival may never use your Farmstead, because a reference card ' +
      'for five rival powers is more than the five-minute teach can carry. ' +
      "⚠️ TWO CONSEQUENCES TO NAME BEFORE ANY RUN. (1) The Farmstead's own end-game scorer " +
      'MOVES TO THE BARN (K13) rather than being deleted, so the monoculture pull does NOT leave ' +
      'with it and gameEnd must score exactly what it scored before off a different card - a ' +
      'test asserting the unchanged total against the shipped commons is the cheap proof. (2) ' +
      'All five powers are SOLITAIRE, so the Farmstead adds nothing to the interaction budget ' +
      "and the whole of this design's cross-table pressure sits in the middle of the table; " +
      'read that beside the soft metric that decides all of it, whether players watch each ' +
      "other's turns. ⭐ THE READING IT OWNS is a19's Farmstead-fires-by-suit line: if one suit " +
      'fires twice as often as another the POWERS are mispriced, not the coins.',
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
    template: 'rules.economy.noticeBoardPower.dairyGrowsBuilt',
    type: 'dairyGrowsBuilt',
    description:
      "⭐⭐ RULED IN BY DEAN, 12/09/2026, AND THE BASE IS NOW 'paidWild'. The Dairy Notice " +
      "Board reads: BUILD, USING CARDS OF ANY CROPS, THEN YOU MAY GROW THE BUILDING YOU JUST " +
      "BUILT BY SPENDING ANY CARD. What the leaf selects is what happens after the Build. " +
      "'paid' immediately GROWs the building " +
      'just built, paying a matching activation card as normal, so the stack advances and the ' +
      "clog brake survives; 'paidWild' the same with the activation card wild, which is the " +
      "AVAILABILITY fix rather than a price cut; 'free' GROWs it placing NOTHING, which is V8's " +
      'clog bypass narrowed to one virgin target. ⛔ DEAD ON A THIRD OF THE DECK BY ' +
      'CONSTRUCTION: the 15 Power and 15 Endgame cards have no threshold and no activation ' +
      'type, so they cannot be Grown at all, which is what stops this becoming the cheap route ' +
      "to the Power layer. ⚠️ 'free' is the shape measured on 12/09/2026 as the coin-Grow, " +
      'which re-broke the barn glut and swelled hands; this is far narrower, once per visit on ' +
      'a building that cannot be full. Read a06 and the Tier 3 harvest rate first.',
  },
  {
    template: 'rules.economy.noticeBoardPower.wheatBarn',
    type: 'int',
    description:
      '⭐ CARDS THE WHEAT NOTICE BOARD PUTS INTO YOUR BARN AFTER ITS HARVEST (Dean, 10/09/2026, ' +
      'RULING C88: "Harvest one of your buildings, then put 1 card from your hand into your ' +
      "barn.\"). NEW, and read under visitCurrency 'noticeBoardPower'. ⛔ THE RULING IS WHY THE " +
      'KEY EXISTS AT ALL: S12\'s Wheat power was "Harvest any one of your buildings, however ' +
      'many cards are on it", which is W11 The Bakehouse WORD FOR WORD, and Dean ruled that the ' +
      "POWER moves and the CARD keeps its identity - S13's own precedent, the one that killed " +
      "the morning's Dairy and Vegetable powers for duplicating D4 and V15, applied a third " +
      'time. So the board harvests plainly and pays a card into the barn on top. ⭐ THE BARN ' +
      'CARD IS ALSO THE AVAILABILITY FIX: a seat with nothing full to harvest still gets ' +
      'something for its card, which is the same job D6 did for the commons wheat board and the ' +
      'reason no power in this set can be dead. ⚠️ It is a barn faucet that needs no building, ' +
      'so read it beside the barn glut and the farm-bypass share.',
  },
  {
    template: 'rules.economy.commonsHarvestMin',
    type: 'intOrNull',
    description:
      "⭐ DEAN'S QUESTION OF 09/09/2026, HALF ONE, AND THE BUILDING SEMANTIC OF A CENTRAL PILE. " +
      "Read only under visitCurrency 'commons' and SHIPPED OFF at null. His words: \"Can we " +
      'measure how many cards are taken when the Harvest is done against the centre cards? ' +
      "I'm interested to see if we place a threshold on the centre cards if it will reduce the " +
      'number of cards going from the centre to the barns - my target is about 30-40% of barn ' +
      'cards should come from the middle." The centre share reads 63.1% on the shipped rules. ' +
      'null IS THE SHIPPED RULE (C5): any central pile holding at least one card may be ' +
      'harvested, whole, by whoever is playing. A number n makes a pile harvestable ONLY at n ' +
      'cards or more - a pile is "full" at n exactly as a building is full at its threshold, and ' +
      'nothing may take it before then. ' +
      '⚠️ IT IS NOT commonsThreshold AND THE TWO ARE EASY TO CONFUSE: that knob caps the ' +
      'INFLOW (a pile at its cap refuses a play), this one gates the OUTFLOW (a pile below n ' +
      'refuses a harvest). The inflow cap MEASURED NO CHANGE at 2 - a centre share of 63.1% ' +
      'against 63.0% - because a central harvest already takes a median of two cards, and ' +
      'because every card played into the centre reaches a barn eventually anyway. ' +
      '⛔ D6 STOPS HOLDING UNDER THIS KNOB, which is the one behaviour change to name before a ' +
      'run. D6 is "the wheat board can never be dead": the fee lands on the pile before the ' +
      'action runs, so the fee is itself harvestable and the floor of the bonus slot is one card ' +
      'from hand into barn. Under commonsHarvestMin that holds only if the pile the fee lands on ' +
      'REACHES n, so at 3 a play onto an empty wheat board would buy a Harvest of nothing and ' +
      'the board is simply not offered unless some pile is already deep enough or the seat has a ' +
      'full building. overlays/commons-harvest-min-2, -3 and -4 are the arms.',
  },
  {
    template: 'rules.economy.commonsHarvestTake',
    type: 'intOrNull',
    description:
      "⭐ DEAN'S QUESTION OF 09/09/2026, HALF TWO, AND THE ONLY ONE OF THE THREE COMMONS KNOBS " +
      "THAT CAN REDUCE THE CENTRE'S OUTFLOW WITHOUT REDUCING PLAYS. Read only under " +
      "visitCurrency 'commons' and SHIPPED OFF at null. The target it is aimed at is Dean's, " +
      '09/09/2026: "my target is about 30-40% of barn cards should come from the middle", ' +
      'against a shipped 63.1%. ' +
      'null IS THE SHIPPED RULE (C5): a central harvest takes the WHOLE pile. A number n takes ' +
      'at most the most recently played n cards - the TOP of the pile - and leaves the rest ' +
      'standing in the centre. A pile holding fewer than n gives up all of it, so the rule is ' +
      '"at most n" and never a minimum. ' +
      '⭐ WHY THIS IS THE ONE THAT CAN WORK. The centre is a closed system: cards enter only by ' +
      'a play (C3) and leave only by a harvest (D3), so plays into the centre = cards harvested ' +
      'out + cards stranded at game end. Capping the plays (commonsThreshold) or gating when a ' +
      'pile may be taken (commonsHarvestMin) changes WHEN cards leave, not how many; leaving ' +
      'cards behind is the only rule that moves the ratio itself, because the remainder stays in ' +
      'the centre where it can be taken later or stranded at the end. ' +
      '⚠️ SO READ IT AGAINST THE CONSERVATION LINE a18 PRINTS and not off the share alone: a knob ' +
      'that hits the target by STRANDING cards has changed where the cards end up rather than ' +
      'how the centre feeds a barn, and at n=1 the centre also becomes a slower faucet for ' +
      'everybody rather than a fat prize for whoever harvests first, which is a different game ' +
      'and not only a different number. overlays/commons-take-1 and -2 are the arms.',
  },
  {
    template: 'rules.economy.storeCoinsPerCard',
    type: 'int',
    description:
      '⭐ THE VILLAGE STORE’S MINT, AND THERE IS EXACTLY ONE (V1, Dean ruled 12/09/2026, ledger ' +
      'A150, docs/village-store-coins-2026-09-12-v2.md): COINS TAKEN PER ADDITIONAL BARN CARD ' +
      'SPENT AT A DELIVERY. The arm is 1. ' +
      '⛔ 0 IS THE SHIPPED VALUE AND IT IS THE WHOLE OFF SWITCH: NOTHING IN THE GAME MINTS A COIN. ' +
      'Every coin economy this project has had died of a SECOND faucet or a pity rate, so this ' +
      'being the only mint is a property to preserve rather than a coincidence to tidy. ' +
      'THE RULE: when you make a delivery you may spend any number of additional cards FROM YOUR ' +
      'BARN (V2) and take this many coins for each, and the exchange resolves AFTER the crate is ' +
      'paid (V3), so a player can never convert the cards the delivery itself needs. ' +
      '⚠️ AN INT RATHER THAN A BOOL, so the rate can be swept without another knob, which is this ' +
      "project's established preference. " +
      '⭐ WHY IT EXISTS, AND DEAN’S OWN ARGUMENT IS THE BETTER OF THE TWO: the barn parity trap ' +
      'strands about 11 cards a player a game (88.8% of the time a player holds barn cards they ' +
      'cannot afford any open tile, 84% of those one or two cards short), and played decks ' +
      'reshuffle 7 / 6 / 4 times a game off a 12-card deck, so stranded cards SHRINK THE ' +
      'CIRCULATING POOL rather than merely sitting there. A converted card goes to the discard and ' +
      'comes back on the next reshuffle, so RESHUFFLES PER PLAYED DECK is the cleanest falsifiable ' +
      'prediction in the pass: if the Store works, that number falls. ' +
      '⛔ DO NOT BUILD THE MINT AS A SUBSET ENUMERATION. "Spend any number of cards from your ' +
      'barn" is the POWER SET of the barn and an 11-card barn offers 2,048 conversions in one task ' +
      'at every delivery. Build it as a repeated binary choice, "convert one more card, or stop": ' +
      'n sequential decisions rather than 2^n, reaching every subset by a different route. A ' +
      '116,535-move position stopped this project on 02/09/2026 and an 888,030-move one on ' +
      '05/09/2026, and both were enumerations exactly like this. ' +
      '⛔ AND coinEconomy() IN packages/engine/src/setup.ts MUST BE EXTENDED to include this above ' +
      '0 (or coinSupplyPerPlayer above 0), or the wallet will not exist when the Store is on. It ' +
      'is a serialisation question and never a rules question. ' +
      '⚠️ THE PLACEMENT IS ON TEST RATHER THAN SETTLED (C113): docs/village-store-2026-08-19-v1.md ' +
      'section 1 ruled out exactly this rider on Deliver as "no cost, so it is always correct". If ' +
      'the arm shows every player converting every spare card every time, the August verdict was ' +
      'right and the PLACEMENT is what to change. overlays/village-store-coins-v1.overlay.json is ' +
      'the assembled arm and pins every passenger by name.',
  },
  {
    template: 'rules.economy.coinSupplyPerPlayer',
    type: 'int',
    description:
      '⭐ THE SHARED COIN SUPPLY, PER SEAT (V4, Dean 12/09/2026, ledger A150): the pool is this ' +
      'times the number of players, so the arm’s 5 is 10 coins at two seats and 20 at four. ' +
      'SHIPPED 0, which is inert twice over: there is no pool, and with storeCoinsPerCard also 0 ' +
      'there is nothing to put in one. ' +
      '⛔ SHARED AND CONTESTED, WITH NO PER-PLAYER HOLDING CAP: ONE PLAYER MAY HOLD ALL OF THEM. ' +
      'Spent coins RETURN to the supply and may be minted again (V5), and an empty supply mints ' +
      'nothing, so the pool is a recirculating bound on the whole economy rather than a per-seat ' +
      'allowance. That bound is also what makes the mint safe to enumerate: never more than this ' +
      'times seats conversions exist in the whole game. ' +
      '⚠️ THE SNOWBALL RISK IS REAL BUT SMALL, and the reasoning is on the record: a shared supply ' +
      'with no cap makes minting a race and a hoarded coin denies everybody else, but minting is ' +
      'keyed to DELIVERIES and the seat delivering most is Orchard, who wins least (17.4% against ' +
      "Wheat's 41.9%), so the supply flows slightly toward the seat that needs it. " +
      '⚠️ HOW OFTEN THE SUPPLY IS EMPTY IS ONE OF THE PASS’S OWN READINGS and is C113’s test from ' +
      'the other side: a supply that never empties is a supply that is rationing nothing. ' +
      '⚠️ SOLO IS NOT MODELLED AT ALL and would size the pool at 5.',
  },
  {
    template: 'rules.economy.coinPaysBuild',
    type: 'boolean',
    description:
      '⭐ THE FIRST COIN SINK: A COIN IS A WILD CARD FOR BUILD (V6, Dean 12/09/2026, ledger A150). ' +
      'SHIPPED false, and read only where a coin can exist, which since 12/09/2026 means ' +
      'rules.economy.storeCoinsPerCard above 0. true lets a coin pay any or all of a build cost, ' +
      'and POWER AND ENDGAME CARDS ARE INCLUDED (V7): they cost two cards of their own suit, so ' +
      'two coins buys one. ' +
      '⛔ A SEPARATE LEAF FROM coinPaysGrow BECAUSE THEY ARE TWO DIFFERENT BETS: Build converts ' +
      'barn into TABLEAU, Grow converts barn into repeatable ABILITIES and deliberately suppresses ' +
      'harvesting. If they go in together and the arm reads badly, nobody will know which did it, ' +
      'which is the 05/09/2026 passenger lesson applied before the fact instead of after it. ' +
      'overlays/village-store-coins-build-only-v1.overlay.json is the arm that isolates it. ' +
      '⚠️ IT IS ALSO THE BRANCHING RISK OF THE WHOLE PACKAGE. Build payments are already ' +
      'C(hand, k), and coins add every split of j coins and k-j cards, so the count becomes a sum ' +
      'of binomials. ⭐ COINS ARE FUNGIBLE, SO THE ENUMERATOR MUST TREAT THE COIN COMPONENT AS A ' +
      'COUNT AND NEVER AS A CHOICE OF WHICH COINS - getting that wrong is the single easiest way ' +
      'to blow the simulator up. Run the branching bench before and after and quote seconds per ' +
      'game beside both move populations (C99).',
  },
  {
    template: 'rules.economy.coinPaysSuitCost',
    type: 'boolean',
    description:
      '⭐ THE n-OF-SUIT HALF OF V6, SPLIT OFF rules.economy.coinPaysBuild ON PURPOSE (Dean, ' +
      '12/09/2026, ledger A150). SHIPPED false. true lets a coin pay a build cost’s SUIT ' +
      'REQUIREMENT and not only its wild slots, so three coins pays "2 apples and a wild". ' +
      '⛔ TWO LEAVES BECAUSE "COINS PAY WILD COSTS ONLY" AND "COINS PAY EVERYTHING" ARE ' +
      'MEANINGFULLY DIFFERENT GAMES AND IT IS ONE RUN TO FIND OUT. Read only with coinPaysBuild ' +
      'on: a coin that pays a suit requirement but not a build is not a rule anybody has proposed. ' +
      'overlays/village-store-coins-wild-only-v1.overlay.json is the arm that turns this half off ' +
      'while leaving the rest of the coin standing. ' +
      '⭐ AND IT IS THE FIRST THING PROPOSED THAT PUSHES AGAINST THE MONOCULTURE PULL: own-crop ' +
      'build share has sat near 83% (82.6% before v31, 83.3% after), and a wild that pays a suit ' +
      'requirement is what makes off-crop building and off-suit Powers cheap. THE OWN-CROP BUILD ' +
      'SHARE IS THEREFORE A READING THIS LEAF OWNS, not a background number.',
  },
  {
    template: 'rules.economy.coinPaysGrow',
    type: 'boolean',
    description:
      '⭐ THE SECOND COIN SINK: A COIN IS A WILD CARD FOR GROW (V8, Dean 12/09/2026, ledger A150). ' +
      "SHIPPED false. true lets a coin stand in for a building's activation card. " +
      '⛔ THE COIN PLACES NOTHING, so the building does not advance toward its threshold and never ' +
      'clogs, cards that trigger on a PLACEMENT do not fire (A16 The Beekeeper’s Veil is the ' +
      'obvious one) and A21 The Wax Hall does not count a building held empty this way. ⭐ It DOES ' +
      'fire the building’s "when activated" ability, because that is the whole point of a Grow ' +
      '(D5), and a reader may assume otherwise precisely because no card lands. ' +
      '⭐ THE BEST PROPERTY OF THE DESIGN IS THAT IT IS SELF-LIMITING: a building you only ever ' +
      'coin-Grow never fills, so it is never harvested, so it never puts cards in your barn - and ' +
      'barn cards are what make coins. Spending coins to dodge clog starves the supply of the ' +
      'material that makes coins. ⭐ AND COINS CANNOT MULTIPLY ACTIONS: a coin changes what a Grow ' +
      'COSTS, never how many you get, so with the fire-once-per-turn guard the ceiling is two ' +
      'coin-Grows a turn and never the same building twice. ' +
      '⚠️ isFull AND isHarvestable STOPPED BEING THE SAME BOOLEAN ON 10/09/2026 (S8), so whoever ' +
      'writes the legality check must read which one a Grow actually wants rather than assuming ' +
      'they still agree. overlays/village-store-coins-grow-only-v1.overlay.json is the arm that ' +
      'isolates this bet from the Build one.',
  },
  {
    template: 'rules.economy.coinGrowOnFullBuilding',
    type: 'boolean',
    description:
      '⭐ V9, AND IT IS THE STRONGEST SINGLE CLAUSE IN THE PACKAGE (Dean, ruled 12/09/2026, ledger ' +
      'A150): MAY A COIN-GROW TARGET A FULL BUILDING? SHIPPED false. true is THE FIRST CLOG BYPASS ' +
      'IN THIS GAME SINCE THE MEEPLES, ruled in deliberately - Dean’s reason is that if you go ' +
      'through all the effort of getting cards in your barn, the reward should be awesome. ' +
      '⛔ NO BRANCH OF PLAY MAY READ THE RAW LEAF: ask coinGrowReachesFullBuildings(data), which ' +
      'carries the precedence that this is MEANINGLESS unless rules.economy.coinPaysGrow is on. A ' +
      'full-building Grow that no coin can pay for is not a rule, and a check reading this leaf ' +
      'alone is right until somebody runs the build-only arm and silently wrong after. That is the ' +
      'hostDrawOnVisitAt precedent of 12/09/2026 and the hostGift seam of the same day, which was ' +
      'a term reading a rule off the wrong accessor and pricing a decision that could not happen. ' +
      '⛔ A SEPARATE LEAF FROM coinPaysGrow BECAUSE IT IS THE HALF MOST LIKELY TO BE THE PROBLEM, ' +
      'and an arm that bundles it cannot say so. Expect the board mix to move with it: the Apiary ' +
      'board’s bought Grow reaches a full building by the same clause, and Apiary is at 12% of ' +
      'plays today. ' +
      '⛔ AND THE TIER 3 LAYER NEEDS RE-PRICING AGAINST IT (C110): the cost/threshold curve is ' +
      'inverse ON PURPOSE, expensive low-threshold buildings are strong BECAUSE clog is their ' +
      'brake, and a repeatable currency that removes the brake changes what every Tier 3 is worth. ' +
      'Card balance, not a reason to reopen the rule and not a reason to hold up the arm. ' +
      '⚠️ A MEEPLE GROW IS THE OPPOSITE AND THE TWO DIFFER ON PURPOSE (M8): it places its ' +
      'activation card as normal and CAN clog.',
  },
  {
    template: 'rules.endGame.furtherTurnsEach',
    type: 'int',
    description: 'Turns each other player takes after the game-end trigger.',
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
    template: 'workers.roster.{}.actionUnderCommons',
    type: 'doorAction',
    description:
      '⭐ THE APIARY BOARD BUYS A GROW, NOT A SOW (Dean, 09/09/2026, C3), and it is the one door ' +
      "whose ACTION the commons changed. Read only under visitCurrency 'commons'. It is a SECOND " +
      'PRINTED PAYLOAD beside `action`, exactly as drawUnderMeepleCurrency sits beside draw, and ' +
      'that shape is load-bearing: `action` is NOT in this registry, so if the commons had simply ' +
      'overwritten it the v31 and meeple controls could not have pinned their Sow back. A knob is ' +
      'how a control keeps what the default moved - the 05/09/2026 passenger lesson, one level ' +
      'down. ⭐ WHY GROW: a Sow through the door was the weakest thing on the table (a visitor ' +
      'paid a card onto the board and a SECOND card into the sow, for one threshold step), and ' +
      'the Grow at least hands back an ability for its activation card. The fee is still extra ' +
      'and there is NO clog bypass - that was the meeple-paid Grow of R15 and it went with the ' +
      'meeples. It also settles, for the commons only, the disagreement CLAUDE.md carries ' +
      'between the player aid (orange buys GROW) and the engine (orange bought SOW). ' +
      "Setting it back to 'sow' is the paired arm and nobody has run one.",
  },
  {
    template: 'workers.roster.{}.sow.amount',
    type: 'int',
    description:
      '⚠️ READ ONLY BY THE TWO CONTROLS SINCE 09/09/2026: under the commons the Apiary board buys ' +
      'a GROW (workers.roster.{}.actionUnderCommons), so nothing in the shipped game sows through ' +
      'a door at all. ' +
      'Cards the Apiary door sows. It sows FROM THE HAND in v31, so a visitor pays 2 cards for 1 ' +
      'threshold step and this is the weakest door on the table by some distance - ruled that way ' +
      'knowingly. If the Apiary board takes no traffic, the fix is the source (back to a deck top), ' +
      'not this number.',
  },

  // --- The island ----------------------------------------------------------
  {
    template: 'island.vpByDeliveryOrder',
    type: 'intArray',
    description:
      "The flat island in one array: entry i is the VP the (i+1)th delivery to a tile takes, and the length is how many deliveries a tile accepts. [6, 3] is the game's only remaining time gradient - first to a tile is worth double second - and it replaced both the 4/8/16 level VP and the fill-order bonus strip. Replaced whole: shortening it closes a delivery space, lengthening it opens one and forces both the new price AND a third meeple out of a 25-deep bag to be found in the same edit.",
  },
  {
    template: 'island.cardsPerSubstitution',
    type: 'intOrNull',
    description:
      'Cards of any crops that stand in for one card the island asked for. null restores exact matching, which is the control arm. This is the dial on the barn queue: ticket 38 proved the block is MATCHING under an all-or-nothing crate payment, not quantity, so this is the only lever that touches the actual cause. Lower is looser - at 2 the colour puzzle survives because matching is still cheaper, and the rate self-scales because only a big barn can afford to substitute.',
  },
  {
    template: 'island.tileRule.crates',
    type: 'int',
    description: 'Crates printed on every tile. Each crate carries one suit demand token.',
  },
  {
    template: 'island.tileRule.cardsPerCrate',
    type: 'int',
    description:
      'Barn cards of the matching suit that pay one crate. Total tile cost is crates times this, so 4 at every tile. The pair, not the tile, is the unit a player reads.',
  },
  {
    template: 'island.meeples.perColour',
    type: 'int',
    description:
      '⛔ NO SUBJECT UNDER THE COMMONS (09/09/2026, C6): there are no meeples in the shipped ' +
      'game, meeplesPerTile() returns 0 and the island seeds none, so every knob under ' +
      "island.meeples is read only under visitCurrency 'card' or 'meeple' and moves nothing " +
      'unless a control overlay is on. ' +
      "Meeples of each colour in the bag. 5 was chosen because 25 is the smallest flat pool that covers a 4-seat board's 24 delivery spaces, which is a component argument rather than a design one - so it is untested in every sense. CONSEQUENCE TO READ FIRST: 24 of 25 are drawn at 4 seats, so the island's colour mix is nearly deterministic there, while at 2 seats only 12 are drawn and it is a genuine sample. Move `poolSize` with this or the two disagree and data.test.ts fails, which is what that assertion is for.",
  },
  {
    template: 'island.meeples.poolSize',
    type: 'int',
    description:
      '⛔ NO SUBJECT UNDER THE COMMONS (09/09/2026, C6): there are no meeples in the shipped ' +
      'game, meeplesPerTile() returns 0 and the island seeds none, so every knob under ' +
      "island.meeples is read only under visitCurrency 'card' or 'meeple' and moves nothing " +
      'unless a control overlay is on. ' +
      'Total meeples in the bag. Stored rather than derived precisely so that an overlay cannot half-change the pool: it must equal perColour times the number of colours, and the test says so.',
  },
  {
    template: 'island.meeples.perDeliverySpace',
    type: 'int',
    description:
      '⛔ NO SUBJECT UNDER THE COMMONS (09/09/2026, C6): there are no meeples in the shipped ' +
      'game, meeplesPerTile() returns 0 and the island seeds none, so every knob under ' +
      "island.meeples is read only under visitCurrency 'card' or 'meeple' and moves nothing " +
      'unless a control overlay is on. ' +
      'Meeples seeded onto each island delivery space at setup. At 1 the bag is drained to 12 / 18 / 24 by seat count; at 2 a 4-seat board would need 48 and the bag does not hold them, so raising this means raising the pool in the same overlay.',
  },
  {
    template: 'island.meeples.seededSpaces',
    type: 'intArray',
    description:
      '⛔ NO SUBJECT UNDER THE COMMONS (09/09/2026, C6): there are no meeples in the shipped ' +
      'game, meeplesPerTile() returns 0 and the island seeds none, so every knob under ' +
      "island.meeples is read only under visitCurrency 'card' or 'meeple' and moves nothing " +
      'unless a control overlay is on. ' +
      'WHICH delivery spaces carry a meeple under the MEEPLE ARM, as indices into ' +
      "vpByDeliveryOrder; the 'card' game keeps reading perDeliverySpace and is untouched. " +
      '[1] is the rule (R12): the 3 VP second delivery carries the tile’s only meeple and the ' +
      '6 VP first pays VP alone. A list rather than a count because perDeliverySpace could say ' +
      'how many but never WHICH, and which is the design - meeples recirculate under the arm, ' +
      'so the island tops the loop up on the slower half of the race. [] seeds none, which is ' +
      'the control for whether the island still needs to pay meeples at all.',
  },
  {
    template: 'island.meeples.faceUpAtSetup',
    type: 'boolean',
    description:
      '⛔ NO SUBJECT UNDER THE COMMONS (09/09/2026, C6): there are no meeples in the shipped ' +
      'game, meeplesPerTile() returns 0 and the island seeds none, so every knob under ' +
      "island.meeples is read only under visitCurrency 'card' or 'meeple' and moves nothing " +
      'unless a control overlay is on. ' +
      "True: every delivery space's meeple is visible from setup, so the whole table can read which actions the island is offering and in what order before anybody delivers. That legibility is the point of the component, and false is the arm that asks how much of the meeple's pull is the information rather than the action.",
  },
  {
    template: 'island.slotsBySeats.{}.{}',
    type: 'int',
    description: 'Tiles in play at this seat count and level. Sets the length of the game.',
  },
  {
    template: 'island.decksInPlayBySeats.{}',
    type: 'int',
    description: 'Suit decks on the table at this seat count.',
  },
  {
    template: 'island.demandTokensBySeats.{}.perSuit',
    type: 'int',
    description: 'Demand tokens per suit in the pool.',
  },
  {
    template: 'island.demandTokensBySeats.{}.wild',
    type: 'int',
    description: 'Cornucopia (wild) tokens in the pool. Raising this loosens the colour puzzle.',
  },

  // --- The aerodrome -------------------------------------------------------
  {
    template: 'aerodrome.moveCost.barnCards',
    type: 'int',
    description: 'Barn cards, of differing suits, spent to move a balloon.',
  },
  {
    template: 'aerodrome.handMoveCost',
    type: 'int',
    description:
      "Cards discarded from HAND by the alternative flight payment Vegetable's Depots print (V4, V8). The base barn cost is untouched and this is a second route in, not a discount. Its number was set when the game had a hand limit and a draw-and-discard, and v31 has neither, so the measurement behind it (flights 0.54 -> 1.22 at n=1580) was taken in a game where hand cards were dearer than they are now. Re-read before trusting it.",
  },
  {
    template: 'aerodrome.balloons.{}.reward.type',
    type: 'balloonReward',
    description:
      '\u2b50 WHAT A BALLOON PAYS, as a type rather than a size. Added 03/09/2026 so that a ' +
      'reward can be REPLACED by an arm and not only resized, which is what the Vegetable question ' +
      'needs: sweeping the amounts from 1 to 8 moved the Vegetable win rate by 0.7 of a point and ' +
      'left its three intervals overlapping, so magnitude is measurably NOT the lever. ' +
      "'meepleFromBag' is the one reward denominated in ACTIONS rather than cards. \u26a0\ufe0f Changing " +
      'a type without changing `rewardText` leaves the printed card lying about itself, which ' +
      'matters for a screenshot and not for a run - the engine reads the type, the card face reads ' +
      'the text.',
  },
  {
    template: 'aerodrome.balloons.{}.reward.amount',
    type: 'int',
    description:
      'Size of a balloon reward. Matches three of the four balloons: the magenta one became "harvest any building, even if it is not full" in v31 and carries no amount, because a permission has no size.',
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
