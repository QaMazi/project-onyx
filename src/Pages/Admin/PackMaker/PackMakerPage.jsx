import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../../components/LauncherLayout";
import { useUser } from "../../../context/UserContext";
import { supabase } from "../../../lib/supabase";
import "../ContainerMaker/ContainerMakerPage.css";
import "./PackMakerPage.css";

const CONTENT_MODE_OPTIONS = [
  { value: "official", label: "Official" },
  { value: "curated", label: "Curated" },
];
const CONTAINER_IMAGE_BUCKET = "container-images";
const PACK_SLOT_COUNT = 9;
const SLOT_TOTAL_TARGET = 100;
const SLOT_TOTAL_TOLERANCE = 0.01;
const INTERNAL_PACK_SET_FALLBACK = "Unsorted";
const LAST_SLOT_DEFAULT_WEIGHTS = {
  rare: 77.42,
  super_rare: 12.9,
  ultra_rare: 6.45,
  secret_rare: 3.23,
};

function roundPercentage(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function calculateSlotTierTotal(rows, slotIndex) {
  return roundPercentage(
    (rows || [])
      .filter((row) => row.slot_index === slotIndex && Boolean(row.is_enabled))
      .reduce((sum, row) => sum + Number(row.weight || 0), 0)
  );
}

function isSlotTierTotalValid(total) {
  return Math.abs(Number(total || 0) - SLOT_TOTAL_TARGET) <= SLOT_TOTAL_TOLERANCE;
}

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
  if (!base) return "New Pack Copy";
  if (base.toLowerCase().endsWith(" copy")) return `${base} 2`;
  return `${base} Copy`;
}

function buildDuplicateCode(code) {
  const base = String(code || "").trim();
  if (!base) return "NEW_PACK_COPY";
  if (base.endsWith("_COPY")) return `${base}_2`;
  return `${base}_COPY`;
}

function parseMassCardNames(rawText) {
  return String(rawText || "")
    .split(/\r?\n|,|;/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function createDefaultSlotTierRows(tiers) {
  return Array.from({ length: PACK_SLOT_COUNT }, (_, index) => index + 1).flatMap(
    (slotIndex) =>
      (tiers || []).map((tier) => {
        const tierCode = String(tier?.code || "").trim().toLowerCase();
        const isCommonSlot = slotIndex <= 8 && tierCode === "common";
        const isLastSlotUpgrade =
          slotIndex === 9 &&
          Object.prototype.hasOwnProperty.call(LAST_SLOT_DEFAULT_WEIGHTS, tierCode);

        return {
          slot_index: slotIndex,
          pack_pool_tier_id: tier.id,
          pack_pool_tier_code: tierCode,
          pack_pool_tier_name: tier.name || tierCode || "Tier",
          weight: isCommonSlot
            ? 100
            : isLastSlotUpgrade
              ? LAST_SLOT_DEFAULT_WEIGHTS[tierCode]
              : 0,
          is_enabled: isCommonSlot || isLastSlotUpgrade,
        };
      })
  );
}

function buildMergedSlotTierRows(tiers, incomingRows) {
  const baseRows = createDefaultSlotTierRows(tiers);
  const incomingMap = new Map(
    (incomingRows || []).map((row) => [
      `${Number(row.slot_index || 0)}:${row.pack_pool_tier_id}`,
      row,
    ])
  );

  return baseRows.map((row) => {
    const incoming = incomingMap.get(`${row.slot_index}:${row.pack_pool_tier_id}`);
    if (!incoming) return row;

    return {
      ...row,
      weight: Number(incoming.weight ?? row.weight ?? 0),
      is_enabled: Boolean(incoming.is_enabled),
    };
  });
}

function normalizeContentMode(mode) {
  return String(mode || "").trim().toLowerCase() === "official" ? "official" : "curated";
}

function normalizePackSetLabel(value) {
  const label = String(value || "").trim();
  return label || INTERNAL_PACK_SET_FALLBACK;
}

function buildCardImageUrl(card) {
  if (card?.image_url) return card.image_url;
  if (card?.card_image_url) return card.card_image_url;

  const cardId = Number(card?.card_id ?? card?.id);
  if (!Number.isFinite(cardId) || cardId <= 0) return "";

  return `https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/${cardId}.jpg`;
}

function buildPackCardPreviewKey(row) {
  return `${row?.id || "pack-card"}:${row?.card_id || ""}:${row?.pack_pool_tier_id || ""}:${row?.rarity_id || ""}`;
}

function PackMakerPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [massImportBusy, setMassImportBusy] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [packProducts, setPackProducts] = useState([]);
  const [packPoolTiers, setPackPoolTiers] = useState([]);
  const [cardRarities, setCardRarities] = useState([]);
  const [selectedPackGroupCode, setSelectedPackGroupCode] = useState("");

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [packSetName, setPackSetName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [contentMode, setContentMode] = useState("official");
  const [isEnabled, setIsEnabled] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  const [packCards, setPackCards] = useState([]);
  const [slotTierRows, setSlotTierRows] = useState([]);

  const [cardSearch, setCardSearch] = useState("");
  const [cardSearchResults, setCardSearchResults] = useState([]);
  const [selectedPoolTierId, setSelectedPoolTierId] = useState("");
  const [selectedRarityId, setSelectedRarityId] = useState("");
  const [massCardNames, setMassCardNames] = useState("");
  const [packPickerOpen, setPackPickerOpen] = useState(false);
  const [packPickerSearch, setPackPickerSearch] = useState("");
  const [previewState, setPreviewState] = useState(null);

  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const canUsePage = user?.role === "Admin+";

  const packTierMap = useMemo(() => {
    const map = new Map();
    (packPoolTiers || []).forEach((tier) => {
      map.set(tier.id, tier);
    });
    return map;
  }, [packPoolTiers]);

  const rarityMap = useMemo(() => {
    const map = new Map();
    (cardRarities || []).forEach((rarity) => {
      map.set(rarity.id, rarity);
    });
    return map;
  }, [cardRarities]);

  const selectedProduct = useMemo(
    () =>
      packProducts.find((product) => product.pack_group_code === selectedPackGroupCode) ||
      null,
    [packProducts, selectedPackGroupCode]
  );

  const groupedPackCards = useMemo(() => {
    return (packPoolTiers || []).map((tier) => ({
      tier,
      rows: packCards
        .filter((row) => row.pack_pool_tier_id === tier.id)
        .sort((a, b) => String(a.card_name || "").localeCompare(String(b.card_name || ""))),
    }));
  }, [packCards, packPoolTiers]);

  const groupedPackProducts = useMemo(() => {
    const query = String(packPickerSearch || "").trim().toLowerCase();
    const groupMap = new Map();

    (packProducts || []).forEach((product) => {
      const setLabel = normalizePackSetLabel(product?.pack_set_name);
      const matchesQuery =
        !query ||
        [product?.name, product?.code, product?.description, setLabel]
          .some((value) => String(value || "").toLowerCase().includes(query));

      if (!matchesQuery) return;

      if (!groupMap.has(setLabel)) {
        groupMap.set(setLabel, []);
      }

      groupMap.get(setLabel).push(product);
    });

    return Array.from(groupMap.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([setLabel, products]) => ({
        setLabel,
        products: [...products].sort((left, right) => {
          const nameDiff = String(left?.name || "").localeCompare(String(right?.name || ""));
          if (nameDiff !== 0) return nameDiff;
          return String(left?.code || "").localeCompare(String(right?.code || ""));
        }),
      }));
  }, [packPickerSearch, packProducts]);

  const previewCard = useMemo(() => {
    if (!previewState) return null;

    if (previewState.source === "pack") {
      return (
        packCards.find((row) => buildPackCardPreviewKey(row) === previewState.key) || null
      );
    }

    if (previewState.source === "search") {
      return (
        cardSearchResults.find((card) => String(card.id) === String(previewState.key)) ||
        previewState.card ||
        null
      );
    }

    return previewState.card || null;
  }, [cardSearchResults, packCards, previewState]);

  const slotTotals = useMemo(() => {
    const map = new Map();
    for (let slotIndex = 1; slotIndex <= PACK_SLOT_COUNT; slotIndex += 1) {
      map.set(slotIndex, calculateSlotTierTotal(slotTierRows, slotIndex));
    }
    return map;
  }, [slotTierRows]);

  const invalidSlotIndexes = useMemo(
    () =>
      Array.from({ length: PACK_SLOT_COUNT }, (_, index) => index + 1).filter(
        (slotIndex) => !isSlotTierTotalValid(slotTotals.get(slotIndex))
      ),
    [slotTotals]
  );

  const canSavePack =
    !saving &&
    Boolean(name) &&
    Boolean(code) &&
    invalidSlotIndexes.length === 0;

  useEffect(() => {
    if (!authLoading && user) {
      loadPage();
    }
  }, [authLoading, user]);

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
        console.error("Failed to search pack cards:", error);
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

    if (!packCards.length) {
      if (previewState) {
        setPreviewState(null);
      }
      return;
    }

    if (
      previewState?.source === "pack" &&
      packCards.some((row) => buildPackCardPreviewKey(row) === previewState.key)
    ) {
      return;
    }

    setPreviewState({
      source: "pack",
      key: buildPackCardPreviewKey(packCards[0]),
    });
  }, [packCards, previewState]);

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
      const baseCode = buildContainerCode(code || name || "pack") || "PACK";
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
      setStatusMessage("Pack image uploaded.");
    } catch (error) {
      console.error("Failed to upload pack image:", error);
      setErrorMessage(error.message || "Failed to upload the image.");
    } finally {
      setUploadingImage(false);
    }
  }

  async function loadPage(nextSelection = selectedPackGroupCode) {
    setLoading(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const [
        { data: productRows, error: productsError },
        { data: tierRows, error: tiersError },
        { data: rarityRows, error: raritiesError },
      ] = await Promise.all([
        supabase.rpc("get_pack_products_admin"),
        supabase.rpc("get_pack_pool_tiers_admin"),
        supabase
          .from("card_rarities")
          .select("id, code, name, sort_order")
          .order("sort_order", { ascending: true }),
      ]);

      if (productsError) throw productsError;
      if (tiersError) throw tiersError;
      if (raritiesError) throw raritiesError;

      const nextProducts = productRows || [];
      const nextTiers = tierRows || [];
      const nextRarities = rarityRows || [];

      setPackProducts(nextProducts);
      setPackPoolTiers(nextTiers);
      setCardRarities(nextRarities);

      if (!selectedPoolTierId && nextTiers.length) {
        setSelectedPoolTierId(nextTiers[0].id);
      }

      if (!selectedRarityId && nextRarities.length) {
        setSelectedRarityId(nextRarities[0].id);
      }

      const nextGroupCode =
        nextProducts.find((row) => row.pack_group_code === nextSelection)?.pack_group_code ||
        nextProducts[0]?.pack_group_code ||
        "";

      if (nextGroupCode) {
        await loadPackProduct(nextGroupCode, nextTiers);
      } else {
        resetEditor(nextTiers);
      }
    } catch (error) {
      console.error("Failed to load pack maker:", error);
      setErrorMessage(error.message || "Failed to load pack maker.");
      setPackProducts([]);
      setPackPoolTiers([]);
      setCardRarities([]);
    } finally {
      setLoading(false);
    }
  }

  function resetEditor(tiers = packPoolTiers) {
    setSelectedPackGroupCode("");
    setName("");
    setCode("");
    setPackSetName("");
    setDescription("");
    setImageUrl("");
    setContentMode("official");
    setIsEnabled(true);
    setIsLocked(false);
    setPackCards([]);
    setSlotTierRows(buildMergedSlotTierRows(tiers, []));
    setCardSearch("");
    setCardSearchResults([]);
    setMassCardNames("");
    setPackPickerSearch("");
    setPreviewState(null);
    setSelectedPoolTierId(tiers?.[0]?.id || "");
    setSelectedRarityId(cardRarities?.[0]?.id || "");
  }

  async function loadPackProduct(packGroupCode, tiers = packPoolTiers) {
    setSelectedPackGroupCode(packGroupCode);
    setStatusMessage("");
    setErrorMessage("");

    const { data, error } = await supabase.rpc("get_pack_product_admin", {
      p_pack_group_code: packGroupCode,
    });

    if (error) throw error;

    setName(data?.name || "");
    setCode(data?.code || "");
    setPackSetName(data?.pack_set_name || "");
    setDescription(data?.description || "");
    setImageUrl(data?.image_url || "");
    setContentMode(normalizeContentMode(data?.content_mode || "official"));
    setIsEnabled(Boolean(data?.is_enabled ?? true));
    setIsLocked(Boolean(data?.is_locked ?? false));
    const nextPackCards = (data?.cards || []).map((row, index) => ({
      ...row,
      id: row.id || `existing-pack-card-${index}`,
      card_id: Number(row.card_id),
      image_url: row.card_image_url || row.image_url || "",
      weight: Number(row.weight ?? 1),
    }));
    setPackCards(nextPackCards);
    setSlotTierRows(buildMergedSlotTierRows(tiers, data?.slot_tiers || []));
    setSelectedPoolTierId(tiers?.[0]?.id || "");
    setMassCardNames("");
    setPreviewState(
      nextPackCards.length
        ? {
            source: "pack",
            key: buildPackCardPreviewKey(nextPackCards[0]),
          }
        : null
    );
  }

  function handleAddCard(card) {
    if (!selectedPoolTierId) return;

    const tier = packTierMap.get(selectedPoolTierId);
    const rarity = rarityMap.get(selectedRarityId);
    const nextCard = {
      id: `temp-${card.id}-${selectedPoolTierId}-${Date.now()}-${Math.random()}`,
      card_id: Number(card.id),
      card_name: card.name,
      image_url: card.image_url || "",
      pack_pool_tier_id: selectedPoolTierId,
      pack_pool_tier_code: tier?.code || "",
      pack_pool_tier_name: tier?.name || "Tier",
      rarity_id: selectedRarityId || null,
      rarity_code: rarity?.code || "",
      rarity_name: rarity?.name || "Base",
      is_enabled: true,
      weight: 1,
    };

    setPackCards((prev) => [...prev, nextCard]);
    setPreviewState({
      source: "pack",
      key: buildPackCardPreviewKey(nextCard),
    });
  }

  async function handleMassAddCards() {
    const names = parseMassCardNames(massCardNames);

    if (!names.length) {
      setErrorMessage("Paste at least one card name.");
      setStatusMessage("");
      return;
    }

    if (!selectedPoolTierId) {
      setErrorMessage("Select a pack tier before mass adding cards.");
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
      const tier = packTierMap.get(selectedPoolTierId);
      const rarity = rarityMap.get(selectedRarityId);

      if (!foundCards.length) {
        throw new Error("No pasted card names matched exact card names in the database.");
      }

      const nextCards = foundCards.map((card, index) => ({
          id: `mass-${card.id}-${selectedPoolTierId}-${Date.now()}-${index}`,
          card_id: Number(card.id),
          card_name: card.name,
          image_url: card.image_url || "",
          pack_pool_tier_id: selectedPoolTierId,
          pack_pool_tier_code: tier?.code || "",
          pack_pool_tier_name: tier?.name || "Tier",
          rarity_id: selectedRarityId || null,
          rarity_code: rarity?.code || "",
          rarity_name: rarity?.name || "Base",
          is_enabled: true,
          weight: 1,
        }));

      setPackCards((prev) => [...prev, ...nextCards]);
      if (nextCards.length > 0) {
        setPreviewState({
          source: "pack",
          key: buildPackCardPreviewKey(nextCards[0]),
        });
      }

      if (missingNames.length > 0) {
        setStatusMessage(
          `Added ${foundCards.length} cards. Not found: ${missingNames.join(", ")}`
        );
      } else {
        setStatusMessage(`Added ${foundCards.length} cards from pasted list.`);
      }
    } catch (error) {
      console.error("Failed to mass add pack cards:", error);
      setErrorMessage(error.message || "Failed to mass add pack cards.");
    } finally {
      setMassImportBusy(false);
    }
  }

  function handleRemoveCard(index) {
    setPackCards((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  }

  function handleChangeCardTier(index, tierId) {
    const tier = packTierMap.get(tierId);

    setPackCards((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        pack_pool_tier_id: tierId,
        pack_pool_tier_code: tier?.code || "",
        pack_pool_tier_name: tier?.name || "Tier",
      };
      return next;
    });
  }

  function handleChangeCardRarity(index, rarityId) {
    const rarity = rarityMap.get(rarityId);

    setPackCards((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        rarity_id: rarityId,
        rarity_code: rarity?.code || "",
        rarity_name: rarity?.name || "Base",
      };
      return next;
    });
  }

  function handleChangeCardWeight(index, weight) {
    setPackCards((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        weight: Math.max(1, Number(weight || 1)),
      };
      return next;
    });
  }

  function handleToggleCardEnabled(index) {
    setPackCards((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        is_enabled: !next[index].is_enabled,
      };
      return next;
    });
  }

  function handleSlotTierChange(slotIndex, packPoolTierId, patch) {
    setSlotTierRows((prev) =>
      prev.map((row) => {
        if (row.slot_index !== slotIndex || row.pack_pool_tier_id !== packPoolTierId) {
          return row;
        }

        const nextWeight =
          patch.weight == null
            ? row.weight
            : Math.max(0, Math.min(SLOT_TOTAL_TARGET, roundPercentage(patch.weight)));

        return {
          ...row,
          ...patch,
          weight: nextWeight,
        };
      })
    );
  }

  function handleNormalizeSlot(slotIndex) {
    setSlotTierRows((prev) => {
      const slotRows = prev.filter(
        (row) => row.slot_index === slotIndex && Boolean(row.is_enabled)
      );

      if (slotRows.length === 0) {
        return prev;
      }

      if (slotRows.length === 1) {
        return prev.map((row) =>
          row.slot_index === slotIndex && row.pack_pool_tier_id === slotRows[0].pack_pool_tier_id
            ? { ...row, weight: SLOT_TOTAL_TARGET }
            : row
        );
      }

      const currentTotal = slotRows.reduce(
        (sum, row) => sum + Math.max(Number(row.weight || 0), 0),
        0
      );

      const fallbackWeight = roundPercentage(SLOT_TOTAL_TARGET / slotRows.length);
      let assignedTotal = 0;

      return prev.map((row) => {
        if (row.slot_index !== slotIndex || !row.is_enabled) {
          return row;
        }

        const enabledIndex = slotRows.findIndex(
          (candidate) => candidate.pack_pool_tier_id === row.pack_pool_tier_id
        );

        if (enabledIndex === slotRows.length - 1) {
          return {
            ...row,
            weight: roundPercentage(SLOT_TOTAL_TARGET - assignedTotal),
          };
        }

        const nextWeight =
          currentTotal > 0
            ? roundPercentage((Math.max(Number(row.weight || 0), 0) / currentTotal) * SLOT_TOTAL_TARGET)
            : fallbackWeight;

        assignedTotal += nextWeight;
        return {
          ...row,
          weight: nextWeight,
        };
      });
    });
  }

  function handleDuplicatePack() {
    setSelectedPackGroupCode("");
    setName(buildDuplicateName(name));
    setCode(buildDuplicateCode(code));
    setIsLocked(false);
    setStatusMessage("Pack duplicated into a new unsaved copy.");
    setErrorMessage("");
  }

  function handleNewPack() {
    setStatusMessage("");
    setErrorMessage("");
    setPackPickerOpen(false);
    resetEditor();
  }

  async function handleLoadPackFromPicker(packGroupCode) {
    setPackPickerOpen(false);
    setPackPickerSearch("");
    await loadPackProduct(packGroupCode);
  }

  function handleClearPackImage() {
    setImageUrl("");
    setStatusMessage("Pack image removed.");
    setErrorMessage("");
  }

  function handlePreviewSearchCard(card) {
    setPreviewState({
      source: "search",
      key: String(card.id),
      card,
    });
  }

  function handlePreviewPackCard(row) {
    setPreviewState({
      source: "pack",
      key: buildPackCardPreviewKey(row),
    });
  }

  async function handleSavePack() {
    setSaving(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc("upsert_pack_product_admin", {
        p_pack_group_code: selectedPackGroupCode || null,
        p_name: name,
        p_code: code || buildContainerCode(name),
        p_pack_set_name: packSetName || null,
        p_description: description,
        p_image_url: imageUrl || null,
        p_content_mode: contentMode || "official",
        p_is_enabled: isEnabled,
        p_is_locked: isLocked,
        p_cards: packCards.map((row) => ({
          card_id: Number(row.card_id),
          pack_pool_tier_id: row.pack_pool_tier_id,
          rarity_id: row.rarity_id || null,
          is_enabled: Boolean(row.is_enabled),
          weight: Math.max(1, Number(row.weight || 1)),
        })),
        p_slot_tiers: slotTierRows
          .filter((row) => Boolean(row.is_enabled) && Number(row.weight) > 0)
          .map((row) => ({
            slot_index: Number(row.slot_index),
            pack_pool_tier_id: row.pack_pool_tier_id,
            is_enabled: Boolean(row.is_enabled),
            weight: Number(row.weight),
          })),
      });

      if (error) throw error;

      const nextGroupCode = data?.pack_group_code || selectedPackGroupCode;
      setStatusMessage("Pack product saved successfully.");
      await loadPage(nextGroupCode);
    } catch (error) {
      console.error("Failed to save pack product:", error);
      setErrorMessage(error.message || "Failed to save pack product.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePack() {
    if (!selectedPackGroupCode || saving) return;
    if (
      !window.confirm(
        "Delete this pack product? This removes both the draft and full pack variants."
      )
    ) {
      return;
    }

    setSaving(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const { error } = await supabase.rpc("delete_pack_product_admin", {
        p_pack_group_code: selectedPackGroupCode,
      });

      if (error) throw error;

      setStatusMessage("Pack product deleted.");
      await loadPage("");
    } catch (error) {
      console.error("Failed to delete pack product:", error);
      setErrorMessage(error.message || "Failed to delete pack product.");
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
            <h1 className="container-maker-title">Pack Maker</h1>
            <p className="container-maker-subtitle">
              Build one pack product at a time. Saving automatically maintains both
              the full pack and draft pack variants behind the scenes, while each
              pack entry keeps its own manually assigned rarity.
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
          <div className="container-maker-card container-maker-empty">
            Loading pack maker...
          </div>
        ) : (
          <>
            <div className="container-maker-status-row">
              {statusMessage ? (
                <div className="container-maker-success">{statusMessage}</div>
              ) : null}

              {errorMessage ? (
                <div className="container-maker-error">{errorMessage}</div>
              ) : null}
            </div>

            <div className="pack-maker-editor-shell">
              <aside className="container-maker-card pack-maker-cover-panel">
                <div className="pack-maker-cover-frame">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={name || "Pack cover preview"}
                      className="pack-maker-cover-image"
                    />
                  ) : (
                    <div className="pack-maker-cover-placeholder">
                      <span>Pack Cover</span>
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
                    onClick={handleClearPackImage}
                    disabled={saving || !imageUrl}
                  >
                    Delete
                  </button>
                </div>
              </aside>

              <div className="pack-maker-editor-stack">
                <div className="container-maker-card pack-maker-editor-topbar">
                  <button
                    type="button"
                    className="container-maker-primary-btn pack-maker-toolbar-btn"
                    onClick={handleNewPack}
                    disabled={saving}
                  >
                    New Pack
                  </button>

                  <div className="pack-maker-editor-topfield">
                    <span>Name</span>
                    <input
                      className="container-maker-input"
                      value={name}
                      onChange={(event) => {
                        const nextName = event.target.value;
                        setName(nextName);
                        if (!selectedPackGroupCode && !code) {
                          setCode(buildContainerCode(nextName));
                        }
                      }}
                      placeholder="Pack name"
                      disabled={saving}
                    />
                  </div>

                  <div className="pack-maker-editor-topfield">
                    <span>Code</span>
                    <input
                      className="container-maker-input"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="Pack code"
                      disabled={saving}
                    />
                  </div>

                  <button
                    type="button"
                    className="container-maker-secondary-btn pack-maker-toolbar-btn"
                    onClick={() => setPackPickerOpen(true)}
                    disabled={saving}
                  >
                    Packs
                  </button>
                </div>

                <section className="container-maker-card pack-maker-editor-card">
                  <div className="container-maker-section-header pack-maker-editor-header">
                    <div>
                      <h2>Pack Editor</h2>
                      <p className="pack-maker-editor-copy">
                        Keep the internal set organizer, art, search tools, and
                        curated card pools together here. Pack slot tier rules stay
                        below this section.
                      </p>
                    </div>
                  </div>

                  <div className="pack-maker-editor-grid">
                    <div className="pack-maker-editor-main">
                      <div className="pack-maker-meta-grid">
                        <div className="container-maker-field">
                          <label>Set</label>
                          <input
                            className="container-maker-input"
                            value={packSetName}
                            onChange={(event) => setPackSetName(event.target.value)}
                            placeholder="Internal organizer only"
                            disabled={saving}
                          />
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
                          <label>Cards Per Pack</label>
                          <input className="container-maker-input" value="9" disabled />
                        </div>

                        <div className="container-maker-field">
                          <label>Generated Full Pack</label>
                          <input
                            className="container-maker-input"
                            value={name ? name : "Pack name pending"}
                            disabled
                          />
                        </div>

                        <div className="container-maker-field">
                          <label>Generated Draft Pack</label>
                          <input
                            className="container-maker-input"
                            value={name ? `${name} Draft` : "Pack name pending"}
                            disabled
                          />
                        </div>

                        <div className="container-maker-field">
                          <label>Pack Group Code</label>
                          <input
                            className="container-maker-input"
                            value={selectedPackGroupCode || "New pack pending"}
                            disabled
                          />
                        </div>

                        <div className="container-maker-field pack-maker-meta-grid-image">
                          <label>Pack Image URL</label>
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
                        Save once and the admin system keeps both variants in sync: a
                        full pack for normal opening and a draft pack version for
                        draft use. The Set field is internal and only groups packs
                        inside the picker modal.
                      </div>

                      <div className="container-maker-actions">
                        <button
                          type="button"
                          className="container-maker-primary-btn"
                          onClick={handleSavePack}
                          disabled={!canSavePack}
                        >
                          {saving ? "Saving Pack..." : "Save Pack"}
                        </button>

                        <button
                          type="button"
                          className="container-maker-secondary-btn"
                          onClick={handleDuplicatePack}
                          disabled={saving || !name}
                        >
                          Duplicate Pack
                        </button>

                        {selectedPackGroupCode ? (
                          <button
                            type="button"
                            className="container-maker-danger-btn"
                            onClick={handleDeletePack}
                            disabled={saving}
                          >
                            Delete Pack
                          </button>
                        ) : null}
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
                            disabled={saving || massImportBusy || !selectedPoolTierId}
                          >
                            {massImportBusy ? "Adding Cards..." : "Mass Add Cards"}
                          </button>
                        </div>
                      </div>

                      <div className="container-maker-card-search-controls pack-maker-search-controls">
                        <input
                          className="container-maker-input"
                          value={cardSearch}
                          onChange={(event) => setCardSearch(event.target.value)}
                          placeholder="Search cards..."
                          disabled={saving}
                        />

                        <select
                          className="container-maker-select"
                          value={selectedPoolTierId}
                          onChange={(event) => setSelectedPoolTierId(event.target.value)}
                          disabled={saving}
                        >
                          {packPoolTiers.map((tier) => (
                            <option key={tier.id} value={tier.id}>
                              {tier.name}
                            </option>
                          ))}
                        </select>

                        <select
                          className="container-maker-select"
                          value={selectedRarityId}
                          onChange={(event) => setSelectedRarityId(event.target.value)}
                          disabled={saving}
                        >
                          {cardRarities.map((rarity) => (
                            <option key={rarity.id} value={rarity.id}>
                              {rarity.name}
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
                              className={`container-maker-search-row pack-maker-interactive-row ${
                                previewState?.source === "search" &&
                                String(previewState?.key) === String(card.id)
                                  ? "is-preview-selected"
                                  : ""
                              }`}
                              key={card.id}
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
                                <div className="container-maker-row-meta">
                                  Card ID: {card.id}
                                </div>
                              </div>

                              <button
                                type="button"
                                className="container-maker-primary-btn small"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleAddCard(card);
                                }}
                                disabled={saving || !selectedPoolTierId}
                              >
                                Add
                              </button>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="pack-maker-tier-groups">
                        {groupedPackCards.every((group) => group.rows.length === 0) ? (
                          <div className="container-maker-empty">
                            No cards have been assigned to any pack tier yet.
                          </div>
                        ) : (
                          groupedPackCards.map((group) => (
                            <div key={group.tier.id} className="container-maker-slot-group">
                              <div className="container-maker-slot-header">
                                <h3>{group.tier.name}</h3>
                                <span>{group.rows.length} cards</span>
                              </div>

                              {group.rows.length === 0 ? (
                                <div className="container-maker-empty small">
                                  No cards assigned to this pack tier yet.
                                </div>
                              ) : (
                                group.rows.map((row) => {
                                  const rowIndex = packCards.indexOf(row);
                                  return (
                                    <div
                                      key={`${row.id || row.card_id}-${rowIndex}`}
                                      className={`container-maker-card-row pack-maker-interactive-row ${
                                        previewState?.source === "pack" &&
                                        previewState?.key === buildPackCardPreviewKey(row)
                                          ? "is-preview-selected"
                                          : ""
                                      }`}
                                      onClick={() => handlePreviewPackCard(row)}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                          event.preventDefault();
                                          handlePreviewPackCard(row);
                                        }
                                      }}
                                      role="button"
                                      tabIndex={0}
                                    >
                                      <div>
                                        <div className="container-maker-row-name">
                                          {row.card_name || `Card ${row.card_id}`}
                                        </div>
                                        <div className="container-maker-row-meta">
                                          Card ID: {row.card_id} | Rarity: {row.rarity_name || "Base"}
                                        </div>
                                      </div>

                                      <div className="container-maker-card-row-actions">
                                        <select
                                          className="container-maker-select small"
                                          value={row.pack_pool_tier_id}
                                          onChange={(event) =>
                                            handleChangeCardTier(rowIndex, event.target.value)
                                          }
                                          disabled={saving}
                                        >
                                          {packPoolTiers.map((tier) => (
                                            <option key={tier.id} value={tier.id}>
                                              {tier.name}
                                            </option>
                                          ))}
                                        </select>

                                        <select
                                          className="container-maker-select small"
                                          value={row.rarity_id || ""}
                                          onChange={(event) =>
                                            handleChangeCardRarity(rowIndex, event.target.value)
                                          }
                                          disabled={saving}
                                        >
                                          {cardRarities.map((rarity) => (
                                            <option key={rarity.id} value={rarity.id}>
                                              {rarity.name}
                                            </option>
                                          ))}
                                        </select>

                                        <input
                                          type="number"
                                          min="1"
                                          className="container-maker-input container-maker-weight-input"
                                          value={row.weight || 1}
                                          title="Weight"
                                          placeholder="Weight"
                                          onChange={(event) =>
                                            handleChangeCardWeight(rowIndex, event.target.value)
                                          }
                                          disabled={saving}
                                        />

                                        <label className="container-maker-inline-checkbox">
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
                                  );
                                })
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <aside className="pack-maker-preview-column">
                      <div className="pack-maker-preview-card">
                        <div className="pack-maker-preview-header">
                          <h3>Card Preview</h3>
                          {previewCard?.rarity_name ? (
                            <span>{previewCard.rarity_name}</span>
                          ) : previewCard?.pack_pool_tier_name ? (
                            <span>{previewCard.pack_pool_tier_name}</span>
                          ) : null}
                        </div>

                        {previewCard ? (
                          <>
                            <div className="pack-maker-preview-image-shell">
                              {buildCardImageUrl(previewCard) ? (
                                <img
                                  src={buildCardImageUrl(previewCard)}
                                  alt={
                                    previewCard.card_name ||
                                    previewCard.name ||
                                    "Selected card preview"
                                  }
                                  className="pack-maker-preview-image"
                                />
                              ) : (
                                <div className="pack-maker-preview-empty">
                                  No card art found for this card yet.
                                </div>
                              )}
                            </div>

                            <div className="pack-maker-preview-meta">
                              <strong>
                                {previewCard.card_name ||
                                  previewCard.name ||
                                  `Card ${previewCard.card_id || previewCard.id}`}
                              </strong>
                              <span>
                                Card ID: {previewCard.card_id || previewCard.id}
                              </span>
                              {previewCard.pack_pool_tier_name ? (
                                <span>Pack Tier: {previewCard.pack_pool_tier_name}</span>
                              ) : null}
                              {previewCard.rarity_name ? (
                                <span>Curated Rarity: {previewCard.rarity_name}</span>
                              ) : null}
                            </div>
                          </>
                        ) : (
                          <div className="pack-maker-preview-empty">
                            Select a searched card or an assigned pack card to preview
                            it here.
                          </div>
                        )}
                      </div>
                    </aside>
                  </div>
                </section>
              </div>
            </div>

            {packPickerOpen ? (
              <div
                className="pack-maker-picker-backdrop"
                onClick={() => setPackPickerOpen(false)}
              >
                <div
                  className="container-maker-card pack-maker-picker-modal"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="container-maker-section-header">
                    <h2>Packs</h2>
                    <button
                      type="button"
                      className="container-maker-secondary-btn"
                      onClick={() => setPackPickerOpen(false)}
                    >
                      Close
                    </button>
                  </div>

                  <p className="pack-maker-picker-copy">
                    Load an existing pack into the editor. Internal Set values only
                    exist here to group large libraries for faster admin navigation.
                  </p>

                  <input
                    className="container-maker-input"
                    value={packPickerSearch}
                    onChange={(event) => setPackPickerSearch(event.target.value)}
                    placeholder="Search packs, codes, or internal sets..."
                    autoFocus
                  />

                  <div className="pack-maker-picker-groups">
                    {groupedPackProducts.length === 0 ? (
                      <div className="container-maker-empty">
                        No packs matched that search.
                      </div>
                    ) : (
                      groupedPackProducts.map((group) => (
                        <div key={group.setLabel} className="pack-maker-picker-group">
                          <div className="pack-maker-picker-group-header">
                            <h3>{group.setLabel}</h3>
                            <span>{group.products.length} packs</span>
                          </div>

                          <div className="pack-maker-picker-list">
                            {group.products.map((product) => (
                              <button
                                key={product.pack_group_code}
                                type="button"
                                className={`container-maker-container-row ${
                                  selectedPackGroupCode === product.pack_group_code
                                    ? "is-selected"
                                    : ""
                                }`}
                                onClick={() =>
                                  handleLoadPackFromPicker(product.pack_group_code)
                                }
                              >
                                <div>
                                  <div className="container-maker-container-row-name">
                                    {product.name}
                                  </div>
                                  <div className="container-maker-container-row-meta">
                                    {product.code}
                                    {product.is_locked ? " • Locked" : ""}
                                    {!product.is_enabled ? " • Disabled" : ""}
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
            <div className="container-maker-card pack-maker-slot-card">
              <div className="container-maker-section-header">
                <h2>Pack Slot Tier Rules</h2>
              </div>

              <p className="pack-maker-slot-copy">
                These 9 slots are the first RNG. Pick which tier pools each slot can
                pull from and set the percent chances so every slot totals exactly
                100%. Pack rarity is curated per card entry below instead of using
                the weighted global rarity roller.
              </p>

              {invalidSlotIndexes.length > 0 ? (
                <div className="container-maker-error">
                  Every slot must total exactly 100%. Fix slot
                  {invalidSlotIndexes.length === 1 ? "" : "s"}{" "}
                  {invalidSlotIndexes.join(", ")} before saving.
                </div>
              ) : (
                <div className="container-maker-success">
                  All 9 slots total 100% and are ready to save.
                </div>
              )}

              <div className="pack-maker-slot-grid">
                {Array.from({ length: PACK_SLOT_COUNT }, (_, index) => index + 1).map(
                  (slotIndex) => (
                    <div key={slotIndex} className="pack-maker-slot-panel">
                      <div className="pack-maker-slot-panel-header">
                        <div>
                          <h3>Slot {slotIndex}</h3>
                          <span>
                            {slotIndex <= 8
                              ? "Common lane by default"
                              : "Rare lane by default"}
                          </span>
                        </div>

                        <div className="pack-maker-slot-panel-tools">
                          <div
                            className={`pack-maker-slot-total ${
                              isSlotTierTotalValid(slotTotals.get(slotIndex))
                                ? "is-valid"
                                : "is-invalid"
                            }`}
                          >
                            {slotTotals.get(slotIndex)?.toFixed(2)}%
                          </div>

                          <button
                            type="button"
                            className="container-maker-secondary-btn pack-maker-normalize-btn"
                            onClick={() => handleNormalizeSlot(slotIndex)}
                            disabled={saving}
                          >
                            Normalize
                          </button>
                        </div>
                      </div>

                      <div className="pack-maker-slot-tier-list">
                        {slotTierRows
                          .filter((row) => row.slot_index === slotIndex)
                          .map((row) => (
                            <div
                              key={`${slotIndex}-${row.pack_pool_tier_id}`}
                              className="pack-maker-slot-tier-row"
                            >
                              <label className="container-maker-inline-checkbox">
                                <input
                                  type="checkbox"
                                  checked={Boolean(row.is_enabled)}
                                  onChange={(event) =>
                                    handleSlotTierChange(slotIndex, row.pack_pool_tier_id, {
                                      is_enabled: event.target.checked,
                                    })
                                  }
                                  disabled={saving}
                                />
                                <span>{row.pack_pool_tier_name}</span>
                              </label>

                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="container-maker-input pack-maker-slot-weight-input"
                                value={row.weight}
                                title="Percent chance"
                                placeholder="%"
                                aria-label={`${row.pack_pool_tier_name} percent chance for slot ${slotIndex}`}
                                onChange={(event) =>
                                  handleSlotTierChange(slotIndex, row.pack_pool_tier_id, {
                                    weight: Number(event.target.value || 0),
                                  })
                                }
                                disabled={saving}
                              />
                            </div>
                          ))}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>

            <div className="container-maker-card container-maker-cards-card">
              <div className="container-maker-section-header">
                <h2>Pack Tier Card Pools</h2>
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
                    disabled={saving || massImportBusy || !selectedPoolTierId}
                  >
                    {massImportBusy ? "Adding Cards..." : "Mass Add Cards"}
                  </button>
                </div>
              </div>

              <div className="container-maker-card-search-controls pack-maker-search-controls">
                <input
                  className="container-maker-input"
                  value={cardSearch}
                  onChange={(event) => setCardSearch(event.target.value)}
                  placeholder="Search cards..."
                  disabled={saving}
                />

                <select
                  className="container-maker-select"
                  value={selectedPoolTierId}
                  onChange={(event) => setSelectedPoolTierId(event.target.value)}
                  disabled={saving}
                >
                  {packPoolTiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name}
                    </option>
                  ))}
                </select>

                <select
                  className="container-maker-select"
                  value={selectedRarityId}
                  onChange={(event) => setSelectedRarityId(event.target.value)}
                  disabled={saving}
                >
                  {cardRarities.map((rarity) => (
                    <option key={rarity.id} value={rarity.id}>
                      {rarity.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="container-maker-search-results">
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
                    <div className="container-maker-search-row" key={card.id}>
                      <div>
                        <div className="container-maker-row-name">{card.name}</div>
                        <div className="container-maker-row-meta">Card ID: {card.id}</div>
                      </div>

                      <button
                        type="button"
                        className="container-maker-primary-btn small"
                        onClick={() => handleAddCard(card)}
                        disabled={saving || !selectedPoolTierId}
                      >
                        Add
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="pack-maker-tier-groups">
                {groupedPackCards.every((group) => group.rows.length === 0) ? (
                  <div className="container-maker-empty">
                    No cards have been assigned to any pack tier yet.
                  </div>
                ) : (
                  groupedPackCards.map((group) => (
                    <div key={group.tier.id} className="container-maker-slot-group">
                      <div className="container-maker-slot-header">
                        <h3>{group.tier.name}</h3>
                        <span>{group.rows.length} cards</span>
                      </div>

                      {group.rows.length === 0 ? (
                        <div className="container-maker-empty small">
                          No cards assigned to this pack tier yet.
                        </div>
                      ) : (
                        group.rows.map((row) => {
                          const rowIndex = packCards.indexOf(row);
                          return (
                            <div
                              key={`${row.id || row.card_id}-${rowIndex}`}
                              className="container-maker-card-row"
                            >
                              <div>
                                <div className="container-maker-row-name">
                                  {row.card_name || `Card ${row.card_id}`}
                                </div>
                                <div className="container-maker-row-meta">
                                  Card ID: {row.card_id} | Rarity: {row.rarity_name || "Base"}
                                </div>
                              </div>

                              <div className="container-maker-card-row-actions">
                                <select
                                  className="container-maker-select small"
                                  value={row.pack_pool_tier_id}
                                  onChange={(event) =>
                                    handleChangeCardTier(rowIndex, event.target.value)
                                  }
                                  disabled={saving}
                                >
                                  {packPoolTiers.map((tier) => (
                                    <option key={tier.id} value={tier.id}>
                                      {tier.name}
                                    </option>
                                  ))}
                                </select>

                                <select
                                  className="container-maker-select small"
                                  value={row.rarity_id || ""}
                                  onChange={(event) =>
                                    handleChangeCardRarity(rowIndex, event.target.value)
                                  }
                                  disabled={saving}
                                >
                                  {cardRarities.map((rarity) => (
                                    <option key={rarity.id} value={rarity.id}>
                                      {rarity.name}
                                    </option>
                                  ))}
                                </select>

                                <input
                                  type="number"
                                  min="1"
                                  className="container-maker-input container-maker-weight-input"
                                  value={row.weight || 1}
                                  title="Weight"
                                  placeholder="Weight"
                                  onChange={(event) =>
                                    handleChangeCardWeight(rowIndex, event.target.value)
                                  }
                                  disabled={saving}
                                />

                                <label className="container-maker-inline-checkbox">
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
                                  onClick={() => handleRemoveCard(rowIndex)}
                                  disabled={saving}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {selectedProduct ? (
              <div className="container-maker-card pack-maker-variant-card">
                <div className="container-maker-section-header">
                  <h2>Published Variants</h2>
                </div>

                <div className="pack-maker-variant-grid">
                  <div className="pack-maker-variant-row">
                    <span>Full Pack Container</span>
                    <strong>{selectedProduct.full_container_id || "Pending"}</strong>
                  </div>
                  <div className="pack-maker-variant-row">
                    <span>Draft Pack Container</span>
                    <strong>{selectedProduct.draft_container_id || "Pending"}</strong>
                  </div>
                  <div className="pack-maker-variant-row">
                    <span>Pack Group Code</span>
                    <strong>{selectedProduct.pack_group_code}</strong>
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

export default PackMakerPage;

