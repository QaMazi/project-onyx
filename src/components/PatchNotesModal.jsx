import { useEffect } from "react";
import patchNotes from "../data/patchNotes.json";
import "./PatchNotesModal.css";

function formatPatchDate(value) {
  if (!value) return "Unknown Date";

  const parsed = new Date(`${value}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function PatchNotesModal({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="patch-modal-backdrop" onClick={onClose}>
      <div className="patch-modal" onClick={(event) => event.stopPropagation()}>
        <div className="patch-modal-header">
          <div>
            <h2 className="patch-modal-title">Patch Notes</h2>
            <p className="patch-modal-subtitle">
              Recent Project Onyx updates and milestone progress.
            </p>
          </div>

          <button
            className="patch-modal-close"
            onClick={onClose}
            type="button"
            aria-label="Close patch notes"
          >
            {"\u2715"}
          </button>
        </div>

        <div className="patch-modal-body">
          {patchNotes.map((entry) => (
            <section
              key={`${entry.version}-${entry.channel}-${entry.date}`}
              className="patch-entry"
            >
              <div className="patch-entry-top">
                <div className="patch-entry-version-group">
                  <span className="patch-entry-version">v{entry.version}</span>
                  <span className="patch-entry-channel">{entry.channel}</span>
                </div>

                <span className="patch-entry-date">{formatPatchDate(entry.date)}</span>
              </div>

              <h3 className="patch-entry-title">{entry.title}</h3>

              <ul className="patch-entry-list">
                {(entry.changes || []).map((change, index) => (
                  <li key={`${entry.version}-${index}`}>{change}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export default PatchNotesModal;
