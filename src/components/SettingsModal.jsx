import { useAudio } from "../context/AudioContext";
import "./SettingsModal.css";

function SettingsModal({ open, onClose }) {
  const { volume, setVolume, muted, setMuted } = useAudio();

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
            <label>Music Volume</label>

            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </div>

          <div className="settings-row">
            <label>Mute</label>

            <input
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