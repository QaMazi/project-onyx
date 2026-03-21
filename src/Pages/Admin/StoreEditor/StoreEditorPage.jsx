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
import "../../Store/StorePage.css";
import "./StoreEditorPage.css";

const EXCHANGE_CATEGORY_CODE = "currency_exchange";
const RETIRED_CATEGORY_CODE = "retired_legacy";

function buildCategorySummary(items) {
  return {
    total: items.length,
    active: items.filter((item) => item.is_active !== false).length,
    locked: items.filter((item) => item.is_store_purchase_locked).length,
    rngLocked: items.filter((item) => item.is_reward_rng_locked).length,
  };
}

function buildExchangeDraft(config) {
  return {
    shardsPerFeatureCoin: String(
      Number(config?.shards_per_feature_coin || 10)
    ),
    featureCoinToShardsRate: String(
      Number(config?.feature_coin_to_shards_rate || 5)
    ),
    feePercent: String(Number(config?.fee_percent || 0)),
  };
}

function StoreEditorPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [savingExchange, setSavingExchange] = useState(false);
  const [randomizing, setRandomizing] = useState(false);
  const [items, setItems] = useState([]);
  const [draftsByItem, setDraftsByItem] = useState({});
  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [activeSeriesName, setActiveSeriesName] = useState("");
  const [exchangeConfig, setExchangeConfig] = useState(null);
  const [exchangeDraft, setExchangeDraft] = useState(() => buildExchangeDraft(null));
  const [categorySearch, setCategorySearch] = useState("");
  const [modalSearch, setModalSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const canUsePage = user?.role === "Admin+" || user?.role === "Admin";

  async function loadStoreItems() {
    setLoading(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const { data: currentSeries, error: currentSeriesError } = await supabase
        .from("game_series")
        .select("id, name")
        .eq("is_current", true)
        .maybeSingle();

      if (currentSeriesError) throw currentSeriesError;

      const [{ data: itemsData, error: itemsError }, { data: categoriesData, error: categoriesError }, exchangeResponse] =
        await Promise.all([
          supabase
            .from("item_definitions")
            .select(
              "id, category_id, code, name, description, image_url, max_purchase, store_price, is_active, is_store_purchase_locked, is_reward_rng_locked, is_randomly_available, store_order, behavior_code, exact_item_family"
            )
            .order("store_order", { ascending: true })
            .order("name", { ascending: true }),
          supabase.from("item_categories").select("id, code, name"),
          currentSeries?.id
            ? supabase.rpc("get_series_currency_exchange_config", {
                p_series_id: currentSeries.id,
              })
            : Promise.resolve({ data: null, error: null }),
        ]);

      if (itemsError) throw itemsError;
      if (categoriesError) throw categoriesError;
      if (exchangeResponse?.error) throw exchangeResponse.error;

      setActiveSeriesId(currentSeries?.id || null);
      setActiveSeriesName(currentSeries?.name || "");
      setExchangeConfig(exchangeResponse?.data || null);
      setExchangeDraft(buildExchangeDraft(exchangeResponse?.data || null));

      const categoryMap = new Map((categoriesData || []).map((row) => [row.id, row]));
      const nextItems = (itemsData || []).map((item) => {
        const category = categoryMap.get(item.category_id);

        return {
          ...item,
          category_code: normalizeStoreCategoryCode(category?.code),
          category_name: formatStoreCategoryName(category?.code, category?.name),
        };
      });

      setItems(nextItems);
      setDraftsByItem(
        nextItems.reduce((accumulator, item) => {
          accumulator[item.id] = {
            storePrice: String(Number(item.store_price || 0)),
            isStorePurchaseLocked: Boolean(item.is_store_purchase_locked),
            isRewardRngLocked: Boolean(item.is_reward_rng_locked),
            isRandomlyAvailable: item.is_randomly_available !== false,
            isActive: item.is_active !== false,
          };
          return accumulator;
        }, {})
      );
    } catch (error) {
      console.error("Failed to load store editor:", error);
      setErrorMessage(error.message || "Failed to load store items.");
      setItems([]);
      setDraftsByItem({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && user) {
      loadStoreItems();
    }
  }, [authLoading, user]);

  const categoryGroups = useMemo(() => {
    const grouped = new Map();
    const retiredItems = [];

    for (const item of items) {
      if (item.is_active === false) {
        retiredItems.push(item);
        continue;
      }

      const code = item.category_code || "other";
      if (code === "currency") {
        retiredItems.push(item);
        continue;
      }

      if (!grouped.has(code)) {
        grouped.set(code, {
          code,
          label: item.category_name || formatStoreCategoryName(code),
          items: [],
        });
      }

      grouped.get(code).items.push(item);
    }

    const nextGroups = sortStoreGroups(
      Array.from(grouped.values()).map((group) => ({
        ...group,
        summary: buildCategorySummary(group.items),
      }))
    );

    nextGroups.push({
      code: EXCHANGE_CATEGORY_CODE,
      label: "Currency Exchange",
      items: [],
      summary: {
        total: 0,
        active: 0,
        locked: 0,
        rngLocked: 0,
      },
      isExchange: true,
    });

    if (retiredItems.length > 0) {
      nextGroups.push({
        code: RETIRED_CATEGORY_CODE,
        label: "Retired & Legacy",
        items: retiredItems,
        summary: buildCategorySummary(retiredItems),
        isRetired: true,
      });
    }

    return nextGroups;
  }, [items]);

  const visibleCategoryGroups = useMemo(() => {
    const query = categorySearch.trim().toLowerCase();

    if (!query) return categoryGroups;

    return categoryGroups.filter((group) => {
      if (String(group.label || "").toLowerCase().includes(query)) return true;

      return group.items.some((item) => {
        return (
          String(item.name || "").toLowerCase().includes(query) ||
          String(item.description || "").toLowerCase().includes(query) ||
          String(item.code || "").toLowerCase().includes(query)
        );
      });
    });
  }, [categoryGroups, categorySearch]);

  const selectedCategoryGroup = useMemo(() => {
    if (!selectedCategory) return null;
    return categoryGroups.find((group) => group.code === selectedCategory) || null;
  }, [categoryGroups, selectedCategory]);

  const activeEditableItems = useMemo(
    () => items.filter((item) => item.is_active !== false && item.category_code !== "currency"),
    [items]
  );

  const retiredItems = useMemo(
    () => items.filter((item) => item.is_active === false || item.category_code === "currency"),
    [items]
  );

  const openerItems = useMemo(
    () => items.filter((item) => normalizeStoreCategoryCode(item.category_code) === "container_openers"),
    [items]
  );

  const filteredModalItems = useMemo(() => {
    const query = modalSearch.trim().toLowerCase();
    const groupItems = selectedCategoryGroup?.items || [];

    if (!query) return groupItems;

    return groupItems.filter((item) => {
      return (
        String(item.name || "").toLowerCase().includes(query) ||
        String(item.description || "").toLowerCase().includes(query) ||
        String(item.code || "").toLowerCase().includes(query)
      );
    });
  }, [modalSearch, selectedCategoryGroup]);

  async function handleSaveItem(item) {
    const draft = draftsByItem[item.id];
    const nextPrice = Number(draft?.storePrice);

    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      setErrorMessage("Store prices must be 0 or greater.");
      setStatusMessage("");
      return;
    }

    setSavingId(item.id);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const { error } = await supabase.rpc("set_store_item_admin_state", {
        p_item_definition_id: item.id,
        p_store_price: Math.floor(nextPrice),
        p_is_store_purchase_locked: Boolean(draft?.isStorePurchaseLocked),
        p_is_reward_rng_locked: Boolean(draft?.isRewardRngLocked),
        p_is_randomly_available: Boolean(draft?.isRandomlyAvailable),
        p_is_active: Boolean(draft?.isActive),
      });

      if (error) throw error;

      setStatusMessage(`Updated ${item.name}.`);
      await loadStoreItems();
    } catch (error) {
      console.error("Failed to update store item:", error);
      setErrorMessage(error.message || "Failed to update store item.");
    } finally {
      setSavingId("");
    }
  }

  async function handleRandomizeAvailability() {
    if (
      !selectedCategoryGroup ||
      selectedCategoryGroup.code === EXCHANGE_CATEGORY_CODE ||
      selectedCategoryGroup.code === RETIRED_CATEGORY_CODE
    ) {
      return;
    }

    setRandomizing(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const { error } = await supabase.rpc("randomize_store_item_availability", {
        p_category_code: selectedCategoryGroup?.code || null,
        p_enabled_ratio: 0.5,
      });

      if (error) throw error;

      setStatusMessage(
        selectedCategoryGroup
          ? `Randomized availability for ${selectedCategoryGroup.label}.`
          : "Randomized store availability across all categories."
      );
      await loadStoreItems();
    } catch (error) {
      console.error("Failed to randomize store availability:", error);
      setErrorMessage(error.message || "Failed to randomize store availability.");
    } finally {
      setRandomizing(false);
    }
  }

  function updateDraft(itemId, patch) {
    setDraftsByItem((current) => ({
      ...current,
      [itemId]: {
        ...current[itemId],
        ...patch,
      },
    }));
  }

  function closeCategoryModal() {
    setSelectedCategory(null);
    setModalSearch("");
  }

  async function handleSaveExchangeConfig() {
    if (!activeSeriesId) {
      setErrorMessage("No active series found for exchange settings.");
      setStatusMessage("");
      return;
    }

    const nextShardsPerFeatureCoin = Number(exchangeDraft.shardsPerFeatureCoin);
    const nextFeatureCoinToShardsRate = Number(exchangeDraft.featureCoinToShardsRate);
    const nextFeePercent = Number(exchangeDraft.feePercent);

    if (
      !Number.isFinite(nextShardsPerFeatureCoin) ||
      !Number.isFinite(nextFeatureCoinToShardsRate) ||
      !Number.isFinite(nextFeePercent)
    ) {
      setErrorMessage("Exchange values must be valid numbers.");
      setStatusMessage("");
      return;
    }

    setSavingExchange(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const { error } = await supabase.rpc("upsert_series_currency_exchange_config", {
        p_series_id: activeSeriesId,
        p_shards_per_feature_coin: nextShardsPerFeatureCoin,
        p_feature_coin_to_shards_rate: nextFeatureCoinToShardsRate,
        p_fee_percent: nextFeePercent,
      });

      if (error) throw error;

      setStatusMessage("Currency exchange settings updated.");
      await loadStoreItems();
    } catch (error) {
      console.error("Failed to update currency exchange settings:", error);
      setErrorMessage(error.message || "Failed to update exchange settings.");
    } finally {
      setSavingExchange(false);
    }
  }

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (!canUsePage) return <Navigate to="/mode/progression" replace />;

  return (
    <LauncherLayout>
      <div className="store-page store-editor-shell">
        <div className="store-topbar onyx-panel">
          <div>
            <div className="store-kicker">ADMIN</div>
            <h1 className="store-title">Store Editor</h1>
            <p className="store-subtitle">
              Browse the store by category, open the matching editor panel, and
              tune price, purchase locks, reward locks, and randomized availability
              without leaving the store-style layout.
            </p>
          </div>

          <div className="store-topbar-right">
            <div className="store-shards-card store-editor-stat-card">
              <span className="store-shards-label">Active Items</span>
              <span className="store-shards-value">{activeEditableItems.length}</span>
            </div>

            <div className="store-shards-card store-feature-coin-card store-editor-stat-card">
              <span className="store-shards-label">Categories</span>
              <span className="store-shards-value">{categoryGroups.length}</span>
            </div>

            <div className="store-shards-card store-editor-stat-card">
              <span className="store-shards-label">Retired</span>
              <span className="store-shards-value">{retiredItems.length}</span>
            </div>

            <button
              type="button"
              className="store-back-btn"
              onClick={() => navigate("/mode/progression")}
            >
              Back
            </button>
          </div>
        </div>

        {statusMessage ? <div className="store-editor-success">{statusMessage}</div> : null}
        {errorMessage ? <div className="store-editor-error">{errorMessage}</div> : null}

        {loading ? (
          <div className="onyx-panel store-empty">Loading store items...</div>
        ) : (
          <div className="store-layout">
            <div className="store-left">
              <div className="onyx-panel store-editor-search-panel">
                <input
                  type="text"
                  className="store-search"
                  value={categorySearch}
                  onChange={(event) => setCategorySearch(event.target.value)}
                  placeholder="Search categories or store items..."
                />
              </div>

              <div className="store-category-grid store-editor-category-grid">
                {visibleCategoryGroups.length === 0 ? (
                  <div className="onyx-panel store-empty">No categories matched your search.</div>
                ) : (
                  visibleCategoryGroups.map((group) => (
                    <button
                      key={group.code}
                      type="button"
                      className="onyx-panel store-category-card store-editor-category-card"
                      onClick={() => setSelectedCategory(group.code)}
                    >
                      <div className="store-category-card-label">{group.label}</div>
                      <div className="store-category-card-count">
                        {group.code === EXCHANGE_CATEGORY_CODE
                          ? activeSeriesName
                            ? `Exchange For ${activeSeriesName}`
                            : "Exchange Settings"
                          : group.code === RETIRED_CATEGORY_CODE
                            ? `${group.summary.total} Retired Items`
                            : `${group.summary.total} Items | ${group.summary.active} Active`}
                      </div>

                      <div className="store-editor-category-tags">
                        {group.code === EXCHANGE_CATEGORY_CODE ? (
                          <>
                            <span>
                              {exchangeConfig
                                ? `${Number(exchangeConfig.shards_per_feature_coin || 0)} Shards / FC`
                                : "Awaiting Series"}
                            </span>
                            <span>
                              {exchangeConfig
                                ? `${Number(exchangeConfig.fee_percent || 0)}% Fee`
                                : "No Config"}
                            </span>
                          </>
                        ) : group.code === RETIRED_CATEGORY_CODE ? (
                          <>
                            <span>{group.summary.total} Hidden From Store</span>
                            <span>Restore Or Leave Archived</span>
                          </>
                        ) : (
                          <>
                            <span>{group.summary.locked} Purchase Locked</span>
                            <span>{group.summary.rngLocked} Reward Locked</span>
                          </>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="store-right">
              <div className="onyx-panel store-cart-panel store-editor-side-panel">
                <div className="store-cart-header">
                  <h2>Admin Tools</h2>
                  <div className="store-cart-total">
                    {selectedCategoryGroup ? selectedCategoryGroup.label : "All Categories"}
                  </div>
                </div>

                <div className="store-editor-side-copy">
                  Edit the live store from the same category structure players
                  actually use, while keeping opener key pricing and exchange
                  rates available here too.
                </div>

                <div className="store-editor-side-stats">
                  <div className="store-exchange-rate-row">
                    <span>Visible Categories</span>
                    <strong>{visibleCategoryGroups.length}</strong>
                  </div>
                  <div className="store-exchange-rate-row">
                    <span>Container Keys</span>
                    <strong>{openerItems.length}</strong>
                  </div>
                  <div className="store-exchange-rate-row">
                    <span>Selected Category Items</span>
                    <strong>{selectedCategoryGroup?.summary.total || 0}</strong>
                  </div>
                  <div className="store-exchange-rate-row">
                    <span>Active Series</span>
                    <strong>{activeSeriesName || "None"}</strong>
                  </div>
                  <div className="store-exchange-rate-row">
                    <span>Exchange Fee</span>
                    <strong>
                      {exchangeConfig ? `${Number(exchangeConfig.fee_percent || 0)}%` : "--"}
                    </strong>
                  </div>
                </div>

                <button
                  type="button"
                  className="store-checkout-btn store-editor-randomize-btn"
                  onClick={handleRandomizeAvailability}
                  disabled={
                    randomizing ||
                    !selectedCategoryGroup ||
                    selectedCategoryGroup.code === EXCHANGE_CATEGORY_CODE ||
                    selectedCategoryGroup.code === RETIRED_CATEGORY_CODE
                  }
                >
                  {randomizing
                    ? "Randomizing..."
                    : selectedCategoryGroup &&
                      selectedCategoryGroup.code !== EXCHANGE_CATEGORY_CODE &&
                      selectedCategoryGroup.code !== RETIRED_CATEGORY_CODE
                      ? `Randomize ${selectedCategoryGroup.label}`
                      : "Choose a store category"}
                </button>
              </div>
            </div>
          </div>
        )}

        {selectedCategoryGroup ? (
          <div className="store-modal-overlay" onClick={closeCategoryModal}>
            <div
              className="onyx-panel store-modal store-editor-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="store-modal-header">
                <div>
                  <div className="store-kicker">
                    {selectedCategoryGroup.code === EXCHANGE_CATEGORY_CODE
                      ? "EXCHANGE EDITOR"
                      : selectedCategoryGroup.code === RETIRED_CATEGORY_CODE
                        ? "RETIRED ITEMS"
                        : "CATEGORY EDITOR"}
                  </div>
                  <h2 className="store-modal-title">{selectedCategoryGroup.label}</h2>
                </div>

                <button
                  type="button"
                  className="store-modal-close"
                  onClick={closeCategoryModal}
                >
                  x
                </button>
              </div>

              {selectedCategoryGroup.code === EXCHANGE_CATEGORY_CODE ? (
                <div className="store-editor-exchange-panel">
                  <div className="store-editor-side-copy">
                    Set the live Shards to Feature Coin transfer cost and the
                    fee on converting Feature Coins back into Shards for the
                    current active series.
                  </div>

                  <div className="store-editor-exchange-grid">
                    <label className="store-editor-field">
                      <span>Shards Per Feature Coin</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className="store-qty-input store-editor-price-input"
                        value={exchangeDraft.shardsPerFeatureCoin}
                        onChange={(event) =>
                          setExchangeDraft((current) => ({
                            ...current,
                            shardsPerFeatureCoin: event.target.value,
                          }))
                        }
                        disabled={savingExchange}
                      />
                    </label>

                    <label className="store-editor-field">
                      <span>Feature Coin To Shards Rate</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className="store-qty-input store-editor-price-input"
                        value={exchangeDraft.featureCoinToShardsRate}
                        onChange={(event) =>
                          setExchangeDraft((current) => ({
                            ...current,
                            featureCoinToShardsRate: event.target.value,
                          }))
                        }
                        disabled={savingExchange}
                      />
                    </label>

                    <label className="store-editor-field">
                      <span>Transfer Fee %</span>
                      <input
                        type="number"
                        min="0"
                        max="99.99"
                        step="0.01"
                        className="store-qty-input store-editor-price-input"
                        value={exchangeDraft.feePercent}
                        onChange={(event) =>
                          setExchangeDraft((current) => ({
                            ...current,
                            feePercent: event.target.value,
                          }))
                        }
                        disabled={savingExchange}
                      />
                    </label>
                  </div>

                  <div className="store-editor-exchange-summary">
                    <div className="store-exchange-rate-row">
                      <span>Active Series</span>
                      <strong>{activeSeriesName || "None"}</strong>
                    </div>
                    <div className="store-exchange-rate-row">
                      <span>Current Shards Per FC</span>
                      <strong>
                        {exchangeConfig
                          ? Number(exchangeConfig.shards_per_feature_coin || 0)
                          : "--"}
                      </strong>
                    </div>
                    <div className="store-exchange-rate-row">
                      <span>Current FC To Shards</span>
                      <strong>
                        {exchangeConfig
                          ? Number(exchangeConfig.feature_coin_to_shards_rate || 0)
                          : "--"}
                      </strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="store-add-btn store-editor-save-btn"
                    onClick={handleSaveExchangeConfig}
                    disabled={savingExchange || !activeSeriesId}
                  >
                    {savingExchange ? "Saving..." : "Save Exchange Settings"}
                  </button>
                </div>
              ) : (
                <>
                  <div className="store-modal-toolbar store-editor-modal-toolbar">
                    <input
                      type="text"
                      value={modalSearch}
                      onChange={(event) => setModalSearch(event.target.value)}
                      placeholder={`Search ${selectedCategoryGroup.label}...`}
                      className="store-search"
                    />

                    <button
                      type="button"
                      className="store-add-btn store-editor-randomize-inline-btn"
                      onClick={handleRandomizeAvailability}
                      disabled={randomizing || selectedCategoryGroup.code === RETIRED_CATEGORY_CODE}
                    >
                      {randomizing
                        ? "Randomizing..."
                        : selectedCategoryGroup.code === RETIRED_CATEGORY_CODE
                          ? "Retired Category"
                          : "Randomize This Category"}
                    </button>
                  </div>

                  <div className="store-modal-items">
                    {filteredModalItems.length === 0 ? (
                      <div className="store-empty">No items found.</div>
                    ) : (
                      filteredModalItems.map((item) => {
                        const draft = draftsByItem[item.id] || {};
                        const isSaving = savingId === item.id;

                        return (
                          <div
                            key={item.id}
                            className="store-modal-item store-editor-modal-item"
                          >
                            <div className="store-modal-item-main">
                              <div className="store-editor-item-header">
                                <div className="store-editor-item-art">
                                  {item.image_url ? (
                                    <img src={item.image_url} alt={item.name} />
                                  ) : (
                                    <span>{String(item.name || "?").slice(0, 1).toUpperCase()}</span>
                                  )}
                                </div>

                                <div>
                                  <div className="store-item-name">{item.name}</div>
                                  <div className="store-item-desc">
                                    {item.description || "No description yet."}
                                  </div>
                                </div>
                              </div>

                              <div className="store-item-flags">
                                <span className="store-item-flag">{item.code}</span>
                                <span className="store-item-flag">
                                  Max {item.max_purchase || 99}
                                </span>
                                {item.exact_item_family ? (
                                  <span className="store-item-flag">{item.exact_item_family}</span>
                                ) : null}
                                {item.is_active === false ? (
                                  <span className="store-item-flag is-locked">Retired</span>
                                ) : null}
                              </div>
                            </div>

                            <div className="store-modal-item-side store-editor-controls">
                              <label className="store-editor-field">
                                <span>Price</span>
                                <input
                                  type="number"
                                  min="0"
                                  className="store-qty-input store-editor-price-input"
                                  value={draft.storePrice ?? String(Number(item.store_price || 0))}
                                  onChange={(event) =>
                                    updateDraft(item.id, {
                                      storePrice: event.target.value,
                                    })
                                  }
                                  disabled={isSaving}
                                />
                              </label>

                              <label className="store-editor-toggle">
                                <input
                                  type="checkbox"
                                  checked={Boolean(draft.isActive)}
                                  onChange={(event) =>
                                    updateDraft(item.id, {
                                      isActive: event.target.checked,
                                    })
                                  }
                                  disabled={isSaving}
                                />
                                <span>Active In Store</span>
                              </label>

                              <label className="store-editor-toggle">
                                <input
                                  type="checkbox"
                                  checked={Boolean(draft.isStorePurchaseLocked)}
                                  onChange={(event) =>
                                    updateDraft(item.id, {
                                      isStorePurchaseLocked: event.target.checked,
                                    })
                                  }
                                  disabled={isSaving}
                                />
                                <span>Purchase Locked</span>
                              </label>

                              <label className="store-editor-toggle">
                                <input
                                  type="checkbox"
                                  checked={Boolean(draft.isRewardRngLocked)}
                                  onChange={(event) =>
                                    updateDraft(item.id, {
                                      isRewardRngLocked: event.target.checked,
                                    })
                                  }
                                  disabled={isSaving}
                                />
                                <span>Reward RNG Locked</span>
                              </label>

                              <label className="store-editor-toggle">
                                <input
                                  type="checkbox"
                                  checked={Boolean(draft.isRandomlyAvailable)}
                                  onChange={(event) =>
                                    updateDraft(item.id, {
                                      isRandomlyAvailable: event.target.checked,
                                    })
                                  }
                                  disabled={isSaving}
                                />
                                <span>Randomly Available</span>
                              </label>

                              <button
                                type="button"
                                className="store-add-btn store-editor-save-btn"
                                onClick={() => handleSaveItem(item)}
                                disabled={isSaving}
                              >
                                {isSaving ? "Saving..." : "Save Item"}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </LauncherLayout>
  );
}

export default StoreEditorPage;
