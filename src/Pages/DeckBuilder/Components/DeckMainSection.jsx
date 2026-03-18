import "../DeckBuilderPage.css";

const MAIN_DECK_SLOT_COUNT = 60;

function DeckMainSection({
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
  const isDropActive = activeDropSection === "main";

  return (
    <section className={`deck-panel deck-section-panel ${collapsed ? "is-collapsed" : ""}`}>
      <div className="deck-panel-header">
        <h2 className="deck-panel-title">Main Deck</h2>
        <div className="deck-panel-header-actions">
          <div className="deck-panel-count">
            {count} / {MAIN_DECK_SLOT_COUNT}
          </div>
          <button
            type="button"
            className="deck-section-toggle"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand main deck panel" : "Collapse main deck panel"}
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
            onDragActivateSection("main");
          }}
          onDrop={(event) => {
            event.preventDefault();
            onDropToSection("main");
          }}
        >
          {cards.length === 0 ? (
            <div className="deck-section-empty">
              Drop Main Deck cards here.
            </div>
          ) : (
            <div className="deck-main-grid deck-main-grid-compact">
              {cards.map((slot, index) => (
                <div
                  key={`main-card-${slot.instanceKey || `${slot.cardId}-${index}`}`}
                  className="deck-slot deck-slot-filled"
                  draggable={!interactionDisabled}
                  onClick={() => onOpenCardModal(slot.cardId)}
                  onMouseEnter={(event) => onShowHoverCard(slot.cardId, event.currentTarget)}
                  onMouseLeave={onHideHoverCard}
                  onDragStart={() => onDragStartCard(slot.cardId, "main")}
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
                      onRemoveCard(slot.cardId, "main");
                    }}
                    disabled={interactionDisabled}
                    aria-label={`Remove ${slot.card?.name || "card"} from main deck`}
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

export default DeckMainSection;
