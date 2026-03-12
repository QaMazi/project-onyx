import patchNotes from "../data/patchNotes.json";
import "./PatchNotesModal.css";

function PatchNotesModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="patch-modal-backdrop" onClick={onClose}>
      <div
        className="patch-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="patch-modal-header">
          <div>
            <h2 className="patch-modal-title">Patch Notes</h2>
            <p className="patch-modal-subtitle">
              Project Onyx development updates
            </p>
          </div>

          <button className="patch-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="patch-modal-body">
          {patchNotes.map((note) => (
            <div className="patch-entry" key={`${note.version}-${note.date}`}>
              <div className="patch-entry-top">
                <div className="patch-entry-version-group">
                  <span className="patch-entry-version">
                    v{note.version}
                  </span>
                  <span className="patch-entry-channel">
                    {note.channel}
                  </span>
                </div>

                <span className="patch-entry-date">{note.date}</span>
              </div>

              <h3 className="patch-entry-title">{note.title}</h3>

              <ul className="patch-entry-list">
                {note.changes.map((change, index) => (
                  <li key={index}>{change}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default PatchNotesModal;