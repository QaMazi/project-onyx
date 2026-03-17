import "../BinderPage.css";

function BinderHoverTooltip({ preview, buildCardImageUrl, CARD_IMAGE_FALLBACK }) {
  if (!preview?.group) return null;

  const { group, x, y } = preview;
  const raritySummary =
    (group.rarities || [])
      .map((entry) => `${entry.rarity?.name || "Unknown"} x${entry.quantity}`)
      .join(" | ") || "None";

  return (
    <div
      className="binder-hover-tooltip"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      <div className="binder-hover-tooltip-image-shell">
        <img
          className="binder-hover-tooltip-image"
          src={buildCardImageUrl(group.card)}
          alt={group.card?.name || "Card"}
          onError={(event) => {
            if (event.currentTarget.src !== CARD_IMAGE_FALLBACK) {
              event.currentTarget.src = CARD_IMAGE_FALLBACK;
            }
          }}
        />
      </div>

      <div className="binder-hover-tooltip-content">
        <h3 className="binder-hover-tooltip-title">{group.card?.name || "Unknown Card"}</h3>
        <p className="binder-hover-tooltip-line">Total Owned: x{group.totalQuantity || 0}</p>
        <p className="binder-hover-tooltip-line">Trade Locked: x{group.totalLockedQuantity || 0}</p>
        <p className="binder-hover-tooltip-line">Rarities: {raritySummary}</p>
        <div className="binder-hover-tooltip-desc">
          {group.card?.desc || "No description available."}
        </div>
      </div>
    </div>
  );
}

export default BinderHoverTooltip;
