import "../DeckBuilderPage.css";

function DeckHoverPreview({
  hoveredCard,
  hoveredUsage,
  hoveredBanlistStatus,
  hoveredIsCursed,
  hoveredAllowedSections,
  buildCardImageUrl,
}) {
  if (!hoveredCard) {
    return (
      <div className="deck-hover-preview">
        <h2 className="deck-hover-preview-title">Card Preview</h2>
        <div className="deck-builder-empty">
          Hover a card in the deck or binder to preview it.
        </div>
      </div>
    );
  }

  const typeParts = [];

  if (hoveredCard.type) typeParts.push(`Type: ${hoveredCard.type}`);
  if (hoveredCard.attribute) typeParts.push(`Attribute: ${hoveredCard.attribute}`);
  if (hoveredCard.race) typeParts.push(`Race: ${hoveredCard.race}`);
  if (hoveredCard.level) typeParts.push(`Level: ${hoveredCard.level}`);

  const combatParts = [];
  if (hoveredCard.atk !== null && hoveredCard.atk !== undefined) {
    combatParts.push(`ATK ${hoveredCard.atk}`);
  }
  if (hoveredCard.def !== null && hoveredCard.def !== undefined) {
    combatParts.push(`DEF ${hoveredCard.def}`);
  }

  return (
    <div className="deck-hover-preview">
      <h2 className="deck-hover-preview-title">Card Preview</h2>

      <div className="deck-hover-preview-body">
        <div className="deck-hover-preview-image-wrap">
          <img
            className="deck-hover-preview-image"
            src={buildCardImageUrl(hoveredCard)}
            alt={hoveredCard.name || "Card"}
          />
        </div>

        <div className="deck-hover-preview-meta">
          <h3 className="deck-hover-preview-name">
            {hoveredCard.name || "Unknown Card"}
          </h3>

          <p className="deck-hover-preview-line">
            Owned: {hoveredUsage?.owned ?? 0} • Used: {hoveredUsage?.used ?? 0} • Available: {hoveredUsage?.available ?? 0}
          </p>

          <p className="deck-hover-preview-line">
            Rule: {hoveredBanlistStatus || "unlimited"}
            {hoveredIsCursed ? " • Cursed" : ""}
          </p>

          <p className="deck-hover-preview-line">
            Allowed Sections: {(hoveredAllowedSections || []).join(", ")}
          </p>

          {typeParts.length > 0 && (
            <p className="deck-hover-preview-line">{typeParts.join(" • ")}</p>
          )}

          {combatParts.length > 0 && (
            <p className="deck-hover-preview-line">{combatParts.join(" • ")}</p>
          )}

          <div className="deck-hover-preview-desc">
            {hoveredCard.desc || "No description available."}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DeckHoverPreview;