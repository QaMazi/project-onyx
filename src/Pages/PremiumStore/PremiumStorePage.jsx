import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useAudio } from "../../context/AudioContext";
import { usePremium } from "../../context/PremiumContext";
import { useTheme } from "../../context/ThemeContext";
import { useUser } from "../../context/UserContext";
import {
  PREMIUM_CATEGORY_LABELS,
  PREMIUM_CATEGORY_ORDER,
  PREMIUM_SLOT_LABELS,
} from "../../data/premiumCatalog.js";
import "./PremiumStorePage.css";

function PremiumStorePage() {
  const navigate = useNavigate();
  const previewAudioRef = useRef(null);
  const previewTimeoutRef = useRef(0);
  const { user, authLoading } = useUser();
  const { currentTheme } = useTheme();
  const { currentTrack } = useAudio();
  const {
    loading,
    errorText,
    tokens,
    catalog,
    equipItem,
    purchaseItem,
    unequipSlot,
  } = usePremium();

  const [statusText, setStatusText] = useState("");
  const [actioningId, setActioningId] = useState("");
  const [previewingId, setPreviewingId] = useState("");

  useEffect(() => {
    return () => {
      if (previewTimeoutRef.current) {
        window.clearTimeout(previewTimeoutRef.current);
      }

      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current.src = "";
      }
    };
  }, []);

  const itemsByCategory = useMemo(() => {
    return PREMIUM_CATEGORY_ORDER.reduce((accumulator, categoryCode) => {
      accumulator[categoryCode] = catalog.filter(
        (item) => item.category_code === categoryCode
      );
      return accumulator;
    }, {});
  }, [catalog]);

  if (authLoading || loading) return null;
  if (!user) return <Navigate to="/" replace />;

  async function handlePreview(item) {
    if (!item.preview_audio_url) return;

    try {
      if (previewTimeoutRef.current) {
        window.clearTimeout(previewTimeoutRef.current);
      }

      if (!previewAudioRef.current) {
        previewAudioRef.current = new Audio();
      }

      previewAudioRef.current.pause();
      previewAudioRef.current.src = item.preview_audio_url;
      previewAudioRef.current.currentTime = 0;
      await previewAudioRef.current.play();
      setPreviewingId(item.id);

      previewTimeoutRef.current = window.setTimeout(() => {
        if (!previewAudioRef.current) return;
        previewAudioRef.current.pause();
        previewAudioRef.current.currentTime = 0;
        setPreviewingId("");
      }, 10000);
    } catch (error) {
      console.error("Preview playback failed:", error);
      setStatusText("Music preview could not be played.");
      setPreviewingId("");
    }
  }

  async function handleItemAction(item) {
    setActioningId(item.id);
    setStatusText("");

    try {
      if (!item.is_owned) {
        await purchaseItem(item.id);
        setStatusText(`${item.name} permanently unlocked.`);
      } else if (item.is_equipped) {
        await unequipSlot(item.slot_code);
        setStatusText(`${item.name} unequipped.`);
      } else {
        await equipItem(item.id);
        setStatusText(`${item.name} equipped.`);
      }
    } catch (error) {
      console.error("Premium item action failed:", error);
      setStatusText(error.message || "Premium action failed.");
    } finally {
      setActioningId("");
    }
  }

  return (
    <LauncherLayout>
      <div className="premium-store-page">
        <div className="premium-store-topbar">
          <div>
            <p className="premium-store-kicker">ACCOUNT PREMIUM</p>
            <h1 className="premium-store-title">Premium Store</h1>
            <p className="premium-store-subtitle">
              Permanent account-wide unlocks for themes, music, UI polish, profile
              cosmetics, atmosphere, and the public showcase system.
            </p>
          </div>

          <div className="premium-store-topbar-actions">
            <div className="premium-store-token-card">
              <img src="/ui/gentlemens_token.png" alt="" aria-hidden="true" />
              <div>
                <span>Onyx Tokens</span>
                <strong>{tokens}</strong>
              </div>
            </div>

            <button
              type="button"
              className="premium-store-back-btn"
              onClick={() => navigate("/mode")}
            >
              Back
            </button>
          </div>
        </div>

        <div className="premium-store-hero">
          <div className="premium-store-hero-copy">
            <span className="premium-store-hero-label">Current Theme</span>
            <strong>{currentTheme?.name}</strong>
            <p>
              Active soundtrack: {currentTrack?.name || "System Default"}. Every
              premium effect inherits the current theme palette automatically.
            </p>
          </div>

          <div
            className="premium-store-hero-preview"
            style={{ backgroundImage: `url(${currentTheme?.background})` }}
          />
        </div>

        {errorText ? <div className="premium-store-inline-error">{errorText}</div> : null}
        {statusText ? <div className="premium-store-inline-status">{statusText}</div> : null}

        <div className="premium-store-sections">
          {PREMIUM_CATEGORY_ORDER.map((categoryCode) => {
            const items = itemsByCategory[categoryCode] || [];

            return (
              <section key={categoryCode} className="premium-store-section">
                <div className="premium-store-section-header">
                  <div>
                    <h2>{PREMIUM_CATEGORY_LABELS[categoryCode]}</h2>
                    {categoryCode === "seasonal" ? (
                      <p>Season 0: Release cosmetics and showcase flex items.</p>
                    ) : (
                      <p>Permanent account unlocks for this premium category.</p>
                    )}
                  </div>
                </div>

                {items.length === 0 ? (
                  <div className="premium-store-empty">No items available in this section yet.</div>
                ) : (
                  <div
                    className={`premium-store-grid ${
                      categoryCode === "themes" ? "premium-store-grid--themes" : ""
                    }`}
                  >
                    {items.map((item) => {
                      const isBusy = actioningId === item.id;
                      const isPreviewing = previewingId === item.id;

                      return (
                        <article
                          key={item.id}
                          className={`premium-item-card ${
                            item.is_equipped ? "is-equipped" : ""
                          } ${item.is_owned ? "is-owned" : "is-locked"}`}
                        >
                          <div
                            className="premium-item-card-preview"
                            style={{ backgroundImage: `url(${item.image_url})` }}
                          />
                          <div className="premium-item-card-overlay" />

                          <div className="premium-item-card-content">
                            <div className="premium-item-card-topline">
                              <span className="premium-item-chip">
                                {PREMIUM_SLOT_LABELS[item.slot_code] || item.slot_code}
                              </span>
                              {item.season_code ? (
                                <span className="premium-item-chip premium-item-chip--seasonal">
                                  {item.season_code}
                                </span>
                              ) : null}
                            </div>

                            <h3>{item.name}</h3>
                            <p>{item.description}</p>

                            <div className="premium-item-footer">
                              <div className="premium-item-price">
                                <img src="/ui/gentlemens_token.png" alt="" aria-hidden="true" />
                                <span>{item.price}</span>
                              </div>

                              <div className="premium-item-actions">
                                {item.preview_audio_url ? (
                                  <button
                                    type="button"
                                    className="premium-item-secondary-btn"
                                    onClick={() => void handlePreview(item)}
                                  >
                                    {isPreviewing ? "Previewing..." : "Preview 10s"}
                                  </button>
                                ) : null}

                                <button
                                  type="button"
                                  className="premium-item-primary-btn"
                                  onClick={() => void handleItemAction(item)}
                                  disabled={isBusy}
                                >
                                  {!item.is_owned
                                    ? isBusy
                                      ? "Unlocking..."
                                      : "Unlock"
                                    : item.is_equipped
                                      ? isBusy
                                        ? "Updating..."
                                        : "Unequip"
                                      : isBusy
                                        ? "Equipping..."
                                        : "Equip"}
                                </button>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </LauncherLayout>
  );
}

export default PremiumStorePage;
