const TYPE_FLAGS = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
  NORMAL: 0x10,
  EFFECT: 0x20,
  FUSION: 0x40,
  RITUAL: 0x80,
  SPIRIT: 0x200,
  UNION: 0x400,
  GEMINI: 0x800,
  TUNER: 0x1000,
  SYNCHRO: 0x2000,
  TOKEN: 0x4000,
  QUICKPLAY: 0x10000,
  CONTINUOUS: 0x20000,
  EQUIP: 0x40000,
  FIELD: 0x80000,
  COUNTER: 0x100000,
  FLIP: 0x200000,
  TOON: 0x400000,
  XYZ: 0x800000,
  PENDULUM: 0x1000000,
  SPECIAL_SUMMON: 0x2000000,
  LINK: 0x4000000,
  SKILL: 0x10000000,
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
  return (
    ATTRIBUTE_OPTIONS.find((option) => option.value === normalized)?.label ||
    "Unknown"
  );
}

function decodeRace(value) {
  const normalized = Number(value || 0);
  return (
    RACE_OPTIONS.find((option) => option.value === normalized)?.label ||
    "Unknown"
  );
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

  if ((normalizedType & TYPE_FLAGS.LINK) === TYPE_FLAGS.LINK) {
    return null;
  }

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

  const rows = [];

  rows.push({
    label: "Card Kind",
    value: cardKind,
  });

  if (cardKind === "Monster" && monsterSubtype) {
    rows.push({
      label: "Monster Type",
      value: monsterSubtype,
    });
  }

  if ((cardKind === "Spell" || cardKind === "Trap") && spellTrapSubtype) {
    rows.push({
      label: "Spell / Trap Type",
      value: spellTrapSubtype,
    });
  }

  if (cardKind === "Monster" && Number(card.attribute || 0) > 0) {
    rows.push({
      label: "Attribute",
      value: decodeAttribute(card.attribute),
    });
  }

  if (cardKind === "Monster" && Number(card.race || 0) > 0) {
    rows.push({
      label: "Race",
      value: decodeRace(card.race),
    });
  }

  if (cardKind === "Monster" && displayLevelOrRank != null) {
    rows.push({
      label: monsterSubtype === "Xyz" ? "Rank" : "Level",
      value: displayLevelOrRank,
    });
  }

  if (cardKind === "Monster" && linkRating != null) {
    rows.push({
      label: "Link Rating",
      value: linkRating,
    });
  }

  if (cardKind === "Monster" && card.atk != null) {
    rows.push({
      label: "ATK",
      value: card.atk,
    });
  }

  if (
    cardKind === "Monster" &&
    monsterSubtype !== "Link" &&
    card.def != null
  ) {
    rows.push({
      label: "DEF",
      value: card.def,
    });
  }

  return rows;
}

function BinderDetailPanel({
  previewGroup,
  buildCardImageUrl,
  CARD_IMAGE_FALLBACK
}) {
  if (!previewGroup) {
    return (
      <aside className="binder-preview-panel">
        <div className="binder-preview-card">
          <div className="binder-empty-state">
            Hover or click a card to preview it.
          </div>
        </div>
      </aside>
    );
  }

  const card = previewGroup.card || null;
  const rarities = previewGroup.rarities || [];
  const imageUrl = buildCardImageUrl(card);
  const detailRows = buildDetailRows(card);

  return (
    <aside className="binder-preview-panel">
      <div className="binder-preview-card">
        <div className="binder-preview-image-shell">
          <img
            src={imageUrl}
            alt={card?.name || "Card"}
            className="binder-preview-image"
            onError={(event) => {
              if (event.currentTarget.src !== CARD_IMAGE_FALLBACK) {
                event.currentTarget.src = CARD_IMAGE_FALLBACK;
              }
            }}
          />
        </div>

        <div className="binder-preview-content">
          <h2 className="binder-preview-title">
            {card?.name || "Unknown Card"}
          </h2>

          <h3 className="binder-preview-subtitle">Collection</h3>
          <div className="binder-preview-list">
            <div className="binder-preview-row">
              <span className="binder-preview-label">Total Owned</span>
              <span className="binder-preview-value">
                x{previewGroup.totalQuantity || 0}
              </span>
            </div>

            <div className="binder-preview-row">
              <span className="binder-preview-label">Trade Locked</span>
              <span className="binder-preview-value">
                x{previewGroup.totalLockedQuantity || 0}
              </span>
            </div>
          </div>

          <h3 className="binder-preview-subtitle">Rarities</h3>
          <div className="binder-preview-list">
            {rarities.length === 0 ? (
              <div className="binder-preview-row">
                <span className="binder-preview-label">Owned Copies</span>
                <span className="binder-preview-value">None</span>
              </div>
            ) : (
              rarities.map((entry) => {
                const rarityName = entry.rarity?.name || "Unknown";
                const shardValue = entry.rarity?.shard_value;

                return (
                  <div className="binder-preview-row" key={entry.rarityId}>
                    <span className="binder-preview-label">
                      {rarityName}
                    </span>

                    <span className="binder-preview-value">
                      x{entry.quantity}
                      {typeof shardValue === "number" ? ` • ${shardValue} shards` : ""}
                      {entry.lockedQuantity > 0 ? ` • ${entry.lockedQuantity} locked` : ""}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <h3 className="binder-preview-subtitle">Card Details</h3>
          <div className="binder-preview-list">
            {detailRows.length === 0 ? (
              <div className="binder-preview-row">
                <span className="binder-preview-label">Details</span>
                <span className="binder-preview-value">Unavailable</span>
              </div>
            ) : (
              detailRows.map((row) => (
                <div className="binder-preview-row" key={row.label}>
                  <span className="binder-preview-label">{row.label}</span>
                  <span className="binder-preview-value">{row.value}</span>
                </div>
              ))
            )}
          </div>

          <h3 className="binder-preview-subtitle">Description</h3>
          <div className="binder-preview-list">
            <div className="binder-preview-row">
              <span
                className="binder-preview-value"
                style={{ textAlign: "left", width: "100%" }}
              >
                {card?.desc || "No description provided."}
              </span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default BinderDetailPanel;