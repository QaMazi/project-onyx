import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useAudio } from "../../context/AudioContext";
import { usePremium } from "../../context/PremiumContext";
import { useTheme } from "../../context/ThemeContext";
import { useUser } from "../../context/UserContext";
import {
  PREMIUM_AUDIO_COLLECTIONS,
  PREMIUM_CATEGORY_LABELS,
  PREMIUM_CATEGORY_ORDER,
  PREMIUM_SLOT_LABELS,
  PREMIUM_STORE_DISCLAIMER,
  PREMIUM_STORE_HIDDEN_CODES,
  PREMIUM_THEME_COLLECTIONS,
  PREMIUM_THEME_COMING_SOON_ITEMS,
} from "../../data/premiumCatalog.js";
import "./PremiumStorePage.css";

function sortByName(left, right) {
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

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
  const [collapsedCollections, setCollapsedCollections] = useState(() => {
    const nextState = {};

    PREMIUM_THEME_COLLECTIONS.forEach((collection) => {
      nextState[`themes:${collection.id}`] = true;
    });

    PREMIUM_AUDIO_COLLECTIONS.forEach((collection) => {
      nextState[`music:${collection.id}`] = true;
    });

    return nextState;
  });

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

  const storeHiddenCodes = useMemo(
    () => new Set(PREMIUM_STORE_HIDDEN_CODES),
    []
  );

  const visibleCatalog = useMemo(() => {
    return catalog.filter((item) => !storeHiddenCodes.has(item.code));
  }, [catalog, storeHiddenCodes]);

  const itemsByCategory = useMemo(() => {
    return PREMIUM_CATEGORY_ORDER.reduce((accumulator, categoryCode) => {
      accumulator[categoryCode] = visibleCatalog
        .filter((item) => item.category_code === categoryCode)
        .sort(sortByName);
      return accumulator;
    }, {});
  }, [visibleCatalog]);

  const themeItemsByCode = useMemo(() => {
    return new Map(
      (itemsByCategory.themes || []).map((item) => [item.code, item])
    );
  }, [itemsByCategory.themes]);

  const themeCollections = useMemo(() => {
    return PREMIUM_THEME_COLLECTIONS.map((collection) => {
      const unlockedItems = collection.themeIds
        .map((themeId) => themeItemsByCode.get(`theme:${themeId}`))
        .filter(Boolean);

      const comingSoonItems = PREMIUM_THEME_COMING_SOON_ITEMS.filter(
        (item) => item.collectionId === collection.id
      ).map((item) => ({
        id: item.code,
        code: item.code,
        name: item.name,
        description: `${item.name} is marked for a future premium theme release.`,
        image_url: item.imageUrl,
        price: item.price,
        slot_code: "theme",
        preview_audio_url: null,
        is_owned: false,
        is_equipped: false,
        metadata: {
          comingSoon: true,
        },
      }));

      const items = [...unlockedItems, ...comingSoonItems].sort(sortByName);

      return {
        ...collection,
        items,
      };
    });
  }, [themeItemsByCode]);

  const musicCollections = useMemo(() => {
    const musicItems = itemsByCategory.music || [];
    const assignedCodes = new Set();

    const grouped = PREMIUM_AUDIO_COLLECTIONS.map((collection) => {
      const items = musicItems.filter((item) => {
        const matches = collection.match(item);
        if (matches) {
          assignedCodes.add(item.code);
        }
        return matches;
      });

      return {
        ...collection,
        items: [...items].sort(sortByName),
      };
    });

    const ungroupedItems = musicItems
      .filter((item) => !assignedCodes.has(item.code))
      .sort(sortByName);

    if (ungroupedItems.length > 0) {
      grouped.push({
        id: "music-other",
        label: "More Tracks",
        subtitle: "Permanent track unlocks",
        items: ungroupedItems,
      });
    }

    return grouped;
  }, [itemsByCategory.music]);

  if (authLoading || loading) return null;
  if (!user) return <Navigate to="/" replace />;

  function toggleCollection(key) {
    setCollapsedCollections((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  async function handlePreview(item) {
    if (!item.preview_audio_url) return;

    try {
      if (previewTimeoutRef.current) {
        window.clearTimeout(previewTimeoutRef.current);
        previewTimeoutRef.current = 0;
      }

      if (!previewAudioRef.current) {
        previewAudioRef.current = new Audio();
      }

      if (previewingId === item.id) {
        previewAudioRef.current.pause();
        previewAudioRef.current.currentTime = 0;
        setPreviewingId("");
        return;
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
        previewTimeoutRef.current = 0;
        setPreviewingId("");
      }, 10000);
    } catch (error) {
      console.error("Preview playback failed:", error);
      setStatusText("Music preview could not be played.");
      setPreviewingId("");
    }
  }

  async function handleItemAction(item) {
    if (item?.metadata?.comingSoon) return;

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

  function renderItemCard(item) {
    const isBusy = actioningId === item.id;
    const isPreviewing = previewingId === item.id;
    const isComingSoon = Boolean(item?.metadata?.comingSoon);

    return (
      <article
        key={item.code || item.id}
        className={`premium-item-card ${
          item.is_equipped ? "is-equipped" : ""
        } ${item.is_owned ? "is-owned" : "is-locked"} ${
          isComingSoon ? "is-coming-soon" : ""
        }`}
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
            {isComingSoon ? (
              <span className="premium-item-chip premium-item-chip--coming-soon">
                Coming Soon
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
                  {isPreviewing ? "Stop Preview" : "Preview 10s"}
                </button>
              ) : null}

              <button
                type="button"
                className="premium-item-primary-btn"
                onClick={() => void handleItemAction(item)}
                disabled={isBusy || isComingSoon}
              >
                {isComingSoon
                  ? "Coming Soon"
                  : !item.is_owned
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
  }

  function renderCollection(collectionKey, collection, options = {}) {
    const isCollapsed = collapsedCollections[collectionKey] !== false;
    const themeCollectionClass = options.themeCollection
      ? "premium-store-grid premium-store-grid--themes"
      : "premium-store-grid";

    return (
      <article key={collectionKey} className="premium-store-collection">
        <button
          type="button"
          className={`premium-store-collection-toggle ${
            isCollapsed ? "is-collapsed" : ""
          }`}
          onClick={() => toggleCollection(collectionKey)}
        >
          <div>
            <h3>{collection.label}</h3>
            <p>{collection.subtitle}</p>
          </div>

          <div className="premium-store-collection-meta">
            <span>{collection.items.length} items</span>
            <strong>{isCollapsed ? "Open" : "Hide"}</strong>
          </div>
        </button>

        {!isCollapsed ? (
          collection.items.length > 0 ? (
            <div className={themeCollectionClass}>
              {collection.items.map((item) => renderItemCard(item))}
            </div>
          ) : (
            <div className="premium-store-empty">
              No items available in this collection yet.
            </div>
          )
        ) : null}
      </article>
    );
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

        <div className="premium-store-disclaimer">{PREMIUM_STORE_DISCLAIMER}</div>

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
                    {categoryCode === "themes" ? (
                      <p>Theme sets are grouped by collection and priced per wallpaper.</p>
                    ) : categoryCode === "music" ? (
                      <p>Audio tracks are grouped to keep the storefront lighter to load.</p>
                    ) : categoryCode === "seasonal" ? (
                      <p>Season 0: Release cosmetics and showcase flex items.</p>
                    ) : (
                      <p>Permanent account unlocks for this premium category.</p>
                    )}
                  </div>
                </div>

                {categoryCode === "themes" ? (
                  <div className="premium-store-collections">
                    {themeCollections.map((collection) =>
                      renderCollection(`themes:${collection.id}`, collection, {
                        themeCollection: true,
                      })
                    )}
                  </div>
                ) : categoryCode === "music" ? (
                  <div className="premium-store-collections">
                    {musicCollections.map((collection) =>
                      renderCollection(`music:${collection.id}`, collection)
                    )}
                  </div>
                ) : items.length === 0 ? (
                  <div className="premium-store-empty">No items available in this section yet.</div>
                ) : (
                  <div className="premium-store-grid">
                    {items.map((item) => renderItemCard(item))}
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
