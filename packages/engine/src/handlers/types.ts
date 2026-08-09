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
    /** Reads or writes another seat's zones or coins. */
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
   * This card's standing moves ARE the main action (the Wheat Tier 3 ACTIONs).
   *
   * Declared on the handler rather than inferred per move, because a card either
   * always spends the action or never does. Two things read it, both in game.ts:
   * `pass` must not be offered beside a live ACTION card, and `apply` must not
   * accept one. The spend itself is the handler's own job - `applyMove` sets
   * `turn.actionSpent` before it does anything - so this flag is about the
   * OTHER moves' legality, never about bookkeeping.
   */
  actionMoves?: true;

  /** Card-specific tasks, keyed by `task.kind`. Prefer the generic vocabulary. */
  tasks?: Record<string, CustomTask>;

  /** End-game VP for this card's owner. Pure; called once at scoring. */
  gameEnd?: (data: GameData, state: GameState, seat: Seat) => number;

  /**
   * This card's own rate REPLACES the coin pity for its owner (the Bread Hall,
   * per the reference). Scoring zeroes their `coinPity` line and the card's
   * `gameEnd` returns the whole value of their coins.
   *
   * It exists so the two lines reconcile on the scoring screen: encoded as a
   * delta against the pity instead, the total was right but the card printed
   * "1 VP for every £2" beside a number that was not the holder's coins over
   * two, and no player could check it.
   */
  replacesCoinPity?: true;
}
