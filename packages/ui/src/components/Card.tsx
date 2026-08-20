/**
 * The card. Text-free illustration, printed frame layers, DOM text - ticket 15's
 * Fork B, built once here and used at every size in the interface.
 *
 * Every element sits where InDesign puts it on the 1039 x 750 printed card, in
 * container-query units, so one component serves a 90px rail thumbnail and a
 * 420px zoom with no second layout. The geometry constants come from measuring
 * the exported layers rather than from taste; see `printed.ts` for the same
 * treatment of which layers a face prints.
 *
 * Small sizes drop what would be illegible rather than shrinking it into mush:
 * the ability band goes below 260px and the cost bar below 150px (both in
 * card.css). That is what hover zoom is for. The one exception is the hand,
 * which passes `className="card-readable"` to keep the whole card printed and
 * scales it on hover instead - there the text is the decision, not a detail.
 */

import type { Suit } from '@gp/data';

import { cardArt, cardArtZoom, cropIcon, deckBack, frame, starterIcon, token } from '../view/art';
import type { CostIcon, PrintedFace } from '../view/printed';
import { SUIT_META } from '../view/suits';

/** Where a cost icon sits in the black bar, as a fraction of card height. */
const BAR = {
  /** The bar shape itself is the printed `cost_bg_<n>` overlay. */
  headCentre: 183 / 750,
  headSize: 84 / 1039,
  columnBottom: (n: number) => (322 + (n - 1) * 80.33) / 750,
  step: 80.33 / 750,
  iconSize: 72 / 1039,
  centreX: 972 / 1039,
} as const;

function costIconSrc(icon: CostIcon): string {
  if (icon.kind === 'coin') return frame('coin_front');
  if (icon.kind === 'wild') return cropIcon('wild');
  return cropIcon(icon.suit);
}

function costIconAlt(icon: CostIcon): string {
  if (icon.kind === 'coin') return '£1';
  if (icon.kind === 'wild') return 'any card';
  return `${SUIT_META[icon.suit].label} card`;
}

function CostBar({ face }: { face: PrintedFace }) {
  const n = face.cost.length;
  if (n === 0 || !face.costIcon) return null;
  const bottom = BAR.columnBottom(n);
  return (
    <div className="card-cost">
      <span className="visually-hidden">{`Cost: ${face.cost.map(costIconAlt).join(', ')}`}</span>
      <img className="card-cost-shape" src={frame(`cost_bg_${n}`)} alt="" />
      <img
        className="card-cost-head"
        src={frame(face.costIcon)}
        alt=""
        style={{
          left: `${(BAR.centreX - BAR.headSize / 2) * 100}%`,
          top: `${(BAR.headCentre - BAR.headSize / 2 / (750 / 1039)) * 100}%`,
          width: `${BAR.headSize * 100}%`,
        }}
      />
      {face.cost.map((icon, i) => {
        const centre = bottom - (n - i - 0.5) * BAR.step;
        return (
          <img
            key={`${icon.kind}-${i}`}
            className="card-cost-icon"
            src={costIconSrc(icon)}
            alt=""
            style={{
              left: `${(BAR.centreX - BAR.iconSize / 2) * 100}%`,
              top: `${centre * 100}%`,
              width: `${BAR.iconSize * 100}%`,
            }}
          />
        );
      })}
    </div>
  );
}

export interface CardProps {
  readonly face: PrintedFace;
  /** Card width in px. Everything else scales off it. */
  readonly width: number;
  /** Fetch the 1040px art tier. For the zoom panel and the inspector only. */
  readonly zoomTier?: boolean;
  /** Overlaid on the art: the stack gauge, a badge, a glow. */
  readonly children?: React.ReactNode;
  readonly className?: string;
}

export function Card({ face, width, zoomTier = false, children, className = '' }: CardProps) {
  const meta = SUIT_META[face.suit];
  const src = zoomTier ? cardArtZoom(face.id, face.upgraded) : cardArt(face.id, face.upgraded);

  return (
    <article
      className={`card ${className}`}
      style={{ width: `${width}px`, ['--suit-ink' as string]: meta.ink }}
      data-suit={face.suit}
      data-upgraded={face.upgraded ? 'yes' : 'no'}
      aria-label={`${face.name}, ${meta.label}`}
    >
      <img className="card-art" src={src} alt="" loading="lazy" draggable={false} />

      <div className="card-band">
        <img className="card-band-bg" src={frame(`ability_bg_${face.suit}`)} alt="" />
        {face.activation && (
          <img
            className="card-band-icon"
            src={cropIcon(face.activation)}
            alt=""
            title={`GROW: pay 1 ${face.activation === 'wild' ? 'card of any suit' : SUIT_META[face.activation].label} card`}
          />
        )}
        {face.convert && (
          <img
            className="card-band-icon card-band-icon-convert"
            src={frame(face.convert === 'convert' ? 'action_convert' : 'action_harvest')}
            alt=""
          />
        )}
        <p className="card-ability" data-text={face.abilityText}>
          {face.abilityText}
        </p>
      </div>

      <h3 className="card-name" data-text={face.name}>
        {face.name}
      </h3>

      {face.printedVp > 0 && (
        <div className="card-vp" title={`${face.printedVp} victory points`}>
          <img src={frame('vp')} alt="" />
          <span>{face.printedVp}</span>
        </div>
      )}

      <div className="card-chip">
        <img className="card-chip-bg" src={frame(`suit_bg_${face.suit}`)} alt="" />
        <img
          className="card-chip-icon"
          src={face.identityIcon === 'starter' ? starterIcon() : cropIcon(face.identityIcon)}
          alt=""
        />
      </div>
      <span className="card-ref" data-text={face.id}>
        {face.id}
      </span>

      {face.threshold !== null && (
        <span
          className="card-threshold"
          title={`Full at ${face.threshold} cards`}
          data-text={String(face.threshold)}
        >
          {face.threshold}
        </span>
      )}

      <CostBar face={face} />

      {children}
    </article>
  );
}

/** A face-down card: the deck back for its suit, at the same footprint. */
export function CardBack({
  suit,
  width,
  count,
  className = '',
}: {
  suit: Suit;
  width: number;
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={`card card-back ${className}`}
      style={{ width: `${width}px` }}
      data-suit={suit}
      aria-label={`${SUIT_META[suit].label} deck${count === undefined ? '' : `, ${count} cards`}`}
    >
      <img className="card-art" src={deckBack(suit)} alt="" draggable={false} />
      {count !== undefined && (
        <span className="card-count" data-text={String(count)}>
          {count}
        </span>
      )}
    </div>
  );
}

/**
 * A card whose identity a seat is not entitled to know: a rival's hand, a card
 * mid-flight. Masked ids keep their suit letter, so the back is the right one.
 */
export function CardHidden({ suit, width }: { suit: Suit | null; width: number }) {
  if (suit) return <CardBack suit={suit} width={width} />;
  return (
    <div
      className="card card-back card-back-unknown"
      style={{ width: `${width}px` }}
      aria-label="a card"
    >
      <img className="card-art" src={token('token-back')} alt="" draggable={false} />
    </div>
  );
}
