import "../DeckBuilderPage.css";

function DeckBinderPanel({
  cards,
  searchTerm,
  setSearchTerm,
  filterValue,
  setFilterValue,
  currentPage,
  totalPages,
  onAddToMain,
  onAddToExtra,
  onAddToSide,
  onHoverCard,
  onLeaveCard,
  onDragStartBinderCard,
  onDragEndCard,
  buildCardImageUrl,
}) {
  return (
    <aside className="deck-binder-panel">
      <div className="deck-binder-top">
        <div className="deck-binder-title-row">
          <h2 className="deck-binder-title">Owned Cards</h2>
          <div className="deck-binder-count">
            Page {totalPages > 0 ? currentPage : 0} / {totalPages}
          </div>
        </div>

        <div className="deck-binder-controls">
          <input
            type="text"
            className="deck-binder-search"
            placeholder="Search owned cards..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />

          <select
            className="deck-binder-select"
            value={filterValue}
            onChange={(event) => setFilterValue(event.target.value)}
          >
            <option value="all">All Cards</option>
            <option value="main">Main Deck Cards</option>
            <option value="extra">Extra Deck Cards</option>
            <option value="spell">Spells</option>
            <option value="trap">Traps</option>
            <option value="monster">Monsters</option>
            <option value="available">Only Available</option>
            <option value="cursed">Cursed Cards</option>
          </select>
        </div>
      </div>

      {!cards.length ? (
        <div className="deck-binder-empty">No matching owned cards.</div>
      ) : (
        <div className="deck-binder-list">
          {cards.map((entry) => {
            const {
              card,
              cardId,
              ownedQuantity,
              usedQuantity,
              availableQuantity,
              banlistStatus,
              isCursed,
              allowedSections,
            } = entry;

            return (
              <div
                key={String(cardId)}
                className={`deck-binder-card ${isCursed ? "is-cursed" : ""}`}
                draggable
                onDragStart={() => onDragStartBinderCard(cardId)}
                onDragEnd={onDragEndCard}
                onMouseEnter={() => onHoverCard(String(cardId))}
                onMouseLeave={onLeaveCard}
              >
                <div className="deck-binder-thumb-wrap">
                  <img
                    className="deck-binder-thumb"
                    src={buildCardImageUrl(card)}
                    alt={card?.name || "Card"}
                  />
                </div>

                <div className="deck-binder-meta">
                  <h3 className="deck-binder-name">{card?.name || "Unknown Card"}</h3>

                  <p className="deck-binder-line">
                    Owned: {ownedQuantity} • Used: {usedQuantity} • Available: {availableQuantity}
                  </p>

                  <p className="deck-binder-line">
                    Rule: {banlistStatus}
                    {isCursed ? " • Cursed" : ""}
                  </p>

                  <div className="deck-binder-actions">
                    {allowedSections.includes("main") && (
                      <button
                        type="button"
                        className="deck-binder-action-btn"
                        onClick={() => onAddToMain(cardId)}
                        disabled={availableQuantity <= 0 || isCursed}
                      >
                        + Main
                      </button>
                    )}

                    {allowedSections.includes("extra") && (
                      <button
                        type="button"
                        className="deck-binder-action-btn"
                        onClick={() => onAddToExtra(cardId)}
                        disabled={availableQuantity <= 0 || isCursed}
                      >
                        + Extra
                      </button>
                    )}

                    {allowedSections.includes("side") && (
                      <button
                        type="button"
                        className="deck-binder-action-btn"
                        onClick={() => onAddToSide(cardId)}
                        disabled={availableQuantity <= 0 || isCursed}
                      >
                        + Side
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}

export default DeckBinderPanel;