import { useEffect, useMemo, useState } from "react";
import {
  PREMIUM_SLOT_LABELS,
  SHOWCASE_SLOT_CODES,
} from "../data/premiumCatalog.js";
import { usePremium } from "../context/PremiumContext";
import { useUser } from "../context/UserContext";
import CommunityShowcaseCard from "./premium/CommunityShowcaseCard";
import "./ShowcaseSettingsModal.css";

function createShowcaseForm(showcase) {
  return {
    isPublic: Boolean(showcase?.is_public),
    headline: showcase?.headline || "",
    subheadline: showcase?.subheadline || "",
    deckSpotlightTitle: showcase?.deck_spotlight_title || "",
    deckSpotlightText: showcase?.deck_spotlight_text || "",
    featuredCardId: showcase?.featured_card_id || null,
    featuredCardName: showcase?.featured_card_name || "",
    featuredCardImageUrl: showcase?.featured_card_image_url || "",
    featuredCardNote: showcase?.featured_card_note || "",
    flexTitle: showcase?.flex_title || "",
    flexText: showcase?.flex_text || "",
    highlightTitle: showcase?.highlight_title || "",
    highlightText: showcase?.highlight_text || "",
    cardSearch: showcase?.featured_card_name || "",
  };
}

function ShowcaseSettingsModal({ open, onClose }) {
  const { profile } = useUser();
  const {
    showcase,
    catalog,
    equippedBySlot,
    equipItem,
    unequipSlot,
    saveShowcase,
    searchShowcaseCards,
  } = usePremium();

  const [statusText, setStatusText] = useState("");
  const [savingShowcase, setSavingShowcase] = useState(false);
  const [showcaseForm, setShowcaseForm] = useState(createShowcaseForm());
  const [showcaseSearchResults, setShowcaseSearchResults] = useState([]);
  const [searchingCards, setSearchingCards] = useState(false);
  const [showcaseEquipDrafts, setShowcaseEquipDrafts] = useState({});
  const [savingShowcaseEquipSlot, setSavingShowcaseEquipSlot] = useState("");

  useEffect(() => {
    if (!open) return;

    setStatusText("");
    setShowcaseForm(createShowcaseForm(showcase));
    setShowcaseEquipDrafts(
      SHOWCASE_SLOT_CODES.reduce((accumulator, slotCode) => {
        accumulator[slotCode] = equippedBySlot?.[slotCode]?.item_id || "";
        return accumulator;
      }, {})
    );
  }, [open, showcase, equippedBySlot]);

  useEffect(() => {
    if (!open) return undefined;

    const query = showcaseForm.cardSearch.trim();
    if (query.length < 2) {
      setShowcaseSearchResults([]);
      setSearchingCards(false);
      return undefined;
    }

    const timeout = window.setTimeout(async () => {
      try {
        setSearchingCards(true);
        const results = await searchShowcaseCards(query);
        setShowcaseSearchResults(results);
      } catch (error) {
        console.error("Showcase card search failed:", error);
        setShowcaseSearchResults([]);
      } finally {
        setSearchingCards(false);
      }
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [open, showcaseForm.cardSearch, searchShowcaseCards]);

  const ownedShowcaseItemsBySlot = useMemo(() => {
    return SHOWCASE_SLOT_CODES.reduce((accumulator, slotCode) => {
      accumulator[slotCode] = catalog.filter((item) => {
        if (!item.is_owned || item.slot_code !== slotCode) return false;
        return item.category_code === "showcase-objects" || item.season_code;
      });
      return accumulator;
    }, {});
  }, [catalog]);

  const previewShowcase = useMemo(() => {
    return {
      username: profile?.username || "Unknown",
      avatar_url: profile?.avatar_url || "",
      headline: showcaseForm.headline,
      subheadline: showcaseForm.subheadline,
      deck_spotlight_title: showcaseForm.deckSpotlightTitle,
      deck_spotlight_text: showcaseForm.deckSpotlightText,
      featured_card_id: showcaseForm.featuredCardId,
      featured_card_name: showcaseForm.featuredCardName,
      featured_card_image_url: showcaseForm.featuredCardImageUrl,
      featured_card_note: showcaseForm.featuredCardNote,
      flex_title: showcaseForm.flexTitle,
      flex_text: showcaseForm.flexText,
      highlight_title: showcaseForm.highlightTitle,
      highlight_text: showcaseForm.highlightText,
      equipped_by_slot: equippedBySlot,
    };
  }, [profile, showcaseForm, equippedBySlot]);

  if (!open || !profile) return null;

  function updateShowcaseField(key, value) {
    setShowcaseForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function handleShowcaseSave(event) {
    event.preventDefault();
    setSavingShowcase(true);
    setStatusText("");

    try {
      await saveShowcase(showcaseForm);
      setStatusText("Showcase updated.");
    } catch (error) {
      setStatusText(error?.message || "Failed to save showcase.");
    } finally {
      setSavingShowcase(false);
    }
  }

  async function handleShowcaseEquipSave(slotCode) {
    const nextItemId = showcaseEquipDrafts[slotCode] || "";

    setSavingShowcaseEquipSlot(slotCode);
    setStatusText("");

    try {
      if (!nextItemId) {
        await unequipSlot(slotCode);
        setStatusText(`${PREMIUM_SLOT_LABELS[slotCode] || slotCode} unequipped.`);
      } else {
        await equipItem(nextItemId);
        setStatusText(`${PREMIUM_SLOT_LABELS[slotCode] || slotCode} equipped.`);
      }
    } catch (error) {
      setStatusText(error?.message || "Failed to update showcase object.");
    } finally {
      setSavingShowcaseEquipSlot("");
    }
  }

  return (
    <div className="showcase-settings-backdrop" onClick={onClose}>
      <div
        className="showcase-settings-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="showcase-settings-header">
          <div>
            <h2>Showcase Settings</h2>
            <p>
              Build the public showcase that appears under Mode Select, then decide
              whether to make it visible.
            </p>
          </div>

          <button
            className="showcase-settings-close"
            onClick={onClose}
            type="button"
            aria-label="Close showcase settings"
          >
            X
          </button>
        </div>

        <div className="showcase-settings-body">
          <div className="showcase-settings-sidebar">
            <form
              className="showcase-settings-panel"
              onSubmit={handleShowcaseSave}
            >
              <div className="showcase-settings-panel-header">
                <h3>Public Visibility</h3>
                <label className="showcase-settings-toggle">
                  <button
                    type="button"
                    className={`settings-toggle ${
                      showcaseForm.isPublic ? "is-active" : ""
                    }`}
                    onClick={() =>
                      updateShowcaseField("isPublic", !showcaseForm.isPublic)
                    }
                    aria-pressed={showcaseForm.isPublic}
                  >
                    <span className="settings-toggle-track">
                      <span className="settings-toggle-thumb" />
                    </span>
                    <span className="settings-toggle-label">
                      {showcaseForm.isPublic ? "On" : "Off"}
                    </span>
                  </button>
                </label>
              </div>

              <div className="showcase-settings-fields">
                <label>Headline</label>
                <input
                  value={showcaseForm.headline}
                  onChange={(event) =>
                    updateShowcaseField("headline", event.target.value)
                  }
                  placeholder="Main showcase headline"
                />

                <label>Subheadline</label>
                <input
                  value={showcaseForm.subheadline}
                  onChange={(event) =>
                    updateShowcaseField("subheadline", event.target.value)
                  }
                  placeholder="Public subtitle or identity line"
                />

                <label>Deck Spotlight Title</label>
                <input
                  value={showcaseForm.deckSpotlightTitle}
                  onChange={(event) =>
                    updateShowcaseField("deckSpotlightTitle", event.target.value)
                  }
                  placeholder="Deck spotlight title"
                />

                <label>Deck Spotlight Text</label>
                <input
                  value={showcaseForm.deckSpotlightText}
                  onChange={(event) =>
                    updateShowcaseField("deckSpotlightText", event.target.value)
                  }
                  placeholder="Deck banner or spotlight copy"
                />

                <label>Rare / Flex Title</label>
                <input
                  value={showcaseForm.flexTitle}
                  onChange={(event) =>
                    updateShowcaseField("flexTitle", event.target.value)
                  }
                  placeholder="Flex section title"
                />

                <label>Rare / Flex Text</label>
                <input
                  value={showcaseForm.flexText}
                  onChange={(event) =>
                    updateShowcaseField("flexText", event.target.value)
                  }
                  placeholder="Flex section copy"
                />

                <label>Highlight Title</label>
                <input
                  value={showcaseForm.highlightTitle}
                  onChange={(event) =>
                    updateShowcaseField("highlightTitle", event.target.value)
                  }
                  placeholder="Highlight label"
                />

                <label>Highlight Text</label>
                <input
                  value={showcaseForm.highlightText}
                  onChange={(event) =>
                    updateShowcaseField("highlightText", event.target.value)
                  }
                  placeholder="Highlight text"
                />

                <button
                  type="submit"
                  className="showcase-settings-action"
                  disabled={savingShowcase}
                >
                  {savingShowcase ? "Saving..." : "Save Showcase"}
                </button>
              </div>
            </form>

            <div className="showcase-settings-panel">
              <div className="showcase-settings-panel-header">
                <h3>Favorite Card</h3>
              </div>

              <div className="showcase-settings-fields">
                <label>Favorite Card Search</label>
                <input
                  value={showcaseForm.cardSearch}
                  onChange={(event) =>
                    updateShowcaseField("cardSearch", event.target.value)
                  }
                  placeholder="Search cards by name..."
                />

                {(searchingCards || showcaseSearchResults.length > 0) && (
                  <div className="showcase-settings-search-results">
                    {searchingCards ? (
                      <div className="showcase-settings-search-row">
                        Searching cards...
                      </div>
                    ) : (
                      showcaseSearchResults.map((card) => (
                        <button
                          key={card.id}
                          type="button"
                          className="showcase-settings-search-row"
                          onClick={() =>
                            setShowcaseForm((current) => ({
                              ...current,
                              featuredCardId: card.id,
                              featuredCardName: card.name,
                              featuredCardImageUrl: card.image_url || "",
                              cardSearch: card.name,
                            }))
                          }
                        >
                          <span>{card.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}

                <label>Favorite Card Note</label>
                <input
                  value={showcaseForm.featuredCardNote}
                  onChange={(event) =>
                    updateShowcaseField("featuredCardNote", event.target.value)
                  }
                  placeholder="Why this card matters to you"
                />
              </div>
            </div>

            <div className="showcase-settings-panel showcase-settings-panel--scroll">
              <div className="showcase-settings-panel-header">
                <h3>Showcase Object Loadout</h3>
              </div>

              <div className="showcase-settings-loadout-list">
                {SHOWCASE_SLOT_CODES.map((slotCode) => {
                  const options = ownedShowcaseItemsBySlot[slotCode] || [];
                  const isSaving = savingShowcaseEquipSlot === slotCode;

                  return (
                    <div key={slotCode} className="showcase-settings-loadout-row">
                      <div>
                        <strong>
                          {PREMIUM_SLOT_LABELS[slotCode] || slotCode}
                        </strong>
                        <span>
                          {equippedBySlot?.[slotCode]?.name || "Nothing equipped"}
                        </span>
                      </div>

                      <div className="showcase-settings-loadout-controls">
                        <select
                          value={showcaseEquipDrafts[slotCode] || ""}
                          onChange={(event) =>
                            setShowcaseEquipDrafts((current) => ({
                              ...current,
                              [slotCode]: event.target.value,
                            }))
                          }
                        >
                          <option value="">None</option>
                          {options.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          className="showcase-settings-action showcase-settings-action--secondary"
                          onClick={() => void handleShowcaseEquipSave(slotCode)}
                          disabled={isSaving}
                        >
                          {isSaving ? "Saving..." : "Apply"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {statusText ? (
              <div className="showcase-settings-status">{statusText}</div>
            ) : null}
          </div>

          <div className="showcase-settings-preview-panel">
            <div className="showcase-settings-preview-header">
              <h3>Public Preview</h3>
              <p>
                This preview keeps its full width and scrolls horizontally instead
                of crushing the layout.
              </p>
            </div>

            <div className="showcase-settings-preview-shell">
              <CommunityShowcaseCard
                showcase={previewShowcase}
                className="showcase-settings-preview-card"
                fallbackLabel="Your Public Showcase"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ShowcaseSettingsModal;
