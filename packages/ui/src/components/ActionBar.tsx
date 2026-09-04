/**
 * The turn bar: what you may do, what you have already spent, and the two exits.
 *
 * It is the guided path. The fast path is picking a card up and clicking where
 * it goes, but a gateway game has to survive someone who has never seen it, and
 * "which of the five actions is this" is the first thing that has to be legible.
 * So a main action is listed whether or not it is legal, and an illegal one is
 * greyed rather than hidden: a bar that changes shape between turns teaches
 * nothing.
 *
 * Nothing here knows a rule. A family is enabled because `legalMoves` contains
 * a move of that type, and clicking it either plays the single move or arms the
 * family so its targets light up.
 *
 * ---------------------------------------------------------------------------
 * PHASE 3 (26/08/2026): THREE ZONES, NOT ONE ROW. v31: FOUR.
 *
 * The zones ARE the turn, in order, so the shape of a turn is legible off the
 * interface without being taught:
 *
 *   meeples  spend any number, one at a time, at the very START of your turn.
 *            Each performs its colour's action free and then leaves the game.
 *   bonus    one option: Draw 1, or a card on a Notice Board.
 *   action   one of Draw / Build / Grow / Harvest / Deliver.
 *   then     the exits, which spend none of the three.
 *
 * ⚠️ THE MEEPLE ZONE DRAWS NO BUTTONS AND IS NOT DECORATION. Spending a meeple
 * is done on the meeple, in your own supply, because it is a wooden piece
 * sitting in front of you - the same rule that put Freight on the balloon and
 * the card power on the card. What the zone contributes is the WINDOW: a meeple
 * may only be spent before the bonus and before the action, and once that window
 * shuts the pawns stop being clickable with nothing on screen to say why. The
 * zone head is that "why", struck through the moment the window closes, in
 * exactly the way the action and bonus heads already were.
 *
 * ⭐ THE BONUS ZONE HAS TWO VISIT BUTTONS AND THAT IS THE POINT OF THE PASS.
 * `visit` and `visit-self` are one move type with a different host, and they are
 * opposite acts - a card on a neighbour's board is the hook, a card on your own
 * is solitaire that also clogs your own door. The v31 plan's risk 2 is precisely
 * that the second quietly wins, and a single "Visit" button, however carefully
 * worded, would let a player take one thinking it was the other. Two buttons,
 * two labels, two glows, two panels, two feed lines.
 */

import type { GameData } from '@gp/data';
import type { Move, PlayerView } from '@gp/engine';
import { useEffect, useState } from 'react';

import type { Play } from '../session/play';
import { actionIcon } from '../view/art';
import { actionGroups, describeMove } from '../view/moveText';
import type { ActionGroup, TurnZone } from '../view/moveText';
import { visitHosts } from '../view/intent';
import { meepleWindowOpen } from './Supply';

/**
 * THE BONUS WINDOW, read off the view rather than imported from the engine.
 *
 * ⭐ `bonusUsed` IS A LIST SINCE v31, not a boolean, and this is where the
 * difference shows. The printed rule is one option a turn, which a boolean said
 * perfectly well; A Helping Hand grants BOTH options, so "has the slot gone" and
 * "how many are left" are two different questions. The interface cannot compute
 * the second - `bonusSlotsFor` reads a built card against the true state - so it
 * asks the move list instead, which is the same answer arrived at from the side
 * the interface is allowed to see.
 *
 * `rules.turn.bonusTiming` carries the paired controls, so the interface honours
 * the knob rather than the rule: an arm that switches the rule back must switch
 * the interface back with it or it is measuring two different games. Since
 * 03/09/2026 the shipped value is 'end' - meeples, core action, THEN the bonus -
 * so the bar's two shapes now arrive in the opposite order to the one they were
 * designed in.
 */
function bonusWindowOpen(data: GameData, view: PlayerView): boolean {
  switch (data.rules.turn.bonusTiming) {
    case 'any':
      return true;
    case 'start':
      return !view.turn.actionSpent;
    case 'end':
      return view.turn.actionSpent;
  }
}

/** Which of the bar's two shapes is on screen. */
export type BarPhase = 'bonus' | 'main';

/**
 * WHICH FAMILIES THE TWO CHOICE ZONES DRAW, as a pure function so that it can be
 * asserted without a browser.
 *
 * The acceptance number for phase 3 is `actionButtonsMain <= 8`, and the failure
 * mode hiding behind it is a move quietly becoming unplayable - which no visual
 * check would catch, and which a count on its own would not catch either. So the
 * rule is written once, here, and `play.test.tsx` asserts BOTH properties
 * against it over a corpus of real positions: that the main phase never exceeds
 * eight buttons, and that every legal move still has somewhere to be clicked.
 *
 * ⚠️ `moves.length > 0` IS THE SAFETY CLAUSE, and it appears in every branch
 * that the MAIN phase can take: a family holding a legal move always prints
 * there, so nothing in this function can make a move unclickable. The bonus
 * phase is the one place a legal family is deliberately held back, and it is
 * not a hole - it is shape (c), it predates this phase, and the skip beside it
 * is the door.
 */
export function barFamilies(groups: readonly ActionGroup[], phase: BarPhase): ActionGroup[] {
  return groups.filter((group) => {
    if (group.onBoard || group.zone === 'exit') return false;
    // The bonus phase is modal: only the slot's own families, and all of them,
    // greyed where they are not legal. That is where the slot is TAUGHT.
    if (phase === 'bonus') {
      return group.zone === 'bonus' && (group.inPlay || group.moves.length > 0);
    }
    // The main phase teaches the ACTION - the same five verbs every turn, greyed
    // where they are shut, so the row never changes shape under a learner.
    if (group.zone === 'action') return group.inPlay || group.moves.length > 0;
    // The bonus zone here is a reminder rather than a lesson: the whole set was
    // on screen one click ago, so this says only what is still in the slot.
    return group.moves.length > 0;
  });
}

/**
 * The exits. End turn is always drawn, greyed when it is not legal, because it
 * is the one control a stuck player looks for and a button that comes and goes
 * is not somewhere the eye can learn. Pass is drawn only when it is legal,
 * which is only ever when it is the only thing that is.
 */
function exitFamilies(groups: readonly ActionGroup[]): ActionGroup[] {
  return groups.filter(
    (g) => !g.onBoard && g.zone === 'exit' && (g.moves.length > 0 || g.type === 'endTurn'),
  );
}

/**
 * A zone's caption, which is also the turn state that used to need a strip of
 * its own.
 *
 * Folding the two together is the tidiest thing this phase does. The label IS
 * the state - struck through once it is spent, in the seat's own green while it
 * is still yours to spend - and the row it used to cost is a row the 40px hit
 * targets could have instead.
 */
function ZoneHead({ label, state }: { label: string; state: 'go' | 'spent' | 'idle' }) {
  return <h4 className={`zone-head zone-${state}`}>{label}</h4>;
}

export function ActionBar({
  data,
  play,
  onUndo,
  canUndo,
  waitingOn,
}: {
  data: GameData;
  play: Play;
  onUndo(): void;
  canUndo: boolean;
  /** Text for whoever the table is waiting on, when it is not you. */
  waitingOn: string | null;
}) {
  const groups = actionGroups(data, play.view, play.moves);
  const armed = play.intent.k === 'arm' ? play.intent : null;

  /**
   * THE BONUS PHASE (plan section 5.2, shape (c): modal, auto-skipped when there
   * is nothing to skip).
   *
   * Under the start-of-turn rule nothing NEEDS a skip - taking your main action
   * IS the decline, because the window is exactly "before the main action". The
   * phase is not here for legality, it is here for HONESTY: offered in one
   * undifferentiated list, the bonus silently expires the moment somebody clicks
   * Build, and players forfeit it by accident, repeatedly. A forfeited visit is
   * the hook not happening, and that is worth a click.
   *
   * ⚠️ THE SKIP IS LOCAL STATE AND NOT AN ENGINE MOVE. A `skipBonus` move would
   * be a strict no-op - a seat that skips reaches the identical state it reaches
   * by taking its action - and adding it would put a dead move type into
   * `MOVE_TYPES`, the bots' claims-union assertion and the sim's per-decision
   * enumeration, all to record a button press that changes nothing.
   */
  const bonusOpen = bonusWindowOpen(data, play.view);
  const bonusGroups = groups.filter((g) => g.zone === 'bonus');
  const bonusLive = play.active && bonusGroups.some((g) => g.moves.length > 0);
  const [skipped, setSkipped] = useState(false);
  // Reset when the window shuts, so the next turn opens its phase again.
  useEffect(() => {
    if (!bonusOpen) setSkipped(false);
  }, [bonusOpen]);
  const inBonusPhase = bonusOpen && bonusLive && !skipped;
  const phase: BarPhase = inBonusPhase ? 'bonus' : 'main';

  const families = barFamilies(groups, phase);
  const exits = exitFamilies(groups);
  const zoned = (zone: TurnZone) => families.filter((g) => g.zone === zone);
  const action = zoned('action');
  const bonus = zoned('bonus');

  /**
   * THE MEEPLE WINDOW, read the same way the bonus window is: off the move list
   * rather than off a rule this file re-implements. A `spendMeeple` in the list
   * IS the window being open for this seat - the engine gates it on
   * `!actionSpent && bonusUsed.length === 0` and additionally refuses a meeple
   * whose action could do nothing, and neither of those is a thing the interface
   * should be re-deriving.
   */
  const meepleGroup = groups.find((g) => g.zone === 'meeple');
  const meepleLive = play.active && (meepleGroup?.moves.length ?? 0) > 0;
  const meeplesHeld = Object.values(play.view.you.meeples).reduce((a, b) => a + b, 0);

  const onGroup = (group: ActionGroup) => {
    const { moves, needsTarget, type, key } = group;
    if (moves.length === 0) return;
    if (!needsTarget) {
      play.choose(moves, 'Which one?');
      return;
    }
    /*
     * A VISIT NARROWS ON ITS HOST, NOT ON ITS MOVE COUNT. There is one move per
     * (host, hand card) pair, so a family with five moves may still have exactly
     * one place to go - and making somebody arm a family and then click the only
     * neighbour in it is a click spent on nothing. The self-visit always takes
     * this branch, which is what makes "your own door" a single click.
     */
    if (type === 'visit') {
      const hosts = visitHosts(moves);
      if (hosts.length === 1) {
        play.setVisitFee(hosts[0] as number, null);
        return;
      }
      play.arm('visit', key === 'visit-self');
      return;
    }
    // One legal target: skip the arming step rather than making someone click a
    // family and then the only thing in it.
    if (moves.length === 1 && type !== 'build') {
      play.send(moves[0] as Move);
      return;
    }
    play.arm(type);
  };

  /**
   * `kind` is the zone's costume, not a second idea of what the button is: an
   * exit is drawn quietly because it takes you OUT of the turn, and drawing End
   * turn with the same weight as Build is how the old flat row managed to make
   * the most consequential button on the bar look like the seventh option.
   */
  const button = (group: ActionGroup, kind: 'action' | 'exit' = 'action') => {
    const enabled = play.active && group.moves.length > 0;
    const title =
      group.moves.length === 1
        ? describeMove(data, play.view, group.moves[0] as Move)
        : `${group.hint}${group.moves.length > 0 ? ` (${group.moves.length} ways)` : ''}`;
    /*
     * THE ICON, AND WHY ONLY SOME BUTTONS GET ONE (27/08/2026, Dean).
     *
     * `actionIcon` returns null for a family with no painting. The six
     * paintings are cut out of the printed player aid, so a family gets one
     * exactly when the aid has a vignette for it - inventing a seventh would put
     * a drawing on the table that is not in the box. That leaves the exits, the
     * bonus Draw 1 and, usefully, THE SELF-VISIT without one: the aid's `visit`
     * vignette is a farmer walking to a neighbour's farm, which is a picture of
     * the hook and not a picture of feeding your own board. So the two visit
     * buttons differ in weight as well as in words, and the illustrated one is
     * the one that puts you on somebody else's farm.
     *
     * ⚠️ `alt=""` PLUS `aria-hidden` IS DELIBERATE AND IS NOT BELT-AND-BRACES.
     * The picture is decorative here: the action's NAME is right beside it in
     * the same button, so any alt text at all makes a screen reader say "Build,
     * Build".
     */
    const icon = actionIcon(group.key);
    const isArmed =
      armed !== null &&
      armed.type === group.type &&
      (group.type !== 'visit' || armed.self === (group.key === 'visit-self'));
    return (
      <button
        key={group.key}
        type="button"
        className={`${kind}${isArmed ? ' action-armed' : ''}${
          group.key === 'visit' ? ' action-hook' : ''
        }${group.key === 'visit-self' ? ' action-solo' : ''}`}
        disabled={!enabled}
        title={title}
        onClick={() => onGroup(group)}
      >
        {icon !== null && <img className="action-icon" src={icon} alt="" aria-hidden="true" />}
        <span className="action-name">{group.label}</span>
      </button>
    );
  };

  const { turn } = play.view;
  /*
   * THE TRAFFIC LIGHT, and the palette constraint that shapes it. Green is
   * `--seat-pip` - the seat's own colour, already carried by the farm's top
   * edge, the receipts and the pips - and red is the `#a2493a` the clog flag and
   * the over-full stack already wear. There is no blue and there is not going to
   * be one: this is a printed cream-and-sepia palette and a blue "primary"
   * button is the single fastest way to make it look like a web form.
   */
  const bonusTaken = turn.bonusUsed.length > 0;
  const actionState = turn.actionSpent ? 'spent' : phase === 'main' && play.active ? 'go' : 'idle';
  const bonusState =
    !bonusOpen || (bonusTaken && bonus.length === 0)
      ? 'spent'
      : phase === 'bonus' && play.active
        ? 'go'
        : 'idle';
  /*
   * FOUR STATES, AND EACH ONE IS A DIFFERENT FACT ABOUT THE SLOT.
   *
   *   bonus slot   open and untouched
   *   bonus again  open, one option taken, and ANOTHER IS ON OFFER - which is A
   *                Helping Hand ("you may take BOTH bonus options") and nothing
   *                else in the sheet. ⚠️ It is gated on `bonus.length > 0`
   *                rather than on `bonusTaken` alone, because this file cannot
   *                compute `bonusSlotsFor` - that reads a built card against the
   *                true state - so the move list is what knows. Without the
   *                gate, every seat would be told it had a second bonus after
   *                spending its first, which is a rule only one card has.
   *   bonus taken  spent, and the window is shut
   *   bonus missed unspent and no longer reachable, which is neither "spent" nor
   *                an option: saying "bonus slot" there would be a lie the rule
   *                cannot back.
   */
  const bonusLabel = !bonusOpen
    ? bonusTaken
      ? 'bonus taken'
      : 'bonus missed'
    : bonusTaken
      ? bonus.length > 0
        ? 'bonus again'
        : 'bonus taken'
      : 'bonus slot';

  /*
   * THE MEEPLE HEAD says one of FOUR things and each is a different fact.
   *
   * ⚠️ THE TWO "nothing to spend" CASES ARE NOT THE SAME, and the wrong one is
   * checkable from the screen. The window can be SHUT (you have taken your bonus
   * or your action) or it can be open with nothing legal to spend into - the
   * engine refuses a meeple whose colour's action could do nothing, so a seat
   * holding one Harvest meeple and no full building has an open window and no
   * options. Saying "not now" in the second case contradicts the bonus slot
   * sitting live beside it. `meepleWindowOpen` is what separates them, read off
   * the turn rather than off the move list because that is the only place the
   * two facts differ.
   *
   * The fourth is not padding - "no meeples" is where a player learns that they
   * come off the island, which is the only source there is.
   */
  const meepleWindow = meepleWindowOpen(turn);
  const meepleState = meepleLive ? 'go' : meeplesHeld > 0 && !meepleWindow ? 'spent' : 'idle';
  const meepleLabel = meepleLive
    ? 'meeples first'
    : meeplesHeld === 0
      ? 'no meeples'
      : meepleWindow
        ? 'meeples: nothing to do'
        : 'meeples: not now';

  return (
    <div className="actionbar" aria-label="your turn">
      <div className="action-buttons">
        {/*
         * ⭐ A ZONE WITH NO BUTTONS, AND IT IS STILL A ZONE. The move is made on
         * the pawn in your supply; what the bar owes the player is the WINDOW -
         * that meeples come first, and that it has shut. Without this the pawns
         * simply stop responding and nothing anywhere says why.
         */}
        <section className="zone zone-meeple" aria-label="your meeples">
          <ZoneHead label={meepleLabel} state={meepleState} />
          <div className="zone-row">
            <p className="zone-note">
              {meepleLive
                ? 'Spend them in your supply, below - any number, before your bonus.'
                : meeplesHeld === 0
                  ? 'Every island delivery brings one.'
                  : meepleWindow
                    ? 'You hold some, but none of their actions is legal right now.'
                    : 'The window has passed. They keep for the start of your next turn.'}
            </p>
          </div>
        </section>

        {action.length > 0 && (
          <section className="zone zone-action" aria-label="your action">
            <ZoneHead label={turn.actionSpent ? 'action spent' : 'action'} state={actionState} />
            <div className="zone-row">{action.map((group) => button(group))}</div>
          </section>
        )}

        <section className="zone zone-bonus" aria-label="your bonus slot">
          <ZoneHead label={bonusLabel} state={bonusState} />
          <div className="zone-row">
            {bonus.map((group) => button(group))}
            {inBonusPhase && (
              /* The skip sits IN the row with the options rather than under it,
                 and the height budget is why: every pixel the bar takes comes out
                 of the tableau, which at 1366 has exactly two rows of buildings
                 and no spare. It reads correctly too: declining IS one of the
                 things you can do with the slot, and the ghost weight already
                 says it is not an option like the others. */
              <span className="bonus-exits">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setSkipped(true)}
                  title="take your action instead - the bonus is forfeited either way"
                >
                  skip bonus action
                </button>
              </span>
            )}
            {!inBonusPhase && bonus.length === 0 && (
              <p className="zone-note">
                {bonusTaken ? 'Taken.' : bonusOpen ? 'Nothing to take.' : 'Not any more.'}
              </p>
            )}
          </div>
          {inBonusPhase && (
            <p className="bonus-phase" aria-label="bonus slot, at the start of your turn">
              <strong>Your bonus, first.</strong> One of these, or skip it - the slot shuts the
              moment you take your action. A card on a <em>neighbour&rsquo;s</em> board is the one
              that puts you on somebody else&rsquo;s farm.
            </p>
          )}
        </section>
      </div>

      <section className="zone zone-exit" aria-label="leaving your turn">
        <ZoneHead label="then" state="idle" />
        <div className="zone-row">
          {exits.map((group) => button(group, 'exit'))}
          <button
            type="button"
            className="exit exit-stop"
            disabled={!canUndo}
            onClick={onUndo}
            title="replay without it"
          >
            undo
          </button>
          {play.intent.k !== 'idle' && (
            <button type="button" className="exit exit-stop" onClick={play.cancel}>
              cancel
            </button>
          )}
        </div>
      </section>

      {waitingOn !== null && <p className="waiting-on">{waitingOn}</p>}
    </div>
  );
}
