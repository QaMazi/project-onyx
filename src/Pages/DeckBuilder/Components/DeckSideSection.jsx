import "../DeckBuilderPage.css";

const SIDE_DECK_SLOT_COUNT = 15;

function DeckSideSection({
  cards,
  count,
  collapsed,
  onToggleCollapsed,
  activeDropSection,
  onDragActivateSection,
  onDropToSection,
  onDragStartCard,
  onDragEndCard,
  onRemoveCard,
  onOpenCardModal,
  onShowHoverCard,
  onHideHoverCard,
  buildCardImageUrl,
  interactionDisabled = false,
}) {
  const isDropActive = activeDropSection === "side";

  return (
    <section className={`deck-panel deck-section-panel ${collapsed ? "is-collapsed" : ""}`}>
      <div className="deck-panel-header">
        <h2 className="deck-panel-title">Side Deck</h2>
        <div className="deck-panel-header-actions">
          <div className="deck-panel-count">
            {count} / {SIDE_DECK_SLOT_COUNT}
          </div>
          <button
            type="button"
            className="deck-section-toggle"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand side deck panel" : "Collapse side deck panel"}
          >
            {collapsed ? "+" : "-"}
          </button>
        </div>
      </div>

      {!collapsed ? (
        <div
          className={`deck-section-dropzone ${isDropActive ? "deck-slot-drop-active" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            onDragActivateSection("side");
          }}
          onDrop={(event) => {
            event.preventDefault();
            onDropToSection("side");
          }}
        >
          {cards.length === 0 ? (
            <div className="deck-section-empty">
              Drop Side Deck cards here.
            </div>
          ) : (
            <div className="deck-row-grid deck-row-grid-compact">
              {cards.map((slot, index) => (
                <div
                  key={`side-card-${slot.instanceKey || `${slot.cardId}-${index}`}`}
                  className="deck-slot deck-slot-filled"
                  draggable={!interactionDisabled}
                  onClick={() => onOpenCardModal(slot.cardId)}
                  onMouseEnter={(event) => onShowHoverCard(slot.cardId, event.currentTarget)}
                  onMouseLeave={onHideHoverCard}
                  onDragStart={() => onDragStartCard(slot.cardId, "side")}
                  onDragEnd={onDragEndCard}
                >
                  <img
                    className="deck-slot-image"
                    src={buildCardImageUrl(slot.card)}
                    alt={slot.card?.name || "Card"}
                  />

                  <button
                    type="button"
                    className="deck-slot-remove"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveCard(slot.cardId, "side");
                    }}
                    disabled={interactionDisabled}
                    aria-label={`Remove ${slot.card?.name || "card"} from side deck`}
                  >
                    -
                  </button>

                  <div className="deck-slot-overlay">
                    <div className="deck-slot-name">{slot.card?.name || "Unknown Card"}</div>
                    <div className="deck-slot-qty">1</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default DeckSideSection;
