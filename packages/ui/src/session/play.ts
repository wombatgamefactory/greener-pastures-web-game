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
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Suit } from '@gp/data';
import type { CardId, Move, MoveType, PlayerView, Seat } from '@gp/engine';

import {
  IDLE,
  buildComplete,
  clickBalloon,
  clickBuilding,
  clickCardPower,
  clickDeck,
  clickHost,
  clickMeeple,
  clickTile,
  emptyBuildDraft,
  focused,
  liveTargets,
  pendingTask,
  subsetAdditions,
  subsetAnswer,
  visitComplete,
  withPayment,
} from '../view/intent';
import type { BuildDraft, Intent, Live } from '../view/intent';

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
  /** Open or re-point the visit assembly. `fee` null clears the card chosen. */
  setVisitFee(host: Seat, fee: CardId | null): void;

  building(card: CardId): void;
  /** The badge on a built card: the standing move that card is offering. */
  cardPower(card: CardId): void;
  /** A farm's Notice Board as a visit target. ⚠️ `seat` may be your own. */
  host(seat: Seat): void;
  tile(id: string): void;
  balloon(id: string): void;
  /** Spend one meeple of this colour from your own supply. */
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIntent(IDLE);
        setPicked([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
        const done = visitComplete(moves, { host: effective.host, fee: card });
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
            : picked,
      subsetKind,
      live: liveTargets(view, moves, effective),

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
      setVisitFee: (host, fee) => setIntent({ k: 'visit', host, fee }),

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
      host: (seat) => {
        if (inert) return;
        const next = clickHost(view, moves, effective, seat);
        if (next) setIntent(next);
      },
      tile: (id) => {
        if (inert) return;
        resolve(clickTile(moves, effective, id), 'Which crops?');
      },
      balloon: (id) => {
        if (inert) return;
        resolve(clickBalloon(moves, effective, id), 'Pay which two barn cards?');
      },
      meeple: (colour) => {
        if (inert) return;
        resolve(clickMeeple(moves, colour), 'Spend which meeple?');
      },
      deck: (suit) => {
        if (inert) return;
        resolve(clickDeck(moves, effective, suit), 'Which deck?');
      },
    };
  }, [active, view, moves, effective, picked, subsetKind, send, resolve]);

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
