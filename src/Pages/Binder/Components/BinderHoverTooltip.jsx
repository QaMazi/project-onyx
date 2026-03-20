import "../BinderPage.css";

function BinderHoverTooltip({ preview, buildCardImageUrl, CARD_IMAGE_FALLBACK }) {
  if (!preview) return null;

  const { group, x, y } = preview;
  const card = preview.card || group?.card || null;
  const lines = Array.isArray(preview.lines)
    ? preview.lines
    : group
    ? [
        `Total Owned: x${group.totalQuantity || 0}`,
        `Trade Locked: x${group.totalLockedQuantity || 0}`,
        `Rarities: ${
          (group.rarities || [])
            .map((entry) => `${entry.rarity?.name || "Unknown"} x${entry.quantity}`)
            .join(" | ") || "None"
        }`,
      ]
    : [];

  return (
    <div
      className="binder-hover-tooltip"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      <div className="binder-hover-tooltip-image-shell">
        <img
          className="binder-hover-tooltip-image"
          src={buildCardImageUrl(card)}
          alt={card?.name || card?.card_name || "Card"}
          onError={(event) => {
            if (event.currentTarget.src !== CARD_IMAGE_FALLBACK) {
              event.currentTarget.src = CARD_IMAGE_FALLBACK;
            }
          }}
        />
      </div>

      <div className="binder-hover-tooltip-content">
        <h3 className="binder-hover-tooltip-title">
          {card?.name || card?.card_name || "Unknown Card"}
        </h3>
        {lines.map((line) => (
          <p key={line} className="binder-hover-tooltip-line">
            {line}
          </p>
        ))}
        <div className="binder-hover-tooltip-desc">{card?.desc || "No description available."}</div>
      </div>
    </div>
  );
}

export default BinderHoverTooltip;
