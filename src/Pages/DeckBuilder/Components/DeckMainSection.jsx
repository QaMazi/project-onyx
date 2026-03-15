import "../DeckBuilderPage.css";

const MAIN_DECK_SLOT_COUNT = 60;

function DeckMainSection({
  slots,
  hoveredCardId,
  setHoveredCardId,
  onRemoveCard,
  onDropToSection,
  onDragStartCard,
  onDragEndCard,
  activeDropSection,
  buildCardImageUrl,
}) {
  return (
    <section className="deck-panel">
      <div className="deck-panel-header">
        <h2 className="deck-panel-title">Main Deck</h2>
        <div className="deck-panel-count">
          {slots.filter((slot) => slot).length} / {MAIN_DECK_SLOT_COUNT}
        </div>
      </div>

      <div className="deck-main-grid">
        {slots.map((slot, index) => {
          const isDropActive = activeDropSection === "main";

          if (!slot) {
            return (
              <div
                key={`main-empty-${index}`}
                className={`deck-slot ${isDropActive ? "deck-slot-drop-active" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  onDropToSection("main");
                }}
              >
                <div className="deck-slot-empty">Empty</div>
              </div>
            );
          }

          return (
            <div
              key={`main-card-${slot.cardId}-${index}`}
              className={`deck-slot deck-slot-filled ${
                isDropActive ? "deck-slot-drop-active" : ""
              }`}
              draggable
              onDragStart={() => onDragStartCard(slot.cardId, "main")}
              onDragEnd={onDragEndCard}
              onMouseEnter={() => setHoveredCardId(String(slot.cardId))}
              onMouseLeave={() => setHoveredCardId((current) => {
                if (current === String(slot.cardId)) return null;
                return current;
              })}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                onDropToSection("main");
              }}
            >
              <img
                className="deck-slot-image"
                src={buildCardImageUrl(slot.card)}
                alt={slot.card?.name || "Card"}
              />

              <button
                type="button"
                className="deck-slot-remove"
                onClick={() => onRemoveCard(slot.cardId, "main")}
                aria-label={`Remove ${slot.card?.name || "card"} from main deck`}
              >
                −
              </button>

              <div className="deck-slot-overlay">
                <div className="deck-slot-name">{slot.card?.name || "Unknown Card"}</div>
                <div className="deck-slot-qty">x{slot.quantity}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default DeckMainSection;