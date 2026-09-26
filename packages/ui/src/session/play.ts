/**
 * The play controller: one object the whole component tree receives, the way it
 * already receives `zoom`.
 *
 * It owns exactly two pieces of state - the current `Intent` and the cards
 * picked for a subset answer - and turns clicks into moves by asking
 * `view/intent.ts`, which only ever filters the engine's own list. Nothing here
 * decides legality, and there is deliberately no path that constructs a move:
 * `send` is only ever handed an object that came out of `legalMoves`.
 *
 * Every applied move resets the interaction. That is not tidiness - a task can
 * appear mid-effect and change what a click means, so carrying an intent across
 * a move would let a stale selection point at a target that no longer exists.
 *
 * ⭐ THREE ASSEMBLIES SHARE ONE SHAPE (18/09/2026): build, visit and, since
 * 2.5.1, deliver. Each has a draft type in `view/intent.ts`, a `setXDraft`/
 * `setXFee` setter here that opens or re-points it, and a panel that reads the
 * draft back and narrows it one click at a time. `hold` is where a HAND card's
 * click is routed to whichever of these (if any) is open; `tile`/`host` are
 * where a BOARD component's click is.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Suit } from '@gp/data';
import type { CardId, Move, MoveType, PlayerView, Seat } from '@gp/engine';

import type { ActionGroup } from '../view/moveText';
import {
  IDLE,
  buildComplete,
  clickBuilding,
  clickCardPower,
  clickDeck,
  clickHandCard,
  clickHost,
  clickMeeple,
  deliverFamilyClick,
  deliverStart,
  emptyBuildDraft,
  focused,
  liveTargets,
  pendingTask,
  subsetAdditions,
  subsetAnswer,
  visitComplete,
  visitHosts,
  withPayment,
} from '../view/intent';
import type { BuildDraft, DeliverDraft, Intent, Live } from '../view/intent';
import { useEscapeKey } from './escape';

export interface Play {
  /** True when the decision is yours. Every click handler is inert otherwise. */
  readonly active: boolean;
  readonly view: PlayerView;
  readonly moves: readonly Move[];
  readonly intent: Intent;
  readonly live: Live;
  /** Cards picked for a keep answer. */
  readonly picked: readonly CardId[];
  /** Hand cards already committed to whatever is being assembled. */
  readonly commitments: readonly CardId[];
  /** The subset answer the current picks would send, if they are complete. */
  readonly subsetKind: 'keep' | 'discard' | null;

  send(move: Move): void;
  /** Play the one move, or open the menu when a click meant several. */
  choose(candidates: readonly Move[], title: string): void;
  cancel(): void;
  /**
   * Arm a family so its targets light up. `self` splits the visit's two
   * families: a card on a neighbour's board and a card on your own are the same
   * move type and opposite acts, so the bar arms one or the other and never
   * both at once.
   */
  arm(type: MoveType, self?: boolean): void;
  /** Pick a card up, put it down, add it to a payment, toggle it in a subset. */
  hold(card: CardId): void;
  startBuild(card: CardId): void;
  setDraft(draft: BuildDraft): void;
  /**
   * Open or re-point the visit assembly. `fee` null clears the card chosen.
   * `board` names one of the host's Notice Boards (2.2.1) - only ever present
   * for a two-player host holding two; every other seat needs none.
   */
  setVisitFee(host: Seat, fee: CardId | null, board?: CardId): void;
  /**
   * Open, re-point or narrow the deliver assembly (2.5.1, 2.5.2).
   *
   * ⚠️ OPTIONAL ONLY SO AN OLDER HAND-WRITTEN `Play` FIXTURE STILL TYPECHECKS
   * (`components/play.test.tsx`'s `staticPlay`, owned by the test-rewrite
   * pass). `usePlay` below always provides it; `DeliverPanel` is the one
   * caller and is written as if it always exists.
   */
  setDeliverDraft?(draft: DeliverDraft): void;

  /**
   * B18 (25/09/2026): true once your action this turn was one that revealed
   * something new to look at - a Draw's cards, or a Harvest that might carry a
   * When-Harvested hook - and still true until you end your turn or a fresh
   * one starts for you. `ActionBar.tsx` reads it to give End turn a "ready"
   * look rather than treating it exactly like Grow's plain, nothing-to-see
   * completion. It is read-only state, never a gate: End turn is unaffected
   * when this is false, and nothing here ever sends a move on its own -
   * B18 asks for no AUTO-pass, only a clearer invitation to the one the
   * player still has to click.
   */
  readonly revealed: boolean;

  building(card: CardId): void;
  /** The badge on a built card: the standing move that card is offering. */
  cardPower(card: CardId): void;
  /**
   * A farm's Notice Board as a visit target. ⚠️ `seat` may be your own.
   * `board` names WHICH board (2.2.1); pass it when the rail is offering one
   * of a two-player host's two, and leave it out for every other seat.
   */
  host(seat: Seat, board?: CardId): void;
  /** An island tile: starts (or continues) a delivery. */
  tile(id: string): void;
  /** Spend one Worker of this colour from your own supply. */
  meeple(colour: Suit): void;
  deck(suit: Suit): void;
}

export interface PlayHost {
  readonly view: PlayerView;
  readonly moves: readonly Move[];
  readonly active: boolean;
  /** Bumped by the session on every applied move; resets the interaction. */
  readonly revision: number;
  send(move: Move): void;
}

export function usePlay(host: PlayHost): Play {
  const [intent, setIntent] = useState<Intent>(IDLE);
  const [picked, setPicked] = useState<readonly CardId[]>([]);
  const { view, moves, active, revision, send: sendMove } = host;

  useEffect(() => {
    setIntent(IDLE);
    setPicked([]);
  }, [revision]);

  /**
   * B18 (25/09/2026): "ready to end turn". See the `Play.revealed` doc for
   * what it means; this is only where it is tracked.
   *
   * Reset on the transition INTO your turn (inactive to active), which is the
   * one moment the flag from a turn already gone must not survive into the
   * next - a fresh turn-top has revealed nothing yet, whatever the last one
   * ended on. Comparing `active` on a ref rather than trusting `revision`
   * alone: `revision` bumps on every move in the game, including every one of
   * a bot's, and resetting on all of those would clear the flag out from under
   * the very render that just set it (a bot's move is what usually makes the
   * decision come back to you in the first place - see `App.tsx`'s stepper).
   */
  const wasActive = useRef(active);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (active && !wasActive.current) setRevealed(false);
    wasActive.current = active;
  }, [active]);

  /*
   * 25/09/2026 (WP5 item 3): `useEscapeKey`, not a plain `window` bubble
   * listener - see `session/escape.ts`'s header for the CookieYes race this
   * wins outright. This is the BOTTOM of the escape stack: it is always
   * active (an assembly's own cancel has nowhere else to go), so any dialog
   * that pushes its own handler while it is open - `TurnSummary`, `KeyHelp`,
   * `HowToPlay`, the island overlay - sits above it and answers Escape first,
   * exactly as it did when Table.tsx's overlay effect and this one were two
   * independent `window` listeners racing on registration order.
   */
  useEscapeKey(() => {
    setIntent(IDLE);
    setPicked([]);
  }, true);

  const task = pendingTask(view);

  /**
   * A build TASK is the one task with no in-place gesture to answer it. Its
   * answers name a card in the HAND, and a hand click means "pick up" - so
   * without this the prompt says "Build a card from your hand", the card lifts
   * out of the fan, and nothing anywhere will take it. Treating the task as a
   * pre-armed Build hands it to the surface that already does this job: the
   * same glow, the same panel, the same send path as the main action.
   *
   * Derived rather than stored, so it cannot be escaped away - a forced task
   * has nothing to cancel back to - and cannot fight the intent reset.
   */
  const armBuildTask = active && intent.k === 'idle' && task?.t === 'build';
  const effective = useMemo<Intent>(
    () => (armBuildTask ? { k: 'arm', type: 'build' } : intent),
    [armBuildTask, intent],
  );

  /**
   * ⭐ THE DISCARD BRANCH IS BACK (02/09/2026), WITH THE HAND LIMIT.
   *
   * The keep half is currently degenerate - Draw is see 2 keep 2, so there is
   * one subset and the surface plays it on the first click - and the discard
   * half is where the real toggling happens: a hand two over the limit offers
   * every pair, and the player picks which two go.
   *
   * Both are answered by clicking cards in the fan, which is why they share one
   * kind rather than being two branches: the difference is entirely in the
   * prompt's wording, and `taskPrompt` carries it.
   */
  const subsetKind: 'keep' | 'discard' | null =
    !active || task === null
      ? null
      : task.t === 'draw' && task.revealed.length >= task.see
        ? 'keep'
        : task.t === 'discard'
          ? 'discard'
          : null;

  const send = useCallback(
    (move: Move) => {
      // B18: a Draw's reveal or a Harvest's stack (which may carry a
      // When-Harvested hook) are what "new information" means here; a task
      // answer completing a draw's keep counts the same as the draw that
      // opened it, since that is the moment the cards actually arrive. Ending
      // the turn is the one send that always clears it, whatever else is true.
      if (
        move.type === 'draw' ||
        move.type === 'harvest' ||
        (move.type === 'task' && (move.answer.kind === 'keep' || move.answer.kind === 'deck'))
      ) {
        setRevealed(true);
      } else if (move.type === 'endTurn') {
        setRevealed(false);
      }
      sendMove(move);
      setIntent(IDLE);
      setPicked([]);
    },
    [sendMove],
  );

  /**
   * A click resolves to the moves it could mean. One plays; several open the
   * generic menu rather than guessing. Zero is the normal case for anything not
   * currently a target and must stay silent.
   */
  const resolve = useCallback(
    (candidates: readonly Move[], title: string) => {
      if (candidates.length === 0) return;
      if (candidates.length === 1) {
        send(candidates[0] as Move);
        return;
      }
      setIntent({ k: 'choose', title, moves: candidates });
    },
    [send],
  );

  const play = useMemo<Play>(() => {
    const inert = !active;

    const startBuild = (card: CardId) => {
      const draft = emptyBuildDraft(card);
      // A free build (a full discount, or a coin-only price) is already complete
      // the moment the card is named, so it plays rather than opening a panel
      // with nothing to put in it.
      const done = buildComplete(moves, draft);
      if (done) send(done.move);
      else setIntent({ k: 'build', draft });
    };

    const hold = (card: CardId) => {
      if (inert) return;
      if (effective.k === 'arm' && effective.type === 'build') {
        startBuild(card);
        return;
      }
      if (effective.k === 'build') {
        setIntent({ k: 'build', draft: withPayment(effective.draft, card) });
        return;
      }
      if (effective.k === 'visit') {
        /*
         * ⭐ A CHIP CLICK IS THE WHOLE MOVE, and deliberately NOT a toggle.
         *
         * A v31 visit is a host and one card, so naming the card fully specifies
         * it - there is no payoff left to pick, which is what the panel used to
         * wait for. Making the chip a toggle instead would have two bad
         * consequences at once: it would ask for a confirm nobody would read,
         * and it would make the DRAG path worse than the click path, because a
         * card dropped on a neighbour arrives with its fee already chosen and
         * clicking that same chip would silently take it back off.
         *
         * Backing out is `cancel`, which is on the panel and on Escape. That is
         * the same exit every other assembly has.
         */
        const done = visitComplete(moves, {
          host: effective.host,
          fee: card,
          ...(effective.board !== undefined ? { board: effective.board } : {}),
        });
        if (done) send(done);
        else setIntent({ ...effective, fee: card });
        return;
      }
      if (subsetKind !== null) {
        const next = picked.includes(card) ? picked.filter((c) => c !== card) : [...picked, card];
        // Send as soon as the selection is complete AND nothing could still be
        // added. Both tasks enumerate exact-size subsets, so that is the last
        // click of a keep or a discard - but a task that would also accept a
        // bigger set waits for the confirm button rather than firing early.
        const answer = subsetAnswer(moves, subsetKind, next);
        if (answer && subsetAdditions(moves, subsetKind, next).size === 0) send(answer);
        else setPicked(next);
        return;
      }
      /*
       * ⭐ `handToBarn` (2.2.2, the Wheat and Vegetable boards' follow-up):
       * the task names a hand card and nothing else, so picking it up IS the
       * whole answer - unlike a build task, which `armBuildTask` pre-arms
       * onto the same surface, this one never opens a panel at all. Checked
       * before the generic "pick it up" fallback below, which would otherwise
       * just leave the card floating with nowhere the prompt lets it go.
       */
      const barnAnswer = clickHandCard(moves, card);
      if (barnAnswer.length > 0) {
        resolve(barnAnswer, 'Into your barn');
        return;
      }
      setIntent(effective.k === 'hold' && effective.card === card ? IDLE : { k: 'hold', card });
    };

    return {
      active,
      view,
      moves,
      intent: effective,
      picked,
      commitments:
        effective.k === 'build'
          ? effective.draft.payment
          : effective.k === 'visit'
            ? effective.fee === null
              ? []
              : [effective.fee]
            : effective.k === 'deliver'
              ? [] // barn cards, never hand cards - see `DeliverDraft.spend` (2.5.1)
              : picked,
      subsetKind,
      live: liveTargets(view, moves, effective),
      revealed,

      send,
      choose: resolve,
      cancel: () => {
        setIntent(IDLE);
        setPicked([]);
      },
      arm: (type, self) => {
        if (inert) return;
        const same = effective.k === 'arm' && effective.type === type && effective.self === self;
        setIntent(same ? IDLE : { k: 'arm', type, ...(self === undefined ? {} : { self }) });
      },
      hold,
      startBuild: (card) => {
        if (inert) return;
        startBuild(card);
      },
      setDraft: (draft) => setIntent({ k: 'build', draft }),
      setVisitFee: (host, fee, board) =>
        setIntent({ k: 'visit', host, fee, ...(board !== undefined ? { board } : {}) }),
      setDeliverDraft: (draft) => setIntent({ k: 'deliver', draft }),

      building: (card) => {
        if (inert) return;
        resolve(clickBuilding(moves, effective, card), 'What here?');
      },
      cardPower: (card) => {
        if (inert) return;
        // The Helping Hand offers one move per hand card (which card pays the
        // second visit fee), so this is nearly always the menu rather than a
        // single move - which is the right surface for it: the choice IS which
        // card you are willing to spend.
        resolve(clickCardPower(moves, card), 'Which card do you spend?');
      },
      host: (seat, board) => {
        if (inert) return;
        const next = clickHost(view, moves, effective, seat, board);
        if (next) setIntent(next);
      },
      tile: (id) => {
        if (inert) return;
        // ⭐ 2.5.1: a tile no longer resolves through the generic menu.
        // `deliverStart` sends the one legal delivery straight away, or opens
        // the assembly - `DeliverPanel` (`components/BuildPanel.tsx`) and
        // `setDeliverDraft` take it from there. Mid-assembly, further tile
        // clicks are no-ops: the token/spend buttons and cancel own the rest
        // of the decision, exactly as a second click on an armed visit host
        // does nothing once the panel is open.
        if (effective.k === 'deliver') return;
        const started = deliverStart(moves, id);
        if (started === null) return;
        if ('move' in started) send(started.move);
        else setIntent({ k: 'deliver', draft: started.draft });
      },
      meeple: (colour) => {
        if (inert) return;
        resolve(clickMeeple(moves, colour), 'Spend which Worker?'); // QA 26/09/2026: was "meeple", which a player reads
      },
      deck: (suit) => {
        if (inert) return;
        resolve(clickDeck(moves, effective, suit), 'Which deck?');
      },
    };
  }, [active, view, moves, effective, picked, subsetKind, revealed, send, resolve]);

  return play;
}

/**
 * The class that makes something look clickable, at two intensities.
 *
 * Ticket 09's rule is "glow targets, never sources", and the two-step is how
 * that survives contact with a game where almost everything is a target of
 * something. `is-live` is the quiet one - "there is a move here" - and is what
 * an idle turn wears. `is-target` is the loud one, used only once an intent has
 * narrowed the question to "where does THIS go", which is the moment a glow
 * carries information.
 */
export function mark(play: Play | undefined, live: boolean): string {
  if (!play || !play.active || !live) return '';
  return focused(play.intent) ? ' is-target' : ' is-live';
}

/**
 * Do what clicking a turn-bar family's button does: play its one move, open
 * the generic menu, or arm it so its targets light up.
 *
 * ⭐ EXTRACTED FROM `ActionBar.tsx`'s `onGroup` 25/09/2026 (WP5 item 2), so the
 * keyboard layer (`session/keys.ts`) can do exactly what a click does rather
 * than re-implementing it - both callers go through the same `Play` methods
 * (`arm`, `send`, `setVisitFee`, `setDeliverDraft`) and never construct a
 * move of their own. Nothing here reads a rule the button did not already
 * read: `group.moves` is still the only thing that decides what is legal.
 */
export function activateGroup(play: Play, group: ActionGroup): void {
  const { moves, needsTarget, type } = group;
  if (moves.length === 0) return;
  if (!needsTarget) {
    play.choose(moves, 'Which one?');
    return;
  }
  /*
   * A VISIT NARROWS ON ITS HOST, NOT ON ITS MOVE COUNT. There is one move per
   * (host, hand card) pair, so a family with five moves may still have exactly
   * one place to go - and making somebody arm a family and then click the only
   * neighbour in it is a click spent on nothing.
   */
  if (type === 'visit') {
    const hosts = visitHosts(moves);
    if (hosts.length === 1) {
      play.setVisitFee(hosts[0] as number, null);
      return;
    }
    play.arm('visit');
    return;
  }
  /*
   * ⭐ B4 (25/09/2026): DELIVER GETS ITS OWN RULE, TESTED ON ITS OWN
   * (`deliverFamilyClick`, `view/intent.ts`). See `ActionBar.tsx`'s own
   * history of this branch for why a lone legal delivery must not simply
   * play itself: a single expensive candidate opens the assembly PRE-FILLED
   * instead, so every chip already shows paid and the player still has to
   * confirm.
   */
  if (type === 'deliver') {
    const decision = deliverFamilyClick(moves);
    if (decision.k === 'send') play.send(decision.move);
    else if (decision.k === 'prefill') play.setDeliverDraft?.(decision.draft);
    else play.arm('deliver');
    return;
  }
  // One legal target: skip the arming step rather than making someone click a
  // family and then the only thing in it. Build is excluded - `startBuild`
  // (via a hand-card click while armed) only ever auto-sends a genuinely free
  // build, never one that spends a card, so it needs no guard here.
  if (moves.length === 1 && type !== 'build') {
    play.send(moves[0] as Move);
    return;
  }
  play.arm(type);
}
