import { useMemo } from "react";
import { useAudio } from "../context/AudioContext";
import { useTheme } from "../context/ThemeContext";
import "./SettingsModal.css";

function SettingsModal({ open, onClose }) {
  const { themes, selectedThemeId, setSelectedThemeId, currentTheme } = useTheme();
  const {
    tracks,
    selectedTrackId,
    setSelectedTrackId,
    currentTrack,
    volume,
    setVolume,
    muted,
    setMuted,
  } = useAudio();

  const trackGroups = useMemo(() => {
    const groups = [
      {
        label: "Defaults / Egyptian",
        items: tracks.filter((track) => track.name.startsWith("Egyptian") || track.name === "Desert Of Set" || track.name === "Obelisk of Thunder"),
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

  if (!open) return null;

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="settings-header">
          <div>
            <h2>Settings</h2>
            <p>
              Visual theme and music now save independently on this browser.
            </p>
          </div>

          <button
            className="settings-close-button"
            onClick={onClose}
            aria-label="Close settings"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <div className="settings-section-header">
              <h3>Visual Theme</h3>
              <span className="settings-section-value">{currentTheme?.name}</span>
            </div>

            <div className="settings-theme-grid">
              {themes.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className={`settings-theme-card ${
                    selectedThemeId === theme.id ? "is-active" : ""
                  }`}
                  onClick={() => setSelectedThemeId(theme.id)}
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
          </section>

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
                  value={selectedTrackId}
                  onChange={(event) => setSelectedTrackId(event.target.value)}
                >
                  {trackGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.items.map((track) => (
                        <option key={track.id} value={track.id}>
                          {track.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
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
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;