function CardFilters({
  totalCount,
  cardKind,
  setCardKind,
  monsterSubtype,
  setMonsterSubtype,
  spellTrapSubtype,
  setSpellTrapSubtype,
  monsterTraits,
  handleMonsterTraitToggle,
  attribute,
  setAttribute,
  race,
  setRace,
  otValue,
  setOtValue,
  levelMin,
  levelMax,
  setLevelMin,
  setLevelMax,
  linkMin,
  linkMax,
  setLinkMin,
  setLinkMax,
  pendulumMin,
  pendulumMax,
  setPendulumMin,
  setPendulumMax,
  atkMin,
  atkMax,
  setAtkMin,
  setAtkMax,
  defMin,
  defMax,
  setDefMin,
  setDefMax,
  handleClearFilters,
  showMonsterSubtypeFilter,
  showSpellTrapSubtypeFilter,
  showMonsterTraitsFilter,
  CARD_KIND_OPTIONS,
  MONSTER_TYPE_OPTIONS,
  SPELL_TRAP_SUBTYPE_OPTIONS,
  MONSTER_TRAIT_OPTIONS,
  ATTRIBUTE_OPTIONS,
  RACE_OPTIONS,
  OT_OPTIONS,
}) {
  return (
    <aside className="card-database-filter-panel">
      <div className="card-database-filter-panel-header">
        <h2 className="card-database-filter-title">Filters</h2>
        <span className="card-database-filter-count">
          {totalCount.toLocaleString()} Cards
        </span>
      </div>

      <div className="card-database-filter-scroll">
        <div className="card-database-filter-group">
          <label className="card-database-filter-label">Card Category</label>
          <select
            className="card-database-filter-input"
            value={cardKind}
            onChange={(event) => setCardKind(event.target.value)}
          >
            {CARD_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card-database-filter-group">
          <label className="card-database-filter-label">Monster Type</label>
          <select
            className="card-database-filter-input"
            value={monsterSubtype}
            onChange={(event) => setMonsterSubtype(event.target.value)}
            disabled={!showMonsterSubtypeFilter}
          >
            {MONSTER_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card-database-filter-group">
          <label className="card-database-filter-label">Spell / Trap Type</label>
          <select
            className="card-database-filter-input"
            value={spellTrapSubtype}
            onChange={(event) => setSpellTrapSubtype(event.target.value)}
            disabled={!showSpellTrapSubtypeFilter}
          >
            {SPELL_TRAP_SUBTYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card-database-filter-group">
          <label className="card-database-filter-label">Monster Traits</label>
          <div className="card-database-checkbox-grid">
            {MONSTER_TRAIT_OPTIONS.map((trait) => (
              <label
                key={trait.value}
                className={`card-database-checkbox-pill ${
                  monsterTraits.includes(trait.value) ? "is-active" : ""
                } ${!showMonsterTraitsFilter ? "is-disabled" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={monsterTraits.includes(trait.value)}
                  disabled={!showMonsterTraitsFilter}
                  onChange={() => handleMonsterTraitToggle(trait.value)}
                />
                <span>{trait.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="card-database-filter-group">
          <label className="card-database-filter-label">Attribute</label>
          <select
            className="card-database-filter-input"
            value={attribute}
            onChange={(event) => setAttribute(event.target.value)}
          >
            {ATTRIBUTE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card-database-filter-group">
          <label className="card-database-filter-label">Type / Race</label>
          <select
            className="card-database-filter-input"
            value={race}
            onChange={(event) => setRace(event.target.value)}
          >
            {RACE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card-database-filter-group">
          <label className="card-database-filter-label">OT / Pool</label>
          <select
            className="card-database-filter-input"
            value={otValue}
            onChange={(event) => setOtValue(event.target.value)}
          >
            {OT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card-database-filter-group">
          <label className="card-database-filter-label">Level / Rank</label>
          <div className="card-database-range-row">
            <input
              type="number"
              min="0"
              max="13"
              className="card-database-filter-input"
              value={levelMin}
              onChange={(event) => setLevelMin(event.target.value)}
              placeholder="Min"
            />
            <span className="card-database-range-divider">-</span>
            <input
              type="number"
              min="0"
              max="13"
              className="card-database-filter-input"
              value={levelMax}
              onChange={(event) => setLevelMax(event.target.value)}
              placeholder="Max"
            />
          </div>
        </div>

        <div className="card-database-filter-group">
          <label className="card-database-filter-label">Link Rating</label>
          <div className="card-database-range-row">
            <input
              type="number"
              min="1"
              max="8"
              className="card-database-filter-input"
              value={linkMin}
              onChange={(event) => setLinkMin(event.target.value)}
              placeholder="Min"
            />
            <span className="card-database-range-divider">-</span>
            <input
              type="number"
              min="1"
              max="8"
              className="card-database-filter-input"
              value={linkMax}
              onChange={(event) => setLinkMax(event.target.value)}
              placeholder="Max"
            />
          </div>
        </div>

        <div className="card-database-filter-group">
          <label className="card-database-filter-label">Pendulum Scale</label>
          <div className="card-database-range-row">
            <input
              type="number"
              min="0"
              max="13"
              className="card-database-filter-input"
              value={pendulumMin}
              onChange={(event) => setPendulumMin(event.target.value)}
              placeholder="Min"
            />
            <span className="card-database-range-divider">-</span>
            <input
              type="number"
              min="0"
              max="13"
              className="card-database-filter-input"
              value={pendulumMax}
              onChange={(event) => setPendulumMax(event.target.value)}
              placeholder="Max"
            />
          </div>
        </div>

        <div className="card-database-filter-group">
          <label className="card-database-filter-label">ATK</label>
          <div className="card-database-range-row">
            <input
              type="number"
              className="card-database-filter-input"
              value={atkMin}
              onChange={(event) => setAtkMin(event.target.value)}
              placeholder="Min ATK"
            />
            <span className="card-database-range-divider">-</span>
            <input
              type="number"
              className="card-database-filter-input"
              value={atkMax}
              onChange={(event) => setAtkMax(event.target.value)}
              placeholder="Max ATK"
            />
          </div>
        </div>

        <div className="card-database-filter-group">
          <label className="card-database-filter-label">DEF</label>
          <div className="card-database-range-row">
            <input
              type="number"
              className="card-database-filter-input"
              value={defMin}
              onChange={(event) => setDefMin(event.target.value)}
              placeholder="Min DEF"
            />
            <span className="card-database-range-divider">-</span>
            <input
              type="number"
              className="card-database-filter-input"
              value={defMax}
              onChange={(event) => setDefMax(event.target.value)}
              placeholder="Max DEF"
            />
          </div>
        </div>

        <button
          type="button"
          className="card-database-clear-btn"
          onClick={handleClearFilters}
        >
          Clear Filters
        </button>
      </div>
    </aside>
  );
}

export default CardFilters;