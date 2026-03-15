function BinderGrid({
  loadError,
  loadingBinder,
  hasActiveSeries,
  groups,
  selectedGroupKey,
  hoveredGroupKey,
  setSelectedGroupKey,
  setHoveredGroupKey,
  buildCardImageUrl,
  CARD_IMAGE_FALLBACK
}) {

  if (loadingBinder) {
    return (
      <div className="binder-grid-card">
        <div className="binder-empty-state">
          Loading binder...
        </div>
      </div>
    );
  }

  if (!hasActiveSeries) {
    return (
      <div className="binder-grid-card">
        <div className="binder-empty-state">
          No active series.
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="binder-grid-card">
        <div className="binder-empty-state">
          {loadError}
        </div>
      </div>
    );
  }

  if (!groups.length) {
    return (
      <div className="binder-grid-card">
        <div className="binder-empty-state">
          Your binder is empty.
        </div>
      </div>
    );
  }

  return (
    <div className="binder-grid-card">

      <div className="binder-grid">

        {groups.map((group) => {

          const isSelected = selectedGroupKey === group.groupKey;
          const isHovered = hoveredGroupKey === group.groupKey;

          const imageUrl = buildCardImageUrl(group.card);

          return (
            <button
              key={group.groupKey}
              className={`binder-tile 
                ${isSelected ? "is-selected" : ""}
                ${isHovered ? "is-hovered" : ""}`}
              onClick={() => setSelectedGroupKey(group.groupKey)}
              onMouseEnter={() => setHoveredGroupKey(group.groupKey)}
              onMouseLeave={() => setHoveredGroupKey(null)}
            >

              <div className="binder-tile-image-shell">

                <img
                  className="binder-tile-image"
                  src={imageUrl}
                  alt={group.card?.name || "Card"}
                  onError={(e) => {
  if (e.currentTarget.src !== CARD_IMAGE_FALLBACK) {
    e.currentTarget.src = CARD_IMAGE_FALLBACK;
  }
}}
                />

              </div>

              <div className="binder-tile-name">
                {group.card?.name}
              </div>

              <div className="binder-tile-quantity">
                x{group.totalQuantity}
              </div>

            </button>
          );

        })}

      </div>

    </div>
  );
}

export default BinderGrid;