function CardDetailPanel({
  previewCard,
  previewRows,
  buildCardImageUrl,
  CARD_IMAGE_FALLBACK,
  setImageModalOpen,
  formatCardTextToHtml,
}) {
  return (
    <aside className="card-database-preview-panel">
      <div className="card-database-preview-card">
        {!previewCard ? (
          <div className="card-database-empty-state">
            Hover or click a card to preview it.
          </div>
        ) : (
          <>
            <div className="card-database-preview-image-shell">
              <img
                src={buildCardImageUrl(previewCard)}
                alt={previewCard.name}
                className="card-database-preview-image"
                loading="lazy"
                decoding="async"
                onClick={() => setImageModalOpen(true)}
                onError={(event) => {
                  if (event.currentTarget.src !== CARD_IMAGE_FALLBACK) {
                    event.currentTarget.src = CARD_IMAGE_FALLBACK;
                  }
                }}
              />
            </div>

            <div className="card-database-preview-content">
              <h2 className="card-database-preview-title">{previewCard.name}</h2>

              <div className="card-database-preview-description-shell">
                <h3 className="card-database-preview-subtitle">Description</h3>
                <p
                  className="card-database-preview-description"
                  dangerouslySetInnerHTML={{
                    __html: formatCardTextToHtml(previewCard.desc),
                  }}
                />
              </div>

              <h3 className="card-database-preview-subtitle">Details</h3>
              <div className="card-database-preview-list">
                {previewRows.map((row) => (
                  <div className="card-database-preview-row" key={row.label}>
                    <span className="card-database-preview-label">{row.label}</span>
                    <span className="card-database-preview-value">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

export default CardDetailPanel;