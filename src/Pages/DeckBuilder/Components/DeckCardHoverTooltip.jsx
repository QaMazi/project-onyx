import "../DeckBuilderPage.css";

function DeckCardHoverTooltip({ preview, buildCardImageUrl }) {
  if (!preview) return null;

  return (
    <div
      className="deck-hover-tooltip"
      style={{
        left: `${preview.x}px`,
        top: `${preview.y}px`,
      }}
    >
      <div className="deck-hover-tooltip-image-wrap">
        <img
          className="deck-hover-tooltip-image"
          src={buildCardImageUrl(preview.card)}
          alt={preview.card?.name || "Card"}
        />
      </div>

      <div className="deck-hover-tooltip-content">
        <h3 className="deck-hover-tooltip-title">
          {preview.card?.name || "Unknown Card"}
        </h3>

        {preview.lines.map((line) => (
          <p className="deck-hover-tooltip-line" key={line}>
            {line}
          </p>
        ))}

        <div className="deck-hover-tooltip-desc">
          {preview.card?.desc || "No description available."}
        </div>
      </div>
    </div>
  );
}

export default DeckCardHoverTooltip;
