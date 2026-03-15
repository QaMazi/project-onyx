import "../DeckBuilderPage.css";

function DeckPagination({
  currentPage,
  totalPages,
  pageInput,
  setPageInput,
  onPrevPage,
  onNextPage,
  onGoToPage,
}) {
  const safeTotalPages = Math.max(1, totalPages || 1);

  return (
    <div className="deck-pagination-panel">
      <div className="deck-pagination">
        <div className="deck-pagination-left">
          <button
            type="button"
            className="deck-pagination-btn"
            onClick={onPrevPage}
            disabled={currentPage <= 1}
          >
            Prev
          </button>

          <button
            type="button"
            className="deck-pagination-btn"
            onClick={onNextPage}
            disabled={currentPage >= safeTotalPages}
          >
            Next
          </button>
        </div>

        <div className="deck-pagination-center">
          <button
            type="button"
            className="deck-pagination-btn deck-pagination-page is-active"
          >
            {currentPage}
          </button>

          <span className="deck-binder-count">of {safeTotalPages}</span>
        </div>

        <div className="deck-pagination-right">
          <input
            type="number"
            min="1"
            max={safeTotalPages}
            className="deck-pagination-input"
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onGoToPage();
              }
            }}
          />

          <button
            type="button"
            className="deck-pagination-btn"
            onClick={onGoToPage}
          >
            Go
          </button>
        </div>
      </div>
    </div>
  );
}

export default DeckPagination;