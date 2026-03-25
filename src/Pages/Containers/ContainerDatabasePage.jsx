import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";
import BinderHoverTooltip from "../Binder/Components/BinderHoverTooltip";
import "./ContainerDatabasePage.css";

const CARD_IMAGE_FALLBACK =
  "https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/fallback_image.jpg";
const RANDOM_PACK_RARITY_LABEL = "Random (Weighted Table)";
const PACK_SECTION_OPTIONS = [
  { value: "tcg", label: "TCG Packs", sectionLabel: "TCG Packs", shortLabel: "TCG Pack", keyPrefix: "TCG" },
  { value: "reward", label: "Reward Packs", sectionLabel: "Reward Packs", shortLabel: "Reward Pack", keyPrefix: "RWD" },
  { value: "tournament", label: "Tournament Packs", sectionLabel: "Tournament Packs", shortLabel: "Tournament Pack", keyPrefix: "TOR" },
];
const PACK_TYPE_CONFIGS = Object.fromEntries(PACK_SECTION_OPTIONS.map((option) => [option.value, option]));
const BOX_SECTION_OPTIONS = [
  { value: "deck", label: "Deck Boxes", sectionLabel: "Deck Boxes", categoryCode: "deck_box", shortLabel: "Deck Box", keyPrefix: "DCK" },
  { value: "promo", label: "Promo Boxes", sectionLabel: "Promo Boxes", categoryCode: "promo_box", shortLabel: "Promo Box", keyPrefix: "PRO" },
  { value: "collectors", label: "Collectors Boxes", sectionLabel: "Collectors Boxes", categoryCode: "collectors_box", shortLabel: "Collectors Box", keyPrefix: "COL" },
];
const BOX_TYPE_CONFIGS = Object.fromEntries(BOX_SECTION_OPTIONS.map((option) => [option.categoryCode, option]));
const FIVE_TIER_BOX_WEIGHTS = new Map([[1, 30], [3, 25], [5, 20], [7, 15], [9, 10]]);

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function buildCardImageUrl(card) {
  if (card?.image_url) return card.image_url;
  if (card?.card_id) {
    return `https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/${card.card_id}.jpg`;
  }
  if (card?.id) {
    return `https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/${card.id}.jpg`;
  }
  return CARD_IMAGE_FALLBACK;
}

function getContainerImageUrl(container) {
  return container?.artwork_url || container?.image_url || "";
}

function resolveTypeLabel(typeRow) {
  if (!typeRow) return "";
  return typeRow.name || typeRow.label || typeRow.code || typeRow.slug || typeRow.title || "";
}

function resolveTypeCode(typeRow) {
  return normalizeText(typeRow?.code || typeRow?.name || "");
}

function normalizePackTypeCode(value, fallbackCardsPerOpen = null) {
  const normalized = normalizeText(value);
  if (Object.prototype.hasOwnProperty.call(PACK_TYPE_CONFIGS, normalized)) {
    return normalized;
  }
  const cardsPerOpen = Number(fallbackCardsPerOpen || 0);
  if (cardsPerOpen === 5) return "reward";
  if (cardsPerOpen === 3) return "tournament";
  return "tcg";
}

function getPackTypeConfig(packTypeCode) {
  return PACK_TYPE_CONFIGS[normalizePackTypeCode(packTypeCode)] || PACK_TYPE_CONFIGS.tcg;
}

function normalizeBoxCategoryCode(value) {
  const normalized = normalizeText(value);
  if (Object.prototype.hasOwnProperty.call(BOX_TYPE_CONFIGS, normalized)) {
    return normalized;
  }
  return "deck_box";
}

function getBoxTypeConfig(boxCategoryCode) {
  return BOX_TYPE_CONFIGS[normalizeBoxCategoryCode(boxCategoryCode)] || BOX_TYPE_CONFIGS.deck_box;
}

function buildPackKeyLabel(packTypeCode, packNumberCode) {
  const packType = getPackTypeConfig(packTypeCode);
  const number = String(packNumberCode || "").trim();
  return number ? `${packType.keyPrefix}-${number}` : `${packType.keyPrefix}-???`;
}

function buildBoxKeyLabel(boxCategoryCode, boxNumberCode) {
  const boxType = getBoxTypeConfig(boxCategoryCode);
  const number = String(boxNumberCode || "").trim();
  return number ? `${boxType.keyPrefix}-${number}` : `${boxType.keyPrefix}-???`;
}

function getNumberSortValue(value) {
  const normalized = String(value || "").trim();
  if (/^(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2})$/.test(normalized)) return Number(normalized);
  return Number.MAX_SAFE_INTEGER;
}

function normalizePackDisplayName(name) {
  return String(name || "").replace(/\s+Draft$/i, "").trim();
}

function formatPercent(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return "0%";
  if (numericValue >= 10) return `${numericValue.toFixed(2).replace(/\.00$/, "")}%`;
  if (numericValue >= 1) return `${numericValue.toFixed(2)}%`;
  if (numericValue >= 0.1) return `${numericValue.toFixed(3)}%`;
  return `${numericValue.toFixed(4)}%`;
}

function formatOneIn(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return "—";
  const oneIn = 100 / numericValue;
  if (oneIn >= 1000) return `1 in ${oneIn.toFixed(0)}`;
  if (oneIn >= 100) return `1 in ${oneIn.toFixed(1)}`;
  return `1 in ${oneIn.toFixed(2)}`;
}

function getHoverPreviewPosition(target) {
  const rect = target.getBoundingClientRect();
  const tooltipWidth = 340;
  const tooltipHeight = 260;
  const showRight = rect.right + tooltipWidth + 24 < window.innerWidth;
  return {
    x: showRight ? rect.right + 14 : Math.max(12, rect.left - tooltipWidth - 14),
    y: Math.min(window.innerHeight - tooltipHeight - 12, Math.max(12, rect.top - 8)),
  };
}

function sortLibraryItems(left, right, numberField = "numberCode") {
  const numberDiff = getNumberSortValue(left?.[numberField]) - getNumberSortValue(right?.[numberField]);
  if (numberDiff !== 0) return numberDiff;
  const nameDiff = String(left?.name || "").localeCompare(String(right?.name || ""));
  if (nameDiff !== 0) return nameDiff;
  return String(left?.code || "").localeCompare(String(right?.code || ""));
}

function buildTypeMap(rows) {
  const map = new Map();
  (rows || []).forEach((row) => map.set(row.id, row));
  return map;
}

function buildTierMap(rows) {
  const map = new Map();
  (rows || []).forEach((row) => map.set(row.id, row));
  return map;
}

function summarizePackGroupCollectionProgress(containerIds, containerCollectionById) {
  let ownedCount = 0;
  let totalCount = 0;
  (containerIds || []).forEach((containerId) => {
    if (!containerId) return;
    const progress = containerCollectionById.get(containerId);
    if (!progress) return;
    ownedCount = Math.max(ownedCount, Number(progress.ownedCount || 0));
    totalCount = Math.max(totalCount, Number(progress.totalCount || 0));
  });
  return { ownedCount, totalCount };
}

function summarizeCollectionProgress(containerId, containerCollectionById, fallbackCards = []) {
  const progress = containerCollectionById.get(containerId);
  if (progress) {
    return { ownedCount: Number(progress.ownedCount || 0), totalCount: Number(progress.totalCount || 0) };
  }
  return { ownedCount: 0, totalCount: new Set((fallbackCards || []).map((row) => row.card_id)).size };
}

function buildProductStatus({ isEnabled, isLocked, variantStates = [] }) {
  if (variantStates.length) {
    const allLocked = variantStates.every((state) => state.isLocked);
    const allHidden = variantStates.every((state) => !state.isEnabled);
    const anyLocked = variantStates.some((state) => state.isLocked);
    const anyHidden = variantStates.some((state) => !state.isEnabled);
    if (allLocked) return "Locked";
    if (allHidden) return "Hidden";
    if (anyLocked) return "Partially Locked";
    if (anyHidden) return "Partially Hidden";
    return "Visible";
  }
  if (isLocked) return "Locked";
  if (!isEnabled) return "Hidden";
  return "Visible";
}

function getStatusTone(statusLabel) {
  const normalized = normalizeText(statusLabel);
  if (normalized.includes("locked")) return "locked";
  if (normalized.includes("hidden")) return "hidden";
  return "visible";
}

function getRouteConfig(typeSlug) {
  switch (typeSlug) {
    case "packs":
      return {
        title: "Pack Database",
        subtitle: "Review every made pack, collection progress, and the current configured pull odds before opening.",
        matchesTypeCode(typeCode) {
          return typeCode === "full_pack" || typeCode === "draft_pack";
        },
      };
    case "deck-boxes":
      return {
        title: "Deck Box Database",
        subtitle: "Browse every made Deck Box, see your collection progress, and inspect the configured box pulls in one place.",
        matchesTypeCode(typeCode) {
          return typeCode === "deck_box";
        },
      };
    case "promo-boxes":
      return {
        title: "Promo Box Database",
        subtitle: "Browse every made Promo Box, see your collection progress, and inspect the configured box pulls in one place.",
        matchesTypeCode(typeCode) {
          return typeCode === "promo_box";
        },
      };
    case "collectors-boxes":
    case "ocg-boxes":
      return {
        title: "Collectors Box Database",
        subtitle: "Browse every made Collectors Box, see your collection progress, and inspect the configured box pulls in one place.",
        matchesTypeCode(typeCode) {
          return typeCode === "collectors_box";
        },
      };
    default:
      return {
        title: "Container Database",
        subtitle: "Review every made pack and box, collection progress, and the current configured pull odds in one place.",
        matchesTypeCode() {
          return true;
        },
      };
  }
}

function groupCardRowsByCardId(cardRows) {
  const grouped = new Map();
  (cardRows || []).forEach((row) => {
    const cardId = Number(row.card_id || 0);
    if (!cardId) return;
    if (!grouped.has(cardId)) {
      grouped.set(cardId, {
        card_id: cardId,
        card_name: row.card_name || `Card ${cardId}`,
        desc: row.desc || "",
        image_url: row.image_url || "",
        tierNames: new Set(),
        rarityNames: new Set(),
        tierContribution: new Map(),
        combinedChancePercent: 0,
        slotChances: [],
        primaryTierSortOrder: Number.MAX_SAFE_INTEGER,
      });
    }
    const entry = grouped.get(cardId);
    if (row.tier_name) entry.tierNames.add(row.tier_name);
    if (row.rarity_name) entry.rarityNames.add(row.rarity_name);
  });
  return grouped;
}

function finalizeOddsEntries(grouped) {
  return Array.from(grouped.values())
    .map((entry) => {
      let primaryTierName = "Unknown Tier";
      let primaryTierContribution = -1;
      entry.tierContribution.forEach((contribution, tierName) => {
        if (contribution > primaryTierContribution) {
          primaryTierContribution = contribution;
          primaryTierName = tierName;
        }
      });
      return {
        ...entry,
        tierNames: Array.from(entry.tierNames),
        rarityNames: Array.from(entry.rarityNames),
        primaryTierName,
        combinedChancePercent: Math.min(100, Math.max(0, Number(entry.combinedChancePercent || 0))),
      };
    })
    .sort((left, right) => {
      const chanceDiff = Number(right.combinedChancePercent || 0) - Number(left.combinedChancePercent || 0);
      if (Math.abs(chanceDiff) > 0.0000001) return chanceDiff;
      const tierDiff = Number(left.primaryTierSortOrder || 9999) - Number(right.primaryTierSortOrder || 9999);
      if (tierDiff !== 0) return tierDiff;
      return String(left.card_name || "").localeCompare(String(right.card_name || ""));
    });
}

function buildPackOddsRows(cardRows, slotRows) {
  const enabledCardRows = (cardRows || []).filter((row) => row.pack_pool_tier_id && row.is_enabled !== false);
  const enabledSlotRows = (slotRows || []).filter((row) => row.pack_pool_tier_id && row.is_enabled !== false && Number(row.weight || 0) > 0);
  if (!enabledCardRows.length || !enabledSlotRows.length) return [];

  const grouped = groupCardRowsByCardId(enabledCardRows);
  const tierCardRows = new Map();
  const tierCardTotals = new Map();
  const slotRowsByIndex = new Map();

  enabledCardRows.forEach((row) => {
    if (!tierCardRows.has(row.pack_pool_tier_id)) tierCardRows.set(row.pack_pool_tier_id, []);
    tierCardRows.get(row.pack_pool_tier_id).push(row);
    tierCardTotals.set(row.pack_pool_tier_id, Number(tierCardTotals.get(row.pack_pool_tier_id) || 0) + Math.max(0, Number(row.weight || 0) || 1));
  });

  enabledSlotRows.forEach((row) => {
    if (!slotRowsByIndex.has(row.slot_index)) slotRowsByIndex.set(row.slot_index, []);
    slotRowsByIndex.get(row.slot_index).push(row);
  });

  Array.from(slotRowsByIndex.entries()).forEach(([, rows]) => {
    const totalSlotWeight = rows.reduce((sum, row) => sum + Math.max(0, Number(row.weight || 0)), 0);
    if (totalSlotWeight <= 0) return;
    const slotChanceByCardId = new Map();

    rows.forEach((row) => {
      const tierId = row.pack_pool_tier_id;
      const tierChance = Math.max(0, Number(row.weight || 0)) / totalSlotWeight;
      const rowsInTier = tierCardRows.get(tierId) || [];
      const tierTotalWeight = Number(tierCardTotals.get(tierId) || 0);
      if (!rowsInTier.length || tierTotalWeight <= 0) return;

      rowsInTier.forEach((cardRow) => {
        const cardWeightShare = Math.max(0, Number(cardRow.weight || 0) || 1) / tierTotalWeight;
        const contribution = tierChance * cardWeightShare;
        const cardId = Number(cardRow.card_id || 0);
        if (!cardId || contribution <= 0) return;
        slotChanceByCardId.set(cardId, Number(slotChanceByCardId.get(cardId) || 0) + contribution);
        const entry = grouped.get(cardId);
        if (!entry) return;
        entry.tierContribution.set(cardRow.tier_name, Number(entry.tierContribution.get(cardRow.tier_name) || 0) + contribution);
        entry.primaryTierSortOrder = Math.min(entry.primaryTierSortOrder, Number(cardRow.tier_sort_order || Number.MAX_SAFE_INTEGER));
      });
    });

    slotChanceByCardId.forEach((slotChance, cardId) => {
      const entry = grouped.get(cardId);
      if (!entry || slotChance <= 0) return;
      entry.slotChances.push(slotChance);
    });
  });

  grouped.forEach((entry) => {
    const missChance = entry.slotChances.reduce((product, slotChance) => product * Math.max(0, 1 - slotChance), 1);
    entry.combinedChancePercent = (1 - missChance) * 100;
  });

  return finalizeOddsEntries(grouped);
}

function getBoxTierChanceMap(typeCode, cardRows) {
  const tierChanceMap = new Map();
  if (typeCode === "deck_box" || typeCode === "collectors_box") {
    const totalConfiguredWeight = Array.from(FIVE_TIER_BOX_WEIGHTS.values()).reduce((sum, value) => sum + value, 0);
    (cardRows || []).forEach((row) => {
      const sortOrder = Number(row.tier_sort_order || 0);
      if (!FIVE_TIER_BOX_WEIGHTS.has(sortOrder) || tierChanceMap.has(row.tier_id)) return;
      tierChanceMap.set(row.tier_id, FIVE_TIER_BOX_WEIGHTS.get(sortOrder) / totalConfiguredWeight);
    });
    return tierChanceMap;
  }
  const seenTiers = new Set();
  (cardRows || []).forEach((row) => {
    if (!row.tier_id || seenTiers.has(row.tier_id)) return;
    seenTiers.add(row.tier_id);
    const weightPercent = Math.max(0, Number(row.tier_weight_percent || 0));
    if (weightPercent > 0) tierChanceMap.set(row.tier_id, weightPercent / 100);
  });
  return tierChanceMap;
}

function buildBoxOddsRows(cardRows, typeCode, cardsPerOpen) {
  const enabledCardRows = (cardRows || []).filter((row) => row.tier_id && row.is_enabled !== false);
  if (!enabledCardRows.length) return [];
  const grouped = groupCardRowsByCardId(enabledCardRows);
  const tierChanceMap = getBoxTierChanceMap(typeCode, enabledCardRows);
  const tierTotalWeights = new Map();

  enabledCardRows.forEach((row) => {
    tierTotalWeights.set(row.tier_id, Number(tierTotalWeights.get(row.tier_id) || 0) + Math.max(0, Number(row.weight || 0) || 1));
  });

  grouped.forEach((entry) => {
    entry.perDrawChance = 0;
  });

  enabledCardRows.forEach((row) => {
    const tierChance = Number(tierChanceMap.get(row.tier_id) || 0);
    const tierTotalWeight = Number(tierTotalWeights.get(row.tier_id) || 0);
    if (tierChance <= 0 || tierTotalWeight <= 0) return;
    const contribution = tierChance * (Math.max(0, Number(row.weight || 0) || 1) / tierTotalWeight);
    const cardId = Number(row.card_id || 0);
    const entry = grouped.get(cardId);
    if (!entry || contribution <= 0) return;
    entry.perDrawChance += contribution;
    entry.tierContribution.set(row.tier_name, Number(entry.tierContribution.get(row.tier_name) || 0) + contribution);
    entry.primaryTierSortOrder = Math.min(entry.primaryTierSortOrder, Number(row.tier_sort_order || Number.MAX_SAFE_INTEGER));
  });

  const pullsPerOpen = Math.max(1, Number(cardsPerOpen || 1));
  grouped.forEach((entry) => {
    const perDrawChance = Math.min(1, Math.max(0, Number(entry.perDrawChance || 0)));
    entry.combinedChancePercent = (1 - Math.pow(1 - perDrawChance, pullsPerOpen)) * 100;
  });

  return finalizeOddsEntries(grouped);
}

function ContainerDatabasePage() {
  const navigate = useNavigate();
  const { typeSlug } = useParams();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [searchText, setSearchText] = useState("");
  const [sections, setSections] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [hoverPreview, setHoverPreview] = useState(null);

  const routeConfig = useMemo(() => getRouteConfig(typeSlug), [typeSlug]);

  const filteredSections = useMemo(() => {
    const query = normalizeText(searchText);
    if (!query) return sections;

    return sections
      .map((section) => ({
        ...section,
        products: section.products.filter((product) => {
          const statusLabel = product.statusLabel || "";
          return (
            normalizeText(product.name).includes(query) ||
            normalizeText(product.code).includes(query) ||
            normalizeText(product.description).includes(query) ||
            normalizeText(statusLabel).includes(query) ||
            normalizeText(product.keyLabel).includes(query)
          );
        }),
      }))
      .filter((section) => section.products.length > 0);
  }, [searchText, sections]);

  const selectedOddsRows = useMemo(() => {
    if (!selectedItem) return [];
    if (selectedItem.type === "pack") {
      return buildPackOddsRows(selectedItem.detailCards, selectedItem.detailSlotRows);
    }
    return buildBoxOddsRows(selectedItem.detailCards, selectedItem.typeCode, selectedItem.cardsPerOpen);
  }, [selectedItem]);

  useEffect(() => {
    if (!authLoading && user) {
      loadPage();
    }
  }, [authLoading, routeConfig, typeSlug, user]);

  async function loadPage() {
    setLoading(true);
    setErrorMessage("");

    try {
      const { data: currentSeries, error: currentSeriesError } = await supabase
        .from("game_series")
        .select("id")
        .eq("is_current", true)
        .maybeSingle();

      if (currentSeriesError) throw currentSeriesError;

      const currentSeriesId = currentSeries?.id || null;

      const promises = [
        supabase.from("containers").select("*").order("name", { ascending: true }),
        supabase.from("container_types").select("*"),
        supabase.from("container_cards").select("*").eq("is_enabled", true),
        supabase.from("container_pack_slot_tiers").select("*").eq("is_enabled", true),
        supabase.from("card_tiers").select("id, name, weight_percent, sort_order").order("sort_order", { ascending: true }),
        supabase.from("pack_pool_tiers").select("id, code, name, sort_order").order("sort_order", { ascending: true }),
        supabase.from("card_rarities").select("id, name"),
      ];

      if (currentSeriesId) {
        promises.push(
          supabase.rpc("get_container_collection_progress", {
            p_series_id: currentSeriesId,
          })
        );
      } else {
        promises.push(Promise.resolve({ data: [], error: null }));
      }

      const [
        { data: containerRows, error: containersError },
        { data: typeRows, error: typesError },
        { data: containerCardRows, error: containerCardsError },
        { data: slotTierRows, error: slotTiersError },
        { data: tierRows, error: tiersError },
        { data: packPoolTierRows, error: packPoolTiersError },
        { data: rarityRows, error: rarityRowsError },
        { data: collectionRows, error: collectionError },
      ] = await Promise.all(promises);

      if (containersError) throw containersError;
      if (typesError) throw typesError;
      if (containerCardsError) throw containerCardsError;
      if (slotTiersError) throw slotTiersError;
      if (tiersError) throw tiersError;
      if (packPoolTiersError) throw packPoolTiersError;
      if (rarityRowsError) throw rarityRowsError;
      if (collectionError) throw collectionError;

      const typeMap = buildTypeMap(typeRows || []);
      const cardTierMap = buildTierMap(tierRows || []);
      const packPoolTierMap = buildTierMap(packPoolTierRows || []);
      const rarityMap = buildTierMap(rarityRows || []);
      const containerCollectionById = new Map(
        (collectionRows || []).map((row) => [
          row.container_id,
          {
            ownedCount: Number(row.owned_unique_cards || 0),
            totalCount: Number(row.total_unique_cards || 0),
          },
        ])
      );

      const matchingContainers = (containerRows || [])
        .map((container) => ({
          ...container,
          container_type: typeMap.get(container.container_type_id) || null,
        }))
        .filter((container) => routeConfig.matchesTypeCode(resolveTypeCode(container.container_type)));

      const relevantContainerIds = new Set(matchingContainers.map((container) => container.id));
      const relevantCardRows = (containerCardRows || []).filter((row) => relevantContainerIds.has(row.container_id));
      const relevantSlotRows = (slotTierRows || []).filter((row) => relevantContainerIds.has(row.container_id));

      const uniqueCardIds = [...new Set(relevantCardRows.map((row) => Number(row.card_id)).filter(Boolean))];

      let cardDetails = [];
      if (uniqueCardIds.length) {
        const { data, error } = await supabase
          .from("cards")
          .select("id, name, desc, image_url")
          .in("id", uniqueCardIds);

        if (error) throw error;
        cardDetails = data || [];
      }

      const cardDetailsMap = new Map(cardDetails.map((row) => [Number(row.id), row]));
      const cardsByContainerId = new Map();
      const slotRowsByContainerId = new Map();

      relevantCardRows.forEach((row) => {
        const tierRow = row.pack_pool_tier_id ? packPoolTierMap.get(row.pack_pool_tier_id) : cardTierMap.get(row.tier_id);
        const rarityRow = row.rarity_id ? rarityMap.get(row.rarity_id) : null;
        const card = cardDetailsMap.get(Number(row.card_id));

        if (!cardsByContainerId.has(row.container_id)) {
          cardsByContainerId.set(row.container_id, []);
        }

        cardsByContainerId.get(row.container_id).push({
          ...row,
          card_name: card?.name || `Card ${row.card_id}`,
          desc: card?.desc || "",
          image_url: card?.image_url || "",
          weight: Number(row.weight || 0) || 1,
          tier_name: tierRow?.name || "Unknown Tier",
          tier_code: tierRow?.code || "",
          tier_sort_order: Number(tierRow?.sort_order || 9999),
          tier_weight_percent: row.pack_pool_tier_id ? null : Number(tierRow?.weight_percent || 0),
          rarity_name: row.pack_pool_tier_id ? rarityRow?.name || RANDOM_PACK_RARITY_LABEL : rarityRow?.name || null,
        });
      });

      relevantSlotRows.forEach((row) => {
        if (!slotRowsByContainerId.has(row.container_id)) {
          slotRowsByContainerId.set(row.container_id, []);
        }

        const tierRow = packPoolTierMap.get(row.pack_pool_tier_id);
        slotRowsByContainerId.get(row.container_id).push({
          ...row,
          weight: Number(row.weight || 0),
          tier_name: tierRow?.name || "Unknown Tier",
          tier_code: tierRow?.code || "",
          tier_sort_order: Number(tierRow?.sort_order || 9999),
        });
      });

      const nextSections = [];

      if (typeSlug === "packs") {
        const groupedPackProducts = new Map();

        matchingContainers.forEach((container) => {
          const groupKey = container.pack_group_code || `pack:${container.id}`;
          const isDraftVariant =
            normalizeText(container.pack_variant || container.container_type?.code) === "draft" ||
            resolveTypeCode(container.container_type) === "draft_pack";

          if (!groupedPackProducts.has(groupKey)) {
            groupedPackProducts.set(groupKey, {
              key: groupKey,
              normalContainer: null,
              draftContainer: null,
            });
          }

          const entry = groupedPackProducts.get(groupKey);
          if (isDraftVariant) {
            entry.draftContainer = container;
          } else {
            entry.normalContainer = container;
          }
        });

        const sectionMap = new Map();

        Array.from(groupedPackProducts.values()).forEach((entry) => {
          const displayContainer = entry.normalContainer || entry.draftContainer;
          const detailContainer = entry.normalContainer || entry.draftContainer;
          if (!displayContainer || !detailContainer) return;

          const detailCards = cardsByContainerId.get(detailContainer.id) || [];
          const detailSlotRows = slotRowsByContainerId.get(detailContainer.id) || [];
          const packTypeCode = normalizePackTypeCode(displayContainer.pack_type_code, displayContainer.cards_per_open);
          const collectionProgress = summarizePackGroupCollectionProgress(
            [entry.normalContainer?.id, entry.draftContainer?.id],
            containerCollectionById
          );
          const fallbackTotal = new Set(detailCards.map((row) => row.card_id)).size;
          const statusLabel = buildProductStatus({
            variantStates: [
              entry.normalContainer ? { isEnabled: entry.normalContainer.is_enabled === true, isLocked: entry.normalContainer.is_locked === true } : null,
              entry.draftContainer ? { isEnabled: entry.draftContainer.is_enabled === true, isLocked: entry.draftContainer.is_locked === true } : null,
            ].filter(Boolean),
          });

          const product = {
            key: `pack:${entry.key}`,
            type: "pack",
            name: normalizePackDisplayName(displayContainer.name),
            code: displayContainer.code,
            description: displayContainer.description || "",
            imageUrl: getContainerImageUrl(displayContainer),
            cardsPerOpen: Number(displayContainer.cards_per_open || 0) || 9,
            keyLabel: buildPackKeyLabel(packTypeCode, displayContainer.pack_number_code || ""),
            numberCode: displayContainer.pack_number_code || "",
            categoryLabel: getPackTypeConfig(packTypeCode).shortLabel,
            sectionLabel: getPackTypeConfig(packTypeCode).sectionLabel,
            collectionOwnedCount: Number(collectionProgress.ownedCount || 0),
            collectionTotalCount: Number(collectionProgress.totalCount || 0) > 0 ? Number(collectionProgress.totalCount || 0) : fallbackTotal,
            statusLabel,
            statusTone: getStatusTone(statusLabel),
            detailCards,
            detailSlotRows,
            typeCode: "pack_group",
          };

          if (!sectionMap.has(product.sectionLabel)) {
            sectionMap.set(product.sectionLabel, []);
          }
          sectionMap.get(product.sectionLabel).push(product);
        });

        Array.from(sectionMap.entries())
          .sort(([left], [right]) => {
            const leftRank = PACK_SECTION_OPTIONS.findIndex((option) => option.sectionLabel === left);
            const rightRank = PACK_SECTION_OPTIONS.findIndex((option) => option.sectionLabel === right);
            if (leftRank !== rightRank) return leftRank - rightRank;
            return left.localeCompare(right);
          })
          .forEach(([label, products]) => {
            nextSections.push({
              label,
              products: [...products].sort((left, right) => sortLibraryItems(left, right)),
            });
          });
      } else {
        const sectionLabel =
          typeSlug === "deck-boxes"
            ? "Deck Boxes"
            : typeSlug === "promo-boxes"
              ? "Promo Boxes"
              : "Collectors Boxes";

        nextSections.push({
          label: sectionLabel,
          products: matchingContainers
            .map((container) => {
              const detailCards = cardsByContainerId.get(container.id) || [];
              const collectionProgress = summarizeCollectionProgress(container.id, containerCollectionById, detailCards);
              const statusLabel = buildProductStatus({
                isEnabled: container.is_enabled === true,
                isLocked: container.is_locked === true,
              });

              return {
                key: `box:${container.id}`,
                type: "box",
                name: container.name,
                code: container.code,
                description: container.description || "",
                imageUrl: getContainerImageUrl(container),
                cardsPerOpen: Number(container.cards_per_open || 0) || 1,
                keyLabel: buildBoxKeyLabel(container.container_type?.code, container.box_number_code || ""),
                numberCode: container.box_number_code || "",
                categoryLabel: getBoxTypeConfig(container.container_type?.code).shortLabel,
                collectionOwnedCount: Number(collectionProgress.ownedCount || 0),
                collectionTotalCount: Number(collectionProgress.totalCount || 0),
                statusLabel,
                statusTone: getStatusTone(statusLabel),
                detailCards,
                detailSlotRows: [],
                typeCode: resolveTypeCode(container.container_type),
              };
            })
            .sort((left, right) => sortLibraryItems(left, right)),
        });
      }

      setSections(nextSections);
      setSelectedItem((current) => {
        if (!current?.key) return null;
        const allProducts = nextSections.flatMap((section) => section.products);
        return allProducts.find((product) => product.key === current.key) || null;
      });
    } catch (error) {
      console.error("Failed to load container database:", error);
      setErrorMessage(error.message || "Failed to load container database.");
      setSections([]);
      setSelectedItem(null);
    } finally {
      setLoading(false);
    }
  }

  function openDetailModal(item) {
    setSelectedItem(item);
    setHoverPreview(null);
  }

  function closeDetailModal() {
    setSelectedItem(null);
    setHoverPreview(null);
  }

  function handleShowCardHover(card, target) {
    if (!card || !target) return;
    const position = getHoverPreviewPosition(target);
    setHoverPreview({
      card: {
        id: card.card_id,
        name: card.card_name,
        desc: card.desc || "",
        image_url: card.image_url || "",
      },
      lines: [
        `Pull Odds: ${formatPercent(card.combinedChancePercent)} (${formatOneIn(card.combinedChancePercent)})`,
        `Tier${card.tierNames.length > 1 ? "s" : ""}: ${card.tierNames.join(", ") || "Unknown"}`,
        card.rarityNames.length ? `Rarity${card.rarityNames.length > 1 ? " Options" : ""}: ${card.rarityNames.join(", ")}` : "",
      ].filter(Boolean),
      ...position,
    });
  }

  function handleHideCardHover() {
    setHoverPreview(null);
  }

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (user.role === "Blocked") return <Navigate to="/" replace />;

  return (
    <LauncherLayout>
      <div className="container-database-page">
        <div className="container-database-topbar">
          <div>
            <div className="container-database-kicker">SERIES</div>
            <h1 className="container-database-title">{routeConfig.title}</h1>
            <p className="container-database-subtitle">{routeConfig.subtitle}</p>
          </div>

          <div className="container-database-topbar-actions">
            <button type="button" className="container-database-secondary-btn" onClick={() => navigate("/mode/progression")}>
              Back
            </button>
          </div>
        </div>

        <div className="container-database-toolbar">
          <div className="container-database-field">
            <label htmlFor="container-database-search">Search</label>
            <input
              id="container-database-search"
              className="container-database-input"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search by name, code, key label, or status..."
            />
          </div>
        </div>

        {loading ? (
          <div className="container-database-panel container-database-empty">Loading {routeConfig.title.toLowerCase()}...</div>
        ) : errorMessage ? (
          <div className="container-database-panel container-database-error">{errorMessage}</div>
        ) : filteredSections.length === 0 ? (
          <div className="container-database-panel container-database-empty">No containers matched that search.</div>
        ) : (
          <div className="container-database-section-stack">
            {filteredSections.map((section) => (
              <section key={section.label} className="container-database-panel">
                <div className="container-database-section-header">
                  <div>
                    <div className="container-database-section-kicker">DATABASE</div>
                    <h2>{section.label}</h2>
                  </div>
                  <span className="container-database-section-count">
                    {section.products.length} {section.products.length === 1 ? "entry" : "entries"}
                  </span>
                </div>

                <div className="container-database-library-grid">
                  {section.products.map((product) => (
                    <button
                      key={product.key}
                      type="button"
                      className={`container-database-library-card tone-${product.statusTone}`}
                      onClick={() => openDetailModal(product)}
                    >
                      <div className="container-database-library-art-shell">
                        {product.imageUrl ? (
                          <img src={product.imageUrl} alt={product.name} className="container-database-library-art" />
                        ) : (
                          <div className="container-database-library-art-placeholder">No art</div>
                        )}
                        <div className={`container-database-status-badge tone-${product.statusTone}`}>{product.statusLabel}</div>
                      </div>

                      <div className="container-database-library-body">
                        <div className="container-database-library-title-row">
                          <h3>{product.name}</h3>
                          <span>{product.numberCode || "---"}</span>
                        </div>
                        <div className="container-database-library-code">{product.code}</div>
                        <div className="container-database-library-meta">
                          <span>Collection: {product.collectionOwnedCount || 0}/{product.collectionTotalCount || 0}</span>
                          <span>{product.categoryLabel}</span>
                          <span>{product.cardsPerOpen} per open</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {selectedItem ? (
          <div className="container-database-modal-backdrop" onClick={closeDetailModal}>
            <div className="container-database-modal" onClick={(event) => event.stopPropagation()}>
              <div className="container-database-modal-grid">
                <div className="container-database-modal-art-column">
                  <div className="container-database-modal-kicker">{selectedItem.categoryLabel.toUpperCase()}</div>
                  <h2 className="container-database-modal-title">{selectedItem.name}</h2>
                  <div className="container-database-modal-art-shell">
                    {selectedItem.imageUrl ? (
                      <img src={selectedItem.imageUrl} alt={selectedItem.name} className="container-database-modal-art" />
                    ) : (
                      <div className="container-database-modal-art-placeholder">No container art uploaded yet.</div>
                    )}
                  </div>
                </div>

                <div className="container-database-modal-content">
                  <div className="container-database-modal-info-grid">
                    <div className="container-database-info-row"><span>Code</span><strong>{selectedItem.code || "—"}</strong></div>
                    <div className="container-database-info-row"><span>Key Label</span><strong>{selectedItem.keyLabel || "—"}</strong></div>
                    <div className="container-database-info-row"><span>Collection</span><strong>{selectedItem.collectionOwnedCount || 0}/{selectedItem.collectionTotalCount || 0}</strong></div>
                    <div className="container-database-info-row"><span>Cards Per Open</span><strong>{selectedItem.cardsPerOpen}</strong></div>
                    <div className="container-database-info-row"><span>Category</span><strong>{selectedItem.categoryLabel}</strong></div>
                    <div className="container-database-info-row"><span>Status</span><strong>{selectedItem.statusLabel}</strong></div>
                  </div>

                  <p className="container-database-modal-copy">{selectedItem.description || "No description provided."}</p>
                  <p className="container-database-modal-note">
                    Collection counts match the opener page. Pull odds below reflect the current configured tier and card weights for this product.
                  </p>

                  {selectedOddsRows.length === 0 ? (
                    <div className="container-database-empty small">No active cards are currently assigned to this container.</div>
                  ) : (
                    <div className="container-database-modal-card-grid">
                      {selectedOddsRows.map((card) => (
                        <button
                          key={card.card_id}
                          type="button"
                          className="container-database-reward-card"
                          onMouseEnter={(event) => handleShowCardHover(card, event.currentTarget)}
                          onMouseLeave={handleHideCardHover}
                        >
                          <div className="container-database-reward-card-image-shell">
                            <img
                              src={buildCardImageUrl(card)}
                              alt={card.card_name}
                              className="container-database-reward-card-image"
                              onError={(event) => {
                                if (event.currentTarget.src !== CARD_IMAGE_FALLBACK) {
                                  event.currentTarget.src = CARD_IMAGE_FALLBACK;
                                }
                              }}
                            />
                          </div>
                          <div className="container-database-reward-card-name">{card.card_name}</div>
                          <div className="container-database-reward-card-meta">{card.tierNames.join(", ")}</div>
                          <div className="container-database-reward-card-odds">
                            <span className="container-database-odds-pill">{formatPercent(card.combinedChancePercent)}</span>
                            <span className="container-database-odds-pill subtle">{formatOneIn(card.combinedChancePercent)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="container-database-modal-actions">
                    <button type="button" className="container-database-secondary-btn" onClick={closeDetailModal}>
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <BinderHoverTooltip preview={hoverPreview} buildCardImageUrl={buildCardImageUrl} CARD_IMAGE_FALLBACK={CARD_IMAGE_FALLBACK} />
      </div>
    </LauncherLayout>
  );
}

export default ContainerDatabasePage;
