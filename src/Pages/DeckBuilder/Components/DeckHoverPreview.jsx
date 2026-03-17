import "../DeckBuilderPage.css";

function DeckHoverPreview({
  previewCard,
  previewUsage,
  previewBanlistStatus,
  previewIsCursed,
  previewAllowedSections,
  buildCardImageUrl,
}) {
  if (!previewCard) {
    return (
      <div className="deck-hover-preview">
        <h2 className="deck-hover-preview-title">Card Preview</h2>
        <div className="deck-builder-empty">
          Click a card in the binder or deck to preview it.
        </div>
      </div>
    );
  }

  const typeParts = [];

  if (previewCard.type) typeParts.push(`Type: ${previewCard.type}`);
  if (previewCard.attribute) typeParts.push(`Attribute: ${previewCard.attribute}`);
  if (previewCard.race) typeParts.push(`Race: ${previewCard.race}`);
  if (previewCard.level) typeParts.push(`Level: ${previewCard.level}`);

  const combatParts = [];
  if (previewCard.atk !== null && previewCard.atk !== undefined) {
    combatParts.push(`ATK ${previewCard.atk}`);
  }
  if (previewCard.def !== null && previewCard.def !== undefined) {
    combatParts.push(`DEF ${previewCard.def}`);
  }

  return (
    <div className="deck-hover-preview">
      <h2 className="deck-hover-preview-title">Card Preview</h2>

      <div className="deck-hover-preview-body">
        <div className="deck-hover-preview-image-wrap">
          <img
            className="deck-hover-preview-image"
            src={buildCardImageUrl(previewCard)}
            alt={previewCard.name || "Card"}
          />
        </div>

        <div className="deck-hover-preview-meta">
          <h3 className="deck-hover-preview-name">
            {previewCard.name || "Unknown Card"}
          </h3>

          <p className="deck-hover-preview-line">
            Owned: {previewUsage?.owned ?? 0} | Used: {previewUsage?.used ?? 0} | Available: {previewUsage?.available ?? 0}
          </p>

          <p className="deck-hover-preview-line">
            Rule: {previewBanlistStatus || "unlimited"}
            {previewIsCursed ? " | Cursed" : ""}
          </p>

          <p className="deck-hover-preview-line">
            Allowed Sections: {(previewAllowedSections || []).join(", ")}
          </p>

          {typeParts.length > 0 && (
            <p className="deck-hover-preview-line">{typeParts.join(" | ")}</p>
          )}

          {combatParts.length > 0 && (
            <p className="deck-hover-preview-line">{combatParts.join(" | ")}</p>
          )}

          <div className="deck-hover-preview-desc">
            {previewCard.desc || "No description available."}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DeckHoverPreview;
