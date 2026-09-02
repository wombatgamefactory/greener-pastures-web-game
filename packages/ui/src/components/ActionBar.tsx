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
 * PHASE 3 (26/08/2026): THREE ZONES, NOT ONE ROW.
 *
 * Measured at fourteen buttons in one flat row, all the same size, half of them
 * greyed. The published digital-board-game UI guidance puts the ceiling at four
 * plus context, but the stronger objection is that fourteen is a LIE ABOUT THE
 * RULES: it says the game has fourteen verbs when the turn is one action plus
 * one bonus slot. The turn's own structure is therefore the layout, and the
 * grouping data already existed - `FAMILIES` in moveText.ts now carries a zone.
 *
 * Four cuts got it from fourteen down, and every one is a rule about WHY a
 * button is dead rather than a taste about how many is too many:
 *
 *   the rule is off       `inPlay`. The £1 buy and the £3 market were deleted
 *                         on 19/08 and both knobs are null, so those two
 *                         buttons could never light up. They are still in the
 *                         table and come straight back when an overlay flips
 *                         the knob - which is the only reason it is safe to
 *                         stop drawing them.
 *   nothing else is legal `pass` prints only when it is the only legal move,
 *                         which is exactly when the engine emits it at all
 *                         (game.ts: `if (moves.length === 0)`), so its own
 *                         hint - "Nothing else is legal" - is now always true.
 *   it lives on the board `onBoard`. A standing move a built card offers is
 *                         made ON the card, through a badge in the tableau; and
 *                         Freight is made on the balloon, in the Aerodrome,
 *                         because it is the Deliver action's freight branch
 *                         rather than a sixth verb.
 *   it is not an action   End turn, Pass and undo LEAVE the turn rather than
 *                         spending it, so they sit in their own zone at the
 *                         right instead of at the end of the action row.
 *
 * And one about the bonus zone, which is the only judgement call in the set. In
 * the BONUS PHASE every bonus family prints, greyed where it is not legal,
 * exactly as before - that phase is where the slot is taught, and "what can I
 * not do" is half of the teaching. In the MAIN phase it prints only what is
 * still live, because the whole set was on screen one click earlier and the
 * zone's job there is not to teach the slot but to say the slot is still open
 * and here is what is left in it.
 */

import type { GameData } from '@gp/data';
import type { Move, PlayerView } from '@gp/engine';
import { useEffect, useState } from 'react';

import type { Play } from '../session/play';
import { actionIcon } from '../view/art';
import { actionGroups, describeMove } from '../view/moveText';
import type { ActionGroup, TurnZone } from '../view/moveText';

/**
 * THE BONUS WINDOW, read off the view rather than imported from the engine: the
 * slot is unspent AND the main action has not been taken (Dean, 19/08/2026).
 * `rules.turn.bonusAtStartOnly` is the paired control, so the interface honours
 * the knob rather than the rule - an arm that switches the rule back must switch
 * the interface back with it or it is measuring two different games.
 */
function bonusWindowOpen(data: GameData, view: PlayerView): boolean {
  if (view.turn.bonusSpent) return false;
  if (!data.rules.turn.bonusAtStartOnly) return true;
  return !view.turn.actionSpent;
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
 * is the door. The test asserts the two halves separately for that reason.
 */
export function barFamilies(groups: readonly ActionGroup[], phase: BarPhase): ActionGroup[] {
  return groups.filter((group) => {
    if (group.onBoard || group.zone === 'exit') return false;
    // The bonus phase is modal: only the slot's own families, and all of them,
    // greyed where they are not legal. That is where the slot is TAUGHT.
    if (phase === 'bonus') {
      return group.zone === 'bonus' && (group.inPlay || group.moves.length > 0);
    }
    // The main phase teaches the ACTION - the same six verbs every turn, greyed
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
 * Folding the two together is the tidiest thing this phase does. The bar used to
 * print "ACTION  BONUS SLOT" as a chip list on the left and label the buttons
 * with nothing, so the moment the zones were labelled the same two words were on
 * screen twice. Now the label IS the state - struck through once it is spent, in
 * the seat's own green while it is still yours to spend - and the row it used to
 * cost is a row the 40px hit targets could have instead.
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
  const groups = actionGroups(data, play.moves);
  const armedType = play.intent.k === 'arm' ? play.intent.type : null;

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
   * It is shape (c) and not (b) because (b) charges every player one extra click
   * on every one of a 60-80 turn game: the phase appears only when the seat
   * actually HAS a legal bonus option, and otherwise the turn opens straight
   * into the main phase.
   *
   * ⚠️ THE SKIP IS LOCAL STATE AND NOT AN ENGINE MOVE, which is a deliberate
   * departure from the plan's section 5.3. A `skipBonus` move would be a strict
   * no-op - a seat that skips reaches the identical state it reaches by taking
   * its action - and adding it would put a dead move type into `MOVE_TYPES`, the
   * bots' claims-union assertion, three separate UI priority lists and the sim's
   * per-decision enumeration, all to record a button press that changes nothing.
   * The cost is that a human's explicit decline is not distinguishable from a
   * forfeit in the event stream; nothing reads that distinction, because the
   * bots never skip, so the sim could not have measured it either way.
   *
   * ⚠️ PHASE 3 CHANGED ITS RENDERING AND NOTHING ELSE. When the window opens,
   * how it is skipped and what it holds back are all exactly as they were.
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

  const onGroup = (type: Move['type'], moves: Move[], needsTarget: boolean) => {
    if (moves.length === 0) return;
    if (!needsTarget) {
      play.choose(moves, 'Which one?');
      return;
    }
    // One legal target: skip the arming step rather than making someone click a
    // family and then the only thing in it.
    if (moves.length === 1 && type !== 'build' && type !== 'visit') {
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
     * `actionIcon` returns null for a family with no painting, which today is
     * exactly the exits - End turn and Pass - and that is a rule rather than an
     * omission. Phase 3 separated the exits from the actions BECAUSE they are a
     * different kind of thing: they leave the turn instead of spending it. Give
     * them a glyph and they are back in the same visual class as Build, which
     * is the confusion the zones were built to remove. undo and cancel are
     * written by hand further down and get none for the same reason.
     *
     * ⚠️ `alt=""` PLUS `aria-hidden` IS DELIBERATE AND IS NOT BELT-AND-BRACES.
     * The picture is decorative here: the action's NAME is right beside it in
     * the same button, so any alt text at all makes a screen reader say "Build,
     * Build". An empty alt is what an image with nothing of its own to add is
     * supposed to carry, and the hidden flag is what keeps it out of the
     * button's accessible name in the browsers that compose one from content
     * rather than from alt alone.
     */
    const icon = actionIcon(group.type);
    return (
      <button
        key={group.type}
        type="button"
        className={`${kind}${armedType === group.type ? ' action-armed' : ''}`}
        disabled={!enabled}
        title={title}
        onClick={() => onGroup(group.type, group.moves, group.needsTarget)}
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
   * the over-limit hand already wear. There is no blue and there is not going to
   * be one: this is a printed cream-and-sepia palette and a blue "primary"
   * button is the single fastest way to make it look like a web form.
   */
  const actionState = turn.actionSpent ? 'spent' : phase === 'main' && play.active ? 'go' : 'idle';
  const bonusState =
    turn.bonusSpent || !bonusOpen ? 'spent' : phase === 'bonus' && play.active ? 'go' : 'idle';
  const bonusLabel = turn.bonusSpent
    ? 'bonus spent'
    : bonusOpen
      ? 'bonus slot'
      : // A slot that is unspent but no longer reachable is neither "spent" nor
        // an option, and saying "bonus slot" there would be a lie the rule
        // cannot back.
        'bonus missed';

  return (
    <div className="actionbar" aria-label="your turn">
      <div className="action-buttons">
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
                 and the height budget is why: the bar is 44px in the main phase
                 and every pixel it takes comes out of the tableau, which at 1366
                 has exactly two rows of buildings and no spare. A second 40px row
                 here cost the laptop step its second row - measured, in
                 `measure-ui`, which takes its geometry in this phase. It reads
                 correctly too: declining IS the fourth thing you can do with the
                 slot, and the ghost weight already says it is not an option like
                 the others. */
              <span className="bonus-exits">
                {/* The main families are not hidden from the RULES, only from
                    this step: taking one is still legal and still forfeits the
                    slot. The button is the honest door to that, not a gate. */}
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
                {turn.bonusSpent ? 'Taken.' : bonusOpen ? 'Nothing to take.' : 'Not any more.'}
              </p>
            )}
          </div>
          {inBonusPhase && (
            <p className="bonus-phase" aria-label="bonus slot, at the start of your turn">
              <strong>Your bonus, first.</strong> One of these, or skip it - the slot shuts the
              moment you take your action.
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

      {/* Two lines that belong to the turn rather than to any one zone. The
          Helping Hand's used to live here too and does not any more: it is a
          badge on the Helping Hand itself, which is the card the move is on. */}
      {waitingOn !== null && <p className="waiting-on">{waitingOn}</p>}
      {turn.again && <p className="turn-note">One more {turn.again}, if you want it.</p>}
    </div>
  );
}
