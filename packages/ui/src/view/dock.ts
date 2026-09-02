/**
 * Dock magnification for the hand fan: the arithmetic, with no DOM in it.
 *
 * The card under the pointer grows a lot; the cards away from it shrink to pay
 * for it; the whole field follows the mouse continuously. This module is the
 * whole of the decision-making; `session/dock.ts` is the part that reads the
 * layout and writes the custom properties.
 *
 * ⚠️ IT IS SPLIT OUT SO IT CAN BE TESTED, AND THE PROPERTIES IT IS TESTED FOR
 * ARE THE POINT OF THE FEATURE. Phase 1 deleted a hover-zoom that blew ONE card
 * up to 2.1x, and it was deleted for a measured reason: the enlarged card
 * covered the neighbours you were reaching for next. So the magnifier has to
 * earn its place by leaving the neighbours readable, and `dock.test.ts` pins
 * exactly how.
 *
 * ⭐ THE FOURTH CUT, 27/08/2026, AND IT IS THE ONE THAT NAMES THE MECHANISM.
 * THE THREE BEFORE IT WERE ALL SOLVING THE SAME PROBLEM WITH THE WRONG VERB.
 *
 * Cuts one to three all asked the same question - where does the width for a
 * bigger card come from? - and all three answered "from somewhere else on the
 * screen". Cut one took it from the fan's own overlap. Cut two bought total
 * separation first and had nothing left, drawing a wave of
 * 1.12/1.36/1.48/1.36/1.12 that nobody could see working. Cut three bought the
 * peak first, which helped at the small steps and did nothing at all at 2560,
 * where the card is already 300px and five of them fill 1524px of a 1620px row;
 * it then went looking for width in the barn's column and the reading region's,
 * which worked and cost two panels of information for the length of every hover.
 *
 * ⭐ DEAN'S CORRECTION IS THE ANSWER: "THE CENTRAL CARD GETS A LOT BIGGER AND
 * THE CARDS ADJACENT SHRINK DOWN."
 *
 * The width does not come from somewhere else on the screen. IT COMES FROM THE
 * OTHER CARDS. The row is a fixed width and the wave redistributes it - a
 * SQUEEZE, not a growth. That one change pays for everything the previous three
 * cuts were scavenging for. Measured at 2560, five cards:
 *
 *   cut three   1.00 / 1.52 / 1.99 / 1.52 / 1.00   covering the barn and the gloss
 *   this one    0.65 / 1.36 / 1.99 / 1.36 / 0.65   covering NOTHING
 *
 * Same 597px card, and the panel-wide land grab cut three needed is deleted
 * along with the fade that had to apologise for it. A row that funds its own
 * wave does not have to borrow.
 *
 * ⭐ THE SCALE OF CARD i, WHICH IS THE WHOLE MODEL:
 *
 *     s = 1 - t·B + (peak - 1 + t·B) · b
 *
 * where `b` is the falloff at that card, `B` is the LARGEST falloff anywhere in
 * the row, and `t` is `1 - min` - how far a card away from the wave is allowed
 * to shrink.
 *
 * ⚠️ THE `B` IS NOT DECORATION AND REMOVING IT PUTS A JUMP IN THE FIELD. The
 * hand's row is wider than its fan (208px of slack at 1600), so a pointer can
 * be inside `.hand` and yet further than the falloff radius from every card in
 * it. Without `B` every card is then at `min` - the whole hand shrinks for a
 * pointer in an empty corner of its own row - and then snaps back to 1 the
 * instant the pointer crosses out of `.hand` and the properties are cleared.
 * With it, the trough is only ever as deep as the wave is tall, so a pointer
 * with no card near it draws nothing, which is the same thing leaving draws.
 *
 * The layout is one formula: card i is offset by the growth of every card to
 * its LEFT (negative, out in the shrinking tail), plus the gaps opened to its
 * left, plus half of its own growth. That pins the strip's left edge - it can
 * never reach the rail beside the farm - and puts all the travel at the right.
 */

/** The falloff, in resting advances, when the row can pay for the full width. */
export const DOCK_RADIUS_MAX = 3;

/**
 * The narrowest falloff the dock will draw before it starts giving up peak.
 *
 * ⚠️ IT IS A FLOOR ON THE LOOK, NOT ON THE ARITHMETIC. Below about 1.3 the
 * raised cosine has fallen to nothing by the time it reaches the neighbouring
 * card, so the only thing that moves is the card under the pointer - which is
 * the hover-zoom Phase 1 deleted, drawn by a more expensive route. At 1.4 the
 * immediate neighbours still take about a fifth of the wave, which reads as a
 * wave rather than a pop.
 *
 * ⭐ THE CONCESSION ORDER, first to last kept:
 *
 *   1. **THE PEAK.** The height of the wave is the whole effect.
 *   2. **Separation under the wave**, which is cheap because it is local.
 *   3. **The falloff radius**, `DOCK_RADIUS_MAX` down to here.
 *
 * and only when even this radius overruns does the peak come down off the
 * token. The trough is not on the ladder at all: it is not a cost, it is what
 * PAYS, so it is never conceded.
 */
export const DOCK_RADIUS_MIN = 1.4;

/**
 * The gap the docked strip leaves between neighbours, as a fraction of a card.
 *
 * Dimensionless for the same reason `--hand-fan` is: it multiplies the card's
 * own width, which is already dialled per step and already scaled by the UI
 * slider, so a length here would be scaled twice.
 *
 * 0.03 is small on purpose - 2.6px at the 1024 floor, 3.9px at desktop, 9px at
 * 2560. What reads as "separated" is the card being WHOLE, not the size of the
 * space around it, and every pixel spent here is a pixel the peak cannot have.
 */
export const DOCK_GAP = 0.03;

/**
 * How fast a gap opens as the wave arrives at it, as a multiple of the falloff.
 *
 * ⭐ THIS IS WHAT MAKES SEPARATION LOCAL. A gap between cards i and i+1 opens by
 * `spacing - advance` times `min(1, DOCK_OPEN_GAIN x the larger of the two
 * cards' falloffs)`. So:
 *
 *   - a gap with a growing card on either side of it is FULLY open, and the two
 *     cards stand clear with the printed gap between them;
 *   - a gap out in the tail, both cards shrunk, stays as the fan rests it - and
 *     shrunk cards have room to spare anyway, so it costs nothing and shows
 *     nothing;
 *   - in between it eases, so the strip goes back to being a fan rather than
 *     ending at a step.
 *
 * At 2.5, a gap is fully open once either of its cards has taken 40% of the
 * wave. Lower it and the mid-wave cards lap; raise it and the tail pays for
 * separation nobody is looking at, which was cut two's whole mistake.
 */
export const DOCK_OPEN_GAIN = 2.5;

/** How finely the radius is searched. Half a tenth of a card is below noticing. */
const RADIUS_STEP = 0.05;

/**
 * How finely the pointer is sampled when looking for the worst case, in pixels.
 *
 * ⚠️ IT IS A LENGTH, NOT A COUNT PER GAP, AND THE DIFFERENCE IS A REAL BUG THAT
 * WAS CAUGHT BY THE BUDGET TEST. An earlier cut subdivided each gap sixteen
 * times, which at the 2560 step is a sample every 15px - fine for a smooth
 * function. The cost is not smooth: `opening` clamps at 1 and the trough takes
 * a `max` over the row, so the surface has corners on it, and a 15px grid
 * walked straight past the top of a ridge and under-reported by 2.2px. A fixed
 * pitch samples a wide fan as finely as a narrow one, which is what was wanted.
 */
const SAMPLE_PITCH = 1;

/** A ceiling on the sampling, so an absurdly wide fan cannot stall a measure. */
const SAMPLE_CAP = 4000;

/**
 * Shaved off the budget so a sampled maximum can never round its way over.
 *
 * A whole pixel, because the cost surface has corners and a corner cannot be
 * sampled exactly: at `SAMPLE_PITCH` the residual measures about 0.14px, and a
 * pixel of budget left unspent is not a thing anyone can see. The overrun it
 * prevents IS visible - it is the strip's last card in the barn's column.
 */
const BUDGET_GUARD = 1;

/** The resting layout of the fan, plus the dials the row can afford. */
export interface DockAnchors {
  /** Resting left edge of each card's printed box, in one shared axis. */
  readonly lefts: readonly number[];
  /** The printed width every card in the fan shares. */
  readonly width: number;
  /** Mean resting advance between neighbours: the dock's unit of distance. */
  readonly advance: number;
  /**
   * The pitch between card left edges WHERE THE WAVE IS AT FULL HEIGHT.
   *
   * `spacing - width` is the gap two neighbouring cards get once the wave has
   * reached them; out in the tail the gap eases back to the resting
   * `advance - width`, which is negative and is the fan. Never below `advance`:
   * docking may only ever open the fan, never tighten it.
   */
  readonly spacing: number;
  /** The peak scale this row can pay for, at most the token's value. */
  readonly peak: number;
  /**
   * How small a card far from the pointer goes, as a fraction of its printed
   * size. This is the SOURCE of the peak's width rather than a cost of it, so
   * it is taken straight from the token and never conceded.
   */
  readonly min: number;
  /** The falloff radius, in advances. */
  readonly radius: number;
  /**
   * ⚠️ TRUE WHEN THE ROW COULD NOT OPEN EVEN THE GAPS UNDER THE WAVE, so the
   * cards it magnifies would still lap. A dock that re-covered the cards to buy
   * itself a wave would be the deleted hover-zoom, so it declines to draw one
   * and says so instead.
   */
  readonly overlapped: boolean;
}

/** What one card is asked to do: how big, and how far along the row. */
export interface DockPlacement {
  readonly scale: number;
  /** Pixels rightward from the card's resting position. */
  readonly shift: number;
  /**
   * The falloff at this card, 0 out in the tail and 1 under the pointer.
   *
   * Carried out to the DOM so the elevation can follow the wave (`--dock-b` in
   * `table.css`). SIZE ALONE IS NOT PROMINENCE: a card that is merely bigger
   * reads as a card nearer the front only if it also casts a bigger shadow, and
   * the shadow costs no width at all - which, in a feature whose every other
   * dial is rationed by width, makes it the cheapest thing here.
   */
  readonly bump: number;
}

/**
 * The falloff. A raised cosine, which is 1 at the pointer, 0 at the radius, and
 * flat at both ends so the wave neither jumps in nor stops abruptly.
 *
 * It has COMPACT SUPPORT, which is worth more than the smoothness: a card more
 * than `radius` advances away is provably at the trough, not merely close to
 * it, so the far end of a long fan is genuinely settled and the test can say so.
 */
export function dockBump(distance: number, radius: number): number {
  if (!(radius > 0)) return distance === 0 ? 1 : 0;
  const d = Math.abs(distance);
  if (d >= radius) return 0;
  const c = Math.cos((Math.PI * d) / (2 * radius));
  return c * c;
}

/** The falloff at every card, for a pointer at `pointer`. The shared step. */
function bumps(
  lefts: readonly number[],
  width: number,
  advance: number,
  radius: number,
  pointer: number,
): number[] {
  return lefts.map((left) => dockBump((left + width / 2 - pointer) / advance, radius));
}

/**
 * The scale of every card, from its falloff. THE MODEL, IN ONE FUNCTION.
 *
 * `1 - t·B` is where a card with no wave on it sits, and `B` - the tallest
 * falloff anywhere in the row - is what makes the trough fade in with the wave
 * rather than switching on the moment the pointer enters the row. See the file
 * header for the jump that removing it puts back.
 */
function scales(b: readonly number[], min: number, peak: number): number[] {
  let tallest = 0;
  for (const x of b) if (x > tallest) tallest = x;
  const depth = (1 - min) * tallest;
  return b.map((x) => 1 - depth + (peak - 1 + depth) * x);
}

/**
 * How far the gap between cards `i` and `i + 1` has opened, 0 to 1.
 *
 * The larger of the pair's two falloffs drives it, so a gap beside a growing
 * card opens even when the card on its other side is in the trough - which is
 * the case that matters, since it is the outermost pair of the wave.
 */
function opening(here: number, next: number): number {
  return Math.min(1, Math.max(here, next) * DOCK_OPEN_GAIN);
}

/**
 * The width the WAVE adds when the pointer sits at `pointer`.
 *
 * The sum of every card's growth, because the left edge is pinned: what the
 * cards gain, the right-hand end of the strip travels. ⚠️ IT GOES NEGATIVE, and
 * that is the squeeze working - a row whose tail has shrunk is NARROWER than it
 * rests even with a 2.3x card standing in the middle of it.
 */
export function dockSpread(
  lefts: readonly number[],
  width: number,
  advance: number,
  min: number,
  peak: number,
  radius: number,
  pointer: number,
): number {
  const s = scales(bumps(lefts, width, advance, radius, pointer), min, peak);
  let total = 0;
  for (const x of s) total += width * (x - 1);
  return total;
}

/**
 * The extra width SEPARATION adds when the pointer sits at `pointer`.
 *
 * ⭐ IT MOVES WITH THE POINTER, which is what makes it affordable: only the gaps
 * the wave has reached are open, so the cost is bounded by the wave's own width
 * rather than by the hand's.
 */
export function dockOpening(
  lefts: readonly number[],
  width: number,
  advance: number,
  spacing: number,
  radius: number,
  pointer: number,
): number {
  const step = Math.max(0, spacing - advance);
  if (step === 0) return 0;
  const b = bumps(lefts, width, advance, radius, pointer);
  let total = 0;
  for (let i = 0; i < b.length - 1; i++)
    total += step * opening(b[i] as number, b[i + 1] as number);
  return total;
}

/**
 * The tallest peak this radius can carry inside `room`, exactly.
 *
 * ⭐ SOLVED RATHER THAN SEARCHED, AND THE TRICK IS THAT THE COST IS A STRAIGHT
 * LINE IN THE PEAK. At any one pointer position the strip's total extension is
 *
 *     cost = (peak - 1)·A + C
 *
 * with `A` the sum of the falloffs times the card width, and `C` everything the
 * peak does not touch - the trough's saving, which is negative, plus the gaps.
 * So each sampled pointer position sets its own ceiling on the peak, and the
 * answer is the LOWEST of them. One pass, no bisection, and no conservatism: an
 * earlier cut bounded the two halves separately and took `max A + max C`, which
 * is safe but slack, because `A` peaks where the wave is centred and `C` is at
 * its least negative where there is no wave at all.
 *
 * Returns `null` when even a flat row (peak 1, no trough) overruns - which means
 * the gaps alone will not fit, and there is no wave to be had at this radius.
 * Returns `Infinity` for a fan with no falloff anywhere, which is a hand of one.
 */
function fitPeak(
  lefts: readonly number[],
  width: number,
  advance: number,
  spacing: number,
  radius: number,
  min: number,
  room: number,
): number | null {
  if (lefts.length === 0) return null;
  const first = lefts[0] ?? 0;
  const last = lefts.at(-1) ?? first;
  const span = Math.abs(last - first);
  const steps = Math.max(1, Math.min(SAMPLE_CAP, Math.ceil(span / SAMPLE_PITCH)));
  const step = Math.max(0, spacing - advance);
  const trough = 1 - min;
  const n = lefts.length;
  let cap = Infinity;
  for (let i = 0; i <= steps; i++) {
    const p = first + width / 2 + (span * i) / steps;
    const b = bumps(lefts, width, advance, radius, p);
    let sum = 0;
    let tallest = 0;
    let open = 0;
    for (let k = 0; k < n; k++) {
      const here = b[k] as number;
      sum += here;
      if (here > tallest) tallest = here;
      if (k < n - 1) open += step * opening(here, b[k + 1] as number);
    }
    // `sum - n` is at most zero, so a deeper trough only ever lowers `C`.
    const a = width * sum;
    const c = width * trough * tallest * (sum - n) + open;
    if (c > room) return null;
    if (a > 1e-9) cap = Math.min(cap, (room - c) / a);
  }
  return cap === Infinity ? Infinity : 1 + Math.max(0, cap);
}

/**
 * Fit the dock to the room the row actually has.
 *
 * `budget` is the spare width to the right of the resting fan, measured by the
 * caller: the empty end of the hand's own row, or - if the strip lifts clear of
 * the barn first - the barn's column too. Nothing else is spendable: left of the
 * fan is the edge of the farm panel and then a neighbour's rail, and past the
 * column is the reading region, which is printing the very card being hovered.
 *
 * ⭐ PEAK FIRST, THEN LOCAL SEPARATION, THEN THE FALLOFF - and the TROUGH is not
 * on that ladder because it is not a cost. See the file header.
 */
export function dockAnchors(
  lefts: readonly number[],
  width: number,
  budget: number,
  peakToken: number,
  minToken: number,
): DockAnchors | null {
  if (lefts.length === 0 || !(width > 0)) return null;
  const peak = Math.max(1, peakToken);
  // A trough below a third of a card leaves a card nobody can identify any
  // more, and above 1 it would be a magnifier that magnified everything.
  const min = Math.min(1, Math.max(0.33, minToken));
  const first = lefts[0] ?? 0;
  const last = lefts.at(-1) ?? first;
  const gaps = lefts.length - 1;
  const advance = gaps > 0 ? (last - first) / gaps : width;
  if (!(advance > 0)) return null;
  const room = Math.max(0, budget - BUDGET_GUARD);

  /*
   * The pitch a pair of cards gets once the wave has reached them: a whole card
   * plus the printed gap. The `Math.max` is not defensive tidying - the large
   * steps rest with a POSITIVE `--hand-fan`, so their resting advance can
   * already exceed a card plus our gap, and docking must never pull a fan
   * tighter than it rests.
   */
  const wanted = Math.max(advance, width * (1 + DOCK_GAP));
  const off = { lefts, width, advance, spacing: wanted, peak: 1, min: 1, radius: DOCK_RADIUS_MIN };

  // Nothing to draw: no growth asked for and no shrink either. Saying so once
  // here keeps every caller from having to test the two separately.
  if (peak <= 1 && min >= 1) {
    return { ...off, spacing: advance, overlapped: gaps > 0 && advance < width };
  }

  /*
   * ⭐ THE PEAK IS THE FIRST CLAIM ON THE ROW. Find the WIDEST falloff at which
   * the row can still pay for the whole token peak with its gaps open - that is
   * the widest wave of full height it can hold, which is the thing being bought.
   *
   * ⚠️ BISECTED, NOT WALKED, AND THE JUSTIFICATION IS A PROPERTY RATHER THAN A
   * HUNCH: a wider raised cosine is larger at every distance, so the affordable
   * radii are a prefix. Seven probes instead of thirty-three, which is what pays
   * for the fine pointer sampling in `fitPeak`.
   */
  const at = (radius: number) => fitPeak(lefts, width, advance, wanted, radius, min, room);
  const done = (radius: number, top: number) => ({
    ...off,
    spacing: wanted,
    peak: Math.max(1, Math.min(peak, top)),
    min,
    radius,
    overlapped: false,
  });

  const widest = at(DOCK_RADIUS_MAX);
  if (widest !== null && widest >= peak) return done(DOCK_RADIUS_MAX, peak);

  const narrow = at(DOCK_RADIUS_MIN);
  if (narrow !== null && narrow >= peak) {
    let lo = DOCK_RADIUS_MIN;
    let hi = DOCK_RADIUS_MAX;
    while (hi - lo > RADIUS_STEP) {
      const mid = (lo + hi) / 2;
      const got = at(mid);
      if (got !== null && got >= peak) lo = mid;
      else hi = mid;
    }
    return done(lo, peak);
  }

  /*
   * Even the narrowest falloff will not carry the whole peak, so the peak comes
   * down - and it is still worth more than the falloff, so it takes the whole
   * remainder here rather than being spread wider and thinner.
   */
  if (narrow !== null) return done(DOCK_RADIUS_MIN, narrow);

  /*
   * ⚠️ THE HONEST FAILURE. The gaps under the wave alone overrun the row, so
   * there is no wave to be had at any radius. Open the gaps as far as the room
   * stretches to and stop: `overlapped` says whether that reached a whole card,
   * and a peak of 1 with no trough says the dock is off rather than drawn on top
   * of cards that still lap.
   */
  const flat = (spacing: number) =>
    fitPeak(lefts, width, advance, spacing, DOCK_RADIUS_MIN, 1, room) !== null;
  let lo = advance;
  let hi = wanted;
  while (hi - lo > 0.05) {
    const mid = (lo + hi) / 2;
    if (flat(mid)) lo = mid;
    else hi = mid;
  }
  return { ...off, spacing: lo, overlapped: gaps > 0 && lo < width };
}

/** What the headroom above the fan will and will not carry. */
export interface DockRise {
  /** Pixels the strip rises. Zero when the ceiling cannot carry the whole lift. */
  readonly lift: number;
  /** Whether it cleared the barn, and so may spend the barn's column. */
  readonly clear: boolean;
  /** The peak the ceiling still leaves once that lift is paid for. */
  readonly peak: number;
  /** The peak the ceiling leaves if the strip stays down in its row. */
  readonly homePeak: number;
}

/**
 * How high the strip may rise, and what the ceiling leaves for the magnifier.
 *
 * The strip spends the barn's column on its way right, and the barn may not be
 * covered - so it goes OVER, not through. `cardTop` and `cardHeight` describe a
 * resting hand card, `barnTop` is the top of the barn strip beside it, and
 * `ceiling` is the highest anything here may reach.
 *
 * ⚠️ THE CEILING IS THE FARM PANEL'S OWN TOP EDGE, and it is chosen rather than
 * assumed. Everything between the fan and it - the tableau, and the farm's head
 * bar above that - is inside your own farm and is coverable for as long as a
 * pointer sits on your hand. The turn bar is NOT: it lives outside the panel,
 * above it, and stopping at the panel's edge keeps the strip away from it by
 * construction rather than by a number somebody has to re-check.
 *
 * ⚠️ THE GROWTH AND THE LIFT STACK, so the ceiling has to pay for both. A
 * magnified card grows upward from its own bottom edge (`transform-origin:
 * 50% 100%`), so what the ceiling leaves after the lift is a CAP ON THE PEAK -
 * and since the peak outranks the width that rising buys, a lift that would cap
 * the peak below what the strip already reaches at home is a lift not worth
 * taking. `dockBeats` is what refuses it.
 */
export function dockRise(
  cardTop: number,
  cardHeight: number,
  barnTop: number,
  ceiling: number,
  peakToken: number,
): DockRise {
  const token = Math.max(1, peakToken);
  const headroom = Math.max(0, cardTop - ceiling);
  const need = Math.max(0, cardTop + cardHeight - barnTop);
  const capped = (rise: number) =>
    cardHeight > 0 ? Math.min(token, 1 + Math.max(0, headroom - rise) / cardHeight) : token;
  const clear = need <= headroom;
  const lift = clear ? need : 0;
  return { lift, clear, peak: capped(lift), homePeak: capped(0) };
}

/**
 * Is `a` the better strip? THE CONCESSION ORDER, WRITTEN AS A COMPARISON.
 *
 * The hook fits the dock twice - once to the hand's own row, once to the whole
 * column it can reach by rising - and this is how it picks. The peak wins on its
 * own; a tie there goes to the wider separation; the falloff is the last word.
 */
export function dockBeats(a: DockAnchors, b: DockAnchors): boolean {
  if (Math.abs(a.peak - b.peak) > 1e-6) return a.peak > b.peak;
  if (Math.abs(a.spacing - b.spacing) > 1e-6) return a.spacing > b.spacing;
  // ⚠️ THE FALLOFF ONLY COUNTS WHILE THERE IS A WAVE TO SPEND IT ON. A falloff
  // at peak 1 with no trough draws nothing at all, so a wide one cannot beat a
  // narrow one that still moves - which is the reading the plain ladder gives if
  // this line is left out, and it would trade the whole wave for empty width.
  const live = (x: DockAnchors) => x.peak > 1 || x.min < 1;
  if (live(a) !== live(b)) return live(a);
  return a.radius > b.radius + 1e-6;
}

/**
 * Where every card goes, for a pointer at `pointer` on the same axis as `lefts`.
 *
 * ⚠️ `pointer` IS A POSITION IN THE RESTING LAYOUT AND NOTHING ELSE. Feeding it
 * a live, already-transformed position is the classic dock bug: the wave moves
 * the cards, which changes which card is under the pointer, which changes the
 * wave, and the fan sits at a card boundary and buzzes. Every number here comes
 * off `lefts`, which is measured once with the transforms switched off, so the
 * whole field is a pure function of one pointer coordinate and cannot feed back
 * into itself.
 *
 * The gap this leaves between cards `i` and `i + 1` works out at
 * `advance - width + (spacing - advance) x opening`, which is the printed gap
 * where the wave is and the fan's own overlap where it is not. That identity is
 * what `dock.test.ts` sweeps, and it is the whole promise of the feature.
 */
export function dockPlacements(anchors: DockAnchors, pointer: number): readonly DockPlacement[] {
  const { lefts, width, advance, spacing, peak, min, radius } = anchors;
  const step = Math.max(0, spacing - advance);
  const b = bumps(lefts, width, advance, radius, pointer);
  const s = scales(b, min, peak);
  const out: DockPlacement[] = [];
  let accumulated = 0;
  for (let i = 0; i < lefts.length; i++) {
    const scale = s[i] as number;
    const growth = width * (scale - 1);
    // The card scales about its own centre, so half its growth goes leftward;
    // the `growth / 2` puts that half back, which is what pins the first card's
    // left edge whether it is growing or shrinking. `accumulated` carries
    // everything opened - or given back - to this card's left.
    out.push({ scale, shift: accumulated + growth / 2, bump: b[i] as number });
    const next = b[i + 1];
    accumulated += growth + (next === undefined ? 0 : step * opening(b[i] as number, next));
  }
  return out;
}
