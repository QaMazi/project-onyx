import { useEffect, useMemo, useState } from "react";
import "../BinderPage.css";

const TYPE_FLAGS = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
  EFFECT: 0x20,
  FUSION: 0x40,
  RITUAL: 0x80,
  CONTINUOUS: 0x20000,
  EQUIP: 0x40000,
  FIELD: 0x80000,
  COUNTER: 0x100000,
  XYZ: 0x800000,
  PENDULUM: 0x1000000,
  LINK: 0x4000000,
  QUICKPLAY: 0x10000,
  SYNCHRO: 0x2000,
  TOKEN: 0x4000,
};

const ATTRIBUTE_OPTIONS = [
  { label: "Earth", value: 1 },
  { label: "Water", value: 2 },
  { label: "Fire", value: 4 },
  { label: "Wind", value: 8 },
  { label: "Light", value: 16 },
  { label: "Dark", value: 32 },
  { label: "Divine", value: 64 },
];

const RACE_OPTIONS = [
  { label: "Warrior", value: 1 },
  { label: "Spellcaster", value: 2 },
  { label: "Fairy", value: 4 },
  { label: "Fiend", value: 8 },
  { label: "Zombie", value: 16 },
  { label: "Machine", value: 32 },
  { label: "Aqua", value: 64 },
  { label: "Pyro", value: 128 },
  { label: "Rock", value: 256 },
  { label: "Winged Beast", value: 512 },
  { label: "Plant", value: 1024 },
  { label: "Insect", value: 2048 },
  { label: "Thunder", value: 4096 },
  { label: "Dragon", value: 8192 },
  { label: "Beast", value: 16384 },
  { label: "Beast-Warrior", value: 32768 },
  { label: "Dinosaur", value: 65536 },
  { label: "Fish", value: 131072 },
  { label: "Sea Serpent", value: 262144 },
  { label: "Reptile", value: 524288 },
  { label: "Psychic", value: 1048576 },
  { label: "Divine Beast", value: 2097152 },
  { label: "Creator God", value: 4194304 },
  { label: "Wyrm", value: 8388608 },
  { label: "Cyberse", value: 16777216 },
];

function decodeAttribute(value) {
  const normalized = Number(value || 0);
  return ATTRIBUTE_OPTIONS.find((option) => option.value === normalized)?.label || "Unknown";
}

function decodeRace(value) {
  const normalized = Number(value || 0);
  return RACE_OPTIONS.find((option) => option.value === normalized)?.label || "Unknown";
}

function getCardKind(typeValue) {
  const normalized = Number(typeValue || 0);
  if ((normalized & TYPE_FLAGS.MONSTER) === TYPE_FLAGS.MONSTER) return "Monster";
  if ((normalized & TYPE_FLAGS.SPELL) === TYPE_FLAGS.SPELL) return "Spell";
  if ((normalized & TYPE_FLAGS.TRAP) === TYPE_FLAGS.TRAP) return "Trap";
  return "Unknown";
}

function getMonsterSubtype(typeValue) {
  const normalized = Number(typeValue || 0);
  if ((normalized & TYPE_FLAGS.MONSTER) !== TYPE_FLAGS.MONSTER) return null;
  if ((normalized & TYPE_FLAGS.LINK) === TYPE_FLAGS.LINK) return "Link";
  if ((normalized & TYPE_FLAGS.XYZ) === TYPE_FLAGS.XYZ) return "Xyz";
  if ((normalized & TYPE_FLAGS.SYNCHRO) === TYPE_FLAGS.SYNCHRO) return "Synchro";
  if ((normalized & TYPE_FLAGS.FUSION) === TYPE_FLAGS.FUSION) return "Fusion";
  if ((normalized & TYPE_FLAGS.RITUAL) === TYPE_FLAGS.RITUAL) return "Ritual";
  if ((normalized & TYPE_FLAGS.TOKEN) === TYPE_FLAGS.TOKEN) return "Token";
  if ((normalized & TYPE_FLAGS.PENDULUM) === TYPE_FLAGS.PENDULUM) return "Pendulum";
  if ((normalized & TYPE_FLAGS.EFFECT) === TYPE_FLAGS.EFFECT) return "Effect";
  return "Normal";
}

function getSpellTrapSubtype(typeValue) {
  const normalized = Number(typeValue || 0);
  const isSpell = (normalized & TYPE_FLAGS.SPELL) === TYPE_FLAGS.SPELL;
  const isTrap = (normalized & TYPE_FLAGS.TRAP) === TYPE_FLAGS.TRAP;
  if (!isSpell && !isTrap) return null;
  if ((normalized & TYPE_FLAGS.COUNTER) === TYPE_FLAGS.COUNTER) return "Counter";
  if ((normalized & TYPE_FLAGS.FIELD) === TYPE_FLAGS.FIELD) return "Field";
  if ((normalized & TYPE_FLAGS.EQUIP) === TYPE_FLAGS.EQUIP) return "Equip";
  if ((normalized & TYPE_FLAGS.CONTINUOUS) === TYPE_FLAGS.CONTINUOUS) return "Continuous";
  if ((normalized & TYPE_FLAGS.QUICKPLAY) === TYPE_FLAGS.QUICKPLAY) return "Quick-Play";
  if ((normalized & TYPE_FLAGS.RITUAL) === TYPE_FLAGS.RITUAL && isSpell) return "Ritual";
  return "Normal";
}

function getLinkRating(typeValue, levelValue) {
  const normalizedType = Number(typeValue || 0);
  if ((normalizedType & TYPE_FLAGS.LINK) !== TYPE_FLAGS.LINK) return null;
  return Number(levelValue || 0) & 0xff;
}

function getDisplayLevelOrRank(typeValue, levelValue) {
  const normalizedType = Number(typeValue || 0);
  const rawLevel = Number(levelValue || 0);
  if ((normalizedType & TYPE_FLAGS.LINK) === TYPE_FLAGS.LINK) return null;
  return rawLevel & 0xff;
}

function buildDetailRows(card) {
  if (!card) return [];

  const typeValue = Number(card.type || 0);
  const cardKind = getCardKind(typeValue);
  const monsterSubtype = getMonsterSubtype(typeValue);
  const spellTrapSubtype = getSpellTrapSubtype(typeValue);
  const linkRating = getLinkRating(typeValue, card.level);
  const displayLevelOrRank = getDisplayLevelOrRank(typeValue, card.level);

  const rows = [{ label: "Card Kind", value: cardKind }];

  if (cardKind === "Monster" && monsterSubtype) {
    rows.push({ label: "Monster Type", value: monsterSubtype });
  }

  if ((cardKind === "Spell" || cardKind === "Trap") && spellTrapSubtype) {
    rows.push({ label: "Spell / Trap Type", value: spellTrapSubtype });
  }

  if (cardKind === "Monster" && Number(card.attribute || 0) > 0) {
    rows.push({ label: "Attribute", value: decodeAttribute(card.attribute) });
  }

  if (cardKind === "Monster" && Number(card.race || 0) > 0) {
    rows.push({ label: "Race", value: decodeRace(card.race) });
  }

  if (cardKind === "Monster" && displayLevelOrRank != null) {
    rows.push({
      label: monsterSubtype === "Xyz" ? "Rank" : "Level",
      value: displayLevelOrRank,
    });
  }

  if (cardKind === "Monster" && linkRating != null) {
    rows.push({ label: "Link Rating", value: linkRating });
  }

  if (cardKind === "Monster" && card.atk != null) {
    rows.push({ label: "ATK", value: card.atk });
  }

  if (cardKind === "Monster" && monsterSubtype !== "Link" && card.def != null) {
    rows.push({ label: "DEF", value: card.def });
  }

  return rows;
}

function BinderCardModal({
  group,
  buildCardImageUrl,
  CARD_IMAGE_FALLBACK,
  onSellCards,
  onClose,
}) {
  const card = group?.card ?? null;
  const copies = group?.copies ?? [];
  const [sellOpen, setSellOpen] = useState(false);
  const [selectedSellRowId, setSelectedSellRowId] = useState("");
  const [sellQuantity, setSellQuantity] = useState(1);
  const [sellBusy, setSellBusy] = useState(false);
  const [sellError, setSellError] = useState("");

  const detailRows = buildDetailRows(card);
  const sellOptions = useMemo(() => {
    return copies
      .filter((copy) => !copy.isTradeLocked && Number(copy.quantity || 0) > 0)
      .sort((a, b) => {
        const aOrder = Number(a.rarity?.sort_order ?? 9999);
        const bOrder = Number(b.rarity?.sort_order ?? 9999);
        if (aOrder !== bOrder) return aOrder - bOrder;
        return String(a.rarity?.name || "").localeCompare(String(b.rarity?.name || ""));
      })
      .map((copy) => ({
        binderCardId: copy.id,
        rarityId: copy.rarityId,
        rarityName: copy.rarity?.name || "Unknown",
        quantity: Number(copy.quantity || 0),
        shardValue: Number(copy.rarity?.shard_value || 0),
      }));
  }, [copies]);

  const selectedSellOption =
    sellOptions.find((option) => option.binderCardId === selectedSellRowId) || sellOptions[0] || null;

  useEffect(() => {
    setSellOpen(false);
    setSellError("");
    setSelectedSellRowId(sellOptions[0]?.binderCardId || "");
    setSellQuantity(1);
  }, [group, sellOptions]);

  useEffect(() => {
    if (!selectedSellOption) {
      setSellQuantity(1);
      return;
    }

    setSellQuantity((current) =>
      Math.max(1, Math.min(Number(selectedSellOption.quantity || 1), Number(current || 1)))
    );
  }, [selectedSellOption]);

  async function handleConfirmSell() {
    if (!selectedSellOption || !onSellCards) return;

    setSellBusy(true);
    setSellError("");

    try {
      await onSellCards({
        binderCardId: selectedSellOption.binderCardId,
        quantity: sellQuantity,
      });
      setSellOpen(false);
    } catch (error) {
      console.error("Failed to sell binder cards:", error);
      setSellError(error.message || "Failed to sell cards.");
    } finally {
      setSellBusy(false);
    }
  }

  if (!group || !card) return null;

  return (
    <div className="binder-card-modal" role="presentation" onClick={onClose}>
      <div
        className="binder-card-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={card.name || "Binder card"}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="binder-card-modal-close"
          onClick={onClose}
          aria-label="Close card modal"
        >
          Close
        </button>

        <div className="binder-card-modal-layout">
          <div className="binder-card-modal-image-shell">
            <img
              className="binder-card-modal-image"
              src={buildCardImageUrl(card)}
              alt={card.name || "Card"}
              onError={(event) => {
                if (event.currentTarget.src !== CARD_IMAGE_FALLBACK) {
                  event.currentTarget.src = CARD_IMAGE_FALLBACK;
                }
              }}
            />
          </div>

          <div className="binder-card-modal-meta">
            <h2 className="binder-card-modal-title">{card.name || "Unknown Card"}</h2>

            <div className="binder-card-modal-list">
              <div className="binder-card-modal-row">
                <span>Total Owned</span>
                <strong>x{group.totalQuantity || 0}</strong>
              </div>
              <div className="binder-card-modal-row">
                <span>Trade Locked</span>
                <strong>x{group.totalLockedQuantity || 0}</strong>
              </div>
            </div>

            <h3 className="binder-card-modal-subtitle">Rarities</h3>
            <div className="binder-card-modal-list">
              {(group.rarities || []).length ? (
                group.rarities.map((entry) => (
                  <div className="binder-card-modal-row" key={entry.rarityId}>
                    <span>{entry.rarity?.name || "Unknown"}</span>
                    <strong>
                      x{entry.quantity}
                      {entry.lockedQuantity > 0 ? ` | ${entry.lockedQuantity} locked` : ""}
                    </strong>
                  </div>
                ))
              ) : (
                <div className="binder-card-modal-row">
                  <span>Owned Copies</span>
                  <strong>None</strong>
                </div>
              )}
            </div>

            <h3 className="binder-card-modal-subtitle">Card Info</h3>
            <div className="binder-card-modal-list">
              {detailRows.map((row) => (
                <div className="binder-card-modal-row" key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>

            <h3 className="binder-card-modal-subtitle">Description</h3>
            <div className="binder-card-modal-description">
              {card.desc || "No description available."}
            </div>

            <div className="binder-card-modal-actions">
              <button
                type="button"
                className="binder-card-modal-sell-btn"
                onClick={() => setSellOpen((current) => !current)}
                disabled={!sellOptions.length || sellBusy}
              >
                {sellOpen ? "Cancel Sell" : "Sell"}
              </button>
            </div>

            {sellOpen ? (
              <div className="binder-card-modal-sell-panel">
                <h3 className="binder-card-modal-subtitle">Sell For Shards</h3>

                {!sellOptions.length ? (
                  <div className="binder-card-modal-description">
                    No tradeable copies are available to sell.
                  </div>
                ) : (
                  <>
                    <label className="binder-filter-label" htmlFor="binder-sell-rarity">
                      Rarity
                    </label>
                    <select
                      id="binder-sell-rarity"
                      className="binder-filter-input"
                      value={selectedSellOption?.binderCardId || ""}
                      onChange={(event) => setSelectedSellRowId(event.target.value)}
                      disabled={sellBusy}
                    >
                      {sellOptions.map((option) => (
                        <option key={option.binderCardId} value={option.binderCardId}>
                          {option.rarityName} - {option.shardValue} shards each - {option.quantity} available
                        </option>
                      ))}
                    </select>

                    {selectedSellOption && selectedSellOption.quantity > 1 ? (
                      <>
                        <label className="binder-filter-label" htmlFor="binder-sell-quantity">
                          Quantity: {sellQuantity}
                        </label>
                        <input
                          id="binder-sell-quantity"
                          type="range"
                          min="1"
                          max={selectedSellOption.quantity}
                          value={sellQuantity}
                          onChange={(event) => setSellQuantity(Number(event.target.value || 1))}
                          disabled={sellBusy}
                          className="binder-card-modal-sell-slider"
                        />
                      </>
                    ) : null}

                    <div className="binder-card-modal-row">
                      <span>Shard Gain</span>
                      <strong>
                        {(selectedSellOption?.shardValue || 0) * Number(sellQuantity || 0)}
                      </strong>
                    </div>

                    {sellError ? (
                      <div className="binder-card-modal-error">{sellError}</div>
                    ) : null}

                    <button
                      type="button"
                      className="binder-card-modal-sell-btn"
                      onClick={handleConfirmSell}
                      disabled={!selectedSellOption || sellBusy}
                    >
                      {sellBusy ? "Selling..." : "Sell Cards"}
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default BinderCardModal;
