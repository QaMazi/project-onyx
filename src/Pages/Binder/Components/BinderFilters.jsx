import { useState } from "react";

function BinderFilters({
  totalCount,
  searchInput,
  setSearchInput
}) {
  const [localSearch, setLocalSearch] = useState(searchInput || "");

  function handleSearchChange(e) {
    const value = e.target.value;
    setLocalSearch(value);
    setSearchInput(value);
  }

  function clearFilters() {
    setLocalSearch("");
    setSearchInput("");
  }

  return (
    <aside className="binder-filter-panel">

      <div className="binder-filter-panel-header">
        <h2 className="binder-filter-title">Binder</h2>
        <span className="binder-filter-count">
          {totalCount} cards
        </span>
      </div>

      <div className="binder-filter-scroll">

        <div className="binder-filter-group">
          <label className="binder-filter-label">
            Search
          </label>

          <input
            type="text"
            className="binder-filter-input"
            placeholder="Search cards..."
            value={localSearch}
            onChange={handleSearchChange}
          />
        </div>

        <div className="binder-filter-group">
          <button
            className="binder-clear-btn"
            onClick={clearFilters}
          >
            Clear Filters
          </button>
        </div>

      </div>

    </aside>
  );
}

export default BinderFilters;