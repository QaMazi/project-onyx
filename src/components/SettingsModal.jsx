import { useAudio } from "../context/AudioContext";
import { useTheme } from "../context/ThemeContext";
import "./SettingsModal.css";

function SettingsModal({ open, onClose }) {
  const { volume, setVolume, muted, setMuted } = useAudio();
  const { themes, themeMode, setThemeMode } = useTheme();

  if (!open) return null;

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>Settings</h2>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          <div className="settings-row">
            <label htmlFor="theme-select">Theme</label>

            <select
              id="theme-select"
              value={themeMode}
              onChange={(e) => setThemeMode(e.target.value)}
            >
              <option value="random">Random on Launch</option>

              {themes.map((theme) => (
                <option key={theme.name} value={theme.name}>
                  {theme.name}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-row">
            <label htmlFor="music-volume">Music Volume</label>

            <input
              id="music-volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </div>

          <div className="settings-row">
            <label htmlFor="mute-toggle">Mute</label>

            <input
              id="mute-toggle"
              type="checkbox"
              checked={muted}
              onChange={() => setMuted(!muted)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;