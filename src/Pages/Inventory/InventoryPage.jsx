import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";

import "./InventoryPage.css";

function formatCategoryName(name, code) {
  if (name) return name;

  return String(code || "Other")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function InventoryPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [shards, setShards] = useState(0);
  const [inventoryItems, setInventoryItems] = useState([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

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
          .select("shards")
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
      setInventoryItems(inventoryResponse.data || []);
    } catch (err) {
      console.error("Inventory load failed:", err);
      setError(err.message || "Failed to load inventory.");
      setInventoryItems([]);
      setShards(0);
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
      const code = item.category_code || "other";
      if (!seen.has(code)) {
        seen.set(code, {
          code,
          label: formatCategoryName(item.category_name, code),
        });
      }
    }

    return Array.from(seen.values()).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [inventoryItems]);

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();

    return inventoryItems.filter((item) => {
      const matchesCategory =
        selectedCategory === "all" || item.category_code === selectedCategory;

      if (!matchesCategory) return false;

      if (!q) return true;

      return (
        String(item.item_name || "").toLowerCase().includes(q) ||
        String(item.description || "").toLowerCase().includes(q) ||
        String(item.item_code || "").toLowerCase().includes(q) ||
        String(item.category_name || "").toLowerCase().includes(q)
      );
    });
  }, [inventoryItems, searchTerm, selectedCategory]);

  const groupedItems = useMemo(() => {
    const map = new Map();

    for (const item of filteredItems) {
      const code = item.category_code || "other";

      if (!map.has(code)) {
        map.set(code, {
          code,
          label: formatCategoryName(item.category_name, code),
          items: [],
        });
      }

      map.get(code).items.push(item);
    }

    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [filteredItems]);

  const totalOwnedItems = useMemo(() => {
    return inventoryItems.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );
  }, [inventoryItems]);

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
      <div className="inventory-page">
        <div className="inventory-topbar inventory-panel">
          <div>
            <div className="inventory-kicker">PROGRESSION</div>
            <h1 className="inventory-title">Inventory</h1>
            <p className="inventory-subtitle">
              Your active-series items and shard balance.
            </p>
          </div>

          <div className="inventory-topbar-right">
            <div className="inventory-shards-card">
              <span className="inventory-shards-label">Available Shards</span>
              <span className="inventory-shards-value">{shards}</span>
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
                onChange={(e) => setSearchTerm(e.target.value)}
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
                onChange={(e) => setSelectedCategory(e.target.value)}
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
              <div className="inventory-panel inventory-empty">
                Loading inventory...
              </div>
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
                              {formatCategoryName(item.category_name, item.category_code)}
                            </span>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))
            )}
          </main>
        </div>
      </div>
    </LauncherLayout>
  );
}

export default InventoryPage;
