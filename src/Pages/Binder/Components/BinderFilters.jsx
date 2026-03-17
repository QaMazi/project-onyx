function BinderFilters({
  totalCount,
  searchInput,
  setSearchInput,
  sortField,
  setSortField,
  sortDirection,
  setSortDirection,
  cardKindFilter,
  setCardKindFilter,
  rarityFilter,
  setRarityFilter,
  rarityOptions,
  tradeStatusFilter,
  setTradeStatusFilter,
  handleClearFilters,
  SORT_OPTIONS,
  CARD_KIND_OPTIONS,
  TRADE_STATUS_OPTIONS,
}) {
  return (
    <aside className="binder-filter-panel">
      <div className="binder-filter-panel-header">
        <h2 className="binder-filter-title">Binder</h2>
        <span className="binder-filter-count">{totalCount} cards</span>
      </div>

      <div className="binder-filter-scroll">
        <div className="binder-filter-group">
          <label className="binder-filter-label">Search</label>
          <input
            type="text"
            className="binder-filter-input"
            placeholder="Search cards..."
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <div className="binder-filter-group">
          <label className="binder-filter-label">Sort By</label>
          <select
            className="binder-filter-input"
            value={sortField}
            onChange={(event) => setSortField(event.target.value)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="binder-filter-group">
          <label className="binder-filter-label">Sort Direction</label>
          <button
            type="button"
            className="binder-clear-btn"
            onClick={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))}
          >
            {sortDirection === "asc" ? "Ascending" : "Descending"}
          </button>
        </div>

        <div className="binder-filter-group">
          <label className="binder-filter-label">Card Category</label>
          <select
            className="binder-filter-input"
            value={cardKindFilter}
            onChange={(event) => setCardKindFilter(event.target.value)}
          >
            {CARD_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="binder-filter-group">
          <label className="binder-filter-label">Rarity</label>
          <select
            className="binder-filter-input"
            value={rarityFilter}
            onChange={(event) => setRarityFilter(event.target.value)}
          >
            {rarityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="binder-filter-group">
          <label className="binder-filter-label">Trade Status</label>
          <select
            className="binder-filter-input"
            value={tradeStatusFilter}
            onChange={(event) => setTradeStatusFilter(event.target.value)}
          >
            {TRADE_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="binder-filter-group">
          <button
            type="button"
            className="binder-clear-btn"
            onClick={handleClearFilters}
          >
            Clear Filters
          </button>
        </div>
      </div>
    </aside>
  );
}

export default BinderFilters;
