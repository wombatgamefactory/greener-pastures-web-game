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
 * the codebase and fail on the other. `doorAction` (09/09/2026) is the newest -
 * the five core actions plus `grow`, which is the commons Apiary board.
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
      "the free option's share of USED slots (play + take), not of all turns, for that reading.",
  },

  // --- Economy -------------------------------------------------------------
  {
    template: 'rules.economy.noticeBoardThreshold',
    type: 'intOrNull',
    description:
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
