function Pagination({
  page,
  setPage,
  totalPages,
  visiblePages,
  pageJumpInput,
  setPageJumpInput,
  clampPage,
}) {
  return (
    <div className="card-database-pagination-bar">
      <button
        type="button"
        className="card-database-page-btn"
        onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
        disabled={page === 1}
      >
        Previous
      </button>

      <div className="card-database-page-list">
        {visiblePages.map((pageNumber) => (
          <button
            key={pageNumber}
            type="button"
            className={`card-database-page-btn ${
              page === pageNumber ? "is-active" : ""
            }`}
            onClick={() => setPage(pageNumber)}
          >
            {pageNumber}
          </button>
        ))}
      </div>

      <div className="card-database-page-jump">
        <span className="card-database-page-jump-label">Page</span>
        <input
          type="number"
          min="1"
          max={totalPages}
          className="card-database-page-jump-input"
          value={pageJumpInput}
          onChange={(event) => setPageJumpInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              const nextPage = clampPage(Number(pageJumpInput || 1), totalPages);
              setPage(nextPage);
            }
          }}
        />
        <button
          type="button"
          className="card-database-page-btn"
          onClick={() => {
            const nextPage = clampPage(Number(pageJumpInput || 1), totalPages);
            setPage(nextPage);
          }}
        >
          Go
        </button>
      </div>

      <button
        type="button"
        className="card-database-page-btn"
        onClick={() =>
          setPage((currentPage) => Math.min(totalPages, currentPage + 1))
        }
        disabled={page === totalPages}
      >
        Next
      </button>
    </div>
  );
}

export default Pagination;