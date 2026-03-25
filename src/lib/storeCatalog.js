const CATEGORY_LABELS = {
  banlist: "Banlist",
  progression: "Progression",
  chaos: "Chaos",
  thiefs_cards: "Binder Steal",
  hex_idols: "Hex Idols",
  card_extractors: "Card Extractors",
  forced_exchanges: "Forced Exchanges",
  protection: "Protection",
  special: "Special",
  container_openers: "Keys",
  currency_exchange: "Currency Exchange",
  pack_openers: "Keys",
  pack_keys: "Keys",
  box_keys: "Keys",
};

const CATEGORY_ORDER = [
  "container_openers",
  "banlist",
  "thiefs_cards",
  "currency_exchange",
  "progression",
  "hex_idols",
  "card_extractors",
  "forced_exchanges",
  "protection",
  "special",
  "pack_opener",
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

export function isSupportedStoreItem(item) {
  const normalizedCategoryCode = normalizeStoreCategoryCode(item?.category_code);
  const itemCode = String(item?.code || item?.item_code || "")
    .trim()
    .toLowerCase();

  if (normalizedCategoryCode === "container_openers") {
    return true;
  }

  if (normalizedCategoryCode === "banlist") {
    return [
      "forbidden_edict",
      "limit_edict",
      "semi_limit_edict",
      "amnesty_edict",
    ].includes(itemCode);
  }

  return itemCode === "thiefs_card";
}
