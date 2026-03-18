import { useEffect, useMemo, useState } from "react";
import { usePremium } from "../../../context/PremiumContext";
import { supabase } from "../../../lib/supabase";
import {
  PREMIUM_CATEGORY_LABELS,
  PREMIUM_CATEGORY_ORDER,
} from "../../../data/premiumCatalog.js";

export default function AdminPremiumStorePanel() {
  const {
    catalog,
    autoMainRoundTokensEnabled,
    grantTokens,
    setItemPrice,
    setAutoMainRoundTokensEnabled,
  } = usePremium();

  const [isOpen, setIsOpen] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [grantForm, setGrantForm] = useState({
    targetUserId: "",
    amount: "1",
    reason: "",
  });
  const [priceDrafts, setPriceDrafts] = useState({});
  const [searchText, setSearchText] = useState("");
  const [statusText, setStatusText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setPriceDrafts(
      catalog.reduce((accumulator, item) => {
        accumulator[item.id] = String(Number(item.price || 0));
        return accumulator;
      }, {})
    );
  }, [catalog]);

  useEffect(() => {
    if (!isOpen) return;

    async function loadProfiles() {
      setLoadingProfiles(true);

      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, username, auth_email")
          .order("username", { ascending: true });

        if (error) throw error;
        setProfiles(data || []);
      } catch (error) {
        console.error("Failed to load profiles for premium admin:", error);
        setStatusText(error.message || "Failed to load profiles.");
      } finally {
        setLoadingProfiles(false);
      }
    }

    loadProfiles();
  }, [isOpen]);

  const filteredCatalog = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return catalog;

    return catalog.filter((item) => {
      return (
        String(item.name || "").toLowerCase().includes(query) ||
        String(item.code || "").toLowerCase().includes(query) ||
        String(item.category_code || "").toLowerCase().includes(query)
      );
    });
  }, [catalog, searchText]);

  async function handleGrantSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setStatusText("");

    try {
      await grantTokens({
        targetUserId: grantForm.targetUserId,
        amount: Number(grantForm.amount || 0),
        reason: grantForm.reason,
      });

      setStatusText("Onyx Tokens granted.");
      setGrantForm((current) => ({
        ...current,
        amount: "1",
        reason: "",
      }));
    } catch (error) {
      console.error("Premium token grant failed:", error);
      setStatusText(error.message || "Failed to grant Onyx Tokens.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePriceSave(itemId) {
    setSubmitting(true);
    setStatusText("");

    try {
      await setItemPrice(itemId, Number(priceDrafts[itemId] || 0));
      setStatusText("Premium item price updated.");
    } catch (error) {
      console.error("Premium price update failed:", error);
      setStatusText(error.message || "Failed to update premium price.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAutoToggle() {
    setSubmitting(true);
    setStatusText("");

    try {
      await setAutoMainRoundTokensEnabled(!autoMainRoundTokensEnabled);
      setStatusText("Automatic token earn rule updated.");
    } catch (error) {
      console.error("Premium auto reward toggle failed:", error);
      setStatusText(error.message || "Failed to update auto token rule.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-header">
        <div
          className="admin-panel-header-main"
          onClick={() => setIsOpen((previous) => !previous)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setIsOpen((previous) => !previous);
            }
          }}
        >
          <p className="admin-panel-kicker">ACCOUNT PREMIUM</p>
          <h2 className="admin-panel-title">Premium Store</h2>
          <p className="admin-section-description">
            Grant Onyx Tokens, tune premium item prices, and toggle the
            hardcoded 1 Onyx Token per 2 main rounds reward rule.
          </p>
        </div>

        <div className="admin-panel-header-actions">
          <div className="admin-panel-count">{catalog.length} Premium Items</div>
          <button className="admin-collapse-btn" onClick={() => setIsOpen((previous) => !previous)} type="button">
            {isOpen ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="admin-panel-body">
          <div className="admin-profiles-grid">
            <div className="admin-profiles-create">
              <h3 className="admin-subsection-title">Grant Onyx Tokens</h3>

              <form className="admin-profile-form" onSubmit={handleGrantSubmit}>
                <div className="admin-form-row">
                  <label className="admin-form-label">Player</label>
                  <select
                    className="admin-form-input admin-form-select"
                    value={grantForm.targetUserId}
                    onChange={(event) =>
                      setGrantForm((current) => ({
                        ...current,
                        targetUserId: event.target.value,
                      }))
                    }
                    disabled={loadingProfiles}
                  >
                    <option value="">
                      {loadingProfiles ? "Loading players..." : "Select a player"}
                    </option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.username} ({profile.auth_email})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="admin-form-row">
                  <label className="admin-form-label">Onyx Token Amount</label>
                  <input
                    className="admin-form-input"
                    type="number"
                    min="1"
                    value={grantForm.amount}
                    onChange={(event) =>
                      setGrantForm((current) => ({
                        ...current,
                        amount: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="admin-form-row">
                  <label className="admin-form-label">Reason</label>
                  <input
                    className="admin-form-input"
                    type="text"
                    value={grantForm.reason}
                    onChange={(event) =>
                      setGrantForm((current) => ({
                        ...current,
                        reason: event.target.value,
                      }))
                    }
                    placeholder="Optional admin note"
                  />
                </div>

                <button className="admin-action-button" type="submit" disabled={submitting}>
                  {submitting ? "Saving..." : "Grant Onyx Tokens"}
                </button>
              </form>

              <div className="admin-series-active-banner">
                <div className="admin-series-active-copy">
                  <span className="admin-series-active-label">Auto Earn Rule</span>
                  <strong className="admin-series-active-name">
                    {autoMainRoundTokensEnabled ? "Enabled" : "Disabled"}
                  </strong>
                  <span className="admin-series-active-meta">
                    1 Onyx Token is granted automatically after each completed main
                    round pair when this is enabled.
                  </span>
                </div>

                <button
                  className="admin-action-button"
                  type="button"
                  onClick={handleAutoToggle}
                  disabled={submitting}
                >
                  {autoMainRoundTokensEnabled ? "Disable Auto Earn" : "Enable Auto Earn"}
                </button>
              </div>
            </div>

            <div className="admin-profiles-list-shell admin-premium-price-shell">
              <div className="admin-profiles-list-topbar">
                <h3 className="admin-subsection-title">Premium Item Prices</h3>
                <input
                  className="admin-form-input admin-profiles-search"
                  type="text"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search premium items..."
                />
              </div>

              <div className="admin-premium-price-list">
                {PREMIUM_CATEGORY_ORDER.map((categoryCode) => {
                  const categoryItems = filteredCatalog.filter(
                    (item) => item.category_code === categoryCode
                  );

                  if (categoryItems.length === 0) return null;

                  return (
                    <div
                      key={categoryCode}
                      className="admin-placeholder-card admin-premium-price-category"
                    >
                      <h4 className="admin-subsection-title">
                        {PREMIUM_CATEGORY_LABELS[categoryCode]}
                      </h4>

                      <div className="admin-premium-price-category-list">
                        {categoryItems.map((item) => (
                          <div key={item.id} className="admin-profile-card">
                            <div className="admin-profile-name-row">
                              <h4 className="admin-profile-name">{item.name}</h4>
                              <span className="admin-role-pill">{item.slot_code}</span>
                            </div>

                            <p className="admin-profile-email">{item.description}</p>

                            <div className="admin-profile-actions">
                              <input
                                className="admin-form-input"
                                type="number"
                                min="0"
                                value={priceDrafts[item.id] ?? String(Number(item.price || 0))}
                                onChange={(event) =>
                                  setPriceDrafts((current) => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }))
                                }
                              />

                              <button
                                className="admin-action-button"
                                type="button"
                                onClick={() => void handlePriceSave(item.id)}
                                disabled={submitting}
                              >
                                Save Price
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {statusText ? <p className="admin-status-message">{statusText}</p> : null}
        </div>
      )}
    </section>
  );
}
