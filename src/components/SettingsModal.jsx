import { useMemo, useState } from "react";
import { useAudio } from "../context/AudioContext";
import { usePremium } from "../context/PremiumContext";
import { useTheme } from "../context/ThemeContext";
import {
  PREMIUM_SLOT_LABELS,
  SETTINGS_SLOT_GROUPS,
} from "../data/premiumCatalog.js";
import "./SettingsModal.css";

function SettingsModal({ open, onClose }) {
  const {
    themes,
    selectedThemeId,
    setSelectedThemeId,
    currentTheme,
    isThemeOwned,
  } = useTheme();
  const {
    tracks,
    selectedTrackId,
    setSelectedTrackId,
    currentTrack,
    volume,
    setVolume,
    muted,
    setMuted,
    isTrackOwned,
  } = useAudio();
  const { catalog, equippedBySlot, equipItem, unequipSlot } = usePremium();

  const [statusText, setStatusText] = useState("");
  const [busySlot, setBusySlot] = useState("");

  const trackGroups = useMemo(() => {
    const groups = [
      {
        label: "Defaults / Egyptian",
        items: tracks.filter(
          (track) =>
            track.name.startsWith("Egyptian") ||
            track.name === "Desert Of Set" ||
            track.name === "Obelisk of Thunder"
        ),
      },
      {
        label: "Battle / Main Themes",
        items: tracks.filter((track) =>
          [
            "Millennium Battle 1",
            "Millennium Battle 2",
            "Millennium Battle 3",
            "Overlap",
            "Shuffle",
            "Wild Drive",
            "Warriors",
            "Voice",
            "EYES",
          ].includes(track.name)
        ),
      },
      {
        label: "Character / Lighter Tracks",
        items: tracks.filter((track) =>
          [
            "Ano hi no Gogo",
            "Afureru Kanjou ga Tomaranai",
            "Genki no Shower",
            "Going My Way",
            "Rakuen",
            "Rising Weather Hallelujah",
          ].includes(track.name)
        ),
      },
    ];

    return groups.filter((group) => group.items.length > 0);
  }, [tracks]);

  const ownedTrackGroups = useMemo(() => {
    return trackGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((track) => isTrackOwned(track.id)),
      }))
      .filter((group) => group.items.length > 0);
  }, [trackGroups, isTrackOwned]);

  const selectedOwnedTrackId = useMemo(() => {
    if (
      ownedTrackGroups.some((group) =>
        group.items.some((track) => track.id === selectedTrackId)
      )
    ) {
      return selectedTrackId;
    }

    return ownedTrackGroups[0]?.items[0]?.id || selectedTrackId;
  }, [ownedTrackGroups, selectedTrackId]);

  const ownedThemes = useMemo(() => {
    return themes.filter((theme) => isThemeOwned(theme.id));
  }, [themes, isThemeOwned]);

  const selectedVisibleThemeId = useMemo(() => {
    if (ownedThemes.some((theme) => theme.id === selectedThemeId)) {
      return selectedThemeId;
    }

    return ownedThemes[0]?.id || selectedThemeId;
  }, [ownedThemes, selectedThemeId]);

  const configurablePremiumGroups = useMemo(() => {
    return SETTINGS_SLOT_GROUPS.map((group) => ({
      ...group,
      rows: group.slotCodes
        .map((slotCode) => {
          const items = catalog.filter((item) => {
            if (!item.is_owned) return false;
            if (item.slot_code !== slotCode) return false;
            if (item.category_code === "themes") return false;
            if (item.category_code === "music") return false;
            if (item.category_code === "showcase-objects") return false;
            return true;
          });

          if (items.length === 0 && !equippedBySlot?.[slotCode]) {
            return null;
          }

          return {
            slotCode,
            items,
            selectedItemId: equippedBySlot?.[slotCode]?.item_id || "",
          };
        })
        .filter(Boolean),
    })).filter((group) => group.rows.length > 0);
  }, [catalog, equippedBySlot]);

  if (!open) return null;

  async function handlePremiumSlotChange(slotCode, itemId) {
    setBusySlot(slotCode);
    setStatusText("");

    try {
      if (!itemId) {
        await unequipSlot(slotCode);
        setStatusText(`${PREMIUM_SLOT_LABELS[slotCode] || slotCode} cleared.`);
      } else {
        await equipItem(itemId);
        setStatusText(`${PREMIUM_SLOT_LABELS[slotCode] || slotCode} updated.`);
      }
    } catch (error) {
      setStatusText(error?.message || "Failed to update premium setting.");
    } finally {
      setBusySlot("");
    }
  }

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="settings-header">
          <div>
            <h2>Settings</h2>
            <p>
              Owned themes, music, and premium interface cosmetics can be managed
              here at any time.
            </p>
          </div>

          <button
            className="settings-close-button"
            onClick={onClose}
            aria-label="Close settings"
            type="button"
          >
            X
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <div className="settings-section-header">
              <h3>Audio</h3>
              <span className="settings-section-value">{currentTrack?.name}</span>
            </div>

            <div className="settings-audio-panel">
              <div className="settings-field">
                <label htmlFor="music-track">Current Song</label>
                <select
                  id="music-track"
                  value={selectedOwnedTrackId}
                  onChange={(event) => setSelectedTrackId(event.target.value)}
                  disabled={ownedTrackGroups.length === 0}
                >
                  {ownedTrackGroups.length === 0 ? (
                    <option value={selectedTrackId}>No owned tracks</option>
                  ) : (
                    ownedTrackGroups.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.items.map((track) => (
                          <option key={track.id} value={track.id}>
                            {track.name}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  )}
                </select>
                <p className="settings-help-text">
                  Only tracks you own appear here. The default soundtrack stays
                  unlocked from the start.
                </p>
              </div>

              <div className="settings-field">
                <label htmlFor="music-volume">Music Volume</label>

                <div className="settings-range-wrap">
                  <input
                    id="music-volume"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={volume}
                    onChange={(event) => setVolume(Number(event.target.value))}
                  />
                  <span>{Math.round(volume * 100)}%</span>
                </div>
              </div>

              <div className="settings-field settings-field-inline">
                <label htmlFor="mute-toggle">Mute</label>

                <button
                  id="mute-toggle"
                  type="button"
                  className={`settings-toggle ${muted ? "is-active" : ""}`}
                  onClick={() => setMuted(!muted)}
                  aria-pressed={muted}
                >
                  <span className="settings-toggle-track">
                    <span className="settings-toggle-thumb" />
                  </span>
                  <span className="settings-toggle-label">
                    {muted ? "Muted" : "On"}
                  </span>
                </button>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-header">
              <h3>Visual Theme</h3>
              <span className="settings-section-value">{currentTheme?.name}</span>
            </div>

            <div className="settings-theme-grid">
              {ownedThemes.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className={`settings-theme-card ${
                    selectedVisibleThemeId === theme.id ? "is-active" : ""
                  }`}
                  onClick={() => {
                    void setSelectedThemeId(theme.id);
                  }}
                >
                  <span
                    className="settings-theme-card-preview"
                    style={{ backgroundImage: `url(${theme.background})` }}
                  />

                  <span className="settings-theme-card-overlay" />

                  <span className="settings-theme-card-content">
                    <span className="settings-theme-card-name">{theme.name}</span>

                    <span className="settings-theme-swatches">
                      <span
                        className="settings-theme-swatch"
                        style={{ background: theme.accent }}
                      />
                      <span
                        className="settings-theme-swatch"
                        style={{ background: theme.accent2 }}
                      />
                      <span
                        className="settings-theme-swatch"
                        style={{ background: theme.accent3 }}
                      />
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <p className="settings-help-text">
              Only owned themes appear here. The Project Onyx theme stays unlocked
              by default.
            </p>
          </section>

          {configurablePremiumGroups.map((group) => (
            <section
              key={group.label}
              className="settings-section settings-section--scrollable"
            >
              <div className="settings-section-header">
                <h3>{group.label}</h3>
                <span className="settings-section-value">
                  {group.rows.length} Owned Slot{group.rows.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="settings-premium-slot-list">
                {group.rows.map((row) => (
                  <div key={row.slotCode} className="settings-premium-slot-row">
                    <div className="settings-premium-slot-copy">
                      <strong>{PREMIUM_SLOT_LABELS[row.slotCode] || row.slotCode}</strong>
                      <span>
                        {equippedBySlot?.[row.slotCode]?.name || "None equipped"}
                      </span>
                    </div>

                    <select
                      value={row.selectedItemId}
                      onChange={(event) =>
                        void handlePremiumSlotChange(row.slotCode, event.target.value)
                      }
                      disabled={busySlot === row.slotCode}
                    >
                      <option value="">None</option>
                      {row.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </section>
          ))}

          {statusText ? <div className="settings-inline-status">{statusText}</div> : null}
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
