import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../../components/LauncherLayout";
import { useUser } from "../../../context/UserContext";
import { supabase } from "../../../lib/supabase";
import {
  formatStoreCategoryName,
  normalizeStoreCategoryCode,
  sortStoreGroups,
} from "../../../lib/storeCatalog";
import "./RoundRewardsPage.css";

const PLACEMENTS = [1, 2, 3, 4, 5, 6];
const ROUND_STEPS = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
];

function buildEmptyPlacement(placement) {
  return {
    placement,
    random_item_quantity: 0,
    extra_shard_min: 0,
    extra_shard_max: 0,
    extra_feature_coin_min: 0,
    extra_feature_coin_max: 0,
    specific_item_definition_id: "",
    random_pool_item_ids: [],
  };
}

function buildInitialFormState(roundNumber = 0) {
  return {
    round_number: roundNumber,
    round_step: 1,
    shared_shard_min: 0,
    shared_shard_max: 0,
    shared_feature_coin_min: 0,
    shared_feature_coin_max: 0,
    shared_item_definition_id: "",
    shared_item_quantity: 0,
    placements: PLACEMENTS.map(buildEmptyPlacement),
  };
}

function formatRoundLabel(roundNumber, roundStep) {
  return `Round ${roundNumber}-${roundStep}`;
}

function getItemName(itemId, itemMap) {
  if (!itemId) return "";
  return itemMap.get(String(itemId))?.name || "Unknown Item";
}

function buildPlacementRewardSummary(row, itemMap) {
  if (row.specific_item_definition_id) {
    return {
      title: getItemName(row.specific_item_definition_id, itemMap),
      subtitle: "Exact reward item",
    };
  }

  if (row.random_pool_item_ids.length > 0) {
    return {
      title: `Random Pool (${row.random_pool_item_ids.length})`,
      subtitle: "Random from your selected pool",
    };
  }

  return {
    title: "Random Eligible Item",
    subtitle: "Falls back to all reward-eligible items",
  };
}

function RangeEditor({ label, minValue, maxValue, onMinChange, onMaxChange }) {
  return (
    <label className="round-rewards-range-field">
      <span>{label}</span>
      <div className="round-rewards-range-inputs">
        <input
          type="number"
          min="0"
          value={minValue}
          onChange={(event) => onMinChange(Number(event.target.value || 0))}
          placeholder="Min"
        />
        <div className="round-rewards-range-divider">-</div>
        <input
          type="number"
          min="0"
          value={maxValue}
          onChange={(event) => onMaxChange(Number(event.target.value || 0))}
          placeholder="Max"
        />
      </div>
    </label>
  );
}

function RewardPickerModal({
  pickerState,
  itemGroups,
  itemMap,
  onClose,
  onApply,
  onSelectSpecificItem,
  onTogglePoolItem,
  onSetMode,
  onSetSearch,
  onSetCategory,
}) {
  if (!pickerState.open) return null;

  const isPlacementPicker = pickerState.targetType === "placement";
  const filteredGroups = itemGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const matchesCategory =
          pickerState.selectedCategory === "all" || group.code === pickerState.selectedCategory;
        const query = pickerState.search.trim().toLowerCase();
        const matchesSearch =
          !query ||
          String(item.name || "").toLowerCase().includes(query) ||
          String(item.code || "").toLowerCase().includes(query) ||
          String(item.description || "").toLowerCase().includes(query);
        return matchesCategory && matchesSearch;
      }),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="round-rewards-modal-backdrop" onClick={onClose}>
      <div className="round-rewards-modal" onClick={(event) => event.stopPropagation()}>
        <div className="round-rewards-modal-header">
          <div>
            <div className="round-rewards-modal-kicker">
              {isPlacementPicker ? `Placement ${pickerState.placement}` : "Shared Reward"}
            </div>
            <h2>{isPlacementPicker ? "Choose Reward Item" : "Choose Shared Item"}</h2>
            <p>
              {isPlacementPicker
                ? "Pick an exact reward item or build the random pool for this placement."
                : "Pick the fixed item all players receive for this round."}
            </p>
          </div>

          <button type="button" className="round-rewards-modal-close" onClick={onClose}>
            Close
          </button>
        </div>

        {isPlacementPicker ? (
          <div className="round-rewards-modal-mode-row">
            <button
              type="button"
              className={`round-rewards-mode-pill ${pickerState.mode === "specific" ? "is-active" : ""}`}
              onClick={() => onSetMode("specific")}
            >
              Exact Item
            </button>
            <button
              type="button"
              className={`round-rewards-mode-pill ${pickerState.mode === "random" ? "is-active" : ""}`}
              onClick={() => onSetMode("random")}
            >
              Random Pool
            </button>
          </div>
        ) : null}

        <div className="round-rewards-modal-toolbar">
          <input
            type="text"
            className="round-rewards-modal-search"
            placeholder="Search reward items..."
            value={pickerState.search}
            onChange={(event) => onSetSearch(event.target.value)}
          />

          <select
            className="round-rewards-modal-category"
            value={pickerState.selectedCategory}
            onChange={(event) => onSetCategory(event.target.value)}
          >
            <option value="all">All Categories</option>
            {itemGroups.map((group) => (
              <option key={group.code} value={group.code}>
                {group.label}
              </option>
            ))}
          </select>
        </div>

        <div className="round-rewards-modal-selection-bar">
          <div className="round-rewards-selection-summary">
            {pickerState.mode === "random" && isPlacementPicker
              ? `Pool selected: ${pickerState.draftPoolItemIds.length} items`
              : `Selected: ${getItemName(pickerState.draftSpecificItemId, itemMap) || (isPlacementPicker ? "Random from pool" : "None")}`}
          </div>
        </div>

        <div className="round-rewards-modal-groups">
          {isPlacementPicker && pickerState.mode === "specific" ? (
            <button
              type="button"
              className={`round-rewards-item-card round-rewards-item-card--special ${
                !pickerState.draftSpecificItemId ? "is-selected" : ""
              }`}
              onClick={() => onSelectSpecificItem("")}
            >
              <div className="round-rewards-item-card-title">Random From Selected Pool</div>
              <div className="round-rewards-item-card-meta">
                Use the random pool for this placement instead of an exact item.
              </div>
            </button>
          ) : !isPlacementPicker ? (
            <button
              type="button"
              className={`round-rewards-item-card round-rewards-item-card--special ${
                !pickerState.draftSpecificItemId ? "is-selected" : ""
              }`}
              onClick={() => onSelectSpecificItem("")}
            >
              <div className="round-rewards-item-card-title">No Shared Item</div>
              <div className="round-rewards-item-card-meta">
                Remove the shared item reward from this round config.
              </div>
            </button>
          ) : null}

          {!filteredGroups.length ? (
            <div className="round-rewards-modal-empty">No reward items match this filter.</div>
          ) : (
            filteredGroups.map((group) => (
              <section className="round-rewards-modal-group" key={group.code}>
                <div className="round-rewards-modal-group-header">
                  <h3>{group.label}</h3>
                  <span>{group.items.length}</span>
                </div>

                <div className="round-rewards-item-grid">
                  {group.items.map((item) => {
                    const isSpecificSelected = pickerState.draftSpecificItemId === item.id;
                    const isPoolSelected = pickerState.draftPoolItemIds.includes(item.id);
                    const isSelected =
                      pickerState.mode === "random" && isPlacementPicker ? isPoolSelected : isSpecificSelected;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`round-rewards-item-card ${isSelected ? "is-selected" : ""}`}
                        onClick={() => {
                          if (pickerState.mode === "random" && isPlacementPicker) {
                            onTogglePoolItem(item.id);
                          } else {
                            onSelectSpecificItem(item.id);
                          }
                        }}
                      >
                        <div className="round-rewards-item-card-code">{item.code}</div>
                        <div className="round-rewards-item-card-title">{item.name}</div>
                        <div className="round-rewards-item-card-meta">
                          {group.label}
                          {item.store_price != null ? ` | ${item.store_price} Shards` : ""}
                        </div>
                        {item.description ? (
                          <div className="round-rewards-item-card-desc">{item.description}</div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        <div className="round-rewards-modal-actions">
          <button type="button" className="round-rewards-secondary-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="round-rewards-primary-btn" onClick={onApply}>
            Apply Selection
          </button>
        </div>
      </div>
    </div>
  );
}

function RoundRewardsPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [rewardConfigs, setRewardConfigs] = useState([]);
  const [itemOptions, setItemOptions] = useState([]);
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [formState, setFormState] = useState(buildInitialFormState(0));
  const [pickerState, setPickerState] = useState({
    open: false,
    targetType: "placement",
    placement: 1,
    mode: "specific",
    search: "",
    selectedCategory: "all",
    draftSpecificItemId: "",
    draftPoolItemIds: [],
  });

  const selectedConfig = useMemo(
    () => rewardConfigs.find((config) => config.id === selectedConfigId) || null,
    [rewardConfigs, selectedConfigId]
  );

  const itemMap = useMemo(
    () => new Map(itemOptions.map((item) => [String(item.id), item])),
    [itemOptions]
  );

  const itemGroups = useMemo(() => {
    const groups = new Map();
    itemOptions.forEach((item) => {
      const code = item.category_code || "other";
      if (!groups.has(code)) {
        groups.set(code, {
          code,
          label: item.category_name || formatStoreCategoryName(code),
          items: [],
        });
      }
      groups.get(code).items.push(item);
    });

    return sortStoreGroups(Array.from(groups.values())).map((group) => ({
      ...group,
      items: [...group.items].sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""))),
    }));
  }, [itemOptions]);

  useEffect(() => {
    if (!authLoading && user) {
      loadPage();
    }
  }, [authLoading, user]);

  async function loadPage() {
    if (!user) return;

    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const [
        activeSeriesResponse,
        configsResponse,
        placementsResponse,
        poolsResponse,
        itemsResponse,
        categoriesResponse,
      ] = await Promise.all([
        supabase.from("game_series").select("id, name").eq("is_current", true).maybeSingle(),
        supabase
          .from("series_round_reward_configs")
          .select("*")
          .order("round_number", { ascending: true })
          .order("round_step", { ascending: true }),
        supabase
          .from("series_round_reward_config_placements")
          .select("*")
          .order("placement", { ascending: true }),
        supabase
          .from("series_round_reward_config_random_items")
          .select("*")
          .order("placement", { ascending: true }),
        supabase
          .from("item_definitions")
          .select("id, category_id, code, name, description, store_price, is_active")
          .eq("is_active", true)
          .order("name", { ascending: true }),
        supabase.from("item_categories").select("id, code, name"),
      ]);

      if (activeSeriesResponse.error) throw activeSeriesResponse.error;
      if (configsResponse.error) throw configsResponse.error;
      if (placementsResponse.error) throw placementsResponse.error;
      if (poolsResponse.error) throw poolsResponse.error;
      if (itemsResponse.error) throw itemsResponse.error;
      if (categoriesResponse.error) throw categoriesResponse.error;

      const nextSeriesId = activeSeriesResponse.data?.id || null;
      const categoryMap = new Map((categoriesResponse.data || []).map((row) => [row.id, row]));

      setActiveSeriesId(nextSeriesId);
      setItemOptions(
        (itemsResponse.data || []).map((item) => {
          const category = categoryMap.get(item.category_id);
          return {
            ...item,
            category_code: normalizeStoreCategoryCode(category?.code),
            category_name: formatStoreCategoryName(category?.code, category?.name),
          };
        })
      );

      const poolMap = new Map();
      (poolsResponse.data || []).forEach((row) => {
        const key = `${row.reward_config_id}:${row.placement}`;
        if (!poolMap.has(key)) {
          poolMap.set(key, []);
        }
        poolMap.get(key).push(row.item_definition_id);
      });

      const placementsByConfigId = new Map();
      (placementsResponse.data || []).forEach((row) => {
        if (!placementsByConfigId.has(row.reward_config_id)) {
          placementsByConfigId.set(row.reward_config_id, []);
        }

        placementsByConfigId.get(row.reward_config_id).push({
          ...row,
          random_pool_item_ids: poolMap.get(`${row.reward_config_id}:${row.placement}`) || [],
        });
      });

      const hydratedConfigs = (configsResponse.data || [])
        .filter((row) => row.series_id === nextSeriesId)
        .map((row) => ({
          ...row,
          placements: placementsByConfigId.get(row.id) || [],
        }));

      setRewardConfigs(hydratedConfigs);

      const nextConfig =
        hydratedConfigs.find((config) => config.id === selectedConfigId) ||
        hydratedConfigs[0] ||
        null;

      if (nextConfig) {
        hydrateForm(nextConfig);
      } else {
        handleNewConfig();
      }
    } catch (error) {
      console.error("Failed to load round rewards:", error);
      setErrorMessage(error.message || "Failed to load round rewards.");
    } finally {
      setLoading(false);
    }
  }

  function hydrateForm(config) {
    setSelectedConfigId(config.id || "");

    const placementMap = new Map((config.placements || []).map((row) => [Number(row.placement), row]));

    setFormState({
      round_number: Number(config.round_number ?? 0),
      round_step: Number(config.round_step || 1),
      shared_shard_min: Number(config.shared_shard_min || 0),
      shared_shard_max: Number(config.shared_shard_max || 0),
      shared_feature_coin_min: Number(config.shared_feature_coin_min || 0),
      shared_feature_coin_max: Number(config.shared_feature_coin_max || 0),
      shared_item_definition_id: config.shared_item_definition_id || "",
      shared_item_quantity: Number(config.shared_item_quantity || 0),
      placements: PLACEMENTS.map((placement) => {
        const row = placementMap.get(placement);
        return {
          placement,
          random_item_quantity: Number(row?.random_item_quantity || 0),
          extra_shard_min: Number(row?.extra_shard_min || 0),
          extra_shard_max: Number(row?.extra_shard_max || 0),
          extra_feature_coin_min: Number(row?.extra_feature_coin_min || 0),
          extra_feature_coin_max: Number(row?.extra_feature_coin_max || 0),
          specific_item_definition_id: row?.specific_item_definition_id || "",
          random_pool_item_ids: [...(row?.random_pool_item_ids || [])],
        };
      }),
    });
  }

  function handleNewConfig() {
    setSelectedConfigId("");
    setFormState(buildInitialFormState(0));
    setPickerState((current) => ({ ...current, open: false }));
    setErrorMessage("");
    setStatusMessage("");
  }

  function updatePlacement(placement, key, value) {
    setFormState((current) => ({
      ...current,
      placements: current.placements.map((row) =>
        row.placement === placement ? { ...row, [key]: value } : row
      ),
    }));
  }

  function openSharedItemPicker() {
    setPickerState({
      open: true,
      targetType: "shared",
      placement: 1,
      mode: "specific",
      search: "",
      selectedCategory: "all",
      draftSpecificItemId: formState.shared_item_definition_id || "",
      draftPoolItemIds: [],
    });
  }

  function openPlacementPicker(placement) {
    const row = formState.placements.find((entry) => entry.placement === placement) || buildEmptyPlacement(placement);
    setPickerState({
      open: true,
      targetType: "placement",
      placement,
      mode: row.specific_item_definition_id ? "specific" : "random",
      search: "",
      selectedCategory: "all",
      draftSpecificItemId: row.specific_item_definition_id || "",
      draftPoolItemIds: [...(row.random_pool_item_ids || [])],
    });
  }

  async function saveConfig() {
    if (!activeSeriesId) {
      setErrorMessage("No active series is available.");
      return;
    }

    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const duplicateConfig = rewardConfigs.find(
        (config) =>
          config.id !== selectedConfigId &&
          Number(config.round_number) === Number(formState.round_number) &&
          Number(config.round_step) === Number(formState.round_step)
      );

      if (duplicateConfig) {
        throw new Error(
          `${formatRoundLabel(formState.round_number, formState.round_step)} already exists. Load it from the left list instead.`
        );
      }

      const payload = {
        series_id: activeSeriesId,
        round_number: Math.max(0, Number(formState.round_number ?? 0)),
        round_step: Number(formState.round_step || 1),
        shared_shard_min: Number(formState.shared_shard_min || 0),
        shared_shard_max: Number(formState.shared_shard_max || 0),
        shared_feature_coin_min: Number(formState.shared_feature_coin_min || 0),
        shared_feature_coin_max: Number(formState.shared_feature_coin_max || 0),
        shared_item_definition_id: formState.shared_item_definition_id || null,
        shared_item_quantity: Number(formState.shared_item_quantity || 0),
      };

      let configId = selectedConfigId;

      if (!configId) {
        const { data, error } = await supabase
          .from("series_round_reward_configs")
          .insert(payload)
          .select("id")
          .single();

        if (error) throw error;
        configId = data.id;
      } else {
        const { error } = await supabase
          .from("series_round_reward_configs")
          .update(payload)
          .eq("id", configId);

        if (error) throw error;

        const { error: deletePlacementError } = await supabase
          .from("series_round_reward_config_placements")
          .delete()
          .eq("reward_config_id", configId);

        if (deletePlacementError) throw deletePlacementError;

        const { error: deletePoolError } = await supabase
          .from("series_round_reward_config_random_items")
          .delete()
          .eq("reward_config_id", configId);

        if (deletePoolError) throw deletePoolError;
      }

      const placementRows = formState.placements.map((row) => ({
        reward_config_id: configId,
        placement: row.placement,
        random_item_quantity: Number(row.random_item_quantity || 0),
        extra_shard_min: Number(row.extra_shard_min || 0),
        extra_shard_max: Number(row.extra_shard_max || 0),
        extra_feature_coin_min: Number(row.extra_feature_coin_min || 0),
        extra_feature_coin_max: Number(row.extra_feature_coin_max || 0),
        specific_item_definition_id: row.specific_item_definition_id || null,
      }));

      const { error: placementError } = await supabase
        .from("series_round_reward_config_placements")
        .insert(placementRows);

      if (placementError) throw placementError;

      const poolRows = formState.placements.flatMap((row) =>
        [...new Set(row.random_pool_item_ids || [])].map((itemDefinitionId) => ({
          reward_config_id: configId,
          placement: row.placement,
          item_definition_id: itemDefinitionId,
        }))
      );

      if (poolRows.length > 0) {
        const { error: poolError } = await supabase
          .from("series_round_reward_config_random_items")
          .insert(poolRows);

        if (poolError) throw poolError;
      }

      setStatusMessage(`${formatRoundLabel(formState.round_number, formState.round_step)} saved.`);
      await loadPage();
    } catch (error) {
      console.error("Failed to save round reward config:", error);
      setErrorMessage(error.message || "Failed to save round reward config.");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) return null;

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (user.role !== "Admin+" && user.role !== "Admin") {
    return <Navigate to="/mode/progression" replace />;
  }

  return (
    <LauncherLayout>
      <div className="round-rewards-page">
        <div className="round-rewards-topbar">
          <div>
            <div className="round-rewards-kicker">ADMIN</div>
            <h1 className="round-rewards-title">Round Rewards</h1>
            <p className="round-rewards-subtitle">
              Edit every round directly, including Round 0, with cleaner reward pickers and custom random pools.
            </p>
          </div>

          <div className="round-rewards-topbar-actions">
            <button
              type="button"
              className="round-rewards-secondary-btn"
              onClick={() => navigate("/mode/progression")}
            >
              Back
            </button>
          </div>
        </div>

        {loading ? (
          <div className="round-rewards-card round-rewards-empty">Loading reward configs...</div>
        ) : (
          <div className="round-rewards-layout">
            <aside className="round-rewards-card round-rewards-sidebar">
              <div className="round-rewards-section-header">
                <div>
                  <h2>Configured Rounds</h2>
                  <p>Pick a round config to edit or start a fresh one.</p>
                </div>
                <button type="button" className="round-rewards-primary-btn" onClick={handleNewConfig}>
                  New Round
                </button>
              </div>

              <div className="round-rewards-config-list">
                {rewardConfigs.length === 0 ? (
                  <div className="round-rewards-empty">No reward configs yet.</div>
                ) : (
                  rewardConfigs.map((config) => (
                    <button
                      key={config.id}
                      type="button"
                      className={`round-rewards-config-row ${selectedConfig?.id === config.id ? "is-selected" : ""}`}
                      onClick={() => {
                        hydrateForm(config);
                        setStatusMessage("");
                        setErrorMessage("");
                      }}
                    >
                      <div className="round-rewards-config-row-title">
                        {formatRoundLabel(config.round_number, config.round_step)}
                      </div>
                      <div className="round-rewards-config-row-meta">
                        Shared {Number(config.shared_shard_min || 0)}-{Number(config.shared_shard_max || 0)} Shards
                      </div>
                    </button>
                  ))
                )}
              </div>
            </aside>

            <main className="round-rewards-main">
              <section className="round-rewards-card round-rewards-chooser-card">
                <div className="round-rewards-section-header">
                  <div>
                    <h2>Round Chooser</h2>
                    <p>Keep the round label compact while you edit.</p>
                  </div>
                </div>

                <div className="round-rewards-chooser-row">
                  <label className="round-rewards-compact-field">
                    <span>Round</span>
                    <input
                      type="number"
                      min="0"
                      value={formState.round_number}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          round_number: Math.max(0, Number(event.target.value || 0)),
                        }))
                      }
                    />
                  </label>

                  <label className="round-rewards-compact-field round-rewards-compact-field--step">
                    <span>Step</span>
                    <select
                      value={formState.round_step}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          round_step: Number(event.target.value || 1),
                        }))
                      }
                    >
                      {ROUND_STEPS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="round-rewards-round-preview">
                    {formatRoundLabel(formState.round_number, formState.round_step)}
                  </div>
                </div>
              </section>

              <section className="round-rewards-card round-rewards-shared-card">
                <div className="round-rewards-section-header">
                  <div>
                    <h2>Shared Rewards</h2>
                    <p>These apply to every result row in the selected round.</p>
                  </div>
                </div>

                <div className="round-rewards-shared-grid">
                  <RangeEditor
                    label="Shards"
                    minValue={formState.shared_shard_min}
                    maxValue={formState.shared_shard_max}
                    onMinChange={(value) => setFormState((current) => ({ ...current, shared_shard_min: value }))}
                    onMaxChange={(value) => setFormState((current) => ({ ...current, shared_shard_max: value }))}
                  />

                  <RangeEditor
                    label="Feature Coins"
                    minValue={formState.shared_feature_coin_min}
                    maxValue={formState.shared_feature_coin_max}
                    onMinChange={(value) =>
                      setFormState((current) => ({ ...current, shared_feature_coin_min: value }))
                    }
                    onMaxChange={(value) =>
                      setFormState((current) => ({ ...current, shared_feature_coin_max: value }))
                    }
                  />

                  <label className="round-rewards-compact-field">
                    <span>Item Qty</span>
                    <input
                      type="number"
                      min="0"
                      value={formState.shared_item_quantity}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          shared_item_quantity: Number(event.target.value || 0),
                        }))
                      }
                    />
                  </label>

                  <button
                    type="button"
                    className="round-rewards-picker-btn"
                    onClick={openSharedItemPicker}
                  >
                    <div className="round-rewards-picker-btn-label">Shared Item</div>
                    <div className="round-rewards-picker-btn-value">
                      {formState.shared_item_definition_id
                        ? getItemName(formState.shared_item_definition_id, itemMap)
                        : "None selected"}
                    </div>
                  </button>
                </div>
              </section>

              <section className="round-rewards-placement-grid">
                {formState.placements.map((row) => {
                  const summary = buildPlacementRewardSummary(row, itemMap);

                  return (
                    <article className="round-rewards-placement-card round-rewards-card" key={row.placement}>
                      <div className="round-rewards-placement-header">
                        <div>
                          <div className="round-rewards-placement-kicker">Placement</div>
                          <h3>{row.placement}</h3>
                        </div>

                        <label className="round-rewards-compact-field round-rewards-compact-field--qty">
                          <span>Quantity</span>
                          <input
                            type="number"
                            min="0"
                            value={row.random_item_quantity}
                            onChange={(event) =>
                              updatePlacement(
                                row.placement,
                                "random_item_quantity",
                                Number(event.target.value || 0)
                              )
                            }
                          />
                        </label>
                      </div>

                      <button
                        type="button"
                        className="round-rewards-picker-btn round-rewards-picker-btn--placement"
                        onClick={() => openPlacementPicker(row.placement)}
                      >
                        <div className="round-rewards-picker-btn-label">Reward Item</div>
                        <div className="round-rewards-picker-btn-value">{summary.title}</div>
                        <div className="round-rewards-picker-btn-subvalue">{summary.subtitle}</div>
                      </button>

                      <div className="round-rewards-placement-ranges">
                        <RangeEditor
                          label="Shards"
                          minValue={row.extra_shard_min}
                          maxValue={row.extra_shard_max}
                          onMinChange={(value) => updatePlacement(row.placement, "extra_shard_min", value)}
                          onMaxChange={(value) => updatePlacement(row.placement, "extra_shard_max", value)}
                        />

                        <RangeEditor
                          label="Feature Coins"
                          minValue={row.extra_feature_coin_min}
                          maxValue={row.extra_feature_coin_max}
                          onMinChange={(value) =>
                            updatePlacement(row.placement, "extra_feature_coin_min", value)
                          }
                          onMaxChange={(value) =>
                            updatePlacement(row.placement, "extra_feature_coin_max", value)
                          }
                        />
                      </div>

                      <div className="round-rewards-placement-footer">
                        <div className="round-rewards-placement-footer-pill">
                          Pool Size: {row.random_pool_item_ids.length || 0}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>

              {statusMessage ? <div className="round-rewards-success">{statusMessage}</div> : null}
              {errorMessage ? <div className="round-rewards-error">{errorMessage}</div> : null}

              <div className="round-rewards-actions">
                <button type="button" className="round-rewards-primary-btn" disabled={saving} onClick={saveConfig}>
                  {saving ? "Saving..." : "Save Config"}
                </button>
              </div>
            </main>
          </div>
        )}

        <RewardPickerModal
          pickerState={pickerState}
          itemGroups={itemGroups}
          itemMap={itemMap}
          onClose={() => setPickerState((current) => ({ ...current, open: false }))}
          onApply={() => {
            if (pickerState.targetType === "shared") {
              setFormState((current) => ({
                ...current,
                shared_item_definition_id: pickerState.draftSpecificItemId || "",
              }));
            } else {
              updatePlacement(
                pickerState.placement,
                "specific_item_definition_id",
                pickerState.mode === "specific" ? pickerState.draftSpecificItemId || "" : ""
              );
              updatePlacement(
                pickerState.placement,
                "random_pool_item_ids",
                [...pickerState.draftPoolItemIds]
              );
            }
            setPickerState((current) => ({ ...current, open: false }));
          }}
          onSelectSpecificItem={(itemId) =>
            setPickerState((current) => ({
              ...current,
              draftSpecificItemId: itemId,
            }))
          }
          onTogglePoolItem={(itemId) =>
            setPickerState((current) => ({
              ...current,
              draftPoolItemIds: current.draftPoolItemIds.includes(itemId)
                ? current.draftPoolItemIds.filter((value) => value !== itemId)
                : [...current.draftPoolItemIds, itemId],
            }))
          }
          onSetMode={(mode) => setPickerState((current) => ({ ...current, mode }))}
          onSetSearch={(search) => setPickerState((current) => ({ ...current, search }))}
          onSetCategory={(selectedCategory) =>
            setPickerState((current) => ({ ...current, selectedCategory }))
          }
        />
      </div>
    </LauncherLayout>
  );
}

export default RoundRewardsPage;
