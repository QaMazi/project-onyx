import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";
import {
  formatStoreCategoryName,
  normalizeStoreCategoryCode,
  sortStoreGroups,
} from "../../lib/storeCatalog";

import "./StorePage.css";

const HIDDEN_STORE_CATEGORY_CODES = new Set([
  "feature_tokens",
  "collection_notices",
  "container_openers",
]);

function StorePage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exchangeBusy, setExchangeBusy] = useState(false);
  const [error, setError] = useState("");

  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [shards, setShards] = useState(0);
  const [featureCoins, setFeatureCoins] = useState(0);

  const [catalog, setCatalog] = useState([]);
  const [cartItems, setCartItems] = useState([]);
  const [exchangeConfig, setExchangeConfig] = useState(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [quantityByItem, setQuantityByItem] = useState({});
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [exchangeForm, setExchangeForm] = useState({
    fromCurrency: "shards",
    amount: "10",
  });

  async function loadStoreData(currentUser) {
    if (!currentUser?.id) return;

    setLoading(true);
    setError("");

    try {
      const { data: currentSeries, error: seriesError } = await supabase
        .from("game_series")
        .select("id")
        .eq("is_current", true)
        .maybeSingle();

      if (seriesError) throw seriesError;
      if (!currentSeries?.id) throw new Error("No active series found.");

      setActiveSeriesId(currentSeries.id);

      const [catalogResponse, walletResponse, cartResponse, exchangeResponse] =
        await Promise.all([
          supabase.from("store_catalog").select("*"),
          supabase
            .from("player_wallets")
            .select("shards, feature_coins")
            .eq("user_id", currentUser.id)
            .eq("series_id", currentSeries.id)
            .maybeSingle(),
          supabase
            .from("store_cart_view")
            .select("*")
            .eq("user_id", currentUser.id)
            .eq("series_id", currentSeries.id),
          supabase.rpc("get_series_currency_exchange_config", {
            p_series_id: currentSeries.id,
          }),
        ]);

      if (catalogResponse.error) throw catalogResponse.error;
      if (walletResponse.error) throw walletResponse.error;
      if (cartResponse.error) throw cartResponse.error;
      if (exchangeResponse.error) throw exchangeResponse.error;

      const nextCatalog = catalogResponse.data || [];
      const nextCart = cartResponse.data || [];

      setCatalog(nextCatalog);
      setCartItems(nextCart);
      setShards(Number(walletResponse.data?.shards || 0));
      setFeatureCoins(Number(walletResponse.data?.feature_coins || 0));
      setExchangeConfig(exchangeResponse.data || null);

      setQuantityByItem(
        nextCatalog.reduce((accumulator, item) => {
          accumulator[item.id] = 1;
          return accumulator;
        }, {})
      );
    } catch (err) {
      console.error("Store load failed:", err);
      setError(err.message || "Failed to load store.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && user) {
      loadStoreData(user);
    }
  }, [authLoading, user]);

  const categoryGroups = useMemo(() => {
    const map = new Map();

    for (const item of catalog) {
      const code = normalizeStoreCategoryCode(item.category_code);
      if (HIDDEN_STORE_CATEGORY_CODES.has(code)) continue;

      if (!map.has(code)) {
        map.set(code, {
          code,
          label: formatStoreCategoryName(code, item.category_name),
          items: [],
        });
      }

      map.get(code).items.push(item);
    }

    if (!map.has("currency_exchange")) {
      map.set("currency_exchange", {
        code: "currency_exchange",
        label: "Currency Exchange",
        items: [],
      });
    }

    return sortStoreGroups(Array.from(map.values()));
  }, [catalog]);

  const selectedCategoryGroup = useMemo(() => {
    if (!selectedCategory) return null;
    return categoryGroups.find((group) => group.code === selectedCategory) || null;
  }, [categoryGroups, selectedCategory]);

  const filteredModalItems = useMemo(() => {
    if (!selectedCategoryGroup) return [];

    const query = searchTerm.trim().toLowerCase();

    return selectedCategoryGroup.items.filter((item) => {
      if (!query) return true;

      return (
        String(item.name || "").toLowerCase().includes(query) ||
        String(item.description || "").toLowerCase().includes(query)
      );
    });
  }, [selectedCategoryGroup, searchTerm]);

  const cartTotal = useMemo(
    () =>
      cartItems.reduce((sum, item) => sum + Number(item.total_price || 0), 0),
    [cartItems]
  );

  async function addToCart(itemId) {
    if (!user?.id || !activeSeriesId) return;

    const qty = Math.max(1, Number(quantityByItem[itemId] || 1));

    try {
      setBusy(true);

      const { error: rpcError } = await supabase.rpc("store_add_to_cart", {
        p_user: user.id,
        p_series: activeSeriesId,
        p_item_definition_id: itemId,
        p_quantity: qty,
      });

      if (rpcError) throw rpcError;

      await loadStoreData(user);
    } catch (err) {
      console.error("Add to cart failed:", err);
      window.alert(err.message || "Failed to add item to cart.");
    } finally {
      setBusy(false);
    }
  }

  async function setCartQuantity(itemId, quantity) {
    if (!user?.id || !activeSeriesId) return;

    try {
      setBusy(true);

      const { error: rpcError } = await supabase.rpc("store_set_cart_quantity", {
        p_user: user.id,
        p_series: activeSeriesId,
        p_item_definition_id: itemId,
        p_quantity: quantity,
      });

      if (rpcError) throw rpcError;

      await loadStoreData(user);
    } catch (err) {
      console.error("Set cart quantity failed:", err);
      window.alert(err.message || "Failed to update cart.");
    } finally {
      setBusy(false);
    }
  }

  async function checkoutCart() {
    if (!user?.id || !activeSeriesId || cartItems.length === 0) return;

    try {
      setBusy(true);

      const { error: rpcError } = await supabase.rpc("store_checkout", {
        p_user: user.id,
        p_series: activeSeriesId,
      });

      if (rpcError) throw rpcError;

      await loadStoreData(user);
      window.alert("Purchase complete.");
    } catch (err) {
      console.error("Checkout failed:", err);
      window.alert(err.message || "Checkout failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleExchangeSubmit() {
    if (!activeSeriesId) return;

    try {
      setExchangeBusy(true);

      const { error: rpcError } = await supabase.rpc(
        "exchange_series_wallet_currency",
        {
          p_series_id: activeSeriesId,
          p_from_currency: exchangeForm.fromCurrency,
          p_amount: Number(exchangeForm.amount || 0),
        }
      );

      if (rpcError) throw rpcError;

      await loadStoreData(user);
      window.alert("Exchange complete.");
    } catch (err) {
      console.error("Exchange failed:", err);
      window.alert(err.message || "Exchange failed.");
    } finally {
      setExchangeBusy(false);
    }
  }

  function closeModal() {
    setSelectedCategory(null);
    setSearchTerm("");
  }

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (user.role === "Blocked") return <Navigate to="/" replace />;
  if (user.role !== "Admin+" && user.role !== "Admin" && user.role !== "Duelist") {
    return <Navigate to="/mode" replace />;
  }

  return (
    <LauncherLayout>
      <div className="store-page">
        <div className="store-topbar onyx-panel">
          <div>
            <div className="store-kicker">PROGRESSION</div>
            <h1 className="store-title">Store</h1>
            <p className="store-subtitle">
              Buy items with shards, exchange into Feature Coins, and send purchases
              straight into your active-series inventory.
            </p>
          </div>

          <div className="store-topbar-right">
            <div className="store-shards-card">
              <span className="store-shards-label">Available Shards</span>
              <span className="store-shards-value">{shards}</span>
            </div>

            <div className="store-shards-card store-feature-coin-card">
              <span className="store-shards-label">Feature Coins</span>
              <span className="store-shards-value">{featureCoins}</span>
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

        {loading ? (
          <div className="onyx-panel store-empty">Loading store...</div>
        ) : error ? (
          <div className="onyx-panel store-empty">{error}</div>
        ) : (
          <div className="store-layout">
            <div className="store-left">
              <div className="store-category-grid">
                <button
                  type="button"
                  className="onyx-panel store-category-card store-category-card--shortcut"
                  onClick={() => navigate("/mode/progression/opener")}
                >
                  <div className="store-category-card-label">Pack Opener</div>
                  <div className="store-category-card-count">
                    Open packs and boxes from inventory
                  </div>
                </button>

                {categoryGroups.map((group) => (
                  <button
                    key={group.code}
                    type="button"
                    className="onyx-panel store-category-card"
                    onClick={() => setSelectedCategory(group.code)}
                  >
                    <div className="store-category-card-label">{group.label}</div>
                    <div className="store-category-card-count">
                      {group.code === "currency_exchange"
                        ? "Wallet Exchange"
                        : `${group.items.length} Items`}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="store-right">
              <div className="onyx-panel store-cart-panel">
                <div className="store-cart-header">
                  <h2>Cart</h2>
                  <div className="store-cart-total">{cartTotal} Shards</div>
                </div>

                <div className="store-cart-list">
                  {cartItems.length === 0 ? (
                    <div className="store-cart-empty">Your cart is empty.</div>
                  ) : (
                    cartItems.map((item) => (
                      <div key={item.cart_item_id} className="store-cart-row">
                        <div className="store-cart-info">
                          <div className="store-cart-name">{item.name}</div>
                          <div className="store-cart-line-price">
                            {item.store_price} x {item.quantity} = {item.total_price}
                          </div>
                        </div>

                        <div className="store-cart-controls">
                          <button
                            type="button"
                            className="store-cart-adjust-btn"
                            onClick={() =>
                              setCartQuantity(
                                item.item_definition_id,
                                Number(item.quantity || 0) - 1
                              )
                            }
                            disabled={busy}
                          >
                            -
                          </button>

                          <span className="store-cart-qty">{item.quantity}</span>

                          <button
                            type="button"
                            className="store-cart-adjust-btn"
                            onClick={() =>
                              setCartQuantity(
                                item.item_definition_id,
                                Number(item.quantity || 0) + 1
                              )
                            }
                            disabled={busy}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  className="store-checkout-btn"
                  onClick={checkoutCart}
                  disabled={busy || cartItems.length === 0 || cartTotal > shards}
                >
                  Checkout
                </button>
              </div>
            </div>
          </div>
        )}

        {selectedCategoryGroup ? (
          <div className="store-modal-overlay" onClick={closeModal}>
            <div className="onyx-panel store-modal" onClick={(event) => event.stopPropagation()}>
              <div className="store-modal-header">
                <div>
                  <div className="store-kicker">CATEGORY</div>
                  <h2 className="store-modal-title">{selectedCategoryGroup.label}</h2>
                </div>

                <button
                  type="button"
                  className="store-modal-close"
                  onClick={closeModal}
                >
                  x
                </button>
              </div>

              {selectedCategoryGroup.code === "currency_exchange" ? (
                <div className="store-exchange-shell">
                  <div className="store-exchange-card">
                    <div className="store-item-name">Currency Exchange</div>
                    <div className="store-item-desc">
                      Convert between Shards and Feature Coins with the live
                      series buy and sell rates.
                    </div>

                    <div className="store-exchange-rates">
                      <div className="store-exchange-rate-row">
                        <span>Buy 1 Feature Coin</span>
                        <strong>{exchangeConfig?.shards_per_feature_coin ?? "-"} Shards</strong>
                      </div>
                      <div className="store-exchange-rate-row">
                        <span>Sell 1 Feature Coin</span>
                        <strong>{exchangeConfig?.feature_coin_to_shards_rate ?? "-"} Shards</strong>
                      </div>
                    </div>

                    <div className="store-exchange-form">
                      <select
                        className="store-search"
                        value={exchangeForm.fromCurrency}
                        onChange={(event) =>
                          setExchangeForm((current) => ({
                            ...current,
                            fromCurrency: event.target.value,
                          }))
                        }
                      >
                        <option value="shards">Spend Shards</option>
                        <option value="feature_coins">Spend Feature Coins</option>
                      </select>

                      <input
                        type="number"
                        min="1"
                        className="store-search"
                        value={exchangeForm.amount}
                        onChange={(event) =>
                          setExchangeForm((current) => ({
                            ...current,
                            amount: event.target.value,
                          }))
                        }
                      />

                      <button
                        type="button"
                        className="store-add-btn"
                        onClick={handleExchangeSubmit}
                        disabled={exchangeBusy}
                      >
                        {exchangeBusy ? "Exchanging..." : "Confirm Exchange"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="store-modal-toolbar">
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder={`Search ${selectedCategoryGroup.label}...`}
                      className="store-search"
                    />
                  </div>

                  <div className="store-modal-items">
                    {filteredModalItems.length === 0 ? (
                      <div className="store-empty">No items found.</div>
                    ) : (
                      filteredModalItems.map((item) => {
                        const isPurchaseLocked = Boolean(item.is_store_purchase_locked);

                        return (
                          <div key={item.id} className="store-modal-item">
                            <div className="store-modal-item-main">
                              <div className="store-item-name">{item.name}</div>
                              <div className="store-item-desc">
                                {item.description || "No description yet."}
                              </div>

                              <div className="store-item-flags">
                                {isPurchaseLocked ? (
                                  <span className="store-item-flag is-locked">
                                    Purchase Locked
                                  </span>
                                ) : null}

                                {item.max_purchase ? (
                                  <span className="store-item-flag">
                                    Max {item.max_purchase}
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <div className="store-modal-item-side">
                              <div className="store-item-price">
                                {item.store_price} Shards
                              </div>

                              <div className="store-item-actions">
                                <input
                                  type="number"
                                  min="1"
                                  max={item.max_purchase || 99}
                                  value={quantityByItem[item.id] || 1}
                                  onChange={(event) =>
                                    setQuantityByItem((current) => ({
                                      ...current,
                                      [item.id]: Math.max(
                                        1,
                                        Math.min(
                                          Number(item.max_purchase || 99),
                                          Number(event.target.value || 1)
                                        )
                                      ),
                                    }))
                                  }
                                  className="store-qty-input"
                                  disabled={isPurchaseLocked}
                                />

                                <button
                                  type="button"
                                  className="store-add-btn"
                                  onClick={() => addToCart(item.id)}
                                  disabled={busy || isPurchaseLocked}
                                >
                                  {isPurchaseLocked ? "Locked" : "Add to Cart"}
                                </button>
                              </div>
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

export default StorePage;
