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
const REWARD_KIND_OPTIONS = [
  { value: "set", label: "Set Item" },
  { value: "random", label: "Random" },
  { value: "choice", label: "Choice Item" },
];
const OPTION_KIND_LABELS = {
  shards: "Shards",
  feature_coins: "Feature Coins",
  specific_item: "Specific Item",
  random_item: "Random Item",
};

function makeLocalId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeInt(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function uniqueIds(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function getAllowedOptionKinds(rewardKind) {
  if (rewardKind === "random") return ["shards", "feature_coins", "random_item"];
  if (rewardKind === "choice") return ["shards", "feature_coins", "specific_item", "random_item"];
  return ["shards", "feature_coins", "specific_item"];
}

function buildEmptyOption(rewardKind, optionKind) {
  const allowedKinds = getAllowedOptionKinds(rewardKind);
  const resolvedOptionKind = allowedKinds.includes(optionKind)
    ? optionKind
    : allowedKinds[allowedKinds.length - 1];

  return {
    id: "",
    localId: makeLocalId(),
    optionKind: resolvedOptionKind,
    exactQuantity: resolvedOptionKind === "specific_item" || resolvedOptionKind === "random_item" ? 1 : 0,
    quantityMin: 0,
    quantityMax: 0,
    itemDefinitionId: "",
    poolItemIds: [],
  };
}

function normalizeOptionForRewardKind(option, rewardKind) {
  const allowedKinds = getAllowedOptionKinds(rewardKind);
  const fallbackOption = buildEmptyOption(rewardKind);
  const nextOptionKind = allowedKinds.includes(option?.optionKind)
    ? option.optionKind
    : fallbackOption.optionKind;

  return {
    id: option?.id || "",
    localId: option?.localId || makeLocalId(),
    optionKind: nextOptionKind,
    exactQuantity: Math.max(0, normalizeInt(option?.exactQuantity, 0)),
    quantityMin: Math.max(0, normalizeInt(option?.quantityMin, 0)),
    quantityMax: Math.max(0, normalizeInt(option?.quantityMax, 0)),
    itemDefinitionId: nextOptionKind === "specific_item" ? option?.itemDefinitionId || "" : "",
    poolItemIds: nextOptionKind === "random_item" ? uniqueIds(option?.poolItemIds) : [],
  };
}

function normalizeEntry(entry) {
  const rewardKind = entry?.rewardKind || "set";
  const baseOptions = Array.isArray(entry?.options) ? entry.options : [];
  let nextOptions = baseOptions.map((option) => normalizeOptionForRewardKind(option, rewardKind));

  if (rewardKind === "choice") {
    if (nextOptions.length === 0) {
      nextOptions = [
        buildEmptyOption("choice", "specific_item"),
        buildEmptyOption("choice", "shards"),
      ];
    }
  } else {
    nextOptions = [normalizeOptionForRewardKind(nextOptions[0] || buildEmptyOption(rewardKind), rewardKind)];
  }

  return {
    id: entry?.id || "",
    localId: entry?.localId || makeLocalId(),
    placement:
      entry?.placement === null || entry?.placement === undefined || entry?.placement === ""
        ? null
        : normalizeInt(entry.placement, 1),
    entryOrder: Math.max(1, normalizeInt(entry?.entryOrder, 1)),
    rewardKind,
    choiceCount:
      rewardKind === "choice"
        ? Math.min(Math.max(1, normalizeInt(entry?.choiceCount, 1)), Math.max(1, nextOptions.length))
        : 1,
    options: nextOptions,
  };
}

function normalizeEntries(entries) {
  const normalized = (entries || []).map(normalizeEntry);
  const sharedEntries = normalized
    .filter((entry) => entry.placement == null)
    .map((entry, index) => ({ ...entry, placement: null, entryOrder: index + 1 }));
  const placementEntries = PLACEMENTS.flatMap((placement) =>
    normalized
      .filter((entry) => Number(entry.placement) === placement)
      .map((entry, index) => ({ ...entry, placement, entryOrder: index + 1 }))
  );

  return [...sharedEntries, ...placementEntries];
}

function buildEmptyEntry(rewardKind = "set", placement = null) {
  if (rewardKind === "choice") {
    return normalizeEntry({
      placement,
      rewardKind,
      choiceCount: 1,
      options: [
        buildEmptyOption("choice", "specific_item"),
        buildEmptyOption("choice", "shards"),
      ],
    });
  }

  return normalizeEntry({
    placement,
    rewardKind,
    choiceCount: 1,
    options: [buildEmptyOption(rewardKind)],
  });
}

function buildInitialFormState(roundNumber = 0) {
  return {
    configId: "",
    roundNumber,
    roundStep: 1,
    entries: [],
  };
}

function formatRoundLabel(roundNumber, roundStep) {
  return `Round ${roundNumber}-${roundStep}`;
}

function getConfigSummary(config) {
  const entries = Array.isArray(config?.entries) ? config.entries : [];
  const sharedCount = entries.filter((entry) => entry.placement == null).length;
  const placementCount = entries.filter((entry) => entry.placement != null).length;
  return `${sharedCount} shared | ${placementCount} placement`;
}

function describeOption(option, rewardKind, itemMap) {
  if (option.optionKind === "shards") {
    return rewardKind === "random"
      ? `Shards ${Math.max(0, option.quantityMin)}-${Math.max(0, option.quantityMax)}`
      : `${Math.max(0, option.exactQuantity)} Shards`;
  }

  if (option.optionKind === "feature_coins") {
    return rewardKind === "random"
      ? `Feature Coins ${Math.max(0, option.quantityMin)}-${Math.max(0, option.quantityMax)}`
      : `${Math.max(0, option.exactQuantity)} Feature Coins`;
  }

  if (option.optionKind === "specific_item") {
    const itemName = itemMap.get(String(option.itemDefinitionId))?.name || "Choose item";
    return `${itemName} x${Math.max(0, option.exactQuantity)}`;
  }

  return option.poolItemIds.length
    ? `Random from pool (${option.poolItemIds.length}) x${Math.max(0, option.exactQuantity)}`
    : `Random eligible item x${Math.max(0, option.exactQuantity)}`;
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
          onChange={(event) => onMinChange(Math.max(0, Number(event.target.value || 0)))}
          placeholder="Min"
        />
        <div className="round-rewards-range-divider">-</div>
        <input
          type="number"
          min="0"
          value={maxValue}
          onChange={(event) => onMaxChange(Math.max(0, Number(event.target.value || 0)))}
          placeholder="Max"
        />
      </div>
    </label>
  );
}

function RewardItemPickerModal({
  pickerState,
  itemGroups,
  itemMap,
  onClose,
  onApply,
  onSelectSpecificItem,
  onTogglePoolItem,
  onSetSearch,
  onSetCategory,
}) {
  if (!pickerState.open) return null;

  const filteredGroups = itemGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const matchesCategory =
          pickerState.selectedCategory === "all" || pickerState.selectedCategory === group.code;
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
              {pickerState.selectionMode === "pool" ? "RANDOM POOL" : "EXACT ITEM"}
            </div>
            <h2>{pickerState.selectionMode === "pool" ? "Choose Random Item Pool" : "Choose Specific Item"}</h2>
            <p>
              {pickerState.selectionMode === "pool"
                ? "Pick the items this random reward can roll from."
                : "Pick the exact store item this reward should give."}
            </p>
          </div>

          <button type="button" className="round-rewards-modal-close" onClick={onClose}>
            Close
          </button>
        </div>

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
            {pickerState.selectionMode === "pool"
              ? `Pool selected: ${pickerState.draftPoolItemIds.length} item(s)`
              : `Selected: ${itemMap.get(String(pickerState.draftSpecificItemId))?.name || "None selected"}`}
          </div>
        </div>

        <div className="round-rewards-modal-groups">
          {pickerState.selectionMode === "specific" ? (
            <button
              type="button"
              className={`round-rewards-item-card round-rewards-item-card--special ${
                !pickerState.draftSpecificItemId ? "is-selected" : ""
              }`}
              onClick={() => onSelectSpecificItem("")}
            >
              <div className="round-rewards-item-card-title">No Specific Item</div>
              <div className="round-rewards-item-card-meta">Clear the exact item from this reward slot.</div>
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
                    const isSelected =
                      pickerState.selectionMode === "pool"
                        ? pickerState.draftPoolItemIds.includes(item.id)
                        : pickerState.draftSpecificItemId === item.id;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`round-rewards-item-card ${isSelected ? "is-selected" : ""}`}
                        onClick={() => {
                          if (pickerState.selectionMode === "pool") {
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

function RewardOptionEditor({
  entry,
  option,
  itemMap,
  onChangeOptionKind,
  onChangeExactQuantity,
  onChangeRange,
  onOpenSpecificPicker,
  onOpenPoolPicker,
  onRemoveOption,
  canRemoveOption,
}) {
  const allowedKinds = getAllowedOptionKinds(entry.rewardKind);
  const optionSummary = describeOption(option, entry.rewardKind, itemMap);

  return (
    <div className="round-rewards-option-card">
      <div className="round-rewards-option-toprow">
        <label className="round-rewards-compact-field">
          <span>{entry.rewardKind === "choice" ? "Choice Option" : "Reward Type"}</span>
          <select
            value={option.optionKind}
            onChange={(event) => onChangeOptionKind(event.target.value)}
          >
            {allowedKinds.map((kind) => (
              <option key={kind} value={kind}>
                {OPTION_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>

        {canRemoveOption ? (
          <button
            type="button"
            className="round-rewards-icon-btn round-rewards-danger-btn"
            onClick={onRemoveOption}
          >
            Remove
          </button>
        ) : null}
      </div>

      {entry.rewardKind === "random" &&
      (option.optionKind === "shards" || option.optionKind === "feature_coins") ? (
        <RangeEditor
          label="Min - Max"
          minValue={option.quantityMin}
          maxValue={option.quantityMax}
          onMinChange={(value) => onChangeRange("quantityMin", value)}
          onMaxChange={(value) => onChangeRange("quantityMax", value)}
        />
      ) : null}

      {(entry.rewardKind !== "random" || option.optionKind === "specific_item" || option.optionKind === "random_item") &&
      option.optionKind !== "shards" &&
      option.optionKind !== "feature_coins" ? (
        <label className="round-rewards-compact-field">
          <span>{option.optionKind === "random_item" ? "Rolls" : "Quantity"}</span>
          <input
            type="number"
            min="0"
            value={option.exactQuantity}
            onChange={(event) => onChangeExactQuantity(Math.max(0, Number(event.target.value || 0)))}
          />
        </label>
      ) : null}

      {entry.rewardKind !== "random" &&
      (option.optionKind === "shards" || option.optionKind === "feature_coins") ? (
        <label className="round-rewards-compact-field">
          <span>Quantity</span>
          <input
            type="number"
            min="0"
            value={option.exactQuantity}
            onChange={(event) => onChangeExactQuantity(Math.max(0, Number(event.target.value || 0)))}
          />
        </label>
      ) : null}

      {option.optionKind === "specific_item" ? (
        <button type="button" className="round-rewards-picker-btn" onClick={onOpenSpecificPicker}>
          <div className="round-rewards-picker-btn-label">Specific Item</div>
          <div className="round-rewards-picker-btn-value">{optionSummary}</div>
        </button>
      ) : null}

      {option.optionKind === "random_item" ? (
        <button type="button" className="round-rewards-picker-btn" onClick={onOpenPoolPicker}>
          <div className="round-rewards-picker-btn-label">Random Pool</div>
          <div className="round-rewards-picker-btn-value">{optionSummary}</div>
          <div className="round-rewards-picker-btn-subvalue">
            {option.poolItemIds.length ? "Curated pool" : "Falls back to all reward-eligible items"}
          </div>
        </button>
      ) : null}
    </div>
  );
}

function RewardEntryCard({
  entry,
  itemMap,
  onChangeRewardKind,
  onChangeChoiceCount,
  onChangeOptionKind,
  onChangeOptionExactQuantity,
  onChangeOptionRange,
  onOpenSpecificPicker,
  onOpenPoolPicker,
  onAddChoiceOption,
  onRemoveChoiceOption,
  onRemoveEntry,
}) {
  return (
    <article className="round-rewards-entry-card">
      <div className="round-rewards-entry-header">
        <div>
          <div className="round-rewards-entry-kicker">
            {entry.placement == null ? "Shared Reward" : `Placement ${entry.placement}`}
          </div>
          <h3>
            {entry.rewardKind === "choice"
              ? `Choice Reward #${entry.entryOrder}`
              : entry.rewardKind === "random"
              ? `Random Reward #${entry.entryOrder}`
              : `Set Reward #${entry.entryOrder}`}
          </h3>
        </div>

        <div className="round-rewards-entry-actions">
          <label className="round-rewards-compact-field">
            <span>Reward Type</span>
            <select
              value={entry.rewardKind}
              onChange={(event) => onChangeRewardKind(event.target.value)}
            >
              {REWARD_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button type="button" className="round-rewards-icon-btn round-rewards-danger-btn" onClick={onRemoveEntry}>
            Remove
          </button>
        </div>
      </div>

      {entry.rewardKind === "choice" ? (
        <div className="round-rewards-entry-choicebar">
          <label className="round-rewards-compact-field round-rewards-compact-field--choicecount">
            <span>Choices To Give</span>
            <input
              type="number"
              min="1"
              max={Math.max(1, entry.options.length)}
              value={entry.choiceCount}
              onChange={(event) =>
                onChangeChoiceCount(
                  Math.min(
                    Math.max(1, Number(event.target.value || 1)),
                    Math.max(1, entry.options.length)
                  )
                )
              }
            />
          </label>

          <button type="button" className="round-rewards-secondary-btn" onClick={onAddChoiceOption}>
            + Add Choice
          </button>
        </div>
      ) : null}

      <div className="round-rewards-entry-options">
        {entry.options.map((option) => (
          <RewardOptionEditor
            key={option.localId}
            entry={entry}
            option={option}
            itemMap={itemMap}
            onChangeOptionKind={(value) => onChangeOptionKind(option.localId, value)}
            onChangeExactQuantity={(value) => onChangeOptionExactQuantity(option.localId, value)}
            onChangeRange={(key, value) => onChangeOptionRange(option.localId, key, value)}
            onOpenSpecificPicker={() => onOpenSpecificPicker(option.localId)}
            onOpenPoolPicker={() => onOpenPoolPicker(option.localId)}
            onRemoveOption={() => onRemoveChoiceOption(option.localId)}
            canRemoveOption={entry.rewardKind === "choice" && entry.options.length > 1}
          />
        ))}
      </div>
    </article>
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
  const [formState, setFormState] = useState(buildInitialFormState(0));
  const [pickerState, setPickerState] = useState({
    open: false,
    selectionMode: "specific",
    entryLocalId: "",
    optionLocalId: "",
    search: "",
    selectedCategory: "all",
    draftSpecificItemId: "",
    draftPoolItemIds: [],
  });

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
      items: [...group.items].sort((left, right) =>
        String(left.name || "").localeCompare(String(right.name || ""))
      ),
    }));
  }, [itemOptions]);

  const selectedConfig = useMemo(
    () => rewardConfigs.find((config) => config.id === formState.configId) || null,
    [rewardConfigs, formState.configId]
  );

  const sharedEntries = useMemo(
    () => formState.entries.filter((entry) => entry.placement == null),
    [formState.entries]
  );

  const placementEntries = useMemo(
    () =>
      Object.fromEntries(
        PLACEMENTS.map((placement) => [
          placement,
          formState.entries.filter((entry) => Number(entry.placement) === placement),
        ])
      ),
    [formState.entries]
  );

  useEffect(() => {
    if (!authLoading && user) {
      loadPage();
    }
  }, [authLoading, user]);

  async function loadPage(preferredConfigId = "") {
    if (!user) return;

    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const [activeSeriesResponse, itemsResponse, categoriesResponse] = await Promise.all([
        supabase.from("game_series").select("id, name").eq("is_current", true).maybeSingle(),
        supabase
          .from("item_definitions")
          .select("id, category_id, code, name, description, store_price, is_active")
          .eq("is_active", true)
          .order("name", { ascending: true }),
        supabase.from("item_categories").select("id, code, name"),
      ]);

      if (activeSeriesResponse.error) throw activeSeriesResponse.error;
      if (itemsResponse.error) throw itemsResponse.error;
      if (categoriesResponse.error) throw categoriesResponse.error;

      const seriesId = activeSeriesResponse.data?.id || null;
      setActiveSeriesId(seriesId);

      const categoryMap = new Map((categoriesResponse.data || []).map((row) => [row.id, row]));
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

      if (!seriesId) {
        setRewardConfigs([]);
        setFormState(buildInitialFormState(0));
        return;
      }

      const { data: configData, error: configError } = await supabase.rpc(
        "get_series_round_reward_editor_configs",
        { p_series_id: seriesId }
      );

      if (configError) throw configError;

      const configs = (configData || []).map((config) => ({
        id: config.id,
        roundNumber: normalizeInt(config.round_number, 0),
        roundStep: normalizeInt(config.round_step, 1),
        entries: normalizeEntries(
          (config.entries || []).map((entry) => ({
            id: entry.id,
            placement: entry.placement,
            entryOrder: entry.entry_order,
            rewardKind: entry.reward_kind,
            choiceCount: entry.choice_count,
            options: (entry.options || []).map((option) => ({
              id: option.id,
              optionKind: option.option_kind,
              exactQuantity: option.exact_quantity,
              quantityMin: option.quantity_min,
              quantityMax: option.quantity_max,
              itemDefinitionId: option.item_definition_id || "",
              poolItemIds: uniqueIds(option.pool_item_ids),
            })),
          }))
        ),
      }));

      setRewardConfigs(configs);

      const nextConfig =
        configs.find((config) => config.id === preferredConfigId) ||
        configs.find((config) => config.id === formState.configId) ||
        configs[0] ||
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
    setFormState({
      configId: config.id || "",
      roundNumber: normalizeInt(config.roundNumber, 0),
      roundStep: normalizeInt(config.roundStep, 1),
      entries: normalizeEntries(config.entries || []),
    });
    setPickerState((current) => ({ ...current, open: false }));
    setStatusMessage("");
    setErrorMessage("");
  }

  function handleNewConfig() {
    setFormState(buildInitialFormState(0));
    setPickerState((current) => ({ ...current, open: false }));
    setStatusMessage("");
    setErrorMessage("");
  }

  function updateEntries(updater) {
    setFormState((current) => ({
      ...current,
      entries: normalizeEntries(typeof updater === "function" ? updater(current.entries) : updater),
    }));
  }

  function updateEntry(entryLocalId, updater) {
    updateEntries((currentEntries) =>
      currentEntries.map((entry) =>
        entry.localId === entryLocalId ? normalizeEntry(updater(entry)) : entry
      )
    );
  }

  function updateOption(entryLocalId, optionLocalId, updater) {
    updateEntries((currentEntries) =>
      currentEntries.map((entry) => {
        if (entry.localId !== entryLocalId) return entry;
        return normalizeEntry({
          ...entry,
          options: entry.options.map((option) =>
            option.localId === optionLocalId ? updater(option) : option
          ),
        });
      })
    );
  }

  function addRewardEntry(placement, rewardKind) {
    updateEntries((currentEntries) => [...currentEntries, buildEmptyEntry(rewardKind, placement)]);
  }

  function removeRewardEntry(entryLocalId) {
    updateEntries((currentEntries) => currentEntries.filter((entry) => entry.localId !== entryLocalId));
  }

  function changeEntryRewardKind(entryLocalId, rewardKind) {
    updateEntry(entryLocalId, (entry) => {
      if (rewardKind === "choice") {
        const nextOptions = entry.options.length
          ? entry.options.map((option) => normalizeOptionForRewardKind(option, "choice"))
          : [buildEmptyOption("choice", "specific_item"), buildEmptyOption("choice", "shards")];

        if (nextOptions.length === 1) {
          nextOptions.push(buildEmptyOption("choice", "shards"));
        }

        return {
          ...entry,
          rewardKind,
          choiceCount: Math.min(Math.max(1, entry.choiceCount || 1), nextOptions.length),
          options: nextOptions,
        };
      }

      return {
        ...entry,
        rewardKind,
        choiceCount: 1,
        options: [normalizeOptionForRewardKind(entry.options[0] || buildEmptyOption(rewardKind), rewardKind)],
      };
    });
  }

  function addChoiceOption(entryLocalId) {
    updateEntry(entryLocalId, (entry) => ({
      ...entry,
      options: [...entry.options, buildEmptyOption("choice", "specific_item")],
    }));
  }

  function removeChoiceOption(entryLocalId, optionLocalId) {
    updateEntry(entryLocalId, (entry) => {
      const nextOptions = entry.options.filter((option) => option.localId !== optionLocalId);
      return {
        ...entry,
        choiceCount: Math.min(Math.max(1, entry.choiceCount), Math.max(1, nextOptions.length)),
        options: nextOptions,
      };
    });
  }

  function openItemPicker(entryLocalId, optionLocalId, selectionMode) {
    const entry = formState.entries.find((row) => row.localId === entryLocalId);
    const option = entry?.options.find((row) => row.localId === optionLocalId);
    if (!entry || !option) return;

    setPickerState({
      open: true,
      selectionMode,
      entryLocalId,
      optionLocalId,
      search: "",
      selectedCategory: "all",
      draftSpecificItemId: option.itemDefinitionId || "",
      draftPoolItemIds: [...(option.poolItemIds || [])],
    });
  }

  function applyItemPicker() {
    updateOption(pickerState.entryLocalId, pickerState.optionLocalId, (option) => ({
      ...option,
      itemDefinitionId:
        pickerState.selectionMode === "specific" ? pickerState.draftSpecificItemId || "" : "",
      poolItemIds:
        pickerState.selectionMode === "pool" ? [...pickerState.draftPoolItemIds] : option.poolItemIds,
    }));

    setPickerState((current) => ({ ...current, open: false }));
  }

  function handleDuplicateConfig() {
    const nextRoundNumber =
      formState.roundNumber === 0
        ? 1
        : formState.roundStep === 1
        ? formState.roundNumber
        : formState.roundNumber + 1;
    const nextRoundStep = formState.roundNumber === 0 ? 1 : formState.roundStep === 1 ? 2 : 1;

    setFormState({
      configId: "",
      roundNumber: nextRoundNumber,
      roundStep: nextRoundStep,
      entries: normalizeEntries(
        formState.entries.map((entry) => ({
          ...entry,
          id: "",
          localId: makeLocalId(),
          options: entry.options.map((option) => ({
            ...option,
            id: "",
            localId: makeLocalId(),
          })),
        }))
      ),
    });
    setStatusMessage("Config duplicated into a new unsaved round.");
    setErrorMessage("");
  }

  function serializeEntries(entries) {
    return normalizeEntries(entries).map((entry) => ({
      placement: entry.placement == null ? null : Number(entry.placement),
      entry_order: entry.entryOrder,
      reward_kind: entry.rewardKind,
      choice_count: entry.rewardKind === "choice" ? entry.choiceCount : 1,
      options: entry.options.map((option, index) => ({
        option_order: index + 1,
        option_kind: option.optionKind,
        exact_quantity: Math.max(0, option.exactQuantity),
        quantity_min: Math.max(0, option.quantityMin),
        quantity_max: Math.max(0, option.quantityMax),
        item_definition_id: option.itemDefinitionId || null,
        pool_item_ids: uniqueIds(option.poolItemIds),
      })),
    }));
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
      const { data, error } = await supabase.rpc("save_series_round_reward_config", {
        p_series_id: activeSeriesId,
        p_config_id: formState.configId || null,
        p_round_number: Math.max(0, Number(formState.roundNumber || 0)),
        p_round_step: Number(formState.roundStep || 1),
        p_entries: serializeEntries(formState.entries),
      });

      if (error) throw error;

      setStatusMessage(`${formatRoundLabel(formState.roundNumber, formState.roundStep)} saved.`);
      await loadPage(data);
    } catch (error) {
      console.error("Failed to save round reward config:", error);
      setErrorMessage(error.message || "Failed to save round reward config.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteConfig() {
    if (!activeSeriesId || !formState.configId) return;

    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const { error } = await supabase.rpc("delete_series_round_reward_config", {
        p_series_id: activeSeriesId,
        p_config_id: formState.configId,
      });

      if (error) throw error;

      setStatusMessage("Round reward config deleted.");
      await loadPage("");
    } catch (error) {
      console.error("Failed to delete round reward config:", error);
      setErrorMessage(error.message || "Failed to delete round reward config.");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;
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
              Build shared rewards, placement rewards, random pools, and player
              choice rewards from one cleaner editor.
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
                  <p>Load an existing reward config or start a fresh one.</p>
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
                      onClick={() => hydrateForm(config)}
                    >
                      <div className="round-rewards-config-row-title">
                        {formatRoundLabel(config.roundNumber, config.roundStep)}
                      </div>
                      <div className="round-rewards-config-row-meta">{getConfigSummary(config)}</div>
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
                    <p>Keep the round target compact, then duplicate or fine tune from there.</p>
                  </div>

                  <div className="round-rewards-chooser-actions">
                    {formState.entries.length ? (
                      <button
                        type="button"
                        className="round-rewards-secondary-btn"
                        onClick={handleDuplicateConfig}
                      >
                        Duplicate Config
                      </button>
                    ) : null}
                    {formState.configId ? (
                      <button
                        type="button"
                        className="round-rewards-danger-btn"
                        onClick={deleteConfig}
                      >
                        Delete Config
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="round-rewards-chooser-row">
                  <label className="round-rewards-compact-field">
                    <span>Round</span>
                    <input
                      type="number"
                      min="0"
                      value={formState.roundNumber}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          roundNumber: Math.max(0, Number(event.target.value || 0)),
                        }))
                      }
                    />
                  </label>

                  <label className="round-rewards-compact-field round-rewards-compact-field--step">
                    <span>Step</span>
                    <select
                      value={formState.roundStep}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          roundStep: Number(event.target.value || 1),
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
                    {formatRoundLabel(formState.roundNumber, formState.roundStep)}
                  </div>
                </div>
              </section>

              <section className="round-rewards-card round-rewards-shared-card">
                <div className="round-rewards-section-header">
                  <div>
                    <h2>Shared Rewards</h2>
                    <p>These reward rows apply to every player result in this round.</p>
                  </div>
                  <div className="round-rewards-add-actions">
                    <button type="button" className="round-rewards-secondary-btn" onClick={() => addRewardEntry(null, "set")}>
                      + Set
                    </button>
                    <button type="button" className="round-rewards-secondary-btn" onClick={() => addRewardEntry(null, "random")}>
                      + Random
                    </button>
                    <button type="button" className="round-rewards-secondary-btn" onClick={() => addRewardEntry(null, "choice")}>
                      + Choice
                    </button>
                  </div>
                </div>

                <div className="round-rewards-entry-list">
                  {sharedEntries.length === 0 ? (
                    <div className="round-rewards-empty">No shared rewards configured yet.</div>
                  ) : (
                    sharedEntries.map((entry) => (
                      <RewardEntryCard
                        key={entry.localId}
                        entry={entry}
                        itemMap={itemMap}
                        onChangeRewardKind={(value) => changeEntryRewardKind(entry.localId, value)}
                        onChangeChoiceCount={(value) =>
                          updateEntry(entry.localId, (currentEntry) => ({
                            ...currentEntry,
                            choiceCount: value,
                          }))
                        }
                        onChangeOptionKind={(optionLocalId, value) =>
                          updateOption(entry.localId, optionLocalId, (option) =>
                            normalizeOptionForRewardKind({ ...option, optionKind: value }, entry.rewardKind)
                          )
                        }
                        onChangeOptionExactQuantity={(optionLocalId, value) =>
                          updateOption(entry.localId, optionLocalId, (option) => ({
                            ...option,
                            exactQuantity: value,
                          }))
                        }
                        onChangeOptionRange={(optionLocalId, key, value) =>
                          updateOption(entry.localId, optionLocalId, (option) => ({
                            ...option,
                            [key]: value,
                          }))
                        }
                        onOpenSpecificPicker={(optionLocalId) =>
                          openItemPicker(entry.localId, optionLocalId, "specific")
                        }
                        onOpenPoolPicker={(optionLocalId) =>
                          openItemPicker(entry.localId, optionLocalId, "pool")
                        }
                        onAddChoiceOption={() => addChoiceOption(entry.localId)}
                        onRemoveChoiceOption={(optionLocalId) =>
                          removeChoiceOption(entry.localId, optionLocalId)
                        }
                        onRemoveEntry={() => removeRewardEntry(entry.localId)}
                      />
                    ))
                  )}
                </div>
              </section>

              <section className="round-rewards-placement-grid">
                {PLACEMENTS.map((placement) => (
                  <article className="round-rewards-card round-rewards-placement-card" key={placement}>
                    <div className="round-rewards-section-header">
                      <div>
                        <div className="round-rewards-placement-kicker">Placement</div>
                        <h2>{placement}</h2>
                        <p>Build this placement’s direct rewards and player choices here.</p>
                      </div>
                      <div className="round-rewards-add-actions">
                        <button type="button" className="round-rewards-secondary-btn" onClick={() => addRewardEntry(placement, "set")}>
                          + Set
                        </button>
                        <button type="button" className="round-rewards-secondary-btn" onClick={() => addRewardEntry(placement, "random")}>
                          + Random
                        </button>
                        <button type="button" className="round-rewards-secondary-btn" onClick={() => addRewardEntry(placement, "choice")}>
                          + Choice
                        </button>
                      </div>
                    </div>

                    <div className="round-rewards-entry-list">
                      {placementEntries[placement]?.length ? (
                        placementEntries[placement].map((entry) => (
                          <RewardEntryCard
                            key={entry.localId}
                            entry={entry}
                            itemMap={itemMap}
                            onChangeRewardKind={(value) => changeEntryRewardKind(entry.localId, value)}
                            onChangeChoiceCount={(value) =>
                              updateEntry(entry.localId, (currentEntry) => ({
                                ...currentEntry,
                                choiceCount: value,
                              }))
                            }
                            onChangeOptionKind={(optionLocalId, value) =>
                              updateOption(entry.localId, optionLocalId, (option) =>
                                normalizeOptionForRewardKind({ ...option, optionKind: value }, entry.rewardKind)
                              )
                            }
                            onChangeOptionExactQuantity={(optionLocalId, value) =>
                              updateOption(entry.localId, optionLocalId, (option) => ({
                                ...option,
                                exactQuantity: value,
                              }))
                            }
                            onChangeOptionRange={(optionLocalId, key, value) =>
                              updateOption(entry.localId, optionLocalId, (option) => ({
                                ...option,
                                [key]: value,
                              }))
                            }
                            onOpenSpecificPicker={(optionLocalId) =>
                              openItemPicker(entry.localId, optionLocalId, "specific")
                            }
                            onOpenPoolPicker={(optionLocalId) =>
                              openItemPicker(entry.localId, optionLocalId, "pool")
                            }
                            onAddChoiceOption={() => addChoiceOption(entry.localId)}
                            onRemoveChoiceOption={(optionLocalId) =>
                              removeChoiceOption(entry.localId, optionLocalId)
                            }
                            onRemoveEntry={() => removeRewardEntry(entry.localId)}
                          />
                        ))
                      ) : (
                        <div className="round-rewards-empty">No placement rewards configured yet.</div>
                      )}
                    </div>
                  </article>
                ))}
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

        <RewardItemPickerModal
          pickerState={pickerState}
          itemGroups={itemGroups}
          itemMap={itemMap}
          onClose={() => setPickerState((current) => ({ ...current, open: false }))}
          onApply={applyItemPicker}
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
