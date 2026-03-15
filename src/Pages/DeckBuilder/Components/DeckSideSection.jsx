import "../DeckBuilderPage.css";

const SIDE_DECK_SLOT_COUNT = 15;

function DeckSideSection({
  slots,
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
        <h2 className="deck-panel-title">Side Deck</h2>
        <div className="deck-panel-count">
          {slots.filter((slot) => slot).length} / {SIDE_DECK_SLOT_COUNT}
        </div>
      </div>

      <div className="deck-row-grid">
        {slots.map((slot, index) => {
          const isDropActive = activeDropSection === "side";

          if (!slot) {
            return (
              <div
                key={`side-empty-${index}`}
                className={`deck-slot ${isDropActive ? "deck-slot-drop-active" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  onDropToSection("side");
                }}
              >
                <div className="deck-slot-empty">Empty</div>
              </div>
            );
          }

          return (
            <div
              key={`side-card-${slot.cardId}-${index}`}
              className={`deck-slot deck-slot-filled ${
                isDropActive ? "deck-slot-drop-active" : ""
              }`}
              draggable
              onDragStart={() => onDragStartCard(slot.cardId, "side")}
              onDragEnd={onDragEndCard}
              onMouseEnter={() => setHoveredCardId(String(slot.cardId))}
              onMouseLeave={() =>
                setHoveredCardId((current) => {
                  if (current === String(slot.cardId)) return null;
                  return current;
                })
              }
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                onDropToSection("side");
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
                onClick={() => onRemoveCard(slot.cardId, "side")}
                aria-label={`Remove ${slot.card?.name || "card"} from side deck`}
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

export default DeckSideSection;