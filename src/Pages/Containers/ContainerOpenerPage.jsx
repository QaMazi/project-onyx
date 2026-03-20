import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";
import BinderHoverTooltip from "../Binder/Components/BinderHoverTooltip";
import "./ContainerOpenerPage.css";

const CARD_IMAGE_FALLBACK =
  "https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/fallback_image.jpg";
const TAB_ORDER = ["packs", "boxes"];
const PACK_SECTION_OPTIONS = [
  { value: "normal", label: "Normal Packs", sectionLabel: "Normal Packs" },
  { value: "reward", label: "Reward Packs", sectionLabel: "Reward Packs" },
];
const BOX_SECTION_OPTIONS = [
  { value: "deck", label: "Deck Boxes", sectionLabel: "Deck Boxes" },
  { value: "promo", label: "Promo Boxes", sectionLabel: "Promo Boxes" },
];
const RANDOM_KEY_FAMILY_ORDER = [
  "random_deck_box_key",
  "random_promo_box_key",
  "random_full_pack_key",
  "random_draft_pack_key",
];
const BOX_REEL_CARD_WIDTH = 190;
const BOX_REEL_CARD_GAP = 18;
const BOX_REEL_SPINNER_PADDING = 24;
const BOX_REEL_CARD_PITCH = BOX_REEL_CARD_WIDTH + BOX_REEL_CARD_GAP;
const BOX_REEL_TOTAL_CARDS = 80;
const BOX_REEL_WINNER_INDEX = 60;
const BOX_REEL_DEFAULT_WINDOW_WIDTH = 720;
const BOX_REEL_SPIN_DURATION = 5000;
const BOX_REEL_RESULT_DELAY = 420;

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function getContainerBucket(typeCode) {
  const code = normalizeText(typeCode);
  if (code === "promo_box" || code === "deck_box") return "boxes";
  if (code === "full_pack" || code === "draft_pack") return "packs";
  return "boxes";
}

function getRandomKeyBucket(exactItemFamily) {
  const family = normalizeText(exactItemFamily);
  if (family === "random_deck_box_key" || family === "random_promo_box_key") {
    return "boxes";
  }
  if (family === "random_draft_pack_key" || family === "random_full_pack_key") {
    return "packs";
  }
  return "boxes";
}

function getRandomKeySortValue(exactItemFamily) {
  const index = RANDOM_KEY_FAMILY_ORDER.indexOf(normalizeText(exactItemFamily));
  return index >= 0 ? index : RANDOM_KEY_FAMILY_ORDER.length + 10;
}

function getBucketLabel(bucket) {
  return bucket === "packs" ? "Packs" : "Boxes";
}

function getRarityClass(rarityCode) {
  return `rarity-${String(rarityCode || "base")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")}`;
}

function getTierClass(tierCode) {
  return `tier-${String(tierCode || "tier1")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")}`;
}

function getContainerImageUrl(container) {
  return container?.artwork_url || container?.image_url || "";
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

function normalizePackDisplayName(name) {
  return String(name || "").replace(/\s+Draft$/i, "").trim();
}

function getPackVariant(container, containerTypeCode) {
  return normalizeText(container?.pack_variant || containerTypeCode) === "draft" ||
    normalizeText(containerTypeCode) === "draft_pack"
    ? "draft"
    : "normal";
}

function summarizeGrantedKeys(grantedItems) {
  if (!Array.isArray(grantedItems) || grantedItems.length === 0) return "";

  const names = grantedItems
    .map((entry) => String(entry?.item_name || "").trim())
    .filter(Boolean);

  if (names.length === 0) return "";
  if (names.length === 1) return ` Received ${names[0]}.`;
  if (names.length === 2) return ` Received ${names[0]} and ${names[1]}.`;
  if (names.length <= 4) {
    return ` Received ${names.slice(0, -1).join(", ")}, and ${
      names[names.length - 1]
    }.`;
  }
  return ` Received ${names.length} keys.`;
}

function getAffordableOpenerPurchaseCount(openerDefinition, shards) {
  if (!openerDefinition?.id) return 0;

  const maxPurchase = Number(openerDefinition.max_purchase || 99) || 99;
  const price = Number(openerDefinition.store_price || 0);

  if (price <= 0) return maxPurchase;
  return Math.max(0, Math.min(maxPurchase, Math.floor(Number(shards || 0) / price)));
}

function canPurchaseOpenerDefinition(openerDefinition, shards) {
  if (!openerDefinition?.id) return false;
  if (openerDefinition.is_store_purchase_locked) return false;
  if (openerDefinition.is_randomly_available === false) return false;
  return getAffordableOpenerPurchaseCount(openerDefinition, shards) >= 1;
}

function getNumberSortValue(value) {
  const normalized = String(value || "").trim();
  if (/^(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2})$/.test(normalized)) return Number(normalized);
  return Number.MAX_SAFE_INTEGER;
}

function getPackSectionLabel(filter) {
  return filter === "reward" ? "Reward Packs" : "Normal Packs";
}

function getBoxSectionLabel(filter) {
  return filter === "deck" ? "Deck Boxes" : "Promo Boxes";
}

function buildSelectionAction({ mode, container, openerDefinition, inventoryRow, shards }) {
  if (!container && !openerDefinition && !inventoryRow) return null;

  const availableQuantity = Number(inventoryRow?.available_quantity || 0);
  const maxAffordable = getAffordableOpenerPurchaseCount(openerDefinition, shards);
  const maxPurchase = Number(openerDefinition?.max_purchase || 99) || 99;
  const isLocked = container?.is_locked === true;

  return {
    mode,
    container,
    openerDefinition,
    inventoryRow,
    isLocked,
    availableQuantity,
    requiredItemName: inventoryRow?.item_name || openerDefinition?.name || "No key assigned",
    requiredItemCode: inventoryRow?.item_code || openerDefinition?.code || "",
    storePrice: Number(openerDefinition?.store_price || 0),
    purchaseCap: Math.max(1, Math.min(maxPurchase, Math.max(maxAffordable, 1))),
    maxAffordable,
    canPurchase: !isLocked && canPurchaseOpenerDefinition(openerDefinition, shards),
  };
}

function summarizeCollectionProgress(containerIds, containerCollectionById) {
  let ownedCount = 0;
  let totalCount = 0;
  const seenContainerIds = new Set();

  (containerIds || []).forEach((containerId) => {
    if (!containerId || seenContainerIds.has(containerId)) return;
    seenContainerIds.add(containerId);
    const progress = containerCollectionById.get(containerId);
    if (!progress) return;
    ownedCount += Number(progress.ownedCount || 0);
    totalCount += Number(progress.totalCount || 0);
  });

  return { ownedCount, totalCount };
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

function normalizeDraftSessionPayload(sessionData, actionKeyName = "Draft Pack Key") {
  if (!sessionData) return null;

  const openings = Array.isArray(sessionData.openings)
    ? sessionData.openings.map((opening) => ({
        ...opening,
        pulls: [...(opening?.pulls || [])].sort(
          (left, right) => Number(left?.slot_index || 0) - Number(right?.slot_index || 0)
        ),
      }))
    : [];

  if (!openings.length) return null;

  const activeIndex = Math.min(
    Math.max(Number(sessionData.active_index || 0), 0),
    Math.max(openings.length - 1, 0)
  );

  return {
    bucket: "packs",
    actionMode: "draft",
    actionLabel: "DRAFT PACK OPENING",
    actionKeyName,
    requestedCount: Number(sessionData.opening_count || openings.length || 0),
    sessionId: sessionData.session_id || null,
    openings,
    activeIndex,
  };
}

function getOpeningRevealTotal(opening) {
  return Math.max((opening?.pulls || []).length, Number(opening?.cards_per_open || 0), 1);
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

function buildRevealPlaceholders(count) {
  return Array.from({ length: Math.max(1, count) }).map((_, index) => ({
    id: `placeholder-${index}`,
    card_name: "Hidden Card",
    rarity_name: "Unknown",
    rarity_code: "base",
    tier_name: "Unknown",
    tier_code: "tier1",
    image_url: "",
    isPlaceholder: true,
  }));
}

function buildDisplayRevealCards(cards, revealCount, placeholderCount) {
  const total = Math.max(cards.length, placeholderCount, 1);
  const placeholders = buildRevealPlaceholders(total);

  return placeholders.map((placeholder, index) => {
    if (index < revealCount && cards[index]) {
      return {
        ...cards[index],
        revealKey: `revealed-${cards[index].card_id || cards[index].id || index}-${index}`,
        isRevealed: true,
      };
    }

    return {
      ...placeholder,
      revealKey: placeholder.id,
      isRevealed: false,
    };
  });
}

function sumOpeningPulls(openings) {
  return (openings || []).reduce(
    (sum, opening) => sum + ((opening?.pulls || []).length || 0),
    0
  );
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function buildBoxReelData(winningCard, previewCards, windowWidth) {
  if (!winningCard) {
    return {
      cards: [],
      targetX: 0,
    };
  }

  const visualPool = (previewCards || []).filter(
    (card) =>
      String(card?.card_id || "") !== String(winningCard.card_id || "") ||
      String(card?.tier_code || "") !== String(winningCard.tier_code || "")
  );
  const sourcePool = visualPool.length ? visualPool : [winningCard];
  const startOffset =
    sourcePool.length > 0
      ? Math.abs(Number(winningCard.card_id || BOX_REEL_WINNER_INDEX)) % sourcePool.length
      : 0;

  const cards = Array.from({ length: BOX_REEL_TOTAL_CARDS }).map((_, index) => {
    if (index === BOX_REEL_WINNER_INDEX) {
      return {
        ...winningCard,
        reelKey: `winner-${winningCard.card_id || winningCard.id || "card"}-${index}`,
        isWinner: true,
      };
    }

    const sourceCard =
      sourcePool[(startOffset + index * 7 + Math.floor(index / 3)) % sourcePool.length] ||
      winningCard;

    return {
      ...sourceCard,
      reelKey: `visual-${sourceCard.card_id || sourceCard.id || "card"}-${index}`,
      isWinner: false,
    };
  });

  const safeWindowWidth = Math.max(Number(windowWidth || 0), BOX_REEL_DEFAULT_WINDOW_WIDTH);
  const targetCardCenter =
    BOX_REEL_SPINNER_PADDING +
    BOX_REEL_WINNER_INDEX * BOX_REEL_CARD_PITCH +
    BOX_REEL_CARD_WIDTH / 2;

  return {
    cards,
    targetX: -(targetCardCenter - safeWindowWidth / 2),
  };
}

function getBoxReelMotionClass(phase) {
  if (phase === "burst") return "is-fast-blur";
  if (phase === "revealing") return "is-mid-blur";
  return "";
}

function getBoxHitSoundKey(tierCode) {
  const normalized = normalizeText(tierCode);
  if (normalized === "tier9" || normalized === "tier10") return "jackpot";
  if (normalized === "tier7" || normalized === "tier8") return "red";
  return "common";
}

function sortLibraryItems(left, right, numberField = "packNumberCode") {
  const numberDiff =
    getNumberSortValue(left?.[numberField]) - getNumberSortValue(right?.[numberField]);
  if (numberDiff !== 0) return numberDiff;

  const nameDiff = String(left?.name || "").localeCompare(String(right?.name || ""));
  if (nameDiff !== 0) return nameDiff;

  return String(left?.code || "").localeCompare(String(right?.code || ""));
}

function ContainerOpenerPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [purchaseBusyId, setPurchaseBusyId] = useState("");
  const [activeTab, setActiveTab] = useState("packs");
  const [packSectionFilter, setPackSectionFilter] = useState("normal");
  const [boxSectionFilter, setBoxSectionFilter] = useState("promo");
  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [shards, setShards] = useState(0);

  const [catalogContainers, setCatalogContainers] = useState([]);
  const [containerCollectionRows, setContainerCollectionRows] = useState([]);
  const [inventoryRows, setInventoryRows] = useState([]);
  const [openerDefinitions, setOpenerDefinitions] = useState([]);
  const [randomKeyProducts, setRandomKeyProducts] = useState([]);
  const [selectedLibraryItem, setSelectedLibraryItem] = useState(null);
  const [selectionModalOpen, setSelectionModalOpen] = useState(false);
  const [openCount, setOpenCount] = useState(1);
  const [buyCount, setBuyCount] = useState(1);
  const [showBuyOptions, setShowBuyOptions] = useState(false);
  const [randomKeyModalOpen, setRandomKeyModalOpen] = useState(false);
  const [randomBuyCounts, setRandomBuyCounts] = useState({});

  const [sessionState, setSessionState] = useState(null);
  const [revealPhase, setRevealPhase] = useState("idle");
  const [revealCount, setRevealCount] = useState(0);
  const [selectedDraftCardId, setSelectedDraftCardId] = useState(null);
  const [claimingDraftPick, setClaimingDraftPick] = useState(false);
  const [boxResultVisible, setBoxResultVisible] = useState(false);
  const [boxReelPreviewByContainerId, setBoxReelPreviewByContainerId] = useState({});
  const [boxReelWindowWidth, setBoxReelWindowWidth] = useState(BOX_REEL_DEFAULT_WINDOW_WIDTH);
  const [boxReelMotionClass, setBoxReelMotionClass] = useState("");
  const [hoverPreview, setHoverPreview] = useState(null);
  const [hoverCardDetailsById, setHoverCardDetailsById] = useState({});

  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const revealTimersRef = useRef([]);
  const boxSpinnerRef = useRef(null);
  const boxReelWindowRef = useRef(null);
  const boxSpinFrameRef = useRef(null);
  const boxSfxRef = useRef({
    reel: null,
    common: null,
    red: null,
    jackpot: null,
  });
  const lastBoxSfxEventRef = useRef("");

  function clearRevealTimers() {
    revealTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    revealTimersRef.current = [];
  }

  function stopBoxSpinAnimation() {
    if (boxSpinFrameRef.current) {
      cancelAnimationFrame(boxSpinFrameRef.current);
      boxSpinFrameRef.current = null;
    }
    setBoxReelMotionClass("");
  }

  function setBoxSpinnerTransform(value) {
    if (boxSpinnerRef.current) {
      boxSpinnerRef.current.style.transform = `translateX(${value}px)`;
    }
  }

  function stopBoxSfx(resetEvent = false) {
    Object.values(boxSfxRef.current).forEach((audio) => {
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
    });

    if (resetEvent) {
      lastBoxSfxEventRef.current = "";
    }
  }

  function restoreDraftSession(sessionData, actionKeyName = "Draft Pack Key") {
    const nextSession = normalizeDraftSessionPayload(sessionData, actionKeyName);
    if (!nextSession) return false;

    clearRevealTimers();
    stopBoxSpinAnimation();
    setSessionState(nextSession);
    setRevealPhase("revealed");
    setRevealCount(getOpeningRevealTotal(nextSession.openings[nextSession.activeIndex]));
    setSelectedDraftCardId(
      nextSession.openings[nextSession.activeIndex]?.selected_card_id
        ? String(nextSession.openings[nextSession.activeIndex].selected_card_id)
        : null
    );
    setBoxResultVisible(false);

    return true;
  }

  function playBoxSfx(key, { loop = false, volume = 1 } = {}) {
    const audio = boxSfxRef.current[key];
    if (!audio) return;

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.loop = loop;
      audio.volume = volume;
      audio.play().catch(() => {});
    } catch (error) {
      console.warn("Box opener sound failed:", error);
    }
  }

  const inventoryByItemDefinitionId = useMemo(
    () => new Map(inventoryRows.map((row) => [row.item_definition_id, row])),
    [inventoryRows]
  );

  const containerCollectionById = useMemo(
    () =>
      new Map(
        containerCollectionRows.map((row) => [
          row.container_id,
          {
            ownedCount: Number(row.owned_unique_cards || 0),
            totalCount: Number(row.total_unique_cards || 0),
          },
        ])
      ),
    [containerCollectionRows]
  );

  const openerDefinitionsByContainerId = useMemo(() => {
    const map = new Map();
    openerDefinitions.forEach((definition) => {
      if (!definition?.target_id) return;
      if (!map.has(definition.target_id)) {
        map.set(definition.target_id, []);
      }
      map.get(definition.target_id).push(definition);
    });
    return map;
  }, [openerDefinitions]);

  const randomKeyOptions = useMemo(() => {
    const eligibleCounts = {
      deck_box: 0,
      promo_box: 0,
      draft_pack: 0,
      full_pack: 0,
    };

    catalogContainers
      .filter(
        (container) => container.is_enabled === true && container.is_locked !== true
      )
      .forEach((container) => {
      const typeCode = normalizeText(container?.container_type?.code);
      if (Object.prototype.hasOwnProperty.call(eligibleCounts, typeCode)) {
        eligibleCounts[typeCode] += 1;
      }
    });

    return [...randomKeyProducts]
      .map((product) => {
        const bucket = getRandomKeyBucket(product.exact_item_family);
        const family = normalizeText(product.exact_item_family);
        let eligibleCount = 0;

        if (family === "random_deck_box_key") eligibleCount = eligibleCounts.deck_box;
        if (family === "random_promo_box_key") eligibleCount = eligibleCounts.promo_box;
        if (family === "random_draft_pack_key") eligibleCount = eligibleCounts.draft_pack;
        if (family === "random_full_pack_key") eligibleCount = eligibleCounts.full_pack;

        return {
          ...product,
          bucket,
          eligibleCount,
          canBuy:
            eligibleCount > 0 &&
            product.is_store_purchase_locked !== true &&
            product.is_randomly_available !== false,
        };
      })
      .sort((left, right) => {
        const orderDiff =
          getRandomKeySortValue(left.exact_item_family) -
          getRandomKeySortValue(right.exact_item_family);
        if (orderDiff !== 0) return orderDiff;
        return String(left.name || "").localeCompare(String(right.name || ""));
      });
  }, [catalogContainers, randomKeyProducts]);

  const packSections = useMemo(() => {
    const groupMap = new Map();

    catalogContainers
      .filter((container) => container.bucket === "packs")
      .forEach((container) => {
        const groupKey = container.pack_group_code || `pack:${container.id}`;
        const variant = getPackVariant(container, container.container_type?.code);
        const openerDefinition = (openerDefinitionsByContainerId.get(container.id) || [])[0] || null;
        const inventoryRow = openerDefinition
          ? inventoryByItemDefinitionId.get(openerDefinition.id) || null
          : null;

        if (!groupMap.has(groupKey)) {
          groupMap.set(groupKey, {
            key: groupKey,
            type: "pack",
            normalRow: null,
            draftRow: null,
            normalContainer: null,
            draftContainer: null,
            normalOpenerDefinition: null,
            draftOpenerDefinition: null,
          });
        }

        const entry = groupMap.get(groupKey);
        if (variant === "draft") {
          entry.draftRow = inventoryRow;
          entry.draftContainer = container;
          entry.draftOpenerDefinition = openerDefinition;
        } else {
          entry.normalRow = inventoryRow;
          entry.normalContainer = container;
          entry.normalOpenerDefinition = openerDefinition;
        }
      });

    const sectionMap = new Map();

    Array.from(groupMap.values()).forEach((entry) => {
      const displayContainer = entry.normalContainer || entry.draftContainer;
      if (!displayContainer) return;
      const collectionProgress = summarizePackGroupCollectionProgress(
        [entry.normalContainer?.id, entry.draftContainer?.id],
        containerCollectionById
      );

      const product = {
        key: entry.key,
        type: "pack",
        name: normalizePackDisplayName(displayContainer.name),
        code: displayContainer.code,
        imageUrl: getContainerImageUrl(displayContainer),
        description: displayContainer.description || "",
        packNumberCode:
          entry.normalContainer?.pack_number_code ||
          entry.draftContainer?.pack_number_code ||
          "",
        isRewardPack: Boolean(
          entry.normalContainer?.is_reward_pack ?? entry.draftContainer?.is_reward_pack
        ),
        cardsPerOpen:
          entry.normalContainer?.cards_per_open ||
          entry.draftContainer?.cards_per_open ||
          9,
        normalRow: entry.normalRow,
        draftRow: entry.draftRow,
        normalContainer: entry.normalContainer,
        draftContainer: entry.draftContainer,
        normalOpenerDefinition: entry.normalOpenerDefinition,
        draftOpenerDefinition: entry.draftOpenerDefinition,
        normalLocked: entry.normalContainer?.is_locked === true,
        draftLocked: entry.draftContainer?.is_locked === true,
        isLocked: Boolean(
          (entry.normalContainer ? entry.normalContainer.is_locked === true : true) &&
            (entry.draftContainer ? entry.draftContainer.is_locked === true : true)
        ),
        normalQuantity: Number(entry.normalRow?.available_quantity || 0),
        draftQuantity: Number(entry.draftRow?.available_quantity || 0),
        normalRequiredItemName: entry.normalOpenerDefinition?.name || "",
        draftRequiredItemName: entry.draftOpenerDefinition?.name || "",
        collectionOwnedCount: collectionProgress.ownedCount,
        collectionTotalCount: collectionProgress.totalCount,
      };

      const sectionLabel = product.isRewardPack ? "Reward Packs" : "Normal Packs";
      if (!sectionMap.has(sectionLabel)) {
        sectionMap.set(sectionLabel, []);
      }
      sectionMap.get(sectionLabel).push(product);
    });

    return Array.from(sectionMap.entries())
      .sort(([left], [right]) => {
        const leftRank = left === "Normal Packs" ? 0 : 1;
        const rightRank = right === "Normal Packs" ? 0 : 1;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.localeCompare(right);
      })
      .map(([label, products]) => ({
        label,
        products: [...products].sort((left, right) => sortLibraryItems(left, right)),
      }));
  }, [
    catalogContainers,
    containerCollectionById,
    inventoryByItemDefinitionId,
    openerDefinitionsByContainerId,
  ]);

  const boxSections = useMemo(() => {
    const sectionMap = new Map();

    catalogContainers
      .filter((container) => container.bucket === "boxes")
      .forEach((container) => {
        const openerDefinition = (openerDefinitionsByContainerId.get(container.id) || [])[0] || null;
        const inventoryRow = openerDefinition
          ? inventoryByItemDefinitionId.get(openerDefinition.id) || null
          : null;
        const collectionProgress = summarizeCollectionProgress(
          [container.id],
          containerCollectionById
        );
        const sectionLabel =
          normalizeText(container.container_type?.code) === "deck_box"
            ? "Deck Boxes"
            : "Promo Boxes";

        if (!sectionMap.has(sectionLabel)) {
          sectionMap.set(sectionLabel, []);
        }

        sectionMap.get(sectionLabel).push({
          key: `box:${container.id}`,
          type: "box",
          containerId: container.id,
          container,
          name: container.name,
          code: container.code,
          imageUrl: getContainerImageUrl(container),
          description: container.description || openerDefinition?.description || "",
          boxNumberCode: container.box_number_code || "",
          cardsPerOpen: container.cards_per_open || 1,
          inventoryRow,
          openerDefinition,
          isLocked: container.is_locked === true,
          availableQuantity: Number(inventoryRow?.available_quantity || 0),
          categoryLabel: container.container_type?.name || "Box",
          requiredItemName: openerDefinition?.name || "",
          collectionOwnedCount: collectionProgress.ownedCount,
          collectionTotalCount: collectionProgress.totalCount,
        });
      });

    return Array.from(sectionMap.entries())
      .sort(([left], [right]) => {
        const leftRank = left === "Deck Boxes" ? 0 : 1;
        const rightRank = right === "Deck Boxes" ? 0 : 1;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.localeCompare(right);
      })
      .map(([label, products]) => ({
        label,
        products: [...products].sort((left, right) =>
          sortLibraryItems(left, right, "boxNumberCode")
        ),
      }));
  }, [
    catalogContainers,
    containerCollectionById,
    inventoryByItemDefinitionId,
    openerDefinitionsByContainerId,
  ]);

  const packSectionsForDisplay = useMemo(
    () => packSections.filter((section) => section.label === getPackSectionLabel(packSectionFilter)),
    [packSectionFilter, packSections]
  );

  const boxSectionsForDisplay = useMemo(
    () => boxSections.filter((section) => section.label === getBoxSectionLabel(boxSectionFilter)),
    [boxSectionFilter, boxSections]
  );

  const activeSections = activeTab === "packs" ? packSectionsForDisplay : boxSectionsForDisplay;

  const allLibraryItems = useMemo(
    () => [
      ...packSections.flatMap((section) => section.products),
      ...boxSections.flatMap((section) => section.products),
    ],
    [boxSections, packSections]
  );

  const selectedItem = useMemo(() => {
    if (!selectedLibraryItem?.key) return null;
    return allLibraryItems.find((item) => item.key === selectedLibraryItem.key) || selectedLibraryItem;
  }, [allLibraryItems, selectedLibraryItem]);

  const selectedPackFullAction = useMemo(() => {
    if (!selectedItem || selectedItem.type !== "pack") return null;
    return buildSelectionAction({
      mode: "full",
      container: selectedItem.normalContainer,
      openerDefinition: selectedItem.normalOpenerDefinition,
      inventoryRow: selectedItem.normalRow,
      shards,
    });
  }, [selectedItem, shards]);

  const selectedPackDraftAction = useMemo(() => {
    if (!selectedItem || selectedItem.type !== "pack") return null;
    return buildSelectionAction({
      mode: "draft",
      container: selectedItem.draftContainer,
      openerDefinition: selectedItem.draftOpenerDefinition,
      inventoryRow: selectedItem.draftRow,
      shards,
    });
  }, [selectedItem, shards]);

  const selectedBoxAction = useMemo(() => {
    if (!selectedItem || selectedItem.type !== "box") return null;
    return buildSelectionAction({
      mode: "box",
      container: selectedItem.container,
      openerDefinition: selectedItem.openerDefinition,
      inventoryRow: selectedItem.inventoryRow,
      shards,
    });
  }, [selectedItem, shards]);

  const selectedAnyAvailableQuantity = useMemo(() => {
    if (!selectedItem) return 0;
    if (selectedItem.type === "pack") {
      return Math.max(
        selectedPackFullAction?.availableQuantity || 0,
        selectedPackDraftAction?.availableQuantity || 0
      );
    }
    return selectedBoxAction?.availableQuantity || 0;
  }, [selectedBoxAction, selectedItem, selectedPackDraftAction, selectedPackFullAction]);

  const selectedBuyOptions = useMemo(() => {
    if (!selectedItem) return [];
    if (selectedItem.type === "pack") {
      return [selectedPackFullAction, selectedPackDraftAction].filter(Boolean);
    }
    return selectedBoxAction ? [selectedBoxAction] : [];
  }, [selectedBoxAction, selectedItem, selectedPackDraftAction, selectedPackFullAction]);

  const selectedPurchaseCap = useMemo(() => {
    if (!selectedBuyOptions.length) return 1;
    return Math.max(1, ...selectedBuyOptions.map((option) => option.purchaseCap || 1));
  }, [selectedBuyOptions]);

  const selectedPurchaseLabel = selectedItem?.type === "pack" ? "pack" : "box";

  const selectedPrimaryCategoryLabel =
    selectedItem?.type === "pack"
      ? selectedItem?.isRewardPack
        ? "Reward Pack"
        : "Normal Pack"
      : selectedItem?.categoryLabel || "Box";

  const selectedModalKicker =
    selectedItem?.type === "pack"
      ? selectedItem?.isRewardPack
        ? "REWARD PACK"
        : "NORMAL PACK"
      : selectedItem?.categoryLabel?.toUpperCase() || "BOX";

  const selectedActionCopy =
    selectedItem?.type === "pack"
      ? "Choose whether to open the full pack, open the draft version, or buy the exact key you need right here."
      : "Open this box with the exact key you own, or buy one here without leaving the opener.";

  const currentOpening = useMemo(
    () =>
      sessionState?.openings?.[
        Math.min(sessionState.activeIndex || 0, (sessionState?.openings?.length || 1) - 1)
      ] || null,
    [sessionState]
  );

  const isDraftSession = sessionState?.actionMode === "draft";

  const displayRevealCards = useMemo(
    () =>
      buildDisplayRevealCards(
        currentOpening?.pulls || [],
        revealCount,
        currentOpening?.cards_per_open || (currentOpening?.pulls || []).length || 1
      ),
    [currentOpening, revealCount]
  );

  const selectedDraftCard = useMemo(() => {
    if (!isDraftSession || !currentOpening || !selectedDraftCardId) return null;
    return (
      currentOpening.pulls?.find(
        (card) => String(card?.card_id || "") === String(selectedDraftCardId)
      ) || null
    );
  }, [currentOpening, isDraftSession, selectedDraftCardId]);

  const isBoxSession = sessionState?.bucket === "boxes";

  const boxWinningCard = useMemo(
    () => (isBoxSession ? currentOpening?.pulls?.[0] || null : null),
    [currentOpening, isBoxSession]
  );

  const boxReelData = useMemo(
    () =>
      buildBoxReelData(
        boxWinningCard,
        sessionState?.boxReelPreviewCards || [],
        boxReelWindowWidth
      ),
    [boxReelWindowWidth, boxWinningCard, sessionState?.boxReelPreviewCards]
  );

  useEffect(() => {
    if (!isBoxSession || !sessionState || !boxWinningCard) {
      stopBoxSfx(true);
      return;
    }

    const sessionKey = `${sessionState.activeIndex}:${boxWinningCard.card_id || boxWinningCard.id || "card"}`;

    if (revealPhase === "charging" || revealPhase === "sealed") {
      stopBoxSfx(true);
      return;
    }

    if (revealPhase === "burst") {
      const nextKey = `spin:${sessionKey}`;
      if (lastBoxSfxEventRef.current !== nextKey) {
        stopBoxSfx();
        playBoxSfx("reel", { loop: true, volume: 0.85 });
        lastBoxSfxEventRef.current = nextKey;
      }
      return;
    }

    if (revealPhase === "revealed") {
      const nextKey = `hit:${sessionKey}`;
      if (lastBoxSfxEventRef.current !== nextKey) {
        stopBoxSfx();
        playBoxSfx(getBoxHitSoundKey(boxWinningCard.tier_code), { volume: 0.95 });
        lastBoxSfxEventRef.current = nextKey;
      }
      return;
    }

    if (revealPhase === "idle") {
      stopBoxSfx(true);
    }
  }, [boxWinningCard, isBoxSession, revealPhase, sessionState]);

  useEffect(() => {
    if (!authLoading && user) {
      loadPage();
    }

    return () => {
      clearRevealTimers();
      stopBoxSpinAnimation();
    };
  }, [authLoading, user]);

  useEffect(() => {
    if (typeof Audio === "undefined") {
      return undefined;
    }

    const nextAudio = {
      reel: new Audio("/audio/sfx/case-reel-sound.mp3"),
      common: new Audio("/audio/sfx/common-hit.mp3"),
      red: new Audio("/audio/sfx/red-hit.mp3"),
      jackpot: new Audio("/audio/sfx/jackpot-hit.mp3"),
    };

    Object.values(nextAudio).forEach((audio) => {
      audio.preload = "auto";
    });

    boxSfxRef.current = nextAudio;

    return () => {
      Object.values(nextAudio).forEach((audio) => {
        audio.pause();
        audio.src = "";
      });
      boxSfxRef.current = {
        reel: null,
        common: null,
        red: null,
        jackpot: null,
      };
    };
  }, []);

  useEffect(() => {
    if (!selectionModalOpen) return;
    setOpenCount((previous) => {
      if (selectedAnyAvailableQuantity <= 0) return 1;
      return Math.min(Math.max(previous, 1), selectedAnyAvailableQuantity);
    });
  }, [selectedAnyAvailableQuantity, selectionModalOpen]);

  useEffect(() => {
    if (!selectionModalOpen) return;
    setBuyCount((previous) => Math.min(Math.max(previous, 1), selectedPurchaseCap));
  }, [selectedPurchaseCap, selectionModalOpen]);

  useEffect(() => {
    if (!isDraftSession || !currentOpening?.opening_id) {
      setSelectedDraftCardId(null);
      return;
    }

    setSelectedDraftCardId(
      currentOpening?.selected_card_id ? String(currentOpening.selected_card_id) : null
    );
  }, [currentOpening?.opening_id, currentOpening?.selected_card_id, isDraftSession]);

  useEffect(() => {
    if (!isBoxSession) {
      setBoxResultVisible(false);
      setBoxReelMotionClass("");
      setBoxSpinnerTransform(0);
      return undefined;
    }

    const measureWindow = () => {
      setBoxReelWindowWidth(
        Math.max(boxReelWindowRef.current?.offsetWidth || 0, BOX_REEL_DEFAULT_WINDOW_WIDTH)
      );
    };

    measureWindow();
    window.addEventListener("resize", measureWindow);
    return () => {
      window.removeEventListener("resize", measureWindow);
    };
  }, [isBoxSession, sessionState?.activeIndex]);

  useEffect(() => {
    if (!randomKeyProducts.length) return;

    setRandomBuyCounts((current) => {
      const next = { ...current };
      randomKeyProducts.forEach((product) => {
        if (!next[product.id]) {
          next[product.id] = 1;
        }
      });
      return next;
    });
  }, [randomKeyProducts]);

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

      if (!currentSeries?.id) {
        setActiveSeriesId(null);
        setShards(0);
        setCatalogContainers([]);
        setContainerCollectionRows([]);
        setInventoryRows([]);
        setOpenerDefinitions([]);
        setRandomKeyProducts([]);
        return;
      }

      const [
        { data: inventoryData, error: inventoryError },
        { data: walletData, error: walletError },
        { data: openerDefinitionData, error: openerDefinitionError },
        { data: randomKeyProductData, error: randomKeyProductError },
        { data: containersData, error: containersError },
        { data: typeData, error: typeError },
        { data: collectionProgressData, error: collectionProgressError },
        { data: activeDraftSessionData, error: activeDraftSessionError },
      ] = await Promise.all([
        supabase
          .from("player_inventory_view")
          .select("*")
          .eq("user_id", user.id)
          .eq("series_id", currentSeries.id)
          .eq("behavior_code", "open_container")
          .eq("target_kind", "container"),
        supabase
          .from("player_wallets")
          .select("shards")
          .eq("user_id", user.id)
          .eq("series_id", currentSeries.id)
          .maybeSingle(),
        supabase
          .from("item_definitions")
          .select(
            "id, code, name, description, target_id, exact_item_family, store_price, max_purchase, is_store_purchase_locked, is_randomly_available"
          )
          .eq("behavior_code", "open_container")
          .eq("target_kind", "container")
          .eq("is_active", true),
        supabase
          .from("item_definitions")
          .select(
            "id, code, name, description, exact_item_family, store_price, max_purchase, is_store_purchase_locked, is_randomly_available"
          )
          .eq("behavior_code", "grant_random_container_key")
          .eq("is_active", true)
          .order("store_order", { ascending: true })
          .order("name", { ascending: true }),
        supabase.from("containers").select("*").or("is_enabled.eq.true,is_locked.eq.true"),
        supabase.from("container_types").select("*"),
        supabase.rpc("get_container_collection_progress", {
          p_series_id: currentSeries.id,
        }),
        supabase.rpc("get_my_active_draft_pack_session", {
          p_series_id: currentSeries.id,
        }),
      ]);

      if (inventoryError) throw inventoryError;
      if (walletError) throw walletError;
      if (openerDefinitionError) throw openerDefinitionError;
      if (randomKeyProductError) throw randomKeyProductError;
      if (containersError) throw containersError;
      if (typeError) throw typeError;
      if (collectionProgressError) throw collectionProgressError;
      if (activeDraftSessionError) throw activeDraftSessionError;

      const typeMap = new Map((typeData || []).map((row) => [row.id, row]));
      const containerMap = new Map((containersData || []).map((row) => [row.id, row]));

      const hydratedCatalog = (containersData || [])
        .map((container) => {
          const type = typeMap.get(container.container_type_id);
          return {
            ...container,
            bucket: getContainerBucket(type?.code),
            container_type: type || null,
          };
        })
        .filter((container) => container.container_type);

      const hydratedRows = (inventoryData || [])
        .map((row) => {
          const container = containerMap.get(row.target_id);
          const type = container ? typeMap.get(container.container_type_id) : null;

          return {
            ...row,
            bucket: getContainerBucket(type?.code),
            container,
            container_type: type,
          };
        })
        .filter((row) => row.container && row.container_type);

      setCatalogContainers(hydratedCatalog);
      setContainerCollectionRows(collectionProgressData || []);
      setInventoryRows(hydratedRows);
      setOpenerDefinitions(openerDefinitionData || []);
      setRandomKeyProducts(randomKeyProductData || []);
      setActiveSeriesId(currentSeries.id);
      setShards(Number(walletData?.shards || 0));

      if (!sessionState || sessionState.actionMode === "draft") {
        if (!restoreDraftSession(activeDraftSessionData)) {
          setSessionState((previous) =>
            previous?.actionMode === "draft" ? null : previous
          );
          if (sessionState?.actionMode === "draft") {
            clearRevealTimers();
            setRevealPhase("idle");
            setRevealCount(0);
            setSelectedDraftCardId(null);
          }
        }
      }
    } catch (error) {
      console.error("Failed to load opener page:", error);
      setErrorMessage(error.message || "Failed to load opener page.");
      setActiveSeriesId(null);
      setShards(0);
      setCatalogContainers([]);
      setContainerCollectionRows([]);
      setInventoryRows([]);
      setOpenerDefinitions([]);
      setRandomKeyProducts([]);
    } finally {
      setLoading(false);
    }
  }

  function openSelectionModal(item) {
    setSelectedLibraryItem(item);
    setSelectionModalOpen(true);
    setOpenCount(1);
    setBuyCount(1);
    setShowBuyOptions(false);
    setErrorMessage("");
  }

  function closeSelectionModal() {
    setSelectionModalOpen(false);
    setSelectedLibraryItem(null);
    setShowBuyOptions(false);
  }

  function closeRandomKeyModal() {
    setRandomKeyModalOpen(false);
  }

  function getEstimatedBoxReelWindowWidth() {
    if (boxReelWindowRef.current?.offsetWidth) {
      return boxReelWindowRef.current.offsetWidth;
    }

    if (typeof window !== "undefined") {
      return Math.max(Math.min(window.innerWidth - 96, 1032), BOX_REEL_DEFAULT_WINDOW_WIDTH);
    }

    return BOX_REEL_DEFAULT_WINDOW_WIDTH;
  }

  async function getBoxReelPreviewCards(containerId) {
    if (!containerId) return [];
    if (Array.isArray(boxReelPreviewByContainerId[containerId])) {
      return boxReelPreviewByContainerId[containerId];
    }

    const { data, error } = await supabase.rpc("get_box_reel_preview_cards", {
      p_container_id: containerId,
      p_card_limit: 48,
    });

    if (error) throw error;

    const nextCards = Array.isArray(data) ? data : [];
    setBoxReelPreviewByContainerId((current) => ({
      ...current,
      [containerId]: nextCards,
    }));
    return nextCards;
  }

  async function getHoverCardDetails(cardId, fallbackCard = null) {
    if (!cardId) return fallbackCard;

    if (hoverCardDetailsById[cardId]) {
      return hoverCardDetailsById[cardId];
    }

    const { data, error } = await supabase
      .from("cards")
      .select("id, name, desc, image_url")
      .eq("id", cardId)
      .maybeSingle();

    if (error) throw error;

    const nextCard = data || fallbackCard;
    if (nextCard) {
      setHoverCardDetailsById((current) => ({
        ...current,
        [cardId]: nextCard,
      }));
    }

    return nextCard;
  }

  async function handleShowRewardHover(card, target, extraLines = []) {
    if (!card || !target) return;

    try {
      const cardDetails = await getHoverCardDetails(card.card_id || card.id, {
        id: card.card_id || card.id || null,
        name: card.card_name || card.name || "Unknown Card",
        desc: card.desc || "",
        image_url: card.image_url || "",
      });
      const position = getHoverPreviewPosition(target);
      setHoverPreview({
        card: cardDetails,
        lines: extraLines.filter(Boolean),
        ...position,
      });
    } catch (error) {
      console.warn("Failed to load hover card details:", error);
    }
  }

  function handleHideRewardHover() {
    setHoverPreview(null);
  }

  function animateBoxReelToTarget(targetX) {
    stopBoxSpinAnimation();
    setBoxResultVisible(false);
    setBoxSpinnerTransform(0);
    setBoxReelMotionClass("is-fast-blur");
    setRevealPhase("burst");

    const startTime = performance.now();

    const frame = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / BOX_REEL_SPIN_DURATION, 1);
      const eased = easeOutCubic(progress);
      const currentX = targetX * eased;

      if (progress < 0.58) {
        setBoxReelMotionClass("is-fast-blur");
      } else if (progress < 0.82) {
        setBoxReelMotionClass("is-mid-blur");
      } else {
        setBoxReelMotionClass("");
      }

      setBoxSpinnerTransform(currentX);

      if (progress < 1) {
        boxSpinFrameRef.current = requestAnimationFrame(frame);
        return;
      }

      setBoxSpinnerTransform(targetX);
      setBoxReelMotionClass("");
      setRevealPhase("revealed");
      boxSpinFrameRef.current = null;

      revealTimersRef.current.push(
        setTimeout(() => {
          setBoxResultVisible(true);
        }, BOX_REEL_RESULT_DELAY)
      );
    };

    boxSpinFrameRef.current = requestAnimationFrame(frame);
  }

  function startRevealSequence(openings, activeIndex, options = {}) {
    const safeIndex = Math.min(Math.max(activeIndex, 0), Math.max(openings.length - 1, 0));
    const opening = openings[safeIndex];
    const revealTotal = Math.max(opening?.pulls?.length || 0, opening?.cards_per_open || 0, 1);
    const isBoxSequence = options.bucket === "boxes";

    clearRevealTimers();
    setRevealCount(0);
    setSelectedDraftCardId(null);
    setBoxResultVisible(false);
    setSessionState((previous) =>
      previous
        ? {
            ...previous,
            activeIndex: safeIndex,
          }
        : previous
    );

    if (isBoxSequence) {
      animateBoxReelToTarget(options.boxTargetX || 0);
      return;
    }

    setRevealPhase("charging");

    revealTimersRef.current = [
      setTimeout(() => {
        setRevealPhase("sealed");
      }, 140),
      setTimeout(() => {
        setRevealPhase("burst");
      }, 760),
      ...Array.from({ length: revealTotal }).map((_, index) =>
        setTimeout(() => {
          setRevealPhase("revealing");
          setRevealCount(index + 1);
        }, 1160 + index * 180)
      ),
      setTimeout(() => {
        setRevealPhase("revealed");
      }, 1160 + revealTotal * 180 + 220),
    ];
  }

  async function handleOpenAction(action) {
    if (!action?.inventoryRow || opening) return;

    if (action.availableQuantity <= 0) {
      setErrorMessage("You do not have the required key for that option.");
      return;
    }

    const requestedCount = Math.min(Math.max(openCount, 1), action.availableQuantity);

    setOpening(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const rpcName =
        action.mode === "draft"
          ? "open_draft_inventory_container_batch"
          : "open_inventory_container_batch";

      const { data, error } = await supabase.rpc(rpcName, {
        p_inventory_id: action.inventoryRow.id,
        p_open_count: requestedCount,
      });

      if (error) throw error;

      closeSelectionModal();

      if (action.mode === "draft") {
        const nextSession = normalizeDraftSessionPayload(data, action.requiredItemName);

        if (!nextSession?.openings?.length) {
          throw new Error("No draft pack opening was returned.");
        }

        setSelectedDraftCardId(null);
        setSessionState(nextSession);
        startRevealSequence(nextSession.openings, nextSession.activeIndex || 0);
        return;
      }

      const openings = data?.openings || [];
      if (!openings.length) {
        throw new Error("No openings were returned.");
      }

      let boxReelPreviewCards = [];
      if (action.mode === "box" && action.container?.id) {
        try {
          boxReelPreviewCards = await getBoxReelPreviewCards(action.container.id);
        } catch (previewError) {
          console.warn("Failed to load box reel preview cards:", previewError);
        }
      }

      setSessionState({
        bucket: activeTab,
        actionMode: action.mode,
        actionLabel:
          action.mode === "draft"
            ? "DRAFT PACK OPENING"
            : action.mode === "full"
            ? "FULL PACK OPENING"
            : "BOX OPENING",
        actionKeyName: action.requiredItemName,
        libraryItem: selectedItem,
        boxReelPreviewCards,
        requestedCount,
        openings,
        activeIndex: 0,
      });
      startRevealSequence(openings, 0, {
        bucket: activeTab,
        boxTargetX:
          action.mode === "box"
            ? buildBoxReelData(
                openings[0]?.pulls?.[0] || null,
                boxReelPreviewCards,
                getEstimatedBoxReelWindowWidth()
              ).targetX
            : 0,
      });
    } catch (error) {
      console.error("Failed to open container batch:", error);
      setErrorMessage(error.message || "Failed to open opener batch.");
    } finally {
      setOpening(false);
    }
  }

  async function handlePurchaseOpener(itemDefinitionId, quantity, itemName) {
    if (!activeSeriesId || !itemDefinitionId) return;

    setPurchaseBusyId(itemDefinitionId);
    setErrorMessage("");

    try {
      const requestedQuantity = Math.max(1, Number(quantity || 1));
      const { data, error } = await supabase.rpc("purchase_container_opener_now", {
        p_series_id: activeSeriesId,
        p_item_definition_id: itemDefinitionId,
        p_quantity: requestedQuantity,
      });

      if (error) throw error;

      const purchasedQuantity = Number(data?.quantity || requestedQuantity);
      const totalCost = Number(data?.total_cost || 0);

      setStatusMessage(
        `Purchased ${purchasedQuantity} ${itemName}${
          purchasedQuantity === 1 ? "" : "s"
        } for ${totalCost} Shards.${summarizeGrantedKeys(data?.granted_items || [])}`
      );
      await loadPage();
    } catch (error) {
      console.error("Failed to buy opener:", error);
      setErrorMessage(error.message || "Failed to buy opener.");
    } finally {
      setPurchaseBusyId("");
    }
  }

  async function handleConfirmDraftPick() {
    if (
      !isDraftSession ||
      !currentOpening?.opening_id ||
      !selectedDraftCardId ||
      revealPhase !== "revealed" ||
      claimingDraftPick
    ) {
      return;
    }

    setClaimingDraftPick(true);
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc("claim_draft_pack_pick", {
        p_opening_id: currentOpening.opening_id,
        p_card_id: selectedDraftCardId,
      });

      if (error) throw error;

      const pickedName = data?.selected_card?.card_name || "your chosen card";

      if (data?.session_complete || !data?.session) {
        clearRevealTimers();
        setSessionState(null);
        setRevealPhase("idle");
        setRevealCount(0);
        setSelectedDraftCardId(null);
        setStatusMessage(
          `Added ${pickedName} to your binder and finished ${
            sessionState?.openings?.length || 1
          } draft pack${(sessionState?.openings?.length || 1) === 1 ? "" : "s"}.`
        );
        await loadPage();
        return;
      }

      const nextSession = normalizeDraftSessionPayload(
        data.session,
        sessionState?.actionKeyName || "Draft Pack Key"
      );

      if (!nextSession?.openings?.length) {
        throw new Error("The next draft pack opening could not be loaded.");
      }

      setStatusMessage(`Added ${pickedName} to your binder. Choose 1 card from the next draft pack.`);
      setSelectedDraftCardId(null);
      setSessionState(nextSession);
      startRevealSequence(nextSession.openings, nextSession.activeIndex || 0, {
        bucket: "packs",
      });
    } catch (error) {
      console.error("Failed to claim draft pick:", error);
      setErrorMessage(error.message || "Failed to claim your draft pack pick.");
    } finally {
      setClaimingDraftPick(false);
    }
  }

  async function handleAdvanceSession() {
    if (!sessionState) return;

    const nextIndex = (sessionState.activeIndex || 0) + 1;
    if (nextIndex < sessionState.openings.length) {
      startRevealSequence(sessionState.openings, nextIndex, {
        bucket: sessionState.bucket,
        boxTargetX:
          sessionState.bucket === "boxes"
            ? buildBoxReelData(
                sessionState.openings[nextIndex]?.pulls?.[0] || null,
                sessionState.boxReelPreviewCards || [],
                getEstimatedBoxReelWindowWidth()
              ).targetX
            : 0,
      });
      return;
    }

    const totalCards = sumOpeningPulls(sessionState.openings);
    const noun = sessionState.bucket === "packs" ? "pack" : "box";
    setStatusMessage(
      `Opened ${sessionState.openings.length} ${noun}${
        sessionState.openings.length === 1 ? "" : "es"
      } and sent ${totalCards} card${totalCards === 1 ? "" : "s"} to your binder.`
    );

    clearRevealTimers();
    stopBoxSpinAnimation();
    setBoxSpinnerTransform(0);
    setSessionState(null);
    setRevealPhase("idle");
    setRevealCount(0);
    setSelectedDraftCardId(null);
    setBoxResultVisible(false);
    await loadPage();
  }

  function renderLibraryCard(item) {
    const isUnavailable =
      item.type === "pack"
        ? Math.max(item.normalQuantity || 0, item.draftQuantity || 0) <= 0
        : (item.availableQuantity || 0) <= 0;
    const isLocked = item.isLocked === true;
    const statusText =
      item.type === "pack"
        ? item.normalLocked && item.draftLocked
          ? "Locked"
          : item.normalLocked
          ? "Full Locked"
          : item.draftLocked
          ? "Draft Locked"
          : "Unlocked"
        : item.isLocked
        ? "Locked"
        : "Unlocked";
    const keysOwnedText =
      item.type === "pack"
        ? `Full ${item.normalQuantity || 0} | Draft ${item.draftQuantity || 0}`
        : String(item.availableQuantity || 0);

    return (
      <button
        key={item.key}
        type="button"
        className={`container-opener-library-card ${isUnavailable ? "is-unavailable" : ""} ${
          isLocked ? "is-locked" : ""
        }`}
        onClick={() => openSelectionModal(item)}
      >
        <div className="container-opener-library-art-shell">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.name}
              className="container-opener-library-art"
            />
          ) : (
            <div className="container-opener-library-art-placeholder">
              <span>{item.type === "pack" ? "Pack" : "Box"}</span>
              <strong>Preview</strong>
            </div>
          )}
          {isLocked ? (
            <div className="container-opener-library-lock-overlay">
              <span className="container-opener-library-lock-badge">LOCKED</span>
            </div>
          ) : null}
        </div>

        <div className="container-opener-library-body">
          <div className="container-opener-library-head">
            <strong>{item.name}</strong>
            <span>
              {item.type === "pack" ? item.packNumberCode || "---" : item.boxNumberCode || "---"}
            </span>
          </div>

          <div className="container-opener-library-meta">
            <span>Code: {item.code}</span>
            <span>
              Collection: {item.collectionOwnedCount || 0}/{item.collectionTotalCount || 0}
            </span>
            <span>Keys Owned: {keysOwnedText}</span>
            <span>Status: {statusText}</span>
          </div>
        </div>
      </button>
    );
  }

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (user.role === "Blocked") return <Navigate to="/" replace />;

  return (
    <LauncherLayout>
      <div className="container-opener-page">
        <div className="container-opener-topbar">
          <div>
            <div className="container-opener-kicker">PROGRESSION</div>
            <h1 className="container-opener-title">Container Opener</h1>
            <p className="container-opener-subtitle">
              Every enabled pack and box stays visible here. Dimmed entries mean you either do
              not own the right key yet or that container is currently locked by admin.
            </p>
          </div>

          <div className="container-opener-topbar-actions">
            <div className="container-opener-wallet-pill">
              <span>Shards</span>
              <strong>{shards}</strong>
            </div>
            <button
              type="button"
              className="container-opener-primary-btn"
              onClick={() => setRandomKeyModalOpen(true)}
            >
              Buy Random Key
            </button>
            <button
              type="button"
              className="container-opener-secondary-btn"
              onClick={() => navigate("/mode/progression")}
            >
              Back
            </button>
          </div>
        </div>

        <div className="container-opener-status-row">
          {statusMessage ? <div className="container-opener-success">{statusMessage}</div> : null}
          {errorMessage ? <div className="container-opener-error">{errorMessage}</div> : null}
        </div>

        {loading ? (
          <div className="container-opener-card container-opener-empty">Loading opener...</div>
        ) : (
          <div className="container-opener-card container-opener-library-shell">
            <div className="container-opener-library-header">
              <div>
                <h2>Choose Box or Pack</h2>
                <p>
                  Openers are grouped by type and sorted by their numbers where available.
                  Locked and unavailable options stay visible so you can always browse the full catalog.
                </p>
              </div>

              <div className="container-opener-library-controls">
                <div className="container-opener-tabs container-opener-tabs--row">
                  {TAB_ORDER.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      className={`container-opener-tab-btn ${
                        activeTab === tab ? "is-active" : ""
                      }`}
                      onClick={() => {
                        setActiveTab(tab);
                        setSelectionModalOpen(false);
                        setSelectedLibraryItem(null);
                      }}
                    >
                      {getBucketLabel(tab)}
                    </button>
                  ))}
                </div>

                <div className="container-opener-tabs container-opener-tabs--row">
                  {(activeTab === "packs" ? PACK_SECTION_OPTIONS : BOX_SECTION_OPTIONS).map(
                    (option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`container-opener-tab-btn ${
                          (activeTab === "packs" ? packSectionFilter : boxSectionFilter) ===
                          option.value
                            ? "is-active"
                            : ""
                        }`}
                        onClick={() => {
                          if (activeTab === "packs") {
                            setPackSectionFilter(option.value);
                          } else {
                            setBoxSectionFilter(option.value);
                          }
                          setSelectionModalOpen(false);
                          setSelectedLibraryItem(null);
                        }}
                      >
                        {option.label}
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>

            {activeSections.length === 0 ? (
              <div className="container-opener-empty">
                No{" "}
                {activeTab === "packs"
                  ? packSectionFilter === "reward"
                    ? "reward packs"
                    : "normal packs"
                  : boxSectionFilter === "deck"
                  ? "deck boxes"
                  : "promo boxes"}{" "}
                are currently in the catalog.
              </div>
            ) : (
              <div className="container-opener-library-sections">
                {activeSections.map((section) => (
                  <section key={section.label} className="container-opener-library-section">
                    <div className="container-opener-library-section-header">
                      <h3>{section.label}</h3>
                      <span>{section.products.length} options</span>
                    </div>

                    <div className="container-opener-library-grid">
                      {section.products.map((item) => renderLibraryCard(item))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}

        {selectionModalOpen && selectedItem ? (
          <div className="container-opener-modal-backdrop" onClick={closeSelectionModal}>
            <div
              className="container-opener-modal container-opener-choice-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="container-opener-modal-kicker">{selectedModalKicker}</div>
              <h2 className="container-opener-modal-title">{selectedItem.name}</h2>

              <div className="container-opener-choice-layout">
                <div className="container-opener-choice-art-shell">
                  {selectedItem.imageUrl ? (
                    <img
                      src={selectedItem.imageUrl}
                      alt={selectedItem.name}
                      className="container-opener-choice-art"
                    />
                  ) : (
                    <div className="container-opener-choice-art-placeholder">
                      No container art uploaded yet.
                    </div>
                  )}
                </div>

                <div className="container-opener-choice-main">
                  <div className="container-opener-choice-info-grid">
                    <div className="container-opener-info-row">
                      <span>Category</span>
                      <strong>{selectedPrimaryCategoryLabel}</strong>
                    </div>
                    <div className="container-opener-info-row">
                      <span>Number</span>
                      <strong>
                        {selectedItem.type === "pack"
                          ? selectedItem.packNumberCode || "---"
                          : selectedItem.boxNumberCode || "---"}
                      </strong>
                    </div>
                    <div className="container-opener-info-row">
                      <span>Cards Per Open</span>
                      <strong>{selectedItem.cardsPerOpen}</strong>
                    </div>
                    <div className="container-opener-info-row">
                      <span>Cards Owned</span>
                      <strong>
                        {selectedItem.collectionOwnedCount || 0}/
                        {selectedItem.collectionTotalCount || 0}
                      </strong>
                    </div>
                    {selectedItem.type === "pack" ? (
                      <>
                        <div className="container-opener-info-row">
                          <span>Full Keys Owned</span>
                          <strong>{selectedPackFullAction?.availableQuantity || 0}</strong>
                        </div>
                        <div className="container-opener-info-row">
                          <span>Draft Keys Owned</span>
                          <strong>{selectedPackDraftAction?.availableQuantity || 0}</strong>
                        </div>
                      </>
                    ) : (
                      <div className="container-opener-info-row">
                        <span>Box Keys Owned</span>
                        <strong>{selectedBoxAction?.availableQuantity || 0}</strong>
                      </div>
                    )}
                  </div>

                  <p className="container-opener-choice-copy">
                    {selectedItem.description || selectedActionCopy}
                  </p>

                  {selectedAnyAvailableQuantity > 0 ? (
                    <div className="container-opener-quantity-block">
                      <div className="container-opener-quantity-header">
                        <strong>How many do you want to open?</strong>
                        <span>
                          {openCount} / {selectedAnyAvailableQuantity}
                        </span>
                      </div>

                      <input
                        type="range"
                        min="1"
                        max={selectedAnyAvailableQuantity}
                        value={Math.min(openCount, selectedAnyAvailableQuantity)}
                        className="container-opener-quantity-slider"
                        onChange={(event) => setOpenCount(Number(event.target.value))}
                      />
                    </div>
                  ) : (
                    <div className="container-opener-error">
                      You do not currently own a usable key for this selection yet.
                    </div>
                  )}

                  <div className="container-opener-choice-option-grid">
                    {selectedItem.type === "pack" ? (
                      <>
                        <div
                          className={`container-opener-choice-option-card ${
                            selectedPackFullAction?.isLocked ||
                            (selectedPackFullAction?.availableQuantity || 0) <= 0
                              ? "is-disabled"
                              : ""
                          }`}
                        >
                          <div className="container-opener-choice-option-head">
                            <strong>Open Full</strong>
                            <span>{selectedPackFullAction?.availableQuantity || 0} owned</span>
                          </div>
                          <p>
                            {selectedPackFullAction?.isLocked
                              ? "This full pack is currently locked by admin."
                              : selectedPackFullAction?.requiredItemName || "No full key assigned."}
                          </p>
                        </div>
                        <div
                          className={`container-opener-choice-option-card ${
                            selectedPackDraftAction?.isLocked ||
                            (selectedPackDraftAction?.availableQuantity || 0) <= 0
                              ? "is-disabled"
                              : ""
                          }`}
                        >
                          <div className="container-opener-choice-option-head">
                            <strong>Open Draft</strong>
                            <span>{selectedPackDraftAction?.availableQuantity || 0} owned</span>
                          </div>
                          <p>
                            {selectedPackDraftAction?.isLocked
                              ? "This draft pack is currently locked by admin."
                              : selectedPackDraftAction?.requiredItemName || "No draft key assigned."}
                          </p>
                        </div>
                      </>
                    ) : (
                      <div
                        className={`container-opener-choice-option-card ${
                          selectedBoxAction?.isLocked ||
                          (selectedBoxAction?.availableQuantity || 0) <= 0
                            ? "is-disabled"
                            : ""
                        }`}
                      >
                        <div className="container-opener-choice-option-head">
                          <strong>Open Box</strong>
                          <span>{selectedBoxAction?.availableQuantity || 0} owned</span>
                        </div>
                        <p>
                          {selectedBoxAction?.isLocked
                            ? "This box is currently locked by admin."
                            : selectedBoxAction?.requiredItemName || "No box key assigned."}
                        </p>
                      </div>
                    )}
                  </div>

                  {showBuyOptions && selectedBuyOptions.length ? (
                    <div className="container-opener-buy-block">
                      <div className="container-opener-buy-header">
                        <strong>Buy Keys Here</strong>
                        <span>{buyCount} selected</span>
                      </div>

                      <p className="container-opener-buy-copy">
                        Buy the exact key for this {selectedPurchaseLabel} without leaving the
                        opener page. Prices stay synced to whatever the admin has set.
                      </p>

                      <div className="container-opener-buy-actions-row">
                        <input
                          type="number"
                          min="1"
                          max={selectedPurchaseCap}
                          className="container-opener-buy-input"
                          value={buyCount}
                          onChange={(event) =>
                            setBuyCount(
                              Math.max(
                                1,
                                Math.min(
                                  selectedPurchaseCap,
                                  Number(event.target.value || 1)
                                )
                              )
                            )
                          }
                        />
                        <span>Quantity</span>
                      </div>

                      <div className="container-opener-buy-option-grid">
                        {selectedBuyOptions.map((option) => (
                          <div
                            key={option.mode}
                            className={`container-opener-buy-option-card ${
                              option.canPurchase ? "" : "is-disabled"
                            }`}
                          >
                            <div className="container-opener-buy-option-head">
                              <strong>
                                {option.mode === "full"
                                  ? "Full Pack Key"
                                  : option.mode === "draft"
                                  ? "Draft Pack Key"
                                  : "Box Key"}
                              </strong>
                              <span>{option.storePrice} Shards each</span>
                            </div>

                            <p className="container-opener-buy-copy">{option.requiredItemName}</p>

                            <button
                              type="button"
                              className="container-opener-primary-btn"
                              onClick={() =>
                                handlePurchaseOpener(
                                  option.openerDefinition?.id,
                                  buyCount,
                                  option.openerDefinition?.name || option.requiredItemName
                                )
                              }
                              disabled={
                                !option.canPurchase ||
                                option.isLocked ||
                                !option.openerDefinition?.id ||
                                purchaseBusyId === option.openerDefinition?.id
                              }
                            >
                              {purchaseBusyId === option.openerDefinition?.id
                                ? "Buying..."
                                : "Buy Key"}
                            </button>

                            {!option.canPurchase ? (
                              <div className="container-opener-buy-note">
                                {option.isLocked
                                  ? "This container is locked by admin right now."
                                  : option.openerDefinition?.is_store_purchase_locked
                                  ? "This key is purchase locked in the store editor."
                                  : option.openerDefinition?.is_randomly_available === false
                                  ? "This key is not currently available for purchase."
                                  : option.storePrice > shards
                                  ? "You do not have enough Shards for this key."
                                  : "This key cannot be purchased right now."}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="container-opener-choice-actions">
                {selectedItem.type === "pack" ? (
                  <>
                    <button
                      type="button"
                      className="container-opener-primary-btn"
                      onClick={() => handleOpenAction(selectedPackFullAction)}
                      disabled={
                        opening ||
                        selectedPackFullAction?.isLocked ||
                        (selectedPackFullAction?.availableQuantity || 0) <= 0 ||
                        openCount > (selectedPackFullAction?.availableQuantity || 0)
                      }
                    >
                      {opening ? "Opening..." : "Open Full"}
                    </button>
                    <button
                      type="button"
                      className="container-opener-primary-btn"
                      onClick={() => handleOpenAction(selectedPackDraftAction)}
                      disabled={
                        opening ||
                        selectedPackDraftAction?.isLocked ||
                        (selectedPackDraftAction?.availableQuantity || 0) <= 0 ||
                        openCount > (selectedPackDraftAction?.availableQuantity || 0)
                      }
                    >
                      {opening ? "Opening..." : "Open Draft"}
                    </button>
                    <button
                      type="button"
                      className="container-opener-secondary-btn"
                      onClick={() => setShowBuyOptions(true)}
                      disabled={!selectedBuyOptions.some((option) => option?.openerDefinition?.id)}
                    >
                      Buy Key
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="container-opener-primary-btn"
                      onClick={() => handleOpenAction(selectedBoxAction)}
                      disabled={
                        opening ||
                        selectedBoxAction?.isLocked ||
                        (selectedBoxAction?.availableQuantity || 0) <= 0 ||
                        openCount > (selectedBoxAction?.availableQuantity || 0)
                      }
                    >
                      {opening ? "Opening..." : "Open Box"}
                    </button>
                    <button
                      type="button"
                      className="container-opener-secondary-btn"
                      onClick={() => setShowBuyOptions(true)}
                      disabled={!selectedBuyOptions.some((option) => option?.openerDefinition?.id)}
                    >
                      Buy Key
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="container-opener-secondary-btn"
                  onClick={closeSelectionModal}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {randomKeyModalOpen ? (
          <div className="container-opener-modal-backdrop" onClick={closeRandomKeyModal}>
            <div
              className="container-opener-modal container-opener-random-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="container-opener-modal-kicker">RANDOM KEYS</div>
              <h2 className="container-opener-modal-title">Buy A Random Key</h2>

              <p className="container-opener-choice-copy">
                Pick the random key type you want. Prices here stay synced to the store editor.
              </p>

              <div className="container-opener-random-grid">
                {randomKeyOptions.map((product) => {
                  const maxPurchase = Number(product.max_purchase || 99) || 99;
                  const maxAffordable =
                    Number(product.store_price || 0) > 0
                      ? Math.max(0, Math.floor(shards / Number(product.store_price || 0)))
                      : maxPurchase;
                  const canBuyNow = product.canBuy && maxAffordable >= 1;
                  const purchaseCap = Math.max(
                    1,
                    Math.min(maxPurchase, Math.max(maxAffordable, 1))
                  );
                  const selectedCount = Math.max(
                    1,
                    Math.min(purchaseCap, Number(randomBuyCounts[product.id] || 1))
                  );

                  return (
                    <div
                      key={product.id}
                      className={`container-opener-random-card ${canBuyNow ? "" : "is-disabled"}`}
                    >
                      <div className="container-opener-random-card-head">
                        <strong>{product.name}</strong>
                        <span>{Number(product.store_price || 0)} Shards</span>
                      </div>

                      <p className="container-opener-random-card-copy">{product.description}</p>

                      <div className="container-opener-random-card-meta">
                        <span>{product.eligibleCount} unlocked options</span>
                      </div>

                      <div className="container-opener-buy-actions-row">
                        <input
                          type="number"
                          min="1"
                          max={purchaseCap}
                          className="container-opener-buy-input"
                          value={selectedCount}
                          onChange={(event) =>
                            setRandomBuyCounts((current) => ({
                              ...current,
                              [product.id]: Math.max(
                                1,
                                Math.min(purchaseCap, Number(event.target.value || 1))
                              ),
                            }))
                          }
                          disabled={!canBuyNow}
                        />

                        <button
                          type="button"
                          className="container-opener-primary-btn"
                          onClick={() =>
                            handlePurchaseOpener(product.id, selectedCount, product.name)
                          }
                          disabled={!canBuyNow || purchaseBusyId === product.id}
                        >
                          {purchaseBusyId === product.id ? "Buying..." : "Buy Random"}
                        </button>
                      </div>

                      {!canBuyNow ? (
                        <div className="container-opener-buy-note">
                          {product.is_store_purchase_locked
                            ? "This random key product is purchase locked."
                            : product.is_randomly_available === false
                            ? "This random key product is not currently available."
                            : product.eligibleCount <= 0
                            ? "No unlocked containers match this random key yet."
                            : maxAffordable < 1
                            ? "You do not have enough Shards for this random key."
                            : "This random key product cannot be purchased right now."}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="container-opener-choice-actions">
                <button
                  type="button"
                  className="container-opener-secondary-btn"
                  onClick={closeRandomKeyModal}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {sessionState && currentOpening ? (
          <div className="container-opener-modal-backdrop">
            {isBoxSession && boxResultVisible ? (
              <div className="container-opener-modal container-opener-box-hit-modal">
                <div className="container-opener-modal-kicker">
                  {sessionState.actionLabel || "BOX OPENING"} {sessionState.activeIndex + 1} /{" "}
                  {sessionState.openings.length}
                </div>
                <h2 className="container-opener-modal-title">{currentOpening.container_name}</h2>

                {boxWinningCard ? (
                  <div className="container-opener-box-hit-layout">
                    <div
                      className={`container-opener-box-hit-card-shell ${getTierClass(
                        boxWinningCard.tier_code
                      )} ${getRarityClass(boxWinningCard.rarity_code)}`}
                      onMouseEnter={(event) =>
                        handleShowRewardHover(boxWinningCard, event.currentTarget, [
                          `Tier: ${boxWinningCard.tier_name || "Unknown"}`,
                          `Rarity: ${boxWinningCard.rarity_name || "Base"}`,
                        ])
                      }
                      onMouseLeave={handleHideRewardHover}
                    >
                      {boxWinningCard.image_url ? (
                        <img
                          src={boxWinningCard.image_url}
                          alt={boxWinningCard.card_name}
                          className="container-opener-box-hit-card-image"
                        />
                      ) : (
                        <div className="container-opener-reveal-card-back">
                          <span>No Art</span>
                        </div>
                      )}
                    </div>

                    <div
                      className={`container-opener-box-result-banner ${getTierClass(
                        boxWinningCard.tier_code
                      )} ${getRarityClass(boxWinningCard.rarity_code)}`}
                    >
                      <div className="container-opener-box-result-flash" />
                      <span className="container-opener-box-result-kicker">Box Hit</span>
                      <strong>{boxWinningCard.card_name}</strong>
                      <div className="container-opener-box-result-rarity">
                        {boxWinningCard.rarity_name}
                      </div>
                      <em>{boxWinningCard.tier_name}</em>
                    </div>
                  </div>
                ) : null}

                <div className="container-opener-choice-actions">
                  <button
                    type="button"
                    className="container-opener-primary-btn"
                    onClick={handleAdvanceSession}
                    disabled={revealPhase !== "revealed"}
                  >
                    {(sessionState.activeIndex || 0) < sessionState.openings.length - 1
                      ? "Next Box"
                      : "Back to Selection"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="container-opener-modal container-opener-session-modal">
                <div className="container-opener-modal-kicker">
                  {sessionState.actionLabel || (sessionState.bucket === "packs" ? "PACK OPENING" : "BOX OPENING")}{" "}
                  {sessionState.activeIndex + 1} / {sessionState.openings.length}
                </div>
                <h2 className="container-opener-modal-title">{currentOpening.container_name}</h2>

                {isBoxSession ? (
                  <div className={`container-opener-box-reel-shell phase-${revealPhase}`}>
                    <div className="container-opener-box-reel-header">
                      <span>Key Reel</span>
                      <strong>
                        {revealPhase === "revealed"
                          ? boxWinningCard?.tier_name || "Box Pull"
                          : "Spinning..."}
                      </strong>
                    </div>

                    <div className="container-opener-box-reel-window" ref={boxReelWindowRef}>
                      <div className="container-opener-box-reel-center-line" />
                      <div
                        ref={boxSpinnerRef}
                        className={`container-opener-box-spinner ${boxReelMotionClass}`}
                      >
                        {boxReelData.cards.map((card, index) => (
                          <div
                            key={card.reelKey || `${card.card_name}-${index}`}
                            className={`container-opener-box-reel-card ${getTierClass(
                              card.tier_code
                            )} ${card.isWinner ? "is-winner" : ""}`}
                          >
                            {card.image_url ? (
                              <img
                                src={card.image_url}
                                alt={card.card_name}
                                className="container-opener-box-reel-image"
                              />
                            ) : (
                              <div className="container-opener-box-reel-card-back">
                                <span>{card.tier_name}</span>
                              </div>
                            )}

                            <div className="container-opener-box-reel-overlay">
                              <strong>{card.card_name}</strong>
                              <span>{card.tier_name}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={`container-opener-pack-cinematic phase-${revealPhase}`}>
                    <div className="container-opener-pack-energy" />
                    <div className="container-opener-pack-burst-ring" />
                    <div className="container-opener-pack-sparks" />
                    <div className="container-opener-cinematic-art-shell">
                      {currentOpening.container_image_url ? (
                        <img
                          src={currentOpening.container_image_url}
                          alt={currentOpening.container_name}
                          className="container-opener-cinematic-art"
                        />
                      ) : (
                        <div className="container-opener-cinematic-art-placeholder">
                          No art uploaded for this container yet.
                        </div>
                      )}
                      <div className="container-opener-cinematic-tear-line" />
                      <div className="container-opener-cinematic-label">
                        <span>{sessionState.actionKeyName || "Key Open"}</span>
                        <strong>{currentOpening.container_name}</strong>
                      </div>
                    </div>
                  </div>
                )}

                {!isBoxSession ? (
                  <>
                    <div className="container-opener-session-results">
                      <div className="container-opener-session-results-header">
                        <h3>Card Reveals</h3>
                        <span>
                          {isDraftSession && revealPhase === "revealed"
                            ? selectedDraftCard
                              ? `Selected: ${selectedDraftCard.card_name}`
                              : "Choose 1 card to keep"
                            : revealPhase === "revealed"
                            ? `${displayRevealCards.filter((card) => card.isRevealed).length} revealed`
                            : `${revealCount} revealed`}
                        </span>
                      </div>

                      <div className="container-opener-reveal-grid">
                        {displayRevealCards.map((card, index) => {
                          const isDraftSelectable =
                            isDraftSession &&
                            revealPhase === "revealed" &&
                            card.isRevealed &&
                            !card.isPlaceholder;
                          const isDraftSelected =
                            isDraftSelectable &&
                            String(card.card_id || "") === String(selectedDraftCardId || "");

                          return (
                            <div
                              key={card.revealKey || `${card.card_name}-${index}`}
                              className={`container-opener-reveal-card ${
                                card.isPlaceholder ? "is-placeholder" : ""
                              } ${card.isRevealed ? "is-revealed" : "is-hidden"} ${
                                isDraftSelectable ? "is-selectable" : ""
                              } ${isDraftSelected ? "is-selected" : ""} ${getRarityClass(
                                card.rarity_code
                              )} ${getTierClass(card.tier_code)}`}
                              style={{ "--reveal-index": index }}
                              role={isDraftSelectable ? "button" : undefined}
                              tabIndex={isDraftSelectable ? 0 : undefined}
                              aria-pressed={isDraftSelectable ? isDraftSelected : undefined}
                              onMouseEnter={
                                card.isRevealed
                                  ? (event) =>
                                      handleShowRewardHover(card, event.currentTarget, [
                                        `Tier: ${card.tier_name || "Unknown"}`,
                                        `Rarity: ${card.rarity_name || "Base"}`,
                                      ])
                                  : undefined
                              }
                              onMouseLeave={card.isRevealed ? handleHideRewardHover : undefined}
                              onClick={
                                isDraftSelectable
                                  ? () => setSelectedDraftCardId(String(card.card_id))
                                  : undefined
                              }
                              onKeyDown={
                                isDraftSelectable
                                  ? (event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        setSelectedDraftCardId(String(card.card_id));
                                      }
                                    }
                                  : undefined
                              }
                            >
                              <div className="container-opener-reveal-image-shell">
                                {card.isRevealed && card.image_url ? (
                                  <img
                                    src={card.image_url}
                                    alt={card.card_name}
                                    className="container-opener-reveal-image"
                                  />
                                ) : (
                                  <div className="container-opener-reveal-card-back">
                                    <span>{card.isRevealed ? "No Art" : "Hidden"}</span>
                                  </div>
                                )}
                              </div>

                              <div className="container-opener-reveal-meta">
                                <strong>{card.isRevealed ? card.card_name : "Hidden Card"}</strong>
                                <span>
                                  {card.isRevealed
                                    ? `${card.tier_name} | ${card.rarity_name}`
                                    : "Awaiting reveal"}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="container-opener-choice-actions">
                      {isDraftSession ? (
                        <>
                          <div className="container-opener-draft-pick-copy">
                            {selectedDraftCard
                              ? `Selected Pick: ${selectedDraftCard.card_name} (${selectedDraftCard.tier_name} | ${selectedDraftCard.rarity_name})`
                              : "Choose 1 revealed card from this draft pack to add to your binder."}
                          </div>
                          <button
                            type="button"
                            className="container-opener-primary-btn"
                            onClick={handleConfirmDraftPick}
                            disabled={
                              revealPhase !== "revealed" ||
                              !selectedDraftCardId ||
                              claimingDraftPick
                            }
                          >
                            {claimingDraftPick
                              ? "Claiming..."
                              : (sessionState.activeIndex || 0) < sessionState.openings.length - 1
                              ? "Confirm Pick & Next Pack"
                              : "Confirm Pick"}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="container-opener-primary-btn"
                          onClick={handleAdvanceSession}
                          disabled={revealPhase !== "revealed"}
                        >
                          {(sessionState.activeIndex || 0) < sessionState.openings.length - 1
                            ? `Next ${sessionState.bucket === "packs" ? "Pack" : "Box"}`
                            : "Back to Selection"}
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="container-opener-box-reel-note">
                    {revealPhase === "revealed"
                      ? "Locked in. Revealing your box hit..."
                      : "The result is already decided. This reel is just the dramatic part."}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}

        <BinderHoverTooltip
          preview={hoverPreview}
          buildCardImageUrl={buildCardImageUrl}
          CARD_IMAGE_FALLBACK={CARD_IMAGE_FALLBACK}
        />
      </div>
    </LauncherLayout>
  );
}

export default ContainerOpenerPage;
