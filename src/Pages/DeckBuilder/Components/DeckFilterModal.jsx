import DeckFilterPanel from "./DeckFilterPanel";
import "../DeckBuilderPage.css";

function DeckFilterModal({ isOpen, onClose, ...filterProps }) {
  if (!isOpen) return null;

  return (
    <div
      className="deck-filter-modal"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="deck-filter-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Deck filters"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="deck-filter-modal-close"
          onClick={onClose}
          aria-label="Close filters"
        >
          Close
        </button>

        <DeckFilterPanel {...filterProps} />
      </div>
    </div>
  );
}

export default DeckFilterModal;
