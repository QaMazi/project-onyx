function CardGrid({
  loadError,
  loadingCards,
  typeIndexLoading,
  cards,
  lockedCard,
  hoveredCard,
  setHoveredCard,
  setLockedCard,
  buildCardImageUrl,
  CARD_IMAGE_FALLBACK,
}) {
  return (
    <div className="card-database-grid-card">
      {loadError ? (
        <div className="card-database-empty-state">{loadError}</div>
      ) : loadingCards || typeIndexLoading ? (
        <div className="card-database-empty-state">Loading cards...</div>
      ) : cards.length === 0 ? (
        <div className="card-database-empty-state">No cards found.</div>
      ) : (
        <div className="card-database-grid">
          {cards.map((card) => {
            const isLocked = lockedCard?.id === card.id;
            const isHovered = hoveredCard?.id === card.id;

            return (
              <button
                key={card.id}
                type="button"
                className={`card-database-tile ${
                  isLocked ? "is-selected" : ""
                } ${isHovered ? "is-hovered" : ""}`}
                onMouseEnter={() => setHoveredCard(card)}
                onMouseLeave={() => setHoveredCard(null)}
                onClick={() => setLockedCard(card)}
              >
                <div className="card-database-tile-image-shell">
                  <img
                    src={buildCardImageUrl(card)}
                    alt={card.name}
                    className="card-database-tile-image"
                    loading="lazy"
                    decoding="async"
                    onError={(event) => {
                      if (event.currentTarget.src !== CARD_IMAGE_FALLBACK) {
                        event.currentTarget.src = CARD_IMAGE_FALLBACK;
                      }
                    }}
                  />
                </div>

                <div className="card-database-tile-name">{card.name}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default CardGrid;