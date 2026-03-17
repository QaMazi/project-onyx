import "../DeckBuilderPage.css";

function DeckBinderPanel({
  cards,
  totalCount,
  searchTerm,
  setSearchTerm,
  searchMode,
  setSearchMode,
  sortField,
  setSortField,
  sortDirection,
  setSortDirection,
  filtersOpen,
  setFiltersOpen,
  SEARCH_MODE_OPTIONS,
  SORT_OPTIONS,
  onAddToMain,
  onAddToExtra,
  onAddToSide,
  onHoverCard,
  onLeaveCard,
  onOpenCardModal,
  onDragStartBinderCard,
  onDragEndCard,
  buildCardImageUrl,
}) {
  return (
    <aside className="deck-browser-panel">
      <div className="deck-browser-toolbar">
        <div className="deck-browser-title-row">
          <div>
            <h2 className="deck-binder-title">Owned Cards</h2>
            <div className="deck-binder-count">{totalCount} matching cards</div>
          </div>

          <button
            type="button"
            className="deck-builder-action-btn"
            onClick={() => setFiltersOpen((current) => !current)}
          >
            {filtersOpen ? "Close Filters" : "Show Filters"}
          </button>
        </div>

        <div className="deck-browser-search-row">
          <input
            type="text"
            className="deck-binder-search"
            placeholder="Search owned cards..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />

          <select
            className="deck-binder-select"
            value={searchMode}
            onChange={(event) => setSearchMode(event.target.value)}
          >
            {SEARCH_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="deck-browser-search-row deck-browser-search-row-sort">
          <select
            className="deck-binder-select"
            value={sortField}
            onChange={(event) => setSortField(event.target.value)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="deck-builder-action-btn"
            onClick={() =>
              setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
            }
          >
            {sortDirection === "asc" ? "Asc" : "Desc"}
          </button>
        </div>
      </div>

      <div className="deck-browser-body">
        <div className="deck-browser-list-panel">
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
                    onClick={() => onOpenCardModal(cardId)}
                    onMouseEnter={(event) => onHoverCard(cardId, event.currentTarget)}
                    onMouseLeave={onLeaveCard}
                    onDragStart={() => onDragStartBinderCard(cardId)}
                    onDragEnd={onDragEndCard}
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
                        Owned: {ownedQuantity} | Used: {usedQuantity} | Available: {availableQuantity}
                      </p>

                      <p className="deck-binder-line">
                        Rule: {banlistStatus}
                        {isCursed ? " | Cursed" : ""}
                      </p>

                      <div className="deck-binder-actions">
                        {allowedSections.includes("main") && (
                          <button
                            type="button"
                            className="deck-binder-action-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              onAddToMain(cardId);
                            }}
                            disabled={availableQuantity <= 0 || isCursed}
                          >
                            + Main
                          </button>
                        )}

                        {allowedSections.includes("extra") && (
                          <button
                            type="button"
                            className="deck-binder-action-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              onAddToExtra(cardId);
                            }}
                            disabled={availableQuantity <= 0 || isCursed}
                          >
                            + Extra
                          </button>
                        )}

                        {allowedSections.includes("side") && (
                          <button
                            type="button"
                            className="deck-binder-action-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              onAddToSide(cardId);
                            }}
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
        </div>
      </div>
    </aside>
  );
}

export default DeckBinderPanel;
