function BinderGrid({
  loadError,
  loadingBinder,
  hasActiveSeries,
  groups,
  activeGroupKey,
  hoveredGroupKey,
  onHoverGroup,
  onLeaveGroup,
  onOpenGroupModal,
  buildCardImageUrl,
  CARD_IMAGE_FALLBACK,
}) {
  if (loadingBinder) {
    return (
      <div className="binder-grid-card">
        <div className="binder-empty-state">Loading binder...</div>
      </div>
    );
  }

  if (!hasActiveSeries) {
    return (
      <div className="binder-grid-card">
        <div className="binder-empty-state">No active series.</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="binder-grid-card">
        <div className="binder-empty-state">{loadError}</div>
      </div>
    );
  }

  if (!groups.length) {
    return (
      <div className="binder-grid-card">
        <div className="binder-empty-state">Your binder is empty.</div>
      </div>
    );
  }

  return (
    <div className="binder-grid-card">
      <div className="binder-grid">
        {groups.map((group) => {
          const isSelected = activeGroupKey === group.groupKey;
          const isHovered = hoveredGroupKey === group.groupKey;

          return (
            <button
              key={group.groupKey}
              type="button"
              className={`binder-tile ${isSelected ? "is-selected" : ""} ${isHovered ? "is-hovered" : ""}`}
              onClick={() => onOpenGroupModal(group)}
              onMouseEnter={(event) => onHoverGroup(group, event.currentTarget)}
              onMouseLeave={onLeaveGroup}
            >
              <div className="binder-tile-image-shell">
                <img
                  className="binder-tile-image"
                  src={buildCardImageUrl(group.card)}
                  alt={group.card?.name || "Card"}
                  onError={(event) => {
                    if (event.currentTarget.src !== CARD_IMAGE_FALLBACK) {
                      event.currentTarget.src = CARD_IMAGE_FALLBACK;
                    }
                  }}
                />
              </div>

              <div className="binder-tile-name">{group.card?.name}</div>
              <div className="binder-tile-quantity">x{group.totalQuantity}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default BinderGrid;
