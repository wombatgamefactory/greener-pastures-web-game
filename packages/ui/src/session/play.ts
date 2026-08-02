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
import type { Suit, WorkerAction } from '@gp/data';
import type { CardId, Move, MoveType, PlayerView, Seat } from '@gp/engine';

import {
  IDLE,
  buildComplete,
  clickBalloon,
  clickBuilding,
  clickDeck,
  clickRival,
  clickTile,
  clickWorker,
  emptyBuildDraft,
  focused,
  liveTargets,
  pendingTask,
  subsetAdditions,
  subsetAnswer,
  withBarn,
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
  /** Cards picked for a keep or discard answer. */
  readonly picked: readonly CardId[];
  /** Hand cards already committed to whatever is being assembled. */
  readonly commitments: readonly CardId[];
  /** The subset answer the current picks would send, if they are complete. */
  readonly subsetKind: 'keep' | 'discard' | null;

  send(move: Move): void;
  /** Play the one move, or open the menu when a click meant several. */
  choose(candidates: readonly Move[], title: string): void;
  cancel(): void;
  arm(type: MoveType): void;
  /** Pick a card up, put it down, add it to a payment, toggle it in a subset. */
  hold(card: CardId): void;
  startBuild(card: CardId): void;
  setDraft(draft: BuildDraft): void;
  payWithBarn(suit: Suit, delta: number): void;
  setVisitFee(host: Seat, fee: readonly CardId[]): void;

  building(card: CardId): void;
  rival(seat: Seat): void;
  tile(id: string): void;
  balloon(id: string): void;
  worker(id: WorkerAction): void;
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
  const subsetKind: 'keep' | 'discard' | null =
    !active || task === null
      ? null
      : task.t === 'discard'
        ? 'discard'
        : task.t === 'draw' && task.revealed.length >= task.see
          ? 'keep'
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
      if (intent.k === 'arm' && intent.type === 'build') {
        startBuild(card);
        return;
      }
      if (intent.k === 'build') {
        setIntent({ k: 'build', draft: withPayment(intent.draft, card) });
        return;
      }
      if (intent.k === 'visit') {
        const fee = intent.fee.includes(card)
          ? intent.fee.filter((c) => c !== card)
          : [...intent.fee, card];
        setIntent({ ...intent, fee });
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
      setIntent(intent.k === 'hold' && intent.card === card ? IDLE : { k: 'hold', card });
    };

    return {
      active,
      view,
      moves,
      intent,
      picked,
      commitments:
        intent.k === 'build' ? intent.draft.payment : intent.k === 'visit' ? intent.fee : picked,
      subsetKind,
      live: liveTargets(view, moves, intent),

      send,
      choose: resolve,
      cancel: () => {
        setIntent(IDLE);
        setPicked([]);
      },
      arm: (type) => {
        if (inert) return;
        setIntent(intent.k === 'arm' && intent.type === type ? IDLE : { k: 'arm', type });
      },
      hold,
      startBuild: (card) => {
        if (inert) return;
        startBuild(card);
      },
      setDraft: (draft) => setIntent({ k: 'build', draft }),
      payWithBarn: (suit, delta) => {
        if (intent.k !== 'build') return;
        setIntent({ k: 'build', draft: withBarn(intent.draft, suit, delta) });
      },
      setVisitFee: (host, fee) => setIntent({ k: 'visit', host, fee }),

      building: (card) => {
        if (inert) return;
        resolve(clickBuilding(moves, intent, card), 'What here?');
      },
      rival: (seat) => {
        if (inert) return;
        const next = clickRival(moves, intent, seat);
        if (next) setIntent(next);
      },
      tile: (id) => {
        if (inert) return;
        resolve(clickTile(moves, intent, id), 'Which crops?');
      },
      balloon: (id) => {
        if (inert) return;
        resolve(clickBalloon(moves, intent, id), 'Pay which two barn cards?');
      },
      worker: (id) => {
        if (inert) return;
        resolve(clickWorker(moves, intent, id), 'What here?');
      },
      deck: (suit) => {
        if (inert) return;
        resolve(clickDeck(moves, suit), 'Which deck?');
      },
    };
  }, [active, view, moves, intent, picked, subsetKind, send, resolve]);

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
