import { X, Landmark, UtensilsCrossed, Hotel, Sparkles, TrainFront, ShoppingBag, MapPin } from 'lucide-react';
import './SpotCard.css';

const CATEGORY_ICONS = {
  attraction: Landmark,
  restaurant: UtensilsCrossed,
  hotel: Hotel,
  experience: Sparkles,
  transport: TrainFront,
  shopping: ShoppingBag,
};

const PRICE_LABELS = ['', '$', '$$', '$$$', '$$$$'];

function formatHours(opening_hours) {
  if (!opening_hours) return null;
  try {
    const parsed = typeof opening_hours === 'string' ? JSON.parse(opening_hours) : opening_hours;
    // Show today's hours if available
    const today = new Date().getDay(); // 0=Sun
    const texts = parsed.weekday_text || parsed;
    if (Array.isArray(texts) && texts[today !== 0 ? today - 1 : 6]) {
      return texts[today !== 0 ? today - 1 : 6];
    }
    return null;
  } catch {
    return typeof opening_hours === 'string' ? opening_hours : null;
  }
}

export default function SpotCard({
  card,
  variant = 'full',
  distance,
  anchorLabel,
  markerNum,
  onRemove,
  onClick,
  placed,
  reasoning,
  className = '',
}) {
  if (!card) return null;

  const isFull = variant === 'full';
  const hasLocation = card.lat && card.lng;
  const hours = formatHours(card.opening_hours || card.timing);
  const priceLabel = card.price_level ? PRICE_LABELS[card.price_level] || '' : '';
  const desc = card.description || card.summary || '';

  const distLabel = distance != null && distance < 900
    ? (distance < 1 ? `${Math.round(distance * 1000)}m` : `${distance.toFixed(1)}km`)
    : null;

  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      className={`spot-card ${variant} ${placed ? 'placed' : ''} ${className}`}
      onClick={onClick}
    >
      {/* Image */}
      {card.image_url && (
        <img src={card.image_url} alt="" className="spot-img" />
      )}

      <div className="spot-body">
        {/* Row 1: title + badges + actions */}
        <div className="spot-row-main">
          {markerNum && <span className="spot-marker">{markerNum}</span>}
          <span className="spot-title">{card.place_name || card.title}</span>
          {card.category && <span className="spot-cat">{(() => { const Icon = CATEGORY_ICONS[card.category] || MapPin; return <Icon size={10} />; })()}</span>}
          {card.rating && <span className="spot-rating">{card.rating}★</span>}
          {priceLabel && <span className="spot-price">{priceLabel}</span>}
          {onRemove && (
            <button className="spot-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}><X size={14} /></button>
          )}
        </div>

        {/* Row 2: address */}
        {card.address && (
          <span className={`spot-addr ${isFull ? '' : 'truncate'}`}>{card.address}</span>
        )}

        {/* Row 3: description */}
        {desc && (
          <span className={`spot-desc ${isFull ? '' : 'truncate-1'}`}>{desc}</span>
        )}

        {/* Row 4: reasoning (AI suggestions only) */}
        {reasoning && (
          <span className="spot-reasoning">{reasoning}</span>
        )}

        {/* Row 5: meta badges */}
        <div className="spot-meta">
          {hours && <span className="spot-hours">{hours}</span>}
          {distLabel && (
            <span className="spot-dist">
              {distLabel}{anchorLabel ? ` from ${anchorLabel}` : ''}
            </span>
          )}
          {!hasLocation && <span className="spot-no-loc">Location unknown</span>}
          {placed && <span className="spot-placed">Day {placed}</span>}
        </div>
      </div>
    </Tag>
  );
}
