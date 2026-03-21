import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../../components/LauncherLayout";
import { useUser } from "../../../context/UserContext";
import { supabase } from "../../../lib/supabase";
import "../ContainerMaker/ContainerMakerPage.css";
import "../PackMaker/PackMakerPage.css";
import "./BoxMakerPage.css";

const CONTENT_MODE_OPTIONS = [
  { value: "official", label: "Official" },
  { value: "curated", label: "Curated" },
];

const BOX_CATEGORY_OPTIONS = [
  { value: "deck_box", label: "Deck Box", groupLabel: "Deck Boxes", keyPrefix: "DCK" },
  { value: "promo_box", label: "Promo Box", groupLabel: "Promo Boxes", keyPrefix: "PRO" },
  {
    value: "collectors_box",
    label: "Collectors Box",
    groupLabel: "Collectors Boxes",
    keyPrefix: "COL",
  },
];
const BOX_CATEGORY_CONFIGS = Object.fromEntries(
  BOX_CATEGORY_OPTIONS.map((option) => [option.value, option])
);

const CONTAINER_IMAGE_BUCKET = "container-images";
const BOX_NUMBER_RE = /^(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2})$/;
const DECK_BOX_ALLOWED_TIER_SORT_ORDERS = [1, 3, 5, 7, 9];
const DECK_BOX_ALLOWED_TIER_SORT_ORDER_SET = new Set(DECK_BOX_ALLOWED_TIER_SORT_ORDERS);
const DECK_BOX_TIER_BASE_WEIGHTS = {
  1: 30,
  3: 25,
  5: 20,
  7: 15,
  9: 10,
};

function buildContainerCode(name) {
  return String(name || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function buildDuplicateName(name) {
  const base = String(name || "").trim();
  if (!base) return "New Box Copy";
  if (base.toLowerCase().endsWith(" copy")) return `${base} 2`;
  return `${base} Copy`;
}

function buildDuplicateCode(code) {
  const base = String(code || "").trim();
  if (!base) return "NEW_BOX_COPY";
  if (base.endsWith("_COPY")) return `${base}_2`;
  return `${base}_COPY`;
}

function parseMassCardNames(rawText) {
  return String(rawText || "")
    .split(/\r?\n|,|;/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeContentMode(mode) {
  return String(mode || "").trim().toLowerCase() === "official" ? "official" : "curated";
}

function normalizeBoxNumberCode(value) {
  return String(value || "")
    .replace(/\D/g, "")
    .slice(0, 3);
}

function isValidBoxNumberCode(value) {
  return BOX_NUMBER_RE.test(String(value || "").trim());
}

function normalizeBoxCategoryCode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(BOX_CATEGORY_CONFIGS, normalized)) {
    return normalized;
  }
  return "deck_box";
}

function getBoxCategoryConfig(boxCategoryCode) {
  return BOX_CATEGORY_CONFIGS[normalizeBoxCategoryCode(boxCategoryCode)] || BOX_CATEGORY_CONFIGS.deck_box;
}

function buildBoxKeyLabel(boxCategoryCode, boxNumberCode) {
  const category = getBoxCategoryConfig(boxCategoryCode);
  const number = String(boxNumberCode || "").trim();
  return number ? `${category.keyPrefix}-${number}` : `${category.keyPrefix}-???`;
}

function getBoxNumberSortValue(value) {
  const normalized = String(value || "").trim();
  if (BOX_NUMBER_RE.test(normalized)) return Number(normalized);
  return Number.MAX_SAFE_INTEGER;
}

function getBoxLibraryGroupLabel(boxCategoryCode) {
  return getBoxCategoryConfig(boxCategoryCode).groupLabel;
}

function getBoxLibraryGroupSortValue(groupLabel) {
  const index = BOX_CATEGORY_OPTIONS.findIndex((option) => option.groupLabel === groupLabel);
  return index >= 0 ? index : BOX_CATEGORY_OPTIONS.length + 10;
}

function isDeckBoxCategory(boxCategoryCode) {
  return normalizeBoxCategoryCode(boxCategoryCode) === "deck_box";
}

function isCollectorsBoxCategory(boxCategoryCode) {
  return normalizeBoxCategoryCode(boxCategoryCode) === "collectors_box";
}

function usesSharedFiveTierBoxCategory(boxCategoryCode) {
  return isDeckBoxCategory(boxCategoryCode) || isCollectorsBoxCategory(boxCategoryCode);
}

function getVisibleBoxTiers(cardTiers, boxCategoryCode) {
  const tiers = Array.isArray(cardTiers) ? cardTiers : [];
  if (usesSharedFiveTierBoxCategory(boxCategoryCode)) {
    return tiers.filter((tier) =>
      DECK_BOX_ALLOWED_TIER_SORT_ORDER_SET.has(Number(tier?.sort_order ?? Number.MAX_SAFE_INTEGER))
    );
  }
  return tiers;
}

function formatTierWeightPercent(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return "0%";
  const rounded = Number(numericValue.toFixed(2));
  return `${rounded.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}%`;
}

function getDeckBoxBaseTierWeight(tier) {
  return DECK_BOX_TIER_BASE_WEIGHTS[Number(tier?.sort_order || 0)] || 0;
}

function getBaseTierWeightForBoxCategory(tier, boxCategoryCode) {
  if (usesSharedFiveTierBoxCategory(boxCategoryCode)) {
    return getDeckBoxBaseTierWeight(tier);
  }
  return Math.max(0, Number(tier?.weight_percent || 0));
}

function buildEffectiveTierWeightMap(visibleCardTiers, boxCards, boxCategoryCode) {
  const activeTierIds = new Set(
    (Array.isArray(boxCards) ? boxCards : [])
      .filter((row) => row?.tier_id && row?.is_enabled !== false)
      .map((row) => row.tier_id)
  );

  const weights = new Map();
  let totalWeight = 0;

  (Array.isArray(visibleCardTiers) ? visibleCardTiers : []).forEach((tier) => {
    if (!activeTierIds.has(tier.id)) return;
    const weight = getBaseTierWeightForBoxCategory(tier, boxCategoryCode);
    if (!Number.isFinite(weight) || weight <= 0) return;
    weights.set(tier.id, weight);
    totalWeight += weight;
  });

  return new Map(
    (Array.isArray(visibleCardTiers) ? visibleCardTiers : []).map((tier) => [
      tier.id,
      totalWeight > 0 && weights.has(tier.id) ? (weights.get(tier.id) / totalWeight) * 100 : 0,
    ])
  );
}

function getDeckBoxRemappedTierId(tierId, cardTiers) {
  const tiers = Array.isArray(cardTiers) ? cardTiers : [];
  const currentTier = tiers.find((tier) => tier.id === tierId);
  const currentSortOrder = Number(currentTier?.sort_order ?? 0);

  if (!currentTier || DECK_BOX_ALLOWED_TIER_SORT_ORDER_SET.has(currentSortOrder)) {
    return tierId;
  }

  const targetSortOrder =
    [...DECK_BOX_ALLOWED_TIER_SORT_ORDERS]
      .reverse()
      .find((sortOrder) => sortOrder <= currentSortOrder) ?? DECK_BOX_ALLOWED_TIER_SORT_ORDERS[0];

  return tiers.find((tier) => Number(tier?.sort_order ?? 0) === targetSortOrder)?.id || tierId;
}

function buildCardImageUrl(card) {
  if (card?.image_url) return card.image_url;
  if (card?.card_image_url) return card.card_image_url;

  const cardId = Number(card?.card_id ?? card?.id);
  if (!Number.isFinite(cardId) || cardId <= 0) return "";

  return `https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/${cardId}.jpg`;
}

function buildBoxCardPreviewKey(row) {
  return `${row?.id || "box-card"}:${row?.card_id || ""}:${row?.tier_id || ""}`;
}

function normalizeCardsPerOpenValue(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 3);
}

function BoxMakerPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [massImportBusy, setMassImportBusy] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [boxProducts, setBoxProducts] = useState([]);
  const [cardTiers, setCardTiers] = useState([]);

  const [selectedBoxId, setSelectedBoxId] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [boxNumberCode, setBoxNumberCode] = useState("");
  const [boxCategoryCode, setBoxCategoryCode] = useState("deck_box");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [contentMode, setContentMode] = useState("curated");
  const [cardsPerOpen, setCardsPerOpen] = useState("1");
  const [isEnabled, setIsEnabled] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [boxCards, setBoxCards] = useState([]);

  const [cardSearch, setCardSearch] = useState("");
  const [cardSearchResults, setCardSearchResults] = useState([]);
  const [selectedTierId, setSelectedTierId] = useState("");
  const [massCardNames, setMassCardNames] = useState("");
  const [boxPickerOpen, setBoxPickerOpen] = useState(false);
  const [boxPickerSearch, setBoxPickerSearch] = useState("");
  const [previewState, setPreviewState] = useState(null);
  const [collapsedTierSections, setCollapsedTierSections] = useState({});

  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const canUsePage = user?.role === "Admin+" || user?.role === "Admin";

  const tierMap = useMemo(() => {
    const map = new Map();
    (cardTiers || []).forEach((tier) => {
      map.set(tier.id, tier);
    });
    return map;
  }, [cardTiers]);

  const selectedCategoryLabel = useMemo(
    () => getBoxCategoryConfig(boxCategoryCode).label,
    [boxCategoryCode]
  );

  const generatedBoxDisplayLabel = useMemo(
    () => (boxNumberCode ? `${selectedCategoryLabel} ${boxNumberCode}` : `${selectedCategoryLabel} pending`),
    [boxNumberCode, selectedCategoryLabel]
  );

  const generatedBoxKeyLabel = useMemo(
    () => buildBoxKeyLabel(boxCategoryCode, boxNumberCode),
    [boxCategoryCode, boxNumberCode]
  );

  const visibleCardTiers = useMemo(
    () => getVisibleBoxTiers(cardTiers, boxCategoryCode),
    [boxCategoryCode, cardTiers]
  );

  const visibleTierIds = useMemo(
    () => new Set(visibleCardTiers.map((tier) => tier.id)),
    [visibleCardTiers]
  );

  const isFiveTierBox = useMemo(
    () => usesSharedFiveTierBoxCategory(boxCategoryCode),
    [boxCategoryCode]
  );

  const effectiveTierWeightMap = useMemo(
    () => buildEffectiveTierWeightMap(visibleCardTiers, boxCards, boxCategoryCode),
    [boxCards, boxCategoryCode, visibleCardTiers]
  );

  const invalidTierCards = useMemo(
    () =>
      isFiveTierBox
        ? boxCards.filter((row) => row?.tier_id && !visibleTierIds.has(row.tier_id))
        : [],
    [boxCards, isFiveTierBox, visibleTierIds]
  );

  const groupedBoxCards = useMemo(
    () =>
      visibleCardTiers.map((tier) => ({
        tier,
        effectiveWeightPercent: effectiveTierWeightMap.get(tier.id) || 0,
        rows: boxCards
          .filter((row) => row.tier_id === tier.id)
          .sort((left, right) =>
            String(left.card_name || "").localeCompare(String(right.card_name || ""))
          ),
      })),
    [boxCards, effectiveTierWeightMap, visibleCardTiers]
  );

  const boxTierSummaries = useMemo(
    () =>
      visibleCardTiers.map((tier) => ({
        tier,
        count: boxCards.filter((row) => row.tier_id === tier.id).length,
        effectiveWeightPercent: effectiveTierWeightMap.get(tier.id) || 0,
      })),
    [boxCards, effectiveTierWeightMap, visibleCardTiers]
  );

  const groupedBoxProducts = useMemo(() => {
    const query = String(boxPickerSearch || "").trim().toLowerCase();
    const groupMap = new Map();

    (boxProducts || []).forEach((product) => {
      const groupLabel = getBoxLibraryGroupLabel(product?.box_category_code);
      const matchesQuery =
        !query ||
        [
          product?.name,
          product?.code,
          product?.description,
          product?.box_number_code,
          buildBoxKeyLabel(product?.box_category_code, product?.box_number_code),
          groupLabel,
        ].some((value) => String(value || "").toLowerCase().includes(query));

      if (!matchesQuery) return;

      if (!groupMap.has(groupLabel)) {
        groupMap.set(groupLabel, []);
      }

      groupMap.get(groupLabel).push(product);
    });

    return Array.from(groupMap.entries())
      .sort(([left], [right]) => {
        const sortDiff = getBoxLibraryGroupSortValue(left) - getBoxLibraryGroupSortValue(right);
        if (sortDiff !== 0) return sortDiff;
        return left.localeCompare(right);
      })
      .map(([groupLabel, products]) => ({
        groupLabel,
        products: [...products].sort((left, right) => {
          const boxNumberDiff =
            getBoxNumberSortValue(left?.box_number_code) -
            getBoxNumberSortValue(right?.box_number_code);
          if (boxNumberDiff !== 0) return boxNumberDiff;

          const nameDiff = String(left?.name || "").localeCompare(String(right?.name || ""));
          if (nameDiff !== 0) return nameDiff;
          return String(left?.code || "").localeCompare(String(right?.code || ""));
        }),
      }));
  }, [boxPickerSearch, boxProducts]);

  const previewCard = useMemo(() => {
    if (!previewState) return null;

    if (previewState.source === "box") {
      return boxCards.find((row) => buildBoxCardPreviewKey(row) === previewState.key) || null;
    }

    if (previewState.source === "search") {
      return (
        cardSearchResults.find((card) => String(card.id) === String(previewState.key)) ||
        previewState.card ||
        null
      );
    }

    return previewState.card || null;
  }, [boxCards, cardSearchResults, previewState]);

  const previewCardTierName = useMemo(() => previewCard?.tier_name || "", [previewCard]);

  const boxNumberIsValid = useMemo(() => isValidBoxNumberCode(boxNumberCode), [boxNumberCode]);

  const normalizedCardsPerOpen = useMemo(
    () => Math.max(1, Number(cardsPerOpen || 1)),
    [cardsPerOpen]
  );

  const canSaveBox =
    !saving &&
    Boolean(name) &&
    Boolean(code) &&
    boxNumberIsValid &&
    normalizedCardsPerOpen > 0 &&
    Boolean(boxCategoryCode) &&
    invalidTierCards.length === 0;

  useEffect(() => {
    if (!authLoading && user) {
      loadPage();
    }
  }, [authLoading, user]);

  useEffect(() => {
    setCollapsedTierSections((prev) => {
      const next = {};
      (cardTiers || []).forEach((tier) => {
        next[tier.id] = prev[tier.id] ?? false;
      });
      return next;
    });
  }, [cardTiers]);

  useEffect(() => {
    if (!visibleCardTiers.length) {
      if (selectedTierId) {
        setSelectedTierId("");
      }
      return;
    }

    if (!visibleCardTiers.some((tier) => tier.id === selectedTierId)) {
      setSelectedTierId(visibleCardTiers[0].id);
    }
  }, [selectedTierId, visibleCardTiers]);

  useEffect(() => {
    let cancelled = false;

    async function runCardSearch() {
      const query = cardSearch.trim();
      if (query.length < 2) {
        setCardSearchResults([]);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("cards")
          .select("id, name, image_url")
          .ilike("name", `%${query}%`)
          .order("name", { ascending: true })
          .limit(20);

        if (error) throw error;
        if (!cancelled) {
          setCardSearchResults(data || []);
        }
      } catch (error) {
        console.error("Failed to search box cards:", error);
        if (!cancelled) {
          setCardSearchResults([]);
        }
      }
    }

    runCardSearch();

    return () => {
      cancelled = true;
    };
  }, [cardSearch]);

  useEffect(() => {
    if (previewState?.source === "search") return;

    if (!boxCards.length) {
      if (previewState) {
        setPreviewState(null);
      }
      return;
    }

    if (
      previewState?.source === "box" &&
      boxCards.some((row) => buildBoxCardPreviewKey(row) === previewState.key)
    ) {
      return;
    }

    setPreviewState({
      source: "box",
      key: buildBoxCardPreviewKey(boxCards[0]),
    });
  }, [boxCards, previewState]);

  async function handleImageUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploadingImage(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const extension = file.name.includes(".")
        ? file.name.split(".").pop().toLowerCase()
        : "png";
      const baseCode = buildContainerCode(code || name || "box") || "BOX";
      const filePath = `${baseCode.toLowerCase()}-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(CONTAINER_IMAGE_BUCKET)
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type || undefined,
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from(CONTAINER_IMAGE_BUCKET)
        .getPublicUrl(filePath);

      if (!publicUrlData?.publicUrl) {
        throw new Error("Failed to generate a public image URL.");
      }

      setImageUrl(publicUrlData.publicUrl);
      setStatusMessage("Box image uploaded.");
    } catch (error) {
      console.error("Failed to upload box image:", error);
      setErrorMessage(error.message || "Failed to upload the image.");
    } finally {
      setUploadingImage(false);
    }
  }

  async function loadPage(nextSelection = selectedBoxId) {
    setLoading(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const [
        { data: productRows, error: productsError },
        { data: tierRows, error: tiersError },
      ] = await Promise.all([
        supabase.rpc("get_box_products_admin"),
        supabase
          .from("card_tiers")
          .select("id, code, name, sort_order, weight_percent")
          .order("sort_order", { ascending: true }),
      ]);

      if (productsError) throw productsError;
      if (tiersError) throw tiersError;

      const nextProducts = productRows || [];
      const nextTiers = tierRows || [];

      setBoxProducts(nextProducts);
      setCardTiers(nextTiers);
      if (!selectedTierId && nextTiers.length) {
        setSelectedTierId(nextTiers[0].id);
      }

      const nextBoxId =
        nextProducts.find((row) => row.container_id === nextSelection)?.container_id ||
        nextProducts[0]?.container_id ||
        "";

      if (nextBoxId) {
        await loadBoxProduct(nextBoxId, nextTiers);
      } else {
        resetEditor(nextTiers);
      }
    } catch (error) {
      console.error("Failed to load box maker:", error);
      setErrorMessage(error.message || "Failed to load box maker.");
      setBoxProducts([]);
      setCardTiers([]);
    } finally {
      setLoading(false);
    }
  }

  function resetEditor(tiers = cardTiers) {
    setSelectedBoxId("");
    setName("");
    setCode("");
    setBoxNumberCode("");
    setBoxCategoryCode("deck_box");
    setDescription("");
    setImageUrl("");
    setContentMode("curated");
    setCardsPerOpen("1");
    setIsEnabled(true);
    setIsLocked(false);
    setBoxCards([]);
    setCardSearch("");
    setCardSearchResults([]);
    setMassCardNames("");
    setBoxPickerSearch("");
    setPreviewState(null);
    setSelectedTierId(tiers?.[0]?.id || "");
  }

  async function loadBoxProduct(containerId, tiers = cardTiers) {
    setSelectedBoxId(containerId);
    setStatusMessage("");
    setErrorMessage("");

    const { data, error } = await supabase.rpc("get_box_product_admin", {
      p_container_id: containerId,
    });

    if (error) throw error;

    setName(data?.name || "");
    setCode(data?.code || "");
    setBoxNumberCode(data?.box_number_code || "");
    setBoxCategoryCode(data?.box_category_code || "deck_box");
    setDescription(data?.description || "");
    setImageUrl(data?.image_url || "");
    setContentMode(normalizeContentMode(data?.content_mode || "curated"));
    setCardsPerOpen(String(Math.max(1, Number(data?.cards_per_open || 1))));
    setIsEnabled(Boolean(data?.is_enabled ?? true));
    setIsLocked(Boolean(data?.is_locked ?? false));

    const nextBoxCards = (data?.cards || []).map((row, index) => ({
      ...row,
      id: row.id || `existing-box-card-${index}`,
      card_id: Number(row.card_id),
      image_url: row.card_image_url || row.image_url || "",
      weight: Math.max(1, Number(row.weight ?? 1)),
    }));

    setBoxCards(nextBoxCards);
    setSelectedTierId(tiers?.[0]?.id || "");
    setMassCardNames("");
    setPreviewState(
      nextBoxCards.length
        ? { source: "box", key: buildBoxCardPreviewKey(nextBoxCards[0]) }
        : null
    );
  }

  function handleAddCard(card) {
    if (!selectedTierId) return;
    const tier = tierMap.get(selectedTierId);
    const nextCard = {
      id: `temp-${card.id}-${selectedTierId}-${Date.now()}-${Math.random()}`,
      card_id: Number(card.id),
      card_name: card.name,
      image_url: card.image_url || "",
      tier_id: selectedTierId,
      tier_code: tier?.code || "",
      tier_name: tier?.name || "Tier",
      is_enabled: true,
      weight: 1,
    };

    setBoxCards((prev) => [...prev, nextCard]);
    setPreviewState({ source: "box", key: buildBoxCardPreviewKey(nextCard) });
  }

  async function handleMassAddCards() {
    const names = parseMassCardNames(massCardNames);

    if (!names.length) {
      setErrorMessage("Paste at least one card name.");
      setStatusMessage("");
      return;
    }

    if (!selectedTierId) {
      setErrorMessage("Select a box tier before mass adding cards.");
      setStatusMessage("");
      return;
    }

    setMassImportBusy(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const uniqueNames = [...new Set(names)];
      const { data, error } = await supabase
        .from("cards")
        .select("id, name, image_url")
        .in("name", uniqueNames);

      if (error) throw error;

      const foundCards = data || [];
      const foundNameSet = new Set(foundCards.map((card) => card.name));
      const missingNames = uniqueNames.filter((entry) => !foundNameSet.has(entry));
      const tier = tierMap.get(selectedTierId);

      if (!foundCards.length) {
        throw new Error("No pasted card names matched exact card names in the database.");
      }

      const nextCards = foundCards.map((card, index) => ({
        id: `mass-${card.id}-${selectedTierId}-${Date.now()}-${index}`,
        card_id: Number(card.id),
        card_name: card.name,
        image_url: card.image_url || "",
        tier_id: selectedTierId,
        tier_code: tier?.code || "",
        tier_name: tier?.name || "Tier",
        is_enabled: true,
        weight: 1,
      }));

      setBoxCards((prev) => [...prev, ...nextCards]);
      setPreviewState({ source: "box", key: buildBoxCardPreviewKey(nextCards[0]) });
      setStatusMessage(
        missingNames.length > 0
          ? `Added ${foundCards.length} cards. Not found: ${missingNames.join(", ")}`
          : `Added ${foundCards.length} cards from pasted list.`
      );
    } catch (error) {
      console.error("Failed to mass add box cards:", error);
      setErrorMessage(error.message || "Failed to mass add box cards.");
    } finally {
      setMassImportBusy(false);
    }
  }

  function handleRemoveCard(index) {
    setBoxCards((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  }

  function handleChangeCardTier(index, tierId) {
    const tier = tierMap.get(tierId);
    setBoxCards((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        tier_id: tierId,
        tier_code: tier?.code || "",
        tier_name: tier?.name || "Tier",
      };
      return next;
    });
  }

  function handleChangeCardWeight(index, weight) {
    setBoxCards((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        weight: Math.max(1, Number(weight || 1)),
      };
      return next;
    });
  }

  function handleToggleCardEnabled(index) {
    setBoxCards((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        is_enabled: !next[index].is_enabled,
      };
      return next;
    });
  }

  function handleDuplicateBox() {
    setSelectedBoxId("");
    setName(buildDuplicateName(name));
    setCode(buildDuplicateCode(code));
    setBoxNumberCode("");
    setIsLocked(false);
    setStatusMessage("Box duplicated into a new unsaved copy. Set a new Box Number before saving.");
    setErrorMessage("");
  }

  function handleNewBox() {
    setStatusMessage("");
    setErrorMessage("");
    setBoxPickerOpen(false);
    resetEditor();
  }

  async function handleLoadBoxFromPicker(containerId) {
    setBoxPickerOpen(false);
    setBoxPickerSearch("");
    await loadBoxProduct(containerId);
  }

  function handleBoxNumberInputChange(nextValue) {
    setBoxNumberCode(normalizeBoxNumberCode(nextValue));
    setErrorMessage("");
  }

  function handleBoxCategoryChange(nextValue) {
    const nextCategoryCode = normalizeBoxCategoryCode(nextValue);
    const nextVisibleTiers = getVisibleBoxTiers(cardTiers, nextCategoryCode);
    const nextVisibleTierIds = new Set(nextVisibleTiers.map((tier) => tier.id));

    if (usesSharedFiveTierBoxCategory(nextCategoryCode)) {
      const invalidRows = boxCards.filter((row) => row?.tier_id && !nextVisibleTierIds.has(row.tier_id));
      if (invalidRows.length > 0) {
        const categoryLabel = getBoxCategoryConfig(nextCategoryCode).groupLabel;
        const confirmed = window.confirm(
          `${categoryLabel} only use Bulk, Solid, Elite, HighChase, and Legendary. Remap ${invalidRows.length} assigned card${
            invalidRows.length === 1 ? "" : "s"
          } down into those 5 shared box tiers before switching?`
        );

        if (!confirmed) {
          return;
        }

        setBoxCards((current) =>
          current.map((row) => {
            if (!row?.tier_id || nextVisibleTierIds.has(row.tier_id)) return row;
            const remappedTierId = getDeckBoxRemappedTierId(row.tier_id, cardTiers);
            const tier = tierMap.get(remappedTierId);
            return {
              ...row,
              tier_id: remappedTierId,
              tier_code: tier?.code || "",
              tier_name: tier?.name || "Tier",
            };
          })
        );
        setStatusMessage(
          `Remapped ${invalidRows.length} assigned card${
            invalidRows.length === 1 ? "" : "s"
          } into the ${categoryLabel} 5-tier setup.`
        );
      }
    }

    setBoxCategoryCode(nextCategoryCode);
    if (!nextVisibleTierIds.has(selectedTierId)) {
      setSelectedTierId(nextVisibleTiers[0]?.id || "");
    }
    setErrorMessage("");
  }

  function handleClearBoxImage() {
    setImageUrl("");
    setStatusMessage("Box image removed.");
    setErrorMessage("");
  }

  function handlePreviewSearchCard(card) {
    setPreviewState({ source: "search", key: String(card.id), card });
  }

  function handlePreviewBoxCard(row) {
    setPreviewState({ source: "box", key: buildBoxCardPreviewKey(row) });
  }

  function handleToggleTierSection(tierId) {
    setCollapsedTierSections((prev) => ({
      ...prev,
      [tierId]: !prev[tierId],
    }));
  }

  async function handleSaveBox() {
    setSaving(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc("upsert_box_product_admin", {
        p_container_id: selectedBoxId || null,
        p_name: name,
        p_code: code || buildContainerCode(name),
        p_box_number_code: boxNumberCode,
        p_box_category_code: boxCategoryCode,
        p_description: description,
        p_image_url: imageUrl || null,
        p_content_mode: contentMode || "curated",
        p_card_count: normalizedCardsPerOpen,
        p_is_enabled: isEnabled,
        p_is_locked: isLocked,
        p_cards: boxCards.map((row) => ({
          card_id: Number(row.card_id),
          tier_id: row.tier_id,
          is_enabled: Boolean(row.is_enabled),
          weight: Math.max(1, Number(row.weight || 1)),
        })),
      });

      if (error) throw error;

      setStatusMessage("Box product saved successfully.");
      await loadPage(data?.container_id || selectedBoxId);
    } catch (error) {
      console.error("Failed to save box product:", error);
      setErrorMessage(error.message || "Failed to save box product.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteBox() {
    if (!selectedBoxId || saving) return;
    if (!window.confirm("Delete this box product? This removes the box and its card pool.")) {
      return;
    }

    setSaving(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const { error } = await supabase.rpc("delete_box_product_admin", {
        p_container_id: selectedBoxId,
      });

      if (error) throw error;

      setStatusMessage("Box product deleted.");
      await loadPage("");
    } catch (error) {
      console.error("Failed to delete box product:", error);
      setErrorMessage(error.message || "Failed to delete box product.");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) return null;

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (!canUsePage) {
    return <Navigate to="/mode/progression" replace />;
  }

  return (
    <LauncherLayout>
      <div className="container-maker-page">
        <div className="container-maker-topbar">
          <div>
            <div className="container-maker-kicker">ADMIN</div>
            <h1 className="container-maker-title">Box Maker</h1>
            <p className="container-maker-subtitle">
              Build Deck Boxes, Promo Boxes, and Collectors Boxes with the same cleaner
              layout as Pack Maker, while keeping the normal box tier system and
              weighted rarity flow intact.
            </p>
          </div>

          <div className="container-maker-topbar-actions">
            <button
              type="button"
              className="container-maker-secondary-btn"
              onClick={() => navigate("/mode/progression")}
            >
              Back
            </button>
          </div>
        </div>

        {loading ? (
          <div className="container-maker-card container-maker-empty">Loading box maker...</div>
        ) : (
          <>
            <div className="container-maker-status-row">
              {statusMessage ? <div className="container-maker-success">{statusMessage}</div> : null}
              {errorMessage ? <div className="container-maker-error">{errorMessage}</div> : null}
            </div>

            <div className="pack-maker-editor-shell box-maker-editor-shell">
              <aside className="container-maker-card pack-maker-cover-panel">
                <div className="pack-maker-cover-frame">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={name || "Box cover preview"}
                      className="pack-maker-cover-image"
                    />
                  ) : (
                    <div className="pack-maker-cover-placeholder">
                      <span>Box Cover</span>
                      <strong>Art Preview</strong>
                    </div>
                  )}
                </div>

                <div className="pack-maker-cover-actions">
                  <label className="container-maker-secondary-btn container-maker-upload-btn">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleImageUpload}
                      disabled={saving || uploadingImage}
                      hidden
                    />
                    {uploadingImage ? "Uploading..." : "Upload"}
                  </label>

                  <button
                    type="button"
                    className="container-maker-danger-btn"
                    onClick={handleClearBoxImage}
                    disabled={saving || !imageUrl}
                  >
                    Delete
                  </button>
                </div>

                <div className="pack-maker-preview-card pack-maker-preview-card--sidebar">
                  <div className="pack-maker-preview-header">
                    <h3>Card Preview</h3>
                    {previewCardTierName ? <span>{previewCardTierName}</span> : null}
                  </div>

                  {previewCard ? (
                    <>
                      <div className="pack-maker-preview-image-shell">
                        {buildCardImageUrl(previewCard) ? (
                          <img
                            src={buildCardImageUrl(previewCard)}
                            alt={previewCard.card_name || previewCard.name || "Card preview"}
                            className="pack-maker-preview-image"
                          />
                        ) : (
                          <div className="pack-maker-preview-empty">No card art found yet.</div>
                        )}
                      </div>

                      <div className="pack-maker-preview-meta">
                        <strong>
                          {previewCard.card_name ||
                            previewCard.name ||
                            `Card ${previewCard.card_id || previewCard.id}`}
                        </strong>
                        <span>Card ID: {previewCard.card_id || previewCard.id}</span>
                        {previewCardTierName ? <span>Box Tier: {previewCardTierName}</span> : null}
                      </div>
                    </>
                  ) : (
                    <div className="pack-maker-preview-empty">
                      Select a searched card or an assigned box card to preview it here.
                    </div>
                  )}
                </div>
              </aside>

              <div className="pack-maker-editor-stack">
                <div className="container-maker-card pack-maker-editor-topbar">
                  <button
                    type="button"
                    className="container-maker-primary-btn pack-maker-toolbar-btn"
                    onClick={handleNewBox}
                    disabled={saving}
                  >
                    New Box
                  </button>

                  <div className="pack-maker-editor-topfield">
                    <span>Name</span>
                    <input
                      className="container-maker-input"
                      value={name}
                      onChange={(event) => {
                        const nextName = event.target.value;
                        setName(nextName);
                        if (!selectedBoxId && !code) {
                          setCode(buildContainerCode(nextName));
                        }
                      }}
                      placeholder="Box name"
                      disabled={saving}
                    />
                  </div>

                  <div className="pack-maker-editor-topfield">
                    <span>Code</span>
                    <input
                      className="container-maker-input"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="Box code"
                      disabled={saving}
                    />
                  </div>

                  <button
                    type="button"
                    className="container-maker-secondary-btn pack-maker-toolbar-btn"
                    onClick={() => setBoxPickerOpen(true)}
                    disabled={saving}
                  >
                    Boxes
                  </button>
                </div>

                <section className="container-maker-card pack-maker-editor-card">
                  <div className="container-maker-section-header pack-maker-editor-header">
                    <div>
                      <h2>Box Editor</h2>
                      <p className="pack-maker-editor-copy">
                        Keep the box number, category, art, search tools, and tier pools
                        together here. The tier shelves below stay grouped for quick scanning.
                      </p>
                    </div>
                  </div>

                  <div className="pack-maker-editor-grid">
                    <div className="pack-maker-editor-main">
                      <div className="pack-maker-meta-grid">
                        <div className="container-maker-field">
                          <label>Box Number</label>
                          <input
                            className="container-maker-input"
                            value={boxNumberCode}
                            onChange={(event) => handleBoxNumberInputChange(event.target.value)}
                            placeholder="001"
                            maxLength={3}
                            disabled={saving}
                          />
                        </div>

                        <div className="container-maker-field">
                          <label>Box Category</label>
                          <select
                            className="container-maker-select"
                            value={boxCategoryCode}
                            onChange={(event) => handleBoxCategoryChange(event.target.value)}
                            disabled={saving}
                          >
                            {BOX_CATEGORY_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="container-maker-field">
                          <label>Content Mode</label>
                          <select
                            className="container-maker-select"
                            value={contentMode}
                            onChange={(event) => setContentMode(event.target.value)}
                            disabled={saving}
                          >
                            {CONTENT_MODE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="container-maker-field">
                          <label>Cards Per Open</label>
                          <input
                            className="container-maker-input"
                            value={cardsPerOpen}
                            onChange={(event) =>
                              setCardsPerOpen(normalizeCardsPerOpenValue(event.target.value))
                            }
                            placeholder="1"
                            disabled={saving}
                          />
                        </div>

                        <div className="container-maker-field">
                          <label>Display Label</label>
                          <input
                            className="container-maker-input"
                            value={generatedBoxDisplayLabel}
                            disabled
                          />
                        </div>

                        <div className="container-maker-field">
                          <label>Generated Key Label</label>
                          <input
                            className="container-maker-input"
                            value={boxNumberCode ? generatedBoxKeyLabel : "Box number pending"}
                            disabled
                          />
                        </div>

                        <div className="container-maker-field">
                          <label>Box Product ID</label>
                          <input
                            className="container-maker-input"
                            value={selectedBoxId || "New box pending"}
                            disabled
                          />
                        </div>

                        <div className="container-maker-field pack-maker-meta-grid-image">
                          <label>Box Image URL</label>
                          <input
                            className="container-maker-input"
                            value={imageUrl}
                            onChange={(event) => setImageUrl(event.target.value)}
                            placeholder="https://..."
                            disabled={saving || uploadingImage}
                          />
                        </div>
                      </div>

                      <div className="container-maker-field">
                        <label>Description</label>
                        <textarea
                          className="container-maker-textarea pack-maker-description"
                          value={description}
                          onChange={(event) => setDescription(event.target.value)}
                          placeholder="Optional description..."
                          disabled={saving}
                        />
                      </div>

                      <div className="container-maker-toggle-row">
                        <label className="container-maker-checkbox">
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={(event) => setIsEnabled(event.target.checked)}
                            disabled={saving}
                          />
                          <span>Enabled</span>
                        </label>

                        <label className="container-maker-checkbox">
                          <input
                            type="checkbox"
                            checked={isLocked}
                            onChange={(event) => setIsLocked(event.target.checked)}
                            disabled={saving}
                          />
                          <span>Locked</span>
                        </label>
                      </div>

                      <div className="pack-maker-autonote">
                        Deck Boxes, Promo Boxes, and Collectors Boxes each keep their own
                        001-999 numbering. Their generated key labels now follow that
                        identity too, like {generatedBoxKeyLabel}. Deck Boxes and
                        Collectors Boxes both use Bulk, Solid, Elite, HighChase, and
                        Legendary at 30 / 25 / 20 / 15 / 10, while Promo Boxes still
                        use the full 10-tier spread. Boxes always roll tier first,
                        card second, and rarity third when they are opened.
                      </div>

                      {!boxNumberIsValid ? (
                        <div className="container-maker-error">
                          Box Number must be exactly 3 digits from 001 to 999.
                        </div>
                      ) : null}

                      {invalidTierCards.length > 0 ? (
                        <div className="container-maker-error">
                          {isFiveTierBox
                            ? `${getBoxCategoryConfig(boxCategoryCode).groupLabel} only support Bulk, Solid, Elite, HighChase, and Legendary. Remap or remove the ${invalidTierCards.length} assigned card${
                                invalidTierCards.length === 1 ? "" : "s"
                              } outside that ladder before saving.`
                            : `Promo Boxes keep the full 10-tier ladder and should not hit this validation.`}
                        </div>
                      ) : null}

                      <div className="container-maker-actions">
                        <button
                          type="button"
                          className="container-maker-primary-btn"
                          onClick={handleSaveBox}
                          disabled={!canSaveBox}
                        >
                          {saving ? "Saving Box..." : "Save Box"}
                        </button>

                        <button
                          type="button"
                          className="container-maker-secondary-btn"
                          onClick={handleDuplicateBox}
                          disabled={saving || !name}
                        >
                          Duplicate Box
                        </button>

                        {selectedBoxId ? (
                          <button
                            type="button"
                            className="container-maker-danger-btn"
                            onClick={handleDeleteBox}
                            disabled={saving}
                          >
                            Delete Box
                          </button>
                        ) : null}
                      </div>

                      <div className="box-maker-summary-grid">
                        {boxTierSummaries.map((entry) => (
                          <div key={entry.tier.id} className="box-maker-summary-card">
                            <span>{entry.tier.name}</span>
                            <strong>{entry.count} cards</strong>
                            <em>
                              {formatTierWeightPercent(entry.effectiveWeightPercent)}{" "}
                              {isFiveTierBox ? "effective weight" : "base weight"}
                            </em>
                          </div>
                        ))}
                      </div>

                      <div className="container-maker-mass-import-block">
                        <label className="container-maker-mass-import-label">
                          Mass Add by Card Names
                        </label>

                        <textarea
                          className="container-maker-textarea container-maker-mass-import-textarea"
                          value={massCardNames}
                          onChange={(event) => setMassCardNames(event.target.value)}
                          placeholder={
                            "Paste one card name per line, or use commas/semicolons.\nExample:\nBlue-Eyes White Dragon\nDark Magician\nExodia the Forbidden One"
                          }
                          disabled={saving || massImportBusy}
                        />

                        <div className="container-maker-mass-import-actions">
                          <button
                            type="button"
                            className="container-maker-primary-btn"
                            onClick={handleMassAddCards}
                            disabled={saving || massImportBusy || !selectedTierId}
                          >
                            {massImportBusy ? "Adding Cards..." : "Mass Add Cards"}
                          </button>
                        </div>
                      </div>

                      <div className="container-maker-card-search-controls box-maker-search-controls">
                        <input
                          className="container-maker-input"
                          value={cardSearch}
                          onChange={(event) => setCardSearch(event.target.value)}
                          placeholder="Search cards..."
                          disabled={saving}
                        />

                        <select
                          className="container-maker-select"
                          value={selectedTierId}
                          onChange={(event) => setSelectedTierId(event.target.value)}
                          disabled={saving}
                        >
                          {visibleCardTiers.map((tier) => (
                            <option key={tier.id} value={tier.id}>
                              {tier.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="container-maker-search-results pack-maker-search-results">
                        {cardSearch.trim().length < 2 ? (
                          <div className="container-maker-empty small">
                            Type at least 2 characters to search cards.
                          </div>
                        ) : cardSearchResults.length === 0 ? (
                          <div className="container-maker-empty small">
                            No matching cards found.
                          </div>
                        ) : (
                          cardSearchResults.map((card) => (
                            <div
                              key={card.id}
                              className={`container-maker-search-row pack-maker-interactive-row ${
                                previewState?.source === "search" &&
                                String(previewState?.key) === String(card.id)
                                  ? "is-preview-selected"
                                  : ""
                              }`}
                              onClick={() => handlePreviewSearchCard(card)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  handlePreviewSearchCard(card);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                            >
                              <div>
                                <div className="container-maker-row-name">{card.name}</div>
                                <div className="container-maker-row-meta">Card ID: {card.id}</div>
                              </div>

                              <button
                                type="button"
                                className="container-maker-primary-btn small"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleAddCard(card);
                                }}
                                disabled={saving || !selectedTierId}
                              >
                                Add
                              </button>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="pack-maker-tier-groups">
                        {groupedBoxCards.every((group) => group.rows.length === 0) ? (
                          <div className="container-maker-empty">
                            No cards have been assigned to any box tier yet.
                          </div>
                        ) : (
                          groupedBoxCards.map((group) => (
                            <section
                              key={group.tier.id}
                              className={`container-maker-slot-group pack-maker-tier-section ${
                                collapsedTierSections[group.tier.id] ? "is-collapsed" : ""
                              }`}
                            >
                              <div className="container-maker-slot-header pack-maker-tier-section-header">
                                <h3>{group.tier.name}</h3>
                                <div className="pack-maker-tier-section-header-actions">
                                  <span>
                                    {group.rows.length} cards |{" "}
                                    {formatTierWeightPercent(group.effectiveWeightPercent)}{" "}
                                    {isFiveTierBox ? "effective" : "base"} weight
                                  </span>
                                  <button
                                    type="button"
                                    className="pack-maker-tier-toggle"
                                    onClick={() => handleToggleTierSection(group.tier.id)}
                                    aria-label={
                                      collapsedTierSections[group.tier.id]
                                        ? `Expand ${group.tier.name} tier`
                                        : `Collapse ${group.tier.name} tier`
                                    }
                                    aria-expanded={!collapsedTierSections[group.tier.id]}
                                  >
                                    {collapsedTierSections[group.tier.id] ? "+" : "-"}
                                  </button>
                                </div>
                              </div>

                              {collapsedTierSections[group.tier.id] ? null : group.rows.length === 0 ? (
                                <div className="container-maker-empty small">
                                  No cards assigned to this box tier yet.
                                </div>
                              ) : (
                                <div className="pack-maker-tier-card-grid">
                                  {group.rows.map((row) => {
                                    const rowIndex = boxCards.indexOf(row);
                                    return (
                                      <div
                                        key={`${row.id || row.card_id}-${rowIndex}`}
                                        className={`pack-maker-assigned-card pack-maker-interactive-row ${
                                          previewState?.source === "box" &&
                                          previewState?.key === buildBoxCardPreviewKey(row)
                                            ? "is-preview-selected"
                                            : ""
                                        }`}
                                        onClick={() => handlePreviewBoxCard(row)}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            handlePreviewBoxCard(row);
                                          }
                                        }}
                                        role="button"
                                        tabIndex={0}
                                      >
                                        <div className="pack-maker-assigned-card-art">
                                          {buildCardImageUrl(row) ? (
                                            <img
                                              src={buildCardImageUrl(row)}
                                              alt={row.card_name || `Card ${row.card_id}`}
                                              className="pack-maker-assigned-card-image"
                                            />
                                          ) : (
                                            <div className="pack-maker-assigned-card-empty">No Art</div>
                                          )}
                                          <div className="pack-maker-assigned-card-overlay">
                                            <span className="pack-maker-assigned-card-name">
                                              {row.card_name || `Card ${row.card_id}`}
                                            </span>
                                          </div>
                                        </div>

                                        <div className="pack-maker-assigned-card-body">
                                          <div className="pack-maker-assigned-card-meta">
                                            <span>Card ID: {row.card_id}</span>
                                            <span>Tier: {row.tier_name}</span>
                                          </div>

                                          <div className="pack-maker-assigned-card-controls">
                                            <select
                                              className="container-maker-select small"
                                              value={row.tier_id}
                                              onChange={(event) =>
                                                handleChangeCardTier(rowIndex, event.target.value)
                                              }
                                              onClick={(event) => event.stopPropagation()}
                                              disabled={saving}
                                            >
                                              {visibleCardTiers.map((tier) => (
                                                <option key={tier.id} value={tier.id}>
                                                  {tier.name}
                                                </option>
                                              ))}
                                            </select>

                                            <input
                                              type="number"
                                              min="1"
                                              className="container-maker-input container-maker-weight-input"
                                              value={row.weight || 1}
                                              title="Weight"
                                              onChange={(event) =>
                                                handleChangeCardWeight(rowIndex, event.target.value)
                                              }
                                              onClick={(event) => event.stopPropagation()}
                                              disabled={saving}
                                            />

                                            <label
                                              className="container-maker-inline-checkbox pack-maker-assigned-card-toggle"
                                              onClick={(event) => event.stopPropagation()}
                                            >
                                              <input
                                                type="checkbox"
                                                checked={Boolean(row.is_enabled)}
                                                onChange={() => handleToggleCardEnabled(rowIndex)}
                                                disabled={saving}
                                              />
                                              <span>Enabled</span>
                                            </label>

                                            <button
                                              type="button"
                                              className="container-maker-danger-btn small"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                handleRemoveCard(rowIndex);
                                              }}
                                              disabled={saving}
                                            >
                                              Remove
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </section>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            {boxPickerOpen ? (
              <div className="pack-maker-picker-backdrop" onClick={() => setBoxPickerOpen(false)}>
                <div
                  className="container-maker-card pack-maker-picker-modal"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="container-maker-section-header">
                    <h2>Boxes</h2>
                    <button
                      type="button"
                      className="container-maker-secondary-btn"
                      onClick={() => setBoxPickerOpen(false)}
                    >
                      Close
                    </button>
                  </div>

                  <p className="pack-maker-picker-copy">
                    Load an existing box into the editor. Boxes are grouped by category
                    and sorted by Box Number inside each group.
                  </p>

                  <input
                    className="container-maker-input"
                    value={boxPickerSearch}
                    onChange={(event) => setBoxPickerSearch(event.target.value)}
                    placeholder="Search boxes, codes, or numbers..."
                    autoFocus
                  />

                  <div className="pack-maker-picker-groups">
                    {groupedBoxProducts.length === 0 ? (
                      <div className="container-maker-empty">No boxes matched that search.</div>
                    ) : (
                      groupedBoxProducts.map((group) => (
                        <div key={group.groupLabel} className="pack-maker-picker-group">
                          <div className="pack-maker-picker-group-header">
                            <h3>{group.groupLabel}</h3>
                            <span>{group.products.length} boxes</span>
                          </div>

                          <div className="pack-maker-picker-list">
                            {group.products.map((product) => (
                              <button
                                key={product.container_id}
                                type="button"
                                className={`container-maker-container-row ${
                                  selectedBoxId === product.container_id ? "is-selected" : ""
                                }`}
                                onClick={() => handleLoadBoxFromPicker(product.container_id)}
                              >
                                <div>
                                  <div className="container-maker-container-row-name">
                                    {product.name}
                                  </div>
                                  <div className="container-maker-container-row-meta">
                                    {product.box_number_code
                                      ? `${buildBoxKeyLabel(
                                          product?.box_category_code,
                                          product?.box_number_code
                                        )} | `
                                      : ""}
                                    {product.box_category_label} | {product.code}
                                    {product.is_locked ? " | Locked" : ""}
                                    {!product.is_enabled ? " | Disabled" : ""}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </LauncherLayout>
  );
}

export default BoxMakerPage;
