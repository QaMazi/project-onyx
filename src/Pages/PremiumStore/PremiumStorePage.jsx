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
  PREMIUM_UI_EFFECT_COLLECTIONS,
} from "../../data/premiumCatalog.js";
import "./PremiumStorePage.css";

function sortByName(left, right) {
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

function getCategoryDescription(categoryCode) {
  switch (categoryCode) {
    case "themes":
      return "Theme sets are grouped by collection and priced per wallpaper.";
    case "music":
      return "Tracks are organized into two lanes so the store stays lighter and easier to browse.";
    case "ui-effects":
      return "Interface polish is grouped into visual and sound collections instead of one long list.";
    case "profile-cosmetics":
      return "Identity polish for avatars, role pills, profile cards, and account flair.";
    case "atmosphere-packs":
      return "Ambient presentation packs for the app shell and account surfaces.";
    case "showcase-objects":
      return "Public showcase parts for your community-facing presentation setup.";
    case "seasonal":
      return "Season 0 release cosmetics, celebration pieces, and special flex items.";
    case "prestige-flex":
      return "High-visibility account flex pieces and premium finishing touches.";
    default:
      return "Permanent account unlocks for this premium category.";
  }
}

function getCollectionItemCount(collections) {
  return (collections || []).reduce(
    (sum, collection) => sum + Number(collection.items?.length || 0),
    0
  );
}

function PremiumStorePage() {
  const navigate = useNavigate();
  const previewAudioRef = useRef(null);
  const previewTimeoutRef = useRef(0);
  const { user, authLoading } = useUser();
  const { currentTheme } = useTheme();
  const { currentTrack } = useAudio();
  const { loading, errorText, tokens, catalog, equipItem, purchaseItem, unequipSlot } =
    usePremium();

  const [statusText, setStatusText] = useState("");
  const [actioningId, setActioningId] = useState("");
  const [previewingId, setPreviewingId] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [collapsedCollections, setCollapsedCollections] = useState(() => {
    const nextState = {};

    PREMIUM_THEME_COLLECTIONS.forEach((collection) => {
      nextState[`themes:${collection.id}`] = true;
    });

    PREMIUM_AUDIO_COLLECTIONS.forEach((collection) => {
      nextState[`music:${collection.id}`] = true;
    });

    PREMIUM_UI_EFFECT_COLLECTIONS.forEach((collection) => {
      nextState[`ui-effects:${collection.id}`] = true;
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

  const storeHiddenCodes = useMemo(() => new Set(PREMIUM_STORE_HIDDEN_CODES), []);

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
    return new Map((itemsByCategory.themes || []).map((item) => [item.code, item]));
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

      return {
        ...collection,
        items: [...unlockedItems, ...comingSoonItems].sort(sortByName),
      };
    }).filter((collection) => collection.items.length > 0);
  }, [themeItemsByCode]);

  const musicCollections = useMemo(() => {
    const musicItems = itemsByCategory.music || [];
    const assignedCodes = new Set();

    const grouped = PREMIUM_AUDIO_COLLECTIONS.map((collection) => {
      const items = musicItems.filter((item) => {
        const matches = collection.match(item);
        if (matches) assignedCodes.add(item.code);
        return matches;
      });

      return {
        ...collection,
        items: [...items].sort(sortByName),
      };
    }).filter((collection) => collection.items.length > 0);

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

  const uiEffectCollections = useMemo(() => {
    const uiItems = itemsByCategory["ui-effects"] || [];
    const assignedCodes = new Set();

    const grouped = PREMIUM_UI_EFFECT_COLLECTIONS.map((collection) => {
      const items = uiItems.filter((item) => {
        const matches = collection.slotCodes.includes(item.slot_code);
        if (matches) assignedCodes.add(item.code);
        return matches;
      });

      return {
        ...collection,
        items: [...items].sort(sortByName),
      };
    }).filter((collection) => collection.items.length > 0);

    const ungroupedItems = uiItems
      .filter((item) => !assignedCodes.has(item.code))
      .sort(sortByName);

    if (ungroupedItems.length > 0) {
      grouped.push({
        id: "ui-effects-other",
        label: "More UI Effects",
        subtitle: "Additional premium interface polish",
        items: ungroupedItems,
      });
    }

    return grouped;
  }, [itemsByCategory]);

  const availableCategories = useMemo(() => {
    return PREMIUM_CATEGORY_ORDER.map((categoryCode) => {
      const count =
        categoryCode === "themes"
          ? getCollectionItemCount(themeCollections)
          : categoryCode === "music"
            ? getCollectionItemCount(musicCollections)
            : categoryCode === "ui-effects"
              ? getCollectionItemCount(uiEffectCollections)
              : Number(itemsByCategory[categoryCode]?.length || 0);

      return {
        code: categoryCode,
        label: PREMIUM_CATEGORY_LABELS[categoryCode] || categoryCode,
        description: getCategoryDescription(categoryCode),
        count,
      };
    }).filter((category) => category.count > 0);
  }, [itemsByCategory, musicCollections, themeCollections, uiEffectCollections]);

  useEffect(() => {
    if (!availableCategories.length) {
      setSelectedCategory("");
      return;
    }

    if (!availableCategories.some((category) => category.code === selectedCategory)) {
      setSelectedCategory(availableCategories[0].code);
    }
  }, [availableCategories, selectedCategory]);

  const activeCategory = useMemo(() => {
    return (
      availableCategories.find((category) => category.code === selectedCategory) ||
      availableCategories[0] ||
      null
    );
  }, [availableCategories, selectedCategory]);

  const ownedUnlockCount = useMemo(
    () => visibleCatalog.filter((item) => item.is_owned).length,
    [visibleCatalog]
  );

  const equippedUnlockCount = useMemo(
    () => visibleCatalog.filter((item) => item.is_equipped).length,
    [visibleCatalog]
  );

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
    const gridClassName = options.themeCollection
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
            <div className={gridClassName}>
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

  function renderActiveCategory() {
    if (!activeCategory) return null;

    if (activeCategory.code === "themes") {
      return (
        <div className="premium-store-collections">
          {themeCollections.map((collection) =>
            renderCollection(`themes:${collection.id}`, collection, {
              themeCollection: true,
            })
          )}
        </div>
      );
    }

    if (activeCategory.code === "music") {
      return (
        <div className="premium-store-collections">
          {musicCollections.map((collection) =>
            renderCollection(`music:${collection.id}`, collection)
          )}
        </div>
      );
    }

    if (activeCategory.code === "ui-effects") {
      return (
        <div className="premium-store-collections">
          {uiEffectCollections.map((collection) =>
            renderCollection(`ui-effects:${collection.id}`, collection)
          )}
        </div>
      );
    }

    const items = itemsByCategory[activeCategory.code] || [];

    if (items.length === 0) {
      return <div className="premium-store-empty">No items available in this section yet.</div>;
    }

    return <div className="premium-store-grid">{items.map((item) => renderItemCard(item))}</div>;
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

        <div className="premium-store-browse-layout">
          <div className="premium-store-browse-main">
            <section className="premium-store-section premium-store-section--browser">
              <div className="premium-store-section-header">
                <div>
                  <h2>Browse Categories</h2>
                  <p>
                    Pick a premium lane, then open only the collection you want to
                    browse instead of scrolling the whole store at once.
                  </p>
                </div>

                <div className="premium-store-section-badge">
                  {availableCategories.length} categories
                </div>
              </div>

              <div className="premium-store-category-grid">
                {availableCategories.map((category) => (
                  <button
                    key={category.code}
                    type="button"
                    className={`premium-store-category-card ${
                      activeCategory?.code === category.code ? "is-selected" : ""
                    }`}
                    onClick={() => setSelectedCategory(category.code)}
                  >
                    <span className="premium-store-category-kicker">
                      {category.count} unlocks
                    </span>
                    <strong className="premium-store-category-title">
                      {category.label}
                    </strong>
                    <p className="premium-store-category-copy">
                      {category.description}
                    </p>
                    <span className="premium-store-category-open">
                      {activeCategory?.code === category.code ? "Viewing" : "Open"}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {activeCategory ? (
              <section className="premium-store-section premium-store-section--active-browser">
                <div className="premium-store-section-header premium-store-section-header--active">
                  <div>
                    <p className="premium-store-active-kicker">Now Viewing</p>
                    <h2>{activeCategory.label}</h2>
                    <p>{activeCategory.description}</p>
                  </div>

                  <div className="premium-store-section-badge">
                    {activeCategory.count} unlocks
                  </div>
                </div>

                {renderActiveCategory()}
              </section>
            ) : null}
          </div>

          <aside className="premium-store-summary-panel">
            <div className="premium-store-summary-card">
              <div className="premium-store-token-card premium-store-token-card--sidebar">
                <img src="/ui/gentlemens_token.png" alt="" aria-hidden="true" />
                <div>
                  <span>Onyx Tokens</span>
                  <strong>{tokens}</strong>
                </div>
              </div>

              <div className="premium-store-summary-block">
                <span className="premium-store-summary-label">Equipped Theme</span>
                <strong>{currentTheme?.name || "Project Onyx"}</strong>
              </div>

              <div className="premium-store-summary-block">
                <span className="premium-store-summary-label">Equipped Music</span>
                <strong>{currentTrack?.name || "Project Onyx"}</strong>
                <p>
                  Your current loadout stays account-wide, and owned items can be
                  equipped later from Settings or Showcase Settings.
                </p>
              </div>

              <div className="premium-store-summary-stats">
                <div className="premium-store-summary-stat">
                  <span>Owned</span>
                  <strong>{ownedUnlockCount}</strong>
                </div>
                <div className="premium-store-summary-stat">
                  <span>Equipped</span>
                  <strong>{equippedUnlockCount}</strong>
                </div>
                <div className="premium-store-summary-stat">
                  <span>Open Lane</span>
                  <strong>{activeCategory?.label || "-"}</strong>
                </div>
              </div>

              <div className="premium-store-summary-block premium-store-summary-block--muted">
                <span className="premium-store-summary-label">Store Note</span>
                <p>
                  Collections start collapsed so large theme, music, and UI shelves
                  do not flood the page all at once.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </LauncherLayout>
  );
}

export default PremiumStorePage;
