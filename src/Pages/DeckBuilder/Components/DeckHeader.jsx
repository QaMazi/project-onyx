import "../DeckBuilderPage.css";

function DeckHeader({
  deckName,
  setDeckName,
  monsterCount,
  spellCount,
  trapCount,
  deckSlotLabel,
  onBack,
  onSave,
  onDuplicate,
  onDelete,
  onSetActive,
  saveDisabled = false,
  setActiveDisabled = false,
}) {
  return (
    <div className="deck-header">
      <button
        type="button"
        className="deck-header-back-button"
        onClick={onBack}
      >
        Back
      </button>

      <div className="deck-header-center">
        <div className="deck-header-name-row">
          <input
            type="text"
            value={deckName}
            onChange={(event) => setDeckName(event.target.value)}
            className="deck-header-name-input"
            placeholder="Deck Name"
            maxLength={60}
          />

          <div className="deck-header-controls">
            <button
              type="button"
              className="deck-builder-action-btn"
              onClick={onSave}
              disabled={saveDisabled}
            >
              Save
            </button>

            <button
              type="button"
              className="deck-builder-action-btn"
              onClick={onDuplicate}
            >
              Duplicate
            </button>

            <button
              type="button"
              className="deck-builder-action-btn"
              onClick={onDelete}
            >
              Delete
            </button>

            <button
              type="button"
              className="deck-builder-action-btn"
              onClick={onSetActive}
              disabled={setActiveDisabled}
            >
              Set Active
            </button>
          </div>
        </div>

        <div className="deck-header-counts">
          <span>Monsters {monsterCount}</span>
          <span>Spells {spellCount}</span>
          <span>Traps {trapCount}</span>
        </div>
      </div>

      <div className="deck-header-right">
        <div className="deck-header-slot">{deckSlotLabel}</div>
      </div>
    </div>
  );
}

export default DeckHeader;
