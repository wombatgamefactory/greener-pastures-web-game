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
 * ⭐ THE ZONES' ORDER WAS FIXED 18/09/2026 (2.5.3). It used to put the meeple
 * zone first because the v31 meeple loop spent them at the very start of a
 * turn; the 14/09/2026 evening ruling moved the Worker spend to AFTER the main
 * action, and the zone order below - and the JSX further down - now follows
 * it. The zones ARE the turn, in order, so the shape of a turn is legible off
 * the interface without being taught:
 *
 *   bonus    one option: Draw 1, or a card on a Notice Board.
 *   action   one of Draw / Build / Grow / Harvest / Deliver.
 *   workers  after your action, discard AT MOST ONE Worker for the plain
 *            action of its colour, then it leaves the game for good
 *            (`rules.turn.meepleSpendTiming` 'afterAction', `meepleSpendPerTurn`
 *            1 - CLAUDE.md §2.8). Called "meeples" only in identifiers this
 *            file inherited and could not rename without breaking files this
 *            pass does not own (`Supply.tsx`'s exports); every string a player
 *            reads says "Worker".
 *   then     the exits, which spend none of the three.
 *
 * ⚠️ THE WORKER ZONE DRAWS NO BUTTONS AND IS NOT DECORATION. Spending a Worker
 * is done on the Worker, in your own supply, because it is a wooden piece
 * sitting in front of you - the same rule that put the card power on the card.
 * What the zone contributes is the WINDOW: a Worker may only be spent AFTER
 * your action, at most one a turn, and once that window shuts (or has not
 * opened yet) the pawns stop being clickable with nothing on screen to say why.
 * The zone head is that "why".
 *
 * ⭐ THE BONUS ZONE HAS ONE VISIT BUTTON (19/09/2026). Self-visiting is BANNED
 * under the shipped rules (Dean, 11/09/2026, after measuring 44.4% of visits
 * going to a player's own board - the neighbour hook had no subject): every
 * visit crosses the table to a named rival, so there is exactly one door to
 * offer and one thing it can mean. The v31-era second button, "Your own door",
 * and its `action-solo` styling are gone with it - `moveText.ts`'s `FAMILIES`
 * still carries the pre-ban `visit-self` entry for the retired `'card'`
 * currency control (`selfVisitAllowed: true`), but nothing in this file
 * special-cases it any more: it is just another `zone: 'bonus'` family that
 * happens to stay `inPlay: false` and moveless under every game this
 * interface actually plays.
 */

import type { GameData } from '@gp/data';
import type { PlayerView } from '@gp/engine';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { useEscapeKey } from '../session/escape';
import { activateGroup } from '../session/play';
import type { Play } from '../session/play';
import { actionIcon } from '../view/art';
import { actionGroups, actionReason } from '../view/moveText';
import type { ActionGroup, TurnZone } from '../view/moveText';
import { meepleWindowOpen } from './Supply';

/**
 * THE BONUS WINDOW, read off the view rather than imported from the engine.
 *
 * ⭐ `bonusUsed` IS A LIST SINCE v31, not a boolean, and this is where the
 * difference shows. The printed rule is one option a turn, which a boolean said
 * perfectly well; ⚠️ THE OLD A HELPING HAND THAT GRANTED A SECOND PLAY IS GONE
 * (v39 replaced it with five distinct per-suit cards, none of which grants a
 * second bonus play), but A10 The Cross-Pollinator (v48) grants an EXTRA visit
 * with no per-board latch (R9), so "has the slot gone" and "how many are left"
 * are still two different questions. The interface cannot compute the second -
 * `bonusSlotsFor` reads a built card against the true state - so it asks the
 * move list instead, which is the same answer arrived at from the side the
 * interface is allowed to see.
 *
 * `rules.turn.bonusTiming` carries the paired controls, so the interface honours
 * the knob rather than the rule: an arm that switches the rule back must switch
 * the interface back with it or it is measuring two different games. Since
 * 09/09/2026 the shipped value is 'start' - bonus FIRST, then the core action -
 * so the bar's two shapes arrive in the order they were designed in.
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

/**
 * B11 (25/09/2026): Undo is not an `ActionGroup`, so it gets its own fixed
 * sentence rather than one from `actionReason` - live or disabled, it is
 * always the same fact (the scope B17 set), never a count that changes turn
 * to turn.
 */
const UNDO_REASON =
  'Undo last step: your last move this turn. Nothing before your turn began can be undone.';

export function ActionBar({
  data,
  play,
  onUndo,
  canUndo,
  waitingOn,
  onShowHowToPlay,
  onShowKeyHelp,
  children,
}: {
  data: GameData;
  play: Play;
  onUndo(): void;
  canUndo: boolean;
  /** Text for whoever the table is waiting on, when it is not you. */
  waitingOn: string | null;
  /**
   * WP5 item 2 (25/09/2026): the turn bar's own "?" opens a small menu with
   * both of these, mirroring the two things the keyboard layer separately
   * reaches - `?` straight to the shortcut sheet, and How to play already
   * one click away from the start screen. Optional so the render tests and
   * any other caller that mounts `ActionBar` with no help surface at all
   * still typecheck.
   */
  onShowHowToPlay?: (() => void) | undefined;
  onShowKeyHelp?: (() => void) | undefined;
  /**
   * T10b (26/09/2026): THE PROMPT, drawn in the bar's own message line. See
   * the dated note on `.bar-line` below and in `main-column.css`.
   */
  children?: ReactNode;
}) {
  const groups = actionGroups(data, play.view, play.moves);
  const [helpOpen, setHelpOpen] = useState(false);
  // 25/09/2026 (WP5 item 3): joins the same escape stack as every other
  // dialog - see `session/escape.ts`. A menu, not a full dialog, but it still
  // owes Escape a close.
  useEscapeKey(() => setHelpOpen(false), helpOpen);
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
   * THE WORKER WINDOW, read the same way the bonus window is: off the move list
   * rather than off a rule this file re-implements. A `spendMeeple` in the list
   * IS the window being open for this seat - the engine gates it on
   * `actionSpent && meeplesSpent.length < meepleSpendPerTurn` (AFTER the main
   * action, at most one a turn, since 14/09/2026 evening) and additionally
   * refuses a Worker whose action could do nothing, and neither of those is a
   * thing the interface should be re-deriving.
   */
  const meepleGroup = groups.find((g) => g.zone === 'meeple');
  const meepleLive = play.active && (meepleGroup?.moves.length ?? 0) > 0;
  const meeplesHeld = Object.values(play.view.you.meeples).reduce((a, b) => a + b, 0);

  // 25/09/2026 (WP5 item 2): the dispatch logic that used to live in this
  // closure is now `session/play.ts`'s exported `activateGroup`, shared with
  // the keyboard layer (`session/keys.ts`) so a shortcut does exactly what a
  // click does rather than a second copy of the same five branches.
  const onGroup = (group: ActionGroup) => activateGroup(play, group);

  /**
   * `kind` is the zone's costume, not a second idea of what the button is: an
   * exit is drawn quietly because it takes you OUT of the turn, and drawing End
   * turn with the same weight as Build is how the old flat row managed to make
   * the most consequential button on the bar look like the seventh option.
   */
  const button = (group: ActionGroup, kind: 'action' | 'exit' = 'action') => {
    const enabled = play.active && group.moves.length > 0;
    /*
     * B11 (25/09/2026): ONE SENTENCE, LIVE OR DISABLED, EVERY BUTTON.
     *
     * `actionReason` reads only the view and the move list - never a rule this
     * file would have to re-derive - so "why can I not Deliver" is answered
     * honestly (a barn count, not an invented "needs 4"). It doubles as the
     * mouse tooltip (`title`) and, via the hidden span below, the text an
     * `aria-describedby` points a screen reader at: the two must never
     * disagree, so there is exactly one sentence rather than two.
     */
    const reason = actionReason(play.view, group.moves, group);
    const reasonId = `action-reason-${group.key}`;
    /*
     * THE ICON, AND WHY ONLY SOME BUTTONS GET ONE (27/08/2026, Dean).
     *
     * `actionIcon` returns null for a family with no painting. The six
     * paintings are cut out of the printed player aid, so a family gets one
     * exactly when the aid has a vignette for it - inventing a seventh would put
     * a drawing on the table that is not in the box. That leaves the exits and
     * the bonus Draw 1 without one.
     *
     * ⚠️ `alt=""` PLUS `aria-hidden` IS DELIBERATE AND IS NOT BELT-AND-BRACES.
     * The picture is decorative here: the action's NAME is right beside it in
     * the same button, so any alt text at all makes a screen reader say "Build,
     * Build".
     */
    const icon = actionIcon(group.key);
    const isArmed = armed !== null && armed.type === group.type;
    /*
     * B18 (25/09/2026): End turn's "ready" look. `play.revealed` is true once
     * this turn's action told you something new (a Draw's cards, a Harvest
     * that might carry a hook) and stays true until you end your turn or a
     * fresh one starts for you - see `session/play.ts`. Reusing `.primary`
     * (already the assemblies' confirm colour) and `.is-target` (the same
     * pulse a live target wears, which already respects
     * `prefers-reduced-motion`) means End turn gets a genuine invitation
     * without a new stylesheet rule: nothing here AUTO-plays it, it is still
     * one click away exactly as before.
     */
    /*
     * 26/09/2026 (Dean): "if you have a Worker in hand but don't want to
     * spend it, how do you end your turn? There should be an obvious button."
     * End turn is now the solid primary button WHENEVER it is legal - holding
     * an unspent Worker, a standing move, anything that keeps the turn open -
     * not only after a revealing action. The pulse stays reserved for the
     * B18 case (new cards just arrived), so it still means "look at this".
     */
    const endTurnLive = kind === 'exit' && group.type === 'endTurn' && enabled;
    const ready = endTurnLive && play.revealed;
    return (
      <button
        key={group.key}
        type="button"
        className={`${kind}${isArmed ? ' action-armed' : ''}${
          group.key === 'visit' ? ' action-hook' : ''
        }${endTurnLive ? ' primary' : ''}${ready ? ' is-target' : ''}`}
        disabled={!enabled}
        title={reason}
        aria-describedby={reasonId}
        onClick={() => onGroup(group)}
      >
        {icon !== null && <img className="action-icon" src={icon} alt="" aria-hidden="true" />}
        <span className="action-name">{group.label}</span>
        <span id={reasonId} className="visually-hidden">
          {reason}
        </span>
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
   * THE WORKER HEAD says one of FOUR things and each is a different fact.
   *
   * ⚠️ THE TWO "nothing to spend" CASES ARE NOT THE SAME, and the wrong one is
   * checkable from the screen. The point can be BEFORE your action (the window
   * has not arrived yet this turn) or AFTER it with nothing legal to spend into
   * - the engine refuses a Worker whose colour's action could do nothing, so a
   * seat holding one Harvest Worker and no full building has an open window and
   * no options. Saying "not yet" in the second case contradicts the action zone
   * sitting spent right beside it. `meepleWindowOpen` is what separates them,
   * read off the turn rather than off the move list because that is the only
   * place the two facts differ.
   *
   * The fourth is not padding - "no Workers" is where a player learns that they
   * come off the island, which is the only source there is.
   */
  const meepleWindow = meepleWindowOpen(turn);
  // 'spent' only once a Worker has actually gone THIS turn (`turn.meeplesSpent`,
  // present whenever `meepleSpendPerTurn` is rationed - which the shipped game
  // is). Before your action, or after it with nothing legal, is 'idle' rather
  // than 'spent': nothing has been given up yet in either of those, so the
  // struck-through look the bonus/action zones use for "done" would lie.
  const meepleState = meepleLive ? 'go' : (turn.meeplesSpent?.length ?? 0) > 0 ? 'spent' : 'idle';
  const meepleLabel = meepleLive
    ? 'spend a Worker'
    : meeplesHeld === 0
      ? 'no Workers'
      : meepleWindow
        ? 'Workers: nothing to do'
        : 'Workers: after your action';

  const meepleNote = meepleLive
    ? 'Spend one in your supply, below - after your action, before you end your turn.'
    : meeplesHeld === 0
      ? 'Every island delivery brings one.'
      : meepleWindow
        ? 'You hold some, but none of their actions is legal right now.'
        : 'Take your action first - you may spend one afterwards.';

  /*
   * What the message line says when no prompt covers it, in priority order.
   * ⭐ The bonus note is SHORTER than it was (26/09/2026) so that it fits one
   * line at the 1024 floor; the full sentence is its tooltip, and the Visit
   * button's own `aria-describedby` reason already carries the rule.
   */
  const bonusNote = (
    <>
      <strong>Your bonus, first.</strong> Visit a neighbour or skip - it shuts when you take your
      action.
    </>
  );
  // The Worker sentence is NOT a bar note: with Workers held, the farm's own
  // supply strip says the same thing beside the pawns, and a third copy is
  // what QA D1 counted against the tableau. It stays this zone's tooltip.
  const barNote: ReactNode = inBonusPhase ? bonusNote : waitingOn;
  const barNoteTitle = inBonusPhase
    ? "Your bonus, first. One option, or skip it - the slot shuts the moment you take your action. A card on a neighbour's board is the one that puts you on somebody else's farm."
    : typeof barNote === 'string'
      ? barNote
      : undefined;

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
            {/* ⭐ 25/09/2026 (manager note, WP2): the zone HEAD already reads
                "bonus taken" once it is spent, so a second "Taken." right
                underneath it was the same fact said twice. Only the two
                cases the head does not already cover get a note here. */}
            {!inBonusPhase && bonus.length === 0 && !bonusTaken && (
              <p className="zone-note">{bonusOpen ? 'Nothing to take.' : 'Not any more.'}</p>
            )}
          </div>
          {/* T10b (26/09/2026): the bonus note moved to the message line
              (`.bar-line`, below). It was a second and often a third line
              under this row, and every one of those lines came out of the
              tableau's height: at 1600x900 it was a third of every building
              (QA D1). */}
        </section>

        {/*
         * ⭐ A ZONE WITH NO BUTTONS, AND IT IS STILL A ZONE. The move is made on
         * the pawn in your supply; what the bar owes the player is the WINDOW -
         * that a Worker comes AFTER the action, at most one, and when it has
         * shut (or has not opened yet). Without this the pawns simply stop
         * responding and nothing anywhere says why. Rendered LAST of the three
         * decision zones (18/09/2026, 2.5.3) because it is now the last thing
         * that happens in a turn, not the first.
         */}
        <section
          className={`zone zone-meeple${meeplesHeld === 0 ? ' zone-meeple-none' : ''}`}
          aria-label="your Workers"
          title={meepleNote}
        >
          {/* T10b (26/09/2026): THE HEAD ONLY, AND ITS SENTENCE MOVED TO THE
              MESSAGE LINE (or, with no Workers, to this zone's tooltip). The
              zone used to wrap onto a line of its own under the bonus zone
              ("NO WORKERS / Every island delivery brings one."), which with
              the farm's own empty Worker strip said the same thing twice and
              cost the tableau about 45px on every turn (QA D1). The head is
              still the window's name, in the same place, every turn. */}
          <ZoneHead label={meepleLabel} state={meepleState} />
          <span className="visually-hidden">{meepleNote}</span>
        </section>
      </div>

      <section className="zone zone-exit" aria-label="leaving your turn">
        <ZoneHead label="then" state="idle" />
        <div className="zone-row">
          {exits.map((group) => button(group, 'exit'))}
          {/*
           * B17 (25/09/2026): undo is scoped to your own current turn (the
           * floor is set the moment your turn begins - `session/table.ts`),
           * labelled for what it does rather than the bare verb, and drawn as
           * its own class rather than sharing `.exit-stop` with Cancel below:
           * WP2's neutral-ghost restyle in `play.css` targets `.exit-undo`,
           * because undoing your own move is not the same weight as the red
           * "stop what I am doing" cancel is.
           */}
          <button
            type="button"
            className="exit exit-undo"
            disabled={!canUndo}
            onClick={onUndo}
            title={UNDO_REASON}
            aria-describedby="action-reason-undo"
          >
            Undo last step
            <span id="action-reason-undo" className="visually-hidden">
              {UNDO_REASON}
            </span>
          </button>
          {play.intent.k !== 'idle' && (
            <button type="button" className="exit exit-stop" onClick={play.cancel}>
              cancel
            </button>
          )}
          {/*
           * WP5 item 2 (25/09/2026): the visible "?" beside the exits. A menu
           * rather than jumping straight to one page, because the two things
           * behind it answer different questions - "what are the rules" and
           * "what are the keys" - and a player who already knows the rules
           * should not have to page through them to find the shortcut sheet.
           */}
          {(onShowHowToPlay || onShowKeyHelp) && (
            <div className="turn-help">
              <button
                type="button"
                className="exit turn-help-btn"
                aria-haspopup="true"
                aria-expanded={helpOpen}
                aria-label="Help and keyboard shortcuts"
                title="Help and keyboard shortcuts"
                onClick={() => setHelpOpen((v) => !v)}
              >
                ?
              </button>
              {helpOpen && (
                <div className="turn-help-menu" role="menu" aria-label="Help">
                  {onShowHowToPlay && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setHelpOpen(false);
                        onShowHowToPlay();
                      }}
                    >
                      How to play
                    </button>
                  )}
                  {onShowKeyHelp && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setHelpOpen(false);
                        onShowKeyHelp();
                      }}
                    >
                      Keyboard shortcuts
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/*
       * T10b (26/09/2026): THE MESSAGE LINE. ONE LINE, EVERY TURN, AND IT IS
       * THE ONLY PLACE THE BAR SPEAKS IN SENTENCES.
       *
       * Three notes used to take a line each under the buttons - the bonus
       * phase's two-line explanation, the Worker zone's sentence, and the
       * "waiting on" line - and the prompt took a fourth row of its own in
       * `.main-column`. Every one of them came out of the tableau's height,
       * and the prompt's row grew with the question, which moved the whole
       * farm down mid-turn (QA D1 and D2). Now there is exactly one line, of
       * fixed height: the prompt when the game is asking something, otherwise
       * whichever note this moment has. The prompt sits in the same grid cell
       * on top of the note (`main-column.css`), so the note never needs to
       * know whether a prompt is showing.
       *
       * The prompt's multi-line parts are not here: an assembly still docks
       * over the shared table, and a task's cards and answers go to the task
       * tray under the decks (`Prompt.tsx`). Only the sentence lives here.
       */}
      <div className="bar-line">
        {barNote !== null && (
          <p
            className={`bar-note${inBonusPhase ? ' bonus-phase' : ''}${
              // `.waiting-on` is the hook four verify tools wait for.
              !inBonusPhase && waitingOn !== null ? ' waiting-on' : ''
            }`}
            title={barNoteTitle}
          >
            {barNote}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
