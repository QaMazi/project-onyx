import "../DeckBuilderPage.css";

function DeckFilterPanel({
  quickFilter,
  setQuickFilter,
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
  QUICK_FILTER_OPTIONS,
  CARD_KIND_OPTIONS,
  MONSTER_TYPE_OPTIONS,
  SPELL_TRAP_SUBTYPE_OPTIONS,
  MONSTER_TRAIT_OPTIONS,
  ATTRIBUTE_OPTIONS,
  RACE_OPTIONS,
}) {
  return (
    <aside className="deck-filter-panel">
      <div className="deck-filter-panel-header">
        <h3 className="deck-filter-title">Filters</h3>
      </div>

      <div className="deck-filter-scroll">
        <div className="deck-filter-group">
          <label className="deck-filter-label">Quick Filter</label>
          <select
            className="deck-filter-input"
            value={quickFilter}
            onChange={(event) => setQuickFilter(event.target.value)}
          >
            {QUICK_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="deck-filter-group">
          <label className="deck-filter-label">Card Category</label>
          <select
            className="deck-filter-input"
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

        <div className="deck-filter-group">
          <label className="deck-filter-label">Monster Type</label>
          <select
            className="deck-filter-input"
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

        <div className="deck-filter-group">
          <label className="deck-filter-label">Spell / Trap Type</label>
          <select
            className="deck-filter-input"
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

        <div className="deck-filter-group">
          <label className="deck-filter-label">Monster Traits</label>
          <div className="deck-filter-pill-grid">
            {MONSTER_TRAIT_OPTIONS.map((trait) => (
              <label
                key={trait.value}
                className={`deck-filter-pill ${
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

        <div className="deck-filter-group">
          <label className="deck-filter-label">Attribute</label>
          <select
            className="deck-filter-input"
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

        <div className="deck-filter-group">
          <label className="deck-filter-label">Type / Race</label>
          <select
            className="deck-filter-input"
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

        <div className="deck-filter-group">
          <label className="deck-filter-label">Level / Rank</label>
          <div className="deck-filter-range-row">
            <input
              type="number"
              min="0"
              max="13"
              className="deck-filter-input"
              value={levelMin}
              onChange={(event) => setLevelMin(event.target.value)}
              placeholder="Min"
            />
            <span className="deck-filter-range-divider">-</span>
            <input
              type="number"
              min="0"
              max="13"
              className="deck-filter-input"
              value={levelMax}
              onChange={(event) => setLevelMax(event.target.value)}
              placeholder="Max"
            />
          </div>
        </div>

        <div className="deck-filter-group">
          <label className="deck-filter-label">Link Rating</label>
          <div className="deck-filter-range-row">
            <input
              type="number"
              min="1"
              max="8"
              className="deck-filter-input"
              value={linkMin}
              onChange={(event) => setLinkMin(event.target.value)}
              placeholder="Min"
            />
            <span className="deck-filter-range-divider">-</span>
            <input
              type="number"
              min="1"
              max="8"
              className="deck-filter-input"
              value={linkMax}
              onChange={(event) => setLinkMax(event.target.value)}
              placeholder="Max"
            />
          </div>
        </div>

        <div className="deck-filter-group">
          <label className="deck-filter-label">Pendulum Scale</label>
          <div className="deck-filter-range-row">
            <input
              type="number"
              min="0"
              max="13"
              className="deck-filter-input"
              value={pendulumMin}
              onChange={(event) => setPendulumMin(event.target.value)}
              placeholder="Min"
            />
            <span className="deck-filter-range-divider">-</span>
            <input
              type="number"
              min="0"
              max="13"
              className="deck-filter-input"
              value={pendulumMax}
              onChange={(event) => setPendulumMax(event.target.value)}
              placeholder="Max"
            />
          </div>
        </div>

        <div className="deck-filter-group">
          <label className="deck-filter-label">ATK</label>
          <div className="deck-filter-range-row">
            <input
              type="number"
              className="deck-filter-input"
              value={atkMin}
              onChange={(event) => setAtkMin(event.target.value)}
              placeholder="Min"
            />
            <span className="deck-filter-range-divider">-</span>
            <input
              type="number"
              className="deck-filter-input"
              value={atkMax}
              onChange={(event) => setAtkMax(event.target.value)}
              placeholder="Max"
            />
          </div>
        </div>

        <div className="deck-filter-group">
          <label className="deck-filter-label">DEF</label>
          <div className="deck-filter-range-row">
            <input
              type="number"
              className="deck-filter-input"
              value={defMin}
              onChange={(event) => setDefMin(event.target.value)}
              placeholder="Min"
            />
            <span className="deck-filter-range-divider">-</span>
            <input
              type="number"
              className="deck-filter-input"
              value={defMax}
              onChange={(event) => setDefMax(event.target.value)}
              placeholder="Max"
            />
          </div>
        </div>

        <button
          type="button"
          className="deck-builder-action-btn deck-filter-clear-btn"
          onClick={handleClearFilters}
        >
          Clear Filters
        </button>
      </div>
    </aside>
  );
}

export default DeckFilterPanel;
