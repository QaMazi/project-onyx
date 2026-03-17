import "../DeckBuilderPage.css";

const EXTRA_DECK_SLOT_COUNT = 15;

function DeckExtraSection({
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
}) {
  const isDropActive = activeDropSection === "extra";

  return (
    <section className={`deck-panel deck-section-panel ${collapsed ? "is-collapsed" : ""}`}>
      <div className="deck-panel-header">
        <h2 className="deck-panel-title">Extra Deck</h2>
        <div className="deck-panel-header-actions">
          <div className="deck-panel-count">
            {count} / {EXTRA_DECK_SLOT_COUNT}
          </div>
          <button
            type="button"
            className="deck-section-toggle"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand extra deck panel" : "Collapse extra deck panel"}
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
            onDragActivateSection("extra");
          }}
          onDrop={(event) => {
            event.preventDefault();
            onDropToSection("extra");
          }}
        >
          {cards.length === 0 ? (
            <div className="deck-section-empty">
              Drop Extra Deck cards here.
            </div>
          ) : (
            <div className="deck-row-grid deck-row-grid-compact">
              {cards.map((slot, index) => (
                <div
                  key={`extra-card-${slot.instanceKey || `${slot.cardId}-${index}`}`}
                  className="deck-slot deck-slot-filled"
                  draggable
                  onClick={() => onOpenCardModal(slot.cardId)}
                  onMouseEnter={(event) => onShowHoverCard(slot.cardId, event.currentTarget)}
                  onMouseLeave={onHideHoverCard}
                  onDragStart={() => onDragStartCard(slot.cardId, "extra")}
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
                      onRemoveCard(slot.cardId, "extra");
                    }}
                    aria-label={`Remove ${slot.card?.name || "card"} from extra deck`}
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

export default DeckExtraSection;
