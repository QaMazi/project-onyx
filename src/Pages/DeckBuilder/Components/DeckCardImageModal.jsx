import "../DeckBuilderPage.css";

function DeckCardImageModal({ card, buildCardImageUrl, onClose }) {
  if (!card) return null;

  return (
    <div className="deck-card-image-modal" onClick={onClose}>
      <img
        src={buildCardImageUrl(card)}
        alt={card.name || "Card"}
        className="deck-card-image-modal-img"
      />
    </div>
  );
}

export default DeckCardImageModal;
