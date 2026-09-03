/**
 * The card handler API - the shape all 105 cards are written in, decided and
 * proven in wayfinder ticket 05.
 *
 * A handler is a static, declarative registry entry. It holds NO state (all
 * state is in GameState, all numbers in GameData) and appears in serialised
 * form nowhere - tasks and moves reference it by card id and the registry does
 * the lookup. One interface covers every card kind: an activated building uses
 * `activate`, a passive uses `on`, a standing-offer card uses `moves`, an
 * endgame card uses `gameEnd`. A card may combine capabilities.
 */

import type { GameData } from '@gp/data';

import type { CardInPlay, Fx, HookEvents, HookName } from '../fx.js';
import type { GameState, Move, Seat, Task, TaskAnswer } from '../state.js';

/**
 * Hand-assigned build effort, 1-5, plus flags that keep the score honest.
 *
 * `score` and the `asserted` flags are the author's claim; the `verified`
 * flags are re-derived by the difficulty test harness from what the handler's
 * primitives actually did, so they cannot drift from the code. A card that is
 * hard to build (4-5) is a simplification candidate; hard to build AND rarely
 * picked (per the sim) is a cut candidate - difficulty is the project's proxy
 * for teach cost.
 */
export interface Difficulty {
  /** 1 trivial gain .. 3 loops/conditions .. 5 breaks a core rule or adds moves. */
  score: 1 | 2 | 3 | 4 | 5;
  verified: {
    /** Pushes at least one task - the player gets asked something. */
    prompts: boolean;
    /** Reads or writes another seat's zones. */
    crossPlayer: boolean;
    /** Contributes standing moves to legalMoves. */
    addsMoves: boolean;
    /** Scores at game end. */
    endgame: boolean;
  };
  asserted: {
    /** Needed a brand-new primitive or hook when it was written. */
    newPrimitive: boolean;
    /** Branches on game state beyond a simple can-I guard. */
    conditional: boolean;
    /** Counts cards/buildings (per-card payouts, loops over zones). */
    counts: boolean;
    /** Suspends or re-enters another flow (nested worker use, repeat gates). */
    interrupts: boolean;
  };
  /** Reading decisions a future implementer must know, e.g. what "a honey card" means. */
  notes?: string;
}

/** A card-specific task resolver - the escape hatch for choices the generic vocabulary cannot express. */
export interface CustomTask {
  answers: (data: GameData, state: GameState, task: Extract<Task, { t: 'card' }>) => TaskAnswer[];
  resolve: (fx: Fx, task: Extract<Task, { t: 'card' }>, answer: TaskAnswer) => boolean;
}

/** A standing move a built card offers, already concrete (fee chosen, target chosen). */
export type CardMove = Extract<Move, { type: 'cardMove' }>;

export interface CardHandler {
  difficulty: Difficulty;

  /**
   * The owner-only GROW activation ("When activated ..."). Runs AFTER the
   * payment card has been placed on the stack by the grow runtime. Immediate
   * effects run inline; choices are pushed as tasks.
   */
  activate?: (fx: Fx, self: CardInPlay) => void;

  /**
   * Passive triggers, fired by the primitive funnels. The listener guards its
   * own scope (e.g. `if (event.seat !== self.seat) return` for "whenever YOU
   * harvest") - scopes vary per card and belong to the card.
   */
  on?: {
    [K in HookName]?: (fx: Fx, event: HookEvents[K], self: CardInPlay) => void;
  };

  /**
   * Standing moves this built card adds to its owner's legal moves (the
   * Helping Hand's repeat). Enumerated ONLY by legalMoves and applied ONLY by
   * apply, both via the registry, so legality keeps its single source. Return
   * fully-concrete moves - one per choice - never a move with an open slot.
   */
  moves?: (data: GameData, state: GameState, self: CardInPlay) => CardMove[];
  applyMove?: (fx: Fx, self: CardInPlay, move: CardMove) => void;

  /**
   * ⛔ `actionMoves` STOOD HERE AND IS DELETED (19/08/2026). It marked a card
   * whose standing moves WERE the main action - the Tier 3 ACTION cards - and
   * two things in game.ts read it: `pass` must not be offered beside a live
   * ACTION card, and `apply` must not accept one.
   *
   * Dean retired the concept outright: *"The concept of an ACTION was never
   * requested. They are all GROW."* All fifteen Tier 3 cards are now ordinary
   * GROW-fired buildings with a threshold, so nothing declares it. The field is
   * removed rather than left unused ON PURPOSE - a dead capability on an
   * interface is how a retired concept comes back, one handler at a time, with
   * nobody deciding to bring it.
   *
   * `handlers/actionCard.ts` (the shared `actionMove` / `actionOpen` helpers)
   * went with it, as did `actionCardMoves` in game.ts and the two rules that
   * existed only to police it.
   */

  /** Card-specific tasks, keyed by `task.kind`. Prefer the generic vocabulary. */
  tasks?: Record<string, CustomTask>;

  /** End-game VP for this card's owner. Pure; called once at scoring. */
  gameEnd?: (data: GameData, state: GameState, seat: Seat) => number;

  /**
   * ⛔ `replacesCoinPity` STOOD HERE AND IS GONE (v31). It marked a card whose
   * own rate REPLACED the coin pity for its owner - W21 The Bread Hall, "1 VP
   * for every £2" - so that scoring zeroed the holder's pity line and let the
   * card return the whole value of their coins.
   *
   * The reading it encoded outlives the currency and is why it is recorded
   * rather than simply deleted: a card that RESTATES a standing scoring rule at
   * a different rate must REPLACE that rule, never stack a delta on top of it.
   * Encoded as a delta the total was right, but the card printed a rate beside a
   * number that was not its own arithmetic, and no player at a table could check
   * the score. The coin pity went on 2026-08-03 and the currency on 02/09/2026;
   * `ScoreBreakdown` lost both `coinPity` and `coinPityReplacedBy` with it, so
   * this flag had no reader left.
   */

  /**
   * This built card takes a card that was about to be DISCARDED into its owner's
   * barn instead. Declared here rather than named in `tasks.ts` because the
   * divert seam is engine-level - it sits on the one funnel every discard goes
   * through - and the engine may not know a card id.
   *
   * ⚠️ NOTHING DECLARES IT SINCE v31. O17 The Fruit Basket was its only
   * holder, and O17's v31 text scopes itself to "a card you SPEND", which is the
   * BUILD PAYMENT funnel (`divertOrDiscard` in actions.ts) and not the draw's
   * discard funnel (`discardOrDivert` in tasks.ts) that reads this flag. The
   * declaration is kept because the seam it drives is kept: the next card that
   * prints "whenever you discard" wires itself in here and needs no engine
   * change at all.
   */
  divertsDiscard?: true;
}
