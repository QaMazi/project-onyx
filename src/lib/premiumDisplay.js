export function relabelPremiumTokenText(value) {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }

  return value
    .replaceAll("Gentlemen's Tokens", "Onyx Tokens")
    .replaceAll("Gentlemen's Token", "Onyx Token")
    .replaceAll("Gentlemen’s Tokens", "Onyx Tokens")
    .replaceAll("Gentlemen’s Token", "Onyx Token");
}

export function relabelPremiumCatalogItem(item) {
  if (!item) return item;

  return {
    ...item,
    name: relabelPremiumTokenText(item.name),
    description: relabelPremiumTokenText(item.description),
  };
}
