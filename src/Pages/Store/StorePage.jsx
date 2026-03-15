import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";

import "./StorePage.css";

function formatCategoryName(code) {
  switch (code) {
    case "pack_openers":
      return "Pack Openers";
    case "pack_keys":
      return "Pack Keys";
    case "box_keys":
      return "Box Keys";
    case "feature_tokens":
      return "Feature Tokens";
    case "collection_notices":
      return "Collection Notices";
    case "rarity_reforgers":
      return "Rarity Reforgers";
    case "progression":
      return "Progression";
    case "protection":
      return "Protection";
    case "banlist":
      return "Banlist";
    case "chaos":
      return "Chaos";
    case "special":
      return "Special";
    default:
      return String(code || "Other")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (m) => m.toUpperCase());
  }
}

function StorePage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [shards, setShards] = useState(0);

  const [catalog, setCatalog] = useState([]);
  const [cartItems, setCartItems] = useState([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [quantityByItem, setQuantityByItem] = useState({});
  const [selectedCategory, setSelectedCategory] = useState(null);

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

      const [catalogResponse, walletResponse, cartResponse] = await Promise.all([
        supabase.from("store_catalog").select("*"),
        supabase
          .from("player_wallets")
          .select("shards")
          .eq("user_id", currentUser.id)
          .eq("series_id", currentSeries.id)
          .maybeSingle(),
        supabase
          .from("store_cart_view")
          .select("*")
          .eq("user_id", currentUser.id)
          .eq("series_id", currentSeries.id),
      ]);

      if (catalogResponse.error) throw catalogResponse.error;
      if (walletResponse.error) throw walletResponse.error;
      if (cartResponse.error) throw cartResponse.error;

      const nextCatalog = catalogResponse.data || [];
      const nextCart = cartResponse.data || [];

      setCatalog(nextCatalog);
      setCartItems(nextCart);
      setShards(Number(walletResponse.data?.shards || 0));

      const nextQuantities = {};
      for (const item of nextCatalog) {
        nextQuantities[item.id] = 1;
      }
      setQuantityByItem(nextQuantities);
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
      const code = item.category_code || "other";

      if (!map.has(code)) {
        map.set(code, {
          code,
          label: formatCategoryName(code),
          items: [],
        });
      }

      map.get(code).items.push(item);
    }

    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [catalog]);

  const selectedCategoryGroup = useMemo(() => {
    if (!selectedCategory) return null;
    return categoryGroups.find((group) => group.code === selectedCategory) || null;
  }, [categoryGroups, selectedCategory]);

  const filteredModalItems = useMemo(() => {
    if (!selectedCategoryGroup) return [];

    const q = searchTerm.trim().toLowerCase();

    return selectedCategoryGroup.items.filter((item) => {
      if (!q) return true;

      return (
        String(item.name || "").toLowerCase().includes(q) ||
        String(item.description || "").toLowerCase().includes(q)
      );
    });
  }, [selectedCategoryGroup, searchTerm]);

  const cartTotal = useMemo(() => {
    return cartItems.reduce(
      (sum, item) => sum + Number(item.total_price || 0),
      0
    );
  }, [cartItems]);

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
      alert(err.message || "Failed to add item to cart.");
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
      alert(err.message || "Failed to update cart.");
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
      alert("Purchase complete.");
    } catch (err) {
      console.error("Checkout failed:", err);
      alert(err.message || "Checkout failed.");
    } finally {
      setBusy(false);
    }
  }

  function closeModal() {
    setSelectedCategory(null);
    setSearchTerm("");
  }

  if (authLoading) return null;

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (user.role === "Blocked") {
    return <Navigate to="/" replace />;
  }

  if (
    user.role !== "Admin+" &&
    user.role !== "Admin" &&
    user.role !== "Duelist"
  ) {
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
              Buy items with shards. Purchased items go to your inventory.
            </p>
          </div>

          <div className="store-topbar-right">
            <div className="store-shards-card">
              <span className="store-shards-label">Available Shards</span>
              <span className="store-shards-value">{shards}</span>
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
                {categoryGroups.map((group) => (
                  <button
                    key={group.code}
                    type="button"
                    className="onyx-panel store-category-card"
                    onClick={() => setSelectedCategory(group.code)}
                  >
                    <div className="store-category-card-label">{group.label}</div>
                    <div className="store-category-card-count">
                      {group.items.length} Items
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
                            {item.store_price} × {item.quantity} = {item.total_price}
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

        {selectedCategoryGroup && (
          <div className="store-modal-overlay" onClick={closeModal}>
            <div
              className="onyx-panel store-modal"
              onClick={(e) => e.stopPropagation()}
            >
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
                  ×
                </button>
              </div>

              <div className="store-modal-toolbar">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={`Search ${selectedCategoryGroup.label}...`}
                  className="store-search"
                />
              </div>

              <div className="store-modal-items">
                {filteredModalItems.length === 0 ? (
                  <div className="store-empty">No items found.</div>
                ) : (
                  filteredModalItems.map((item) => (
                    <div key={item.id} className="store-modal-item">
                      <div className="store-modal-item-main">
                        <div className="store-item-name">{item.name}</div>
                        <div className="store-item-desc">
                          {item.description || "No description yet."}
                        </div>
                      </div>

                      <div className="store-modal-item-side">
                        <div className="store-item-price">{item.store_price} Shards</div>

                        <div className="store-item-actions">
                          <input
                            type="number"
                            min="1"
                            max={item.max_purchase || 99}
                            value={quantityByItem[item.id] || 1}
                            onChange={(e) =>
                              setQuantityByItem((prev) => ({
                                ...prev,
                                [item.id]: Math.max(
                                  1,
                                  Math.min(
                                    Number(item.max_purchase || 99),
                                    Number(e.target.value || 1)
                                  )
                                ),
                              }))
                            }
                            className="store-qty-input"
                          />

                          <button
                            type="button"
                            className="store-add-btn"
                            onClick={() => addToCart(item.id)}
                            disabled={busy}
                          >
                            Add to Cart
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </LauncherLayout>
  );
}

export default StorePage;
