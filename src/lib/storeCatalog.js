const CATEGORY_LABELS = {
  banlist: "Banlist",
  progression: "Progression",
  chaos: "Chaos",
  thiefs_cards: "Thief's Cards",
  hex_idols: "Hex Idols",
  card_extractors: "Card Extractors",
  forced_exchanges: "Forced Exchanges",
  protection: "Protection",
  special: "Special",
  container_openers: "Container Openers",
  currency_exchange: "Currency Exchange",
  pack_openers: "Container Openers",
  pack_keys: "Container Openers",
  box_keys: "Container Openers",
};

const CATEGORY_ORDER = [
  "banlist",
  "progression",
  "thiefs_cards",
  "hex_idols",
  "card_extractors",
  "forced_exchanges",
  "protection",
  "special",
  "container_openers",
  "pack_opener",
  "currency_exchange",
];

export function normalizeStoreCategoryCode(code) {
  switch (String(code || "").trim().toLowerCase()) {
    case "pack_openers":
    case "pack_keys":
    case "box_keys":
      return "container_openers";
    default:
      return String(code || "other").trim().toLowerCase() || "other";
  }
}

export function formatStoreCategoryName(code, fallbackName = "") {
  const normalized = normalizeStoreCategoryCode(code);

  if (CATEGORY_LABELS[normalized]) {
    return CATEGORY_LABELS[normalized];
  }

  if (fallbackName) {
    return fallbackName;
  }

  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function getStoreCategorySortValue(code) {
  const normalized = normalizeStoreCategoryCode(code);
  const index = CATEGORY_ORDER.indexOf(normalized);
  return index >= 0 ? index : CATEGORY_ORDER.length + 100;
}

export function sortStoreGroups(groups) {
  return [...groups].sort((left, right) => {
    const orderDiff =
      getStoreCategorySortValue(left.code) - getStoreCategorySortValue(right.code);

    if (orderDiff !== 0) {
      return orderDiff;
    }

    return String(left.label || "").localeCompare(String(right.label || ""));
  });
}
