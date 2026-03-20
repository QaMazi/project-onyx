import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";
import {
  formatStoreCategoryName,
  normalizeStoreCategoryCode,
} from "../../lib/storeCatalog";

import "./InventoryPage.css";

const CARD_IMAGE_FALLBACK =
  "https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/fallback_image.jpg";

function buildCardImageUrl(card) {
  if (card?.image_url) return card.image_url;
  if (card?.card_id) {
    return `https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/${card.card_id}.jpg`;
  }
  return CARD_IMAGE_FALLBACK;
}

function getTargetsFromPreview(preview) {
  if (!preview) return [];
  if (Array.isArray(preview.resolved_targets) && preview.resolved_targets.length > 0) {
    return preview.resolved_targets;
  }
  if (Array.isArray(preview.eligible_targets)) {
    return preview.eligible_targets;
  }
  return [];
}

function getUseButtonLabel(item) {
  return item.behavior_code === "open_container" ? "Open" : "Use";
}

function getSingleTargetMode(effectKey) {
  if (effectKey.includes("hex") || effectKey.includes("curse")) return "curse";
  if (effectKey.includes("thief")) return "steal";
  if (effectKey.includes("extract")) return "extract";
  return "unknown";
}

function getMultiTargetMode(effectKey) {
  return getSingleTargetMode(effectKey);
}

function getSelectionCount(selectionMap) {
  return Object.values(selectionMap || {}).reduce(
    (sum, entry) => sum + Number(entry?.count || 0),
    0
  );
}

function expandSelectionTiers(selectionMap) {
  return Object.values(selectionMap || {})
    .flatMap((entry) =>
      Array.from({ length: Number(entry?.count || 0) }, () =>
        Number(entry?.rarity_sort_order ?? 9999)
      )
    )
    .sort((left, right) => left - right);
}

function selectionMapToPayload(selectionMap) {
  return Object.values(selectionMap || {})
    .filter((entry) => Number(entry?.count || 0) > 0)
    .map((entry) => ({
      binder_card_id: entry.binder_card_id,
      quantity: Number(entry.count),
    }));
}

function InventoryPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");

  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [shards, setShards] = useState(0);
  const [featureCoins, setFeatureCoins] = useState(0);
  const [inventoryItems, setInventoryItems] = useState([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedPreview, setSelectedPreview] = useState(null);
  const [modalError, setModalError] = useState("");

  const [cardSearch, setCardSearch] = useState("");
  const [cardSearchResults, setCardSearchResults] = useState([]);
  const [cardSearchLoading, setCardSearchLoading] = useState(false);
  const [selectedBanlistCardId, setSelectedBanlistCardId] = useState(null);

  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [targetOptionsByUser, setTargetOptionsByUser] = useState({});
  const [targetLoadingByUser, setTargetLoadingByUser] = useState({});
  const [actorCardOptions, setActorCardOptions] = useState([]);
  const [actorOptionsLoading, setActorOptionsLoading] = useState(false);

  const [selectedFamilyCardIds, setSelectedFamilyCardIds] = useState([]);
  const [selectedBinderCardId, setSelectedBinderCardId] = useState("");
  const [multiTargetSelections, setMultiTargetSelections] = useState({});
  const [takeSelectionMap, setTakeSelectionMap] = useState({});
  const [giveSelectionMap, setGiveSelectionMap] = useState({});

  async function loadInventory(currentUser) {
    if (!currentUser?.id) return;

    setLoading(true);
    setError("");

    try {
      const { data: currentSeries, error: currentSeriesError } = await supabase
        .from("game_series")
        .select("id")
        .eq("is_current", true)
        .maybeSingle();

      if (currentSeriesError) throw currentSeriesError;
      if (!currentSeries?.id) throw new Error("No active series found.");

      setActiveSeriesId(currentSeries.id);

      const [walletResponse, inventoryResponse] = await Promise.all([
        supabase
          .from("player_wallets")
          .select("shards, feature_coins")
          .eq("user_id", currentUser.id)
          .eq("series_id", currentSeries.id)
          .maybeSingle(),
        supabase
          .from("player_inventory_view")
          .select("*")
          .eq("user_id", currentUser.id)
          .eq("series_id", currentSeries.id)
          .order("category_name", { ascending: true })
          .order("item_name", { ascending: true }),
      ]);

      if (walletResponse.error) throw walletResponse.error;
      if (inventoryResponse.error) throw inventoryResponse.error;

      setShards(Number(walletResponse.data?.shards || 0));
      setFeatureCoins(Number(walletResponse.data?.feature_coins || 0));
      setInventoryItems(inventoryResponse.data || []);
    } catch (err) {
      console.error("Inventory load failed:", err);
      setError(err.message || "Failed to load inventory.");
      setInventoryItems([]);
      setShards(0);
      setFeatureCoins(0);
      setActiveSeriesId(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && user) {
      loadInventory(user);
    }
  }, [authLoading, user]);

  const categoryOptions = useMemo(() => {
    const seen = new Map();

    for (const item of inventoryItems) {
      const code = normalizeStoreCategoryCode(item.category_code);
      if (!seen.has(code)) {
        seen.set(code, {
          code,
          label: formatStoreCategoryName(code, item.category_name),
        });
      }
    }

    return Array.from(seen.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    );
  }, [inventoryItems]);

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return inventoryItems.filter((item) => {
      const normalizedCategoryCode = normalizeStoreCategoryCode(item.category_code);
      const matchesCategory =
        selectedCategory === "all" || normalizedCategoryCode === selectedCategory;

      if (!matchesCategory) return false;
      if (!query) return true;

      return (
        String(item.item_name || "").toLowerCase().includes(query) ||
        String(item.description || "").toLowerCase().includes(query) ||
        String(item.item_code || "").toLowerCase().includes(query) ||
        String(item.category_name || "").toLowerCase().includes(query)
      );
    });
  }, [inventoryItems, searchTerm, selectedCategory]);

  const groupedItems = useMemo(() => {
    const map = new Map();

    for (const item of filteredItems) {
      const code = normalizeStoreCategoryCode(item.category_code);

      if (!map.has(code)) {
        map.set(code, {
          code,
          label: formatStoreCategoryName(code, item.category_name),
          items: [],
        });
      }

      map.get(code).items.push(item);
    }

    return Array.from(map.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    );
  }, [filteredItems]);

  const totalOwnedItems = useMemo(
    () => inventoryItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    [inventoryItems]
  );

  const modalTargets = useMemo(() => getTargetsFromPreview(selectedPreview), [selectedPreview]);
  const singleTargetMode = useMemo(
    () => getSingleTargetMode(selectedPreview?.effect_key || ""),
    [selectedPreview]
  );
  const multiTargetMode = useMemo(
    () => getMultiTargetMode(selectedPreview?.effect_key || ""),
    [selectedPreview]
  );
  const targetOptions = useMemo(
    () => targetOptionsByUser[selectedTargetId] || [],
    [targetOptionsByUser, selectedTargetId]
  );
  const takeSelectionCount = useMemo(
    () => getSelectionCount(takeSelectionMap),
    [takeSelectionMap]
  );
  const giveSelectionCount = useMemo(
    () => getSelectionCount(giveSelectionMap),
    [giveSelectionMap]
  );
  const forcedExchangeRuleOk = useMemo(() => {
    if (takeSelectionCount !== 2 || giveSelectionCount !== 2) return false;

    const takenTiers = expandSelectionTiers(takeSelectionMap);
    const givenTiers = expandSelectionTiers(giveSelectionMap);

    if (takenTiers.length !== 2 || givenTiers.length !== 2) return false;

    return givenTiers.every((tier, index) => tier >= takenTiers[index]);
  }, [takeSelectionCount, giveSelectionCount, takeSelectionMap, giveSelectionMap]);

  function resetModalState(item) {
    setSelectedItem(item);
    setSelectedPreview(null);
    setModalError("");
    setCardSearch("");
    setCardSearchResults([]);
    setSelectedBanlistCardId(null);
    setSelectedTargetId("");
    setTargetOptionsByUser({});
    setTargetLoadingByUser({});
    setActorCardOptions([]);
    setActorOptionsLoading(false);
    setSelectedFamilyCardIds([]);
    setSelectedBinderCardId("");
    setMultiTargetSelections({});
    setTakeSelectionMap({});
    setGiveSelectionMap({});
  }

  async function loadTargetCardOptions(inventoryId, targetUserId) {
    if (!inventoryId || !targetUserId) return;

    setTargetLoadingByUser((current) => ({ ...current, [targetUserId]: true }));

    try {
      const { data, error: optionsError } = await supabase.rpc(
        "get_inventory_item_card_options",
        {
          p_inventory_id: inventoryId,
          p_target_user_id: targetUserId,
        }
      );

      if (optionsError) throw optionsError;

      setTargetOptionsByUser((current) => ({
        ...current,
        [targetUserId]: data || [],
      }));
    } catch (optionsError) {
      console.error("Failed to load target card options:", optionsError);
      setModalError(optionsError.message || "Failed to load target card options.");
    } finally {
      setTargetLoadingByUser((current) => ({ ...current, [targetUserId]: false }));
    }
  }

  async function loadActorCardOptions(inventoryId) {
    if (!inventoryId) return;

    setActorOptionsLoading(true);

    try {
      const { data, error: optionsError } = await supabase.rpc(
        "get_inventory_item_card_options",
        {
          p_inventory_id: inventoryId,
        }
      );

      if (optionsError) throw optionsError;
      setActorCardOptions(data || []);
    } catch (optionsError) {
      console.error("Failed to load your card options:", optionsError);
      setModalError(optionsError.message || "Failed to load your card options.");
    } finally {
      setActorOptionsLoading(false);
    }
  }

  async function openItemModal(item) {
    resetModalState(item);

    try {
      const { data, error: previewError } = await supabase.rpc(
        "get_inventory_item_use_preview",
        {
          p_inventory_id: item.id,
        }
      );

      if (previewError) throw previewError;

      const nextPreview = data || null;
      setSelectedPreview(nextPreview);

      const nextTargets = getTargetsFromPreview(nextPreview);

      if (nextPreview?.action_kind === "opponent_card_picker" && nextTargets.length === 1) {
        setSelectedTargetId(nextTargets[0].user_id);
        await loadTargetCardOptions(item.id, nextTargets[0].user_id);
      }

      if (nextPreview?.action_kind === "multi_target_card_picker") {
        for (const target of nextTargets) {
          if (target?.user_id) {
            await loadTargetCardOptions(item.id, target.user_id);
          }
        }
      }

      if (nextPreview?.action_kind === "forced_exchange") {
        await loadActorCardOptions(item.id);

        if (nextTargets.length === 1) {
          setSelectedTargetId(nextTargets[0].user_id);
          await loadTargetCardOptions(item.id, nextTargets[0].user_id);
        }
      }
    } catch (previewError) {
      console.error("Failed to load item preview:", previewError);
      setSelectedPreview({
        action_kind: "unsupported",
        can_use: false,
        block_reason: previewError.message || "Failed to load item use preview.",
      });
    }
  }

  useEffect(() => {
    let ignore = false;

    async function searchCards() {
      if (!selectedPreview || !activeSeriesId) return;
      if (!["banlist_search", "black_market_pick"].includes(selectedPreview.action_kind)) {
        return;
      }

      setCardSearchLoading(true);

      try {
        const { data, error: searchError } = await supabase.rpc(
          "search_series_card_catalog",
          {
            p_series_id: activeSeriesId,
            p_search: cardSearch.trim() || null,
            p_only_banlisted: selectedPreview.action_kind === "black_market_pick",
            p_limit: 40,
          }
        );

        if (searchError) throw searchError;
        if (!ignore) {
          setCardSearchResults(data || []);
        }
      } catch (searchError) {
        console.error("Failed to search cards:", searchError);
        if (!ignore) {
          setModalError(searchError.message || "Failed to search cards.");
          setCardSearchResults([]);
        }
      } finally {
        if (!ignore) {
          setCardSearchLoading(false);
        }
      }
    }

    searchCards();

    return () => {
      ignore = true;
    };
  }, [activeSeriesId, cardSearch, selectedPreview]);

  useEffect(() => {
    if (
      (selectedPreview?.action_kind === "opponent_card_picker" ||
        selectedPreview?.action_kind === "forced_exchange") &&
      selectedTargetId &&
      !targetOptionsByUser[selectedTargetId] &&
      selectedItem?.id
    ) {
      loadTargetCardOptions(selectedItem.id, selectedTargetId);
    }
  }, [selectedPreview, selectedTargetId, targetOptionsByUser, selectedItem]);

  function closeModal() {
    setSelectedItem(null);
    setSelectedPreview(null);
    setModalError("");
    setCardSearch("");
    setCardSearchResults([]);
    setSelectedBanlistCardId(null);
    setSelectedTargetId("");
    setTargetOptionsByUser({});
    setTargetLoadingByUser({});
    setActorCardOptions([]);
    setActorOptionsLoading(false);
    setSelectedFamilyCardIds([]);
    setSelectedBinderCardId("");
    setMultiTargetSelections({});
    setTakeSelectionMap({});
    setGiveSelectionMap({});
  }

  function toggleFamilyCardSelection(cardId, maxCount = 1) {
    setSelectedFamilyCardIds((current) => {
      if (current.includes(cardId)) {
        return current.filter((value) => value !== cardId);
      }

      if (current.length >= maxCount) {
        return maxCount <= 1 ? [cardId] : [...current.slice(-(maxCount - 1)), cardId];
      }

      return [...current, cardId];
    });
  }

  function setMultiTargetSelection(targetUserId, payload) {
    setMultiTargetSelections((current) => ({
      ...current,
      [targetUserId]: payload,
    }));
  }

  function updateCounterSelection(setter, option, rarity, delta, maxTotal) {
    setter((current) => {
      const next = { ...current };
      const key = rarity.binder_card_id;
      const currentCount = Number(next[key]?.count || 0);
      const nextCount = Math.max(
        0,
        Math.min(currentCount + delta, Number(rarity.quantity || 0))
      );
      const nextTotal = getSelectionCount(next) - currentCount + nextCount;

      if (delta > 0 && nextTotal > maxTotal) {
        return current;
      }

      if (nextCount <= 0) {
        delete next[key];
        return next;
      }

      next[key] = {
        binder_card_id: rarity.binder_card_id,
        count: nextCount,
        card_id: option.card_id,
        card_name: option.card_name,
        rarity_name: rarity.rarity_name,
        rarity_sort_order: Number(rarity.rarity_sort_order ?? 9999),
      };

      return next;
    });
  }

  function getFlowCopy(preview) {
    if (!preview) return "";

    if (preview.action_kind === "open_in_opener") {
      return "This opener is consumed from the Container Opener page.";
    }

    if (preview.effect_key === "deck_case") {
      return `Consume this item to grant +1 permanent saved deck slot. Current extra slots: ${Number(
        preview.extra_saved_deck_slots || 0
      )}.`;
    }

    if (preview.effect_key === "card_vault") {
      return `Consume this item to unlock or expand your Card Vault by 5 slots. Current vault slots: ${Number(
        preview.card_vault_slots || 0
      )}.`;
    }

    if (preview.effect_key === "protection") {
      return `Consume this item to extend your protection. Protection remaining: ${Number(
        preview.protection_rounds_remaining || 0
      )} round(s).`;
    }

    if (preview.effect_key === "random_container_key") {
      return "Consume this item to receive one random unlocked key of the matching type directly into your inventory.";
    }

    if (preview.effect_key === "chaos_verdict") {
      return "Chaos Verdict will hit every eligible opponent, roll one random round-snapshot deck card from each, and assign a fresh banlist state to each result.";
    }

    if (preview.action_kind === "banlist_search") {
      return "Search the full card pool, choose exactly one card, and apply this item's banlist state immediately.";
    }

    if (preview.action_kind === "black_market_pick") {
      return "Choose a currently banlisted card to add at base rarity. Black Market Card also clears the chosen banlist entry.";
    }

    if (preview.action_kind === "opponent_card_picker") {
      return "Choose an eligible opponent, inspect the allowed cards from their visible binder, and confirm the exact target this item should affect.";
    }

    if (preview.action_kind === "multi_target_card_picker") {
      return "Pick exactly one valid selection for every eligible opponent before consuming the item.";
    }

    if (preview.action_kind === "forced_exchange") {
      return "Select the two cards you are taking first, then choose the two cards you are giving. Your offered rarities cannot be lower than the rarities you are taking.";
    }

    return preview.block_reason || "This item still needs its dedicated modal flow.";
  }

  async function submitItemFlow() {
    if (!selectedItem || !selectedPreview) return;

    if (selectedPreview.action_kind === "open_in_opener") {
      closeModal();
      navigate("/mode/progression/opener");
      return;
    }

    try {
      setActionBusy(true);
      setModalError("");

      if (selectedPreview.action_kind === "self_confirm") {
        const { error: useError } = await supabase.rpc("use_inventory_item_self", {
          p_inventory_id: selectedItem.id,
        });

        if (useError) throw useError;
      } else if (selectedPreview.action_kind === "hostile_confirm") {
        const { error: useError } = await supabase.rpc(
          "use_inventory_item_with_payload",
          {
            p_inventory_id: selectedItem.id,
            p_payload: {},
          }
        );

        if (useError) throw useError;
      } else if (
        selectedPreview.action_kind === "banlist_search" ||
        selectedPreview.action_kind === "black_market_pick"
      ) {
        if (!selectedBanlistCardId) {
          throw new Error("Choose a card first.");
        }

        const { error: useError } = await supabase.rpc(
          "use_inventory_item_with_payload",
          {
            p_inventory_id: selectedItem.id,
            p_payload: {
              card_id: selectedBanlistCardId,
            },
          }
        );

        if (useError) throw useError;
      } else if (selectedPreview.action_kind === "opponent_card_picker") {
        if (!selectedTargetId) {
          throw new Error("Choose an opponent first.");
        }

        if (singleTargetMode === "curse") {
          if (selectedFamilyCardIds.length !== 3) {
            throw new Error("Choose exactly 3 different card names.");
          }
        } else if (singleTargetMode === "extract") {
          if (selectedFamilyCardIds.length !== 1) {
            throw new Error("Choose exactly 1 card name to extract.");
          }
        } else if (singleTargetMode === "steal" && !selectedBinderCardId) {
          throw new Error("Choose a specific rarity row to steal.");
        }

        const payload =
          singleTargetMode === "steal"
            ? {
                target_user_id: selectedTargetId,
                binder_card_id: selectedBinderCardId,
              }
            : singleTargetMode === "extract"
            ? {
                target_user_id: selectedTargetId,
                card_id: selectedFamilyCardIds[0],
              }
            : {
                target_user_id: selectedTargetId,
                card_ids: selectedFamilyCardIds.map((cardId) => ({ card_id: cardId })),
              };

        const { error: useError } = await supabase.rpc(
          "use_inventory_item_with_payload",
          {
            p_inventory_id: selectedItem.id,
            p_payload: payload,
          }
        );

        if (useError) throw useError;
      } else if (selectedPreview.action_kind === "multi_target_card_picker") {
        if (modalTargets.some((target) => !multiTargetSelections[target.user_id])) {
          throw new Error("Make a selection for every opponent first.");
        }

        const payloadTargets =
          multiTargetMode === "steal"
            ? modalTargets.map((target) => ({
                target_user_id: target.user_id,
                binder_card_id: multiTargetSelections[target.user_id].binder_card_id,
              }))
            : modalTargets.map((target) => ({
                target_user_id: target.user_id,
                card_id: multiTargetSelections[target.user_id].card_id,
              }));

        const { error: useError } = await supabase.rpc(
          "use_inventory_item_with_payload",
          {
            p_inventory_id: selectedItem.id,
            p_payload: {
              targets: payloadTargets,
            },
          }
        );

        if (useError) throw useError;
      } else if (selectedPreview.action_kind === "forced_exchange") {
        if (!selectedTargetId) {
          throw new Error("Choose an opponent first.");
        }

        if (takeSelectionCount !== 2 || giveSelectionCount !== 2) {
          throw new Error("Choose exactly 2 cards to take and 2 cards to give.");
        }

        if (!forcedExchangeRuleOk) {
          throw new Error(
            "Your offered rarities cannot be lower than the rarities you are taking."
          );
        }

        const { error: useError } = await supabase.rpc(
          "use_inventory_item_with_payload",
          {
            p_inventory_id: selectedItem.id,
            p_payload: {
              target_user_id: selectedTargetId,
              take_selections: selectionMapToPayload(takeSelectionMap),
              give_selections: selectionMapToPayload(giveSelectionMap),
            },
          }
        );

        if (useError) throw useError;
      }

      closeModal();
      await loadInventory(user);
    } catch (useError) {
      console.error("Failed to use inventory item:", useError);
      setModalError(useError.message || "Failed to use inventory item.");
    } finally {
      setActionBusy(false);
    }
  }

  useEffect(() => {
    setSelectedFamilyCardIds([]);
    setSelectedBinderCardId("");
    setTakeSelectionMap({});
  }, [selectedTargetId]);

  function renderSearchCards() {
    return (
      <div className="inventory-flow-stack">
        <input
          type="text"
          className="inventory-search"
          value={cardSearch}
          onChange={(event) => setCardSearch(event.target.value)}
          placeholder="Search cards..."
        />

        <div className="inventory-choice-list">
          {cardSearchLoading ? (
            <div className="inventory-empty">Searching cards...</div>
          ) : cardSearchResults.length === 0 ? (
            <div className="inventory-empty">No matching cards found.</div>
          ) : (
            cardSearchResults.map((card) => (
              <button
                type="button"
                key={card.card_id}
                className={`inventory-choice-card ${
                  selectedBanlistCardId === card.card_id ? "is-selected" : ""
                }`}
                onClick={() => setSelectedBanlistCardId(card.card_id)}
              >
                <img
                  src={buildCardImageUrl(card)}
                  alt={card.card_name}
                  className="inventory-choice-card-image"
                  onError={(event) => {
                    event.currentTarget.src = CARD_IMAGE_FALLBACK;
                  }}
                />

                <div className="inventory-choice-card-copy">
                  <strong>{card.card_name}</strong>
                  <span>
                    Status: {String(card.status || "unlimited").replace(/_/g, " ")}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  function renderTargetSelector() {
    if (modalTargets.length <= 1) {
      const onlyTarget = modalTargets[0];
      return onlyTarget ? (
        <div className="inventory-chip-row">
          <div className="inventory-target-chip">
            Target: {onlyTarget.username || "Opponent"}
          </div>
        </div>
      ) : null;
    }

    return (
      <div className="inventory-flow-stack">
        <label className="inventory-field-label" htmlFor="inventory-target-select">
          Opponent
        </label>
        <select
          id="inventory-target-select"
          className="inventory-select"
          value={selectedTargetId}
          onChange={(event) => setSelectedTargetId(event.target.value)}
        >
          <option value="">Choose an opponent...</option>
          {modalTargets.map((target) => (
            <option key={target.user_id} value={target.user_id}>
              {target.username}
            </option>
          ))}
        </select>
      </div>
    );
  }

  function renderCardFamilyOptions(options, mode, targetUserId) {
    const isLoading = targetLoadingByUser[targetUserId];

    if (isLoading) {
      return <div className="inventory-empty">Loading target binder...</div>;
    }

    if (!options.length) {
      return <div className="inventory-empty">No valid cards are available for this item.</div>;
    }

    return (
      <div className="inventory-choice-list">
        {options.map((option) => (
          <div className="inventory-choice-card inventory-choice-card-static" key={option.card_id}>
            <img
              src={buildCardImageUrl(option)}
              alt={option.card_name}
              className="inventory-choice-card-image"
              onError={(event) => {
                event.currentTarget.src = CARD_IMAGE_FALLBACK;
              }}
            />

            <div className="inventory-choice-card-copy">
              <strong>{option.card_name}</strong>
              <span>
                Visible Copies: {Number(option.total_quantity || 0)}
                {Number(option.duel_locked_quantity || 0) > 0
                  ? ` | Duel Locked: ${Number(option.duel_locked_quantity || 0)}`
                  : ""}
              </span>
            </div>

            {mode === "steal" ? (
              <div className="inventory-rarity-pill-row">
                {(option.rarities || []).map((rarity) => (
                  <button
                    type="button"
                    key={rarity.binder_card_id}
                    className={`inventory-rarity-pill ${
                      selectedBinderCardId === rarity.binder_card_id ? "is-selected" : ""
                    }`}
                    onClick={() => setSelectedBinderCardId(rarity.binder_card_id)}
                  >
                    {rarity.rarity_name} x{Number(rarity.quantity || 0)}
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                className={`inventory-choice-inline-btn ${
                  selectedFamilyCardIds.includes(option.card_id) ? "is-selected" : ""
                }`}
                onClick={() =>
                  toggleFamilyCardSelection(option.card_id, mode === "curse" ? 3 : 1)
                }
              >
                {selectedFamilyCardIds.includes(option.card_id)
                  ? "Selected"
                  : mode === "curse"
                  ? "Choose Name"
                  : "Choose Family"}
              </button>
            )}
          </div>
        ))}
      </div>
    );
  }

  function renderMultiTargetOptions() {
    if (!modalTargets.length) {
      return <div className="inventory-empty">No eligible opponents are available.</div>;
    }

    return (
      <div className="inventory-flow-stack">
        {modalTargets.map((target) => {
          const targetOptions = targetOptionsByUser[target.user_id] || [];
          const selectedForTarget = multiTargetSelections[target.user_id] || null;
          const isLoading = targetLoadingByUser[target.user_id];

          return (
            <section className="inventory-target-section" key={target.user_id}>
              <div className="inventory-target-section-header">
                <h3>{target.username || "Opponent"}</h3>
              </div>

              {isLoading ? (
                <div className="inventory-empty">Loading choices...</div>
              ) : targetOptions.length === 0 ? (
                <div className="inventory-empty">No valid cards are available.</div>
              ) : (
                <div className="inventory-choice-list">
                  {targetOptions.map((option) => (
                    <div
                      className="inventory-choice-card inventory-choice-card-static"
                      key={`${target.user_id}-${option.card_id}`}
                    >
                      <img
                        src={buildCardImageUrl(option)}
                        alt={option.card_name}
                        className="inventory-choice-card-image"
                        onError={(event) => {
                          event.currentTarget.src = CARD_IMAGE_FALLBACK;
                        }}
                      />

                      <div className="inventory-choice-card-copy">
                        <strong>{option.card_name}</strong>
                        <span>Visible Copies: {Number(option.total_quantity || 0)}</span>
                      </div>

                      {multiTargetMode === "steal" ? (
                        <div className="inventory-rarity-pill-row">
                          {(option.rarities || []).map((rarity) => (
                            <button
                              type="button"
                              key={rarity.binder_card_id}
                              className={`inventory-rarity-pill ${
                                selectedForTarget?.binder_card_id === rarity.binder_card_id
                                  ? "is-selected"
                                  : ""
                              }`}
                              onClick={() =>
                                setMultiTargetSelection(target.user_id, {
                                  binder_card_id: rarity.binder_card_id,
                                })
                              }
                            >
                              {rarity.rarity_name} x{Number(rarity.quantity || 0)}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={`inventory-choice-inline-btn ${
                            selectedForTarget?.card_id === option.card_id ? "is-selected" : ""
                          }`}
                          onClick={() =>
                            setMultiTargetSelection(target.user_id, {
                              card_id: option.card_id,
                            })
                          }
                        >
                          {selectedForTarget?.card_id === option.card_id
                            ? "Selected"
                            : "Choose"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  function renderForcedExchangeOptions() {
    const isTargetLoading = targetLoadingByUser[selectedTargetId];

    return (
      <div className="inventory-flow-stack">
        {renderTargetSelector()}

        {selectedTargetId ? (
          <>
            <section className="inventory-target-section">
              <div className="inventory-target-section-header">
                <h3>
                  Step 1: Take 2 Cards
                  <span>{takeSelectionCount}/2</span>
                </h3>
              </div>

              {isTargetLoading ? (
                <div className="inventory-empty">Loading opponent binder...</div>
              ) : (
                <div className="inventory-choice-list">
                  {targetOptions.map((option) => (
                    <div
                      className="inventory-choice-card inventory-choice-card-static"
                      key={`take-${option.card_id}`}
                    >
                      <img
                        src={buildCardImageUrl(option)}
                        alt={option.card_name}
                        className="inventory-choice-card-image"
                        onError={(event) => {
                          event.currentTarget.src = CARD_IMAGE_FALLBACK;
                        }}
                      />

                      <div className="inventory-choice-card-copy">
                        <strong>{option.card_name}</strong>
                        <span>Visible Copies: {Number(option.total_quantity || 0)}</span>
                      </div>

                      <div className="inventory-rarity-counter-list">
                        {(option.rarities || []).map((rarity) => (
                          <div className="inventory-rarity-counter" key={rarity.binder_card_id}>
                            <span>
                              {rarity.rarity_name} x{Number(rarity.quantity || 0)}
                            </span>
                            <div className="inventory-counter-actions">
                              <button
                                type="button"
                                className="inventory-counter-btn"
                                onClick={() =>
                                  updateCounterSelection(
                                    setTakeSelectionMap,
                                    option,
                                    rarity,
                                    -1,
                                    2
                                  )
                                }
                              >
                                -
                              </button>
                              <strong>
                                {Number(
                                  takeSelectionMap[rarity.binder_card_id]?.count || 0
                                )}
                              </strong>
                              <button
                                type="button"
                                className="inventory-counter-btn"
                                onClick={() =>
                                  updateCounterSelection(
                                    setTakeSelectionMap,
                                    option,
                                    rarity,
                                    1,
                                    2
                                  )
                                }
                              >
                                +
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="inventory-target-section">
              <div className="inventory-target-section-header">
                <h3>
                  Step 2: Give 2 Cards
                  <span>{giveSelectionCount}/2</span>
                </h3>
              </div>

              {actorOptionsLoading ? (
                <div className="inventory-empty">Loading your binder...</div>
              ) : (
                <div className="inventory-choice-list">
                  {actorCardOptions.map((option) => (
                    <div
                      className="inventory-choice-card inventory-choice-card-static"
                      key={`give-${option.card_id}`}
                    >
                      <img
                        src={buildCardImageUrl(option)}
                        alt={option.card_name}
                        className="inventory-choice-card-image"
                        onError={(event) => {
                          event.currentTarget.src = CARD_IMAGE_FALLBACK;
                        }}
                      />

                      <div className="inventory-choice-card-copy">
                        <strong>{option.card_name}</strong>
                        <span>Visible Copies: {Number(option.total_quantity || 0)}</span>
                      </div>

                      <div className="inventory-rarity-counter-list">
                        {(option.rarities || []).map((rarity) => (
                          <div className="inventory-rarity-counter" key={rarity.binder_card_id}>
                            <span>
                              {rarity.rarity_name} x{Number(rarity.quantity || 0)}
                            </span>
                            <div className="inventory-counter-actions">
                              <button
                                type="button"
                                className="inventory-counter-btn"
                                onClick={() =>
                                  updateCounterSelection(
                                    setGiveSelectionMap,
                                    option,
                                    rarity,
                                    -1,
                                    2
                                  )
                                }
                              >
                                -
                              </button>
                              <strong>
                                {Number(
                                  giveSelectionMap[rarity.binder_card_id]?.count || 0
                                )}
                              </strong>
                              <button
                                type="button"
                                className="inventory-counter-btn"
                                onClick={() =>
                                  updateCounterSelection(
                                    setGiveSelectionMap,
                                    option,
                                    rarity,
                                    1,
                                    2
                                  )
                                }
                              >
                                +
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div
              className={`inventory-modal-warning ${
                forcedExchangeRuleOk ? "inventory-modal-warning-success" : ""
              }`}
            >
              {forcedExchangeRuleOk
                ? "Rarity rule satisfied. Your offered rarities are not lower than what you are taking."
                : "Your offered rarities cannot be lower than the rarities you are taking."}
            </div>
          </>
        ) : null}
      </div>
    );
  }

  function renderActionBody() {
    if (!selectedPreview) {
      return <div className="inventory-empty">Loading item flow...</div>;
    }

    if (
      selectedPreview.action_kind === "banlist_search" ||
      selectedPreview.action_kind === "black_market_pick"
    ) {
      return renderSearchCards();
    }

    if (selectedPreview.action_kind === "opponent_card_picker") {
      return (
        <div className="inventory-flow-stack">
          {renderTargetSelector()}
          {selectedTargetId
            ? renderCardFamilyOptions(targetOptions, singleTargetMode, selectedTargetId)
            : null}
        </div>
      );
    }

    if (selectedPreview.action_kind === "multi_target_card_picker") {
      return renderMultiTargetOptions();
    }

    if (selectedPreview.action_kind === "forced_exchange") {
      return renderForcedExchangeOptions();
    }

    return null;
  }

  const submitDisabled =
    actionBusy ||
    !selectedPreview?.can_use ||
    selectedPreview?.action_kind === "unsupported" ||
    ((selectedPreview?.action_kind === "banlist_search" ||
      selectedPreview?.action_kind === "black_market_pick") &&
      !selectedBanlistCardId) ||
    (selectedPreview?.action_kind === "opponent_card_picker" &&
      (!selectedTargetId ||
        (singleTargetMode === "curse" && selectedFamilyCardIds.length !== 3) ||
        (singleTargetMode === "steal" && !selectedBinderCardId) ||
        (singleTargetMode === "extract" && selectedFamilyCardIds.length !== 1))) ||
    (selectedPreview?.action_kind === "multi_target_card_picker" &&
      modalTargets.some((target) => !multiTargetSelections[target.user_id])) ||
    (selectedPreview?.action_kind === "forced_exchange" &&
      (!selectedTargetId ||
        takeSelectionCount !== 2 ||
        giveSelectionCount !== 2 ||
        !forcedExchangeRuleOk));

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (user.role === "Blocked") return <Navigate to="/" replace />;
  if (user.role !== "Admin+" && user.role !== "Admin" && user.role !== "Duelist") {
    return <Navigate to="/mode" replace />;
  }

  return (
    <LauncherLayout>
      <div className="inventory-page">
        <div className="inventory-topbar inventory-panel">
          <div>
            <div className="inventory-kicker">PROGRESSION</div>
            <h1 className="inventory-title">Inventory</h1>
            <p className="inventory-subtitle">
              Use consumables from dedicated modal flows, keep openers routed to the
              opener, and track both progression currencies from one view.
            </p>
          </div>

          <div className="inventory-topbar-right">
            <div className="inventory-shards-card">
              <span className="inventory-shards-label">Available Shards</span>
              <span className="inventory-shards-value">{shards}</span>
            </div>

            <div className="inventory-shards-card inventory-feature-coin-card">
              <span className="inventory-shards-label">Feature Coins</span>
              <span className="inventory-shards-value">{featureCoins}</span>
            </div>

            <button
              type="button"
              className="inventory-back-btn"
              onClick={() => navigate("/mode/progression")}
            >
              Back
            </button>
          </div>
        </div>

        <div className="inventory-summary-row">
          <div className="inventory-panel inventory-summary-card">
            <span className="inventory-summary-label">Total Item Types</span>
            <span className="inventory-summary-value">{inventoryItems.length}</span>
          </div>

          <div className="inventory-panel inventory-summary-card">
            <span className="inventory-summary-label">Total Items Owned</span>
            <span className="inventory-summary-value">{totalOwnedItems}</span>
          </div>

          <div className="inventory-panel inventory-summary-card">
            <span className="inventory-summary-label">Active Series</span>
            <span className="inventory-summary-value">
              {activeSeriesId ? "Loaded" : "None"}
            </span>
          </div>
        </div>

        <div className="inventory-layout">
          <aside className="inventory-panel inventory-sidebar">
            <div className="inventory-sidebar-section">
              <label className="inventory-field-label" htmlFor="inventory-search">
                Search
              </label>
              <input
                id="inventory-search"
                type="text"
                className="inventory-search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search inventory..."
              />
            </div>

            <div className="inventory-sidebar-section">
              <label className="inventory-field-label" htmlFor="inventory-category">
                Category
              </label>
              <select
                id="inventory-category"
                className="inventory-select"
                value={selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
              >
                <option value="all">All Categories</option>
                {categoryOptions.map((category) => (
                  <option key={category.code} value={category.code}>
                    {category.label}
                  </option>
                ))}
              </select>
            </div>
          </aside>

          <main className="inventory-main">
            {loading ? (
              <div className="inventory-panel inventory-empty">Loading inventory...</div>
            ) : error ? (
              <div className="inventory-panel inventory-empty">{error}</div>
            ) : groupedItems.length === 0 ? (
              <div className="inventory-panel inventory-empty">
                No inventory items found.
              </div>
            ) : (
              groupedItems.map((group) => (
                <section className="inventory-panel inventory-group" key={group.code}>
                  <div className="inventory-group-header">
                    <h2 className="inventory-group-title">{group.label}</h2>
                    <span className="inventory-group-count">
                      {group.items.length} Item{group.items.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="inventory-item-grid">
                    {group.items.map((item) => (
                      <article className="inventory-item-card" key={item.id}>
                        <div className="inventory-item-top">
                          <div className="inventory-item-heading">
                            <h3 className="inventory-item-name">{item.item_name}</h3>
                            <div className="inventory-item-code">{item.item_code}</div>
                          </div>

                          <div className="inventory-item-qty-wrap">
                            <span className="inventory-item-qty-label">Qty</span>
                            <span className="inventory-item-qty">{item.quantity}</span>
                          </div>
                        </div>

                        <p className="inventory-item-desc">
                          {item.description || "No description available."}
                        </p>

                        <div className="inventory-item-meta">
                          <div className="inventory-item-meta-row">
                            <span className="inventory-item-meta-label">Available</span>
                            <span className="inventory-item-meta-value">
                              {item.available_quantity}
                            </span>
                          </div>

                          <div className="inventory-item-meta-row">
                            <span className="inventory-item-meta-label">Locked</span>
                            <span className="inventory-item-meta-value">
                              {item.locked_quantity}
                            </span>
                          </div>

                          <div className="inventory-item-meta-row">
                            <span className="inventory-item-meta-label">Category</span>
                            <span className="inventory-item-meta-value">
                              {formatStoreCategoryName(item.category_code, item.category_name)}
                            </span>
                          </div>
                        </div>

                        <div className="inventory-item-actions">
                          <button
                            type="button"
                            className="inventory-item-action-btn"
                            onClick={() => openItemModal(item)}
                            disabled={Number(item.available_quantity || 0) <= 0}
                          >
                            {getUseButtonLabel(item)}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))
            )}
          </main>
        </div>

        {selectedItem ? (
          <div className="inventory-modal-overlay" onClick={closeModal}>
            <div
              className="inventory-panel inventory-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="inventory-modal-header">
                <div>
                  <div className="inventory-kicker">ITEM USE</div>
                  <h2 className="inventory-modal-title">{selectedItem.item_name}</h2>
                </div>

                <button
                  type="button"
                  className="inventory-modal-close-btn"
                  onClick={closeModal}
                >
                  x
                </button>
              </div>

              {!selectedPreview ? (
                <div className="inventory-empty">Loading item flow...</div>
              ) : (
                <div className="inventory-modal-body">
                  <p className="inventory-modal-copy">{getFlowCopy(selectedPreview)}</p>

                  {selectedPreview.block_reason ? (
                    <div className="inventory-modal-warning">
                      {selectedPreview.block_reason}
                    </div>
                  ) : null}

                  {modalError ? (
                    <div className="inventory-modal-warning">{modalError}</div>
                  ) : null}

                  <div className="inventory-item-meta inventory-modal-meta">
                    <div className="inventory-item-meta-row">
                      <span className="inventory-item-meta-label">Available Quantity</span>
                      <span className="inventory-item-meta-value">
                        {selectedPreview.available_quantity}
                      </span>
                    </div>

                    <div className="inventory-item-meta-row">
                      <span className="inventory-item-meta-label">Action Type</span>
                      <span className="inventory-item-meta-value">
                        {selectedPreview.action_kind}
                      </span>
                    </div>
                  </div>

                  {renderActionBody()}

                  <div className="inventory-modal-actions">
                    <button
                      type="button"
                      className="inventory-back-btn"
                      onClick={closeModal}
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      className="inventory-item-action-btn"
                      disabled={submitDisabled}
                      onClick={submitItemFlow}
                    >
                      {actionBusy
                        ? "Processing..."
                        : selectedPreview.action_kind === "open_in_opener"
                        ? "Go to Opener"
                        : "Confirm Use"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </LauncherLayout>
  );
}

export default InventoryPage;
