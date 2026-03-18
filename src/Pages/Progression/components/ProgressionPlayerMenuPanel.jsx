import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ProgressionPanelShell from "./ProgressionPanelShell";
import { useProgression } from "../../../context/ProgressionContext";

const LEFT_MENU_ITEMS = [
  { label: "Ready Up", primary: true },
  { label: "Deck Builder" },
  { label: "Binder" },
  { label: "Vault" },
  { label: "Inventory" },
];

const RIGHT_MENU_ITEMS = [
  { label: "Store" },
  { label: "Trade" },
  { label: "Notes" },
  { label: "Containers" },
  { label: "Feature Slots" },
];

function ProgressionPlayerMenuPanel({ onOpenNotes }) {
  const navigate = useNavigate();
  const { busy, readyUp, state } = useProgression();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const currentPhase = String(state?.currentPhase || "standby").toLowerCase();
  const roundNumber = Number(state?.roundNumber || 0);

  const readyPrompt =
    currentPhase === "deckbuilding"
      ? "Ready Up will lock your status for this Deckbuilding Phase. This cannot be undone."
      : roundNumber === 0 && currentPhase === "standby"
        ? "Begin Series is handled through the Round 0 modal."
        : "Ready Up will lock your status for this phase. This cannot be undone.";

  function handlePlayerMenuClick(label) {
    if (label === "Binder") {
      navigate("/mode/progression/binder");
      return;
    }

    if (label === "Vault") {
      navigate("/mode/progression/vault");
      return;
    }

    if (label === "Deck Builder") {
      navigate("/mode/progression/deck");
      return;
    }

    if (label === "Store") {
      navigate("/mode/progression/store");
      return;
    }

    if (label === "Inventory") {
      navigate("/mode/progression/inventory");
      return;
    }

    if (label === "Trade") {
      navigate("/mode/progression/trade");
      return;
    }

    if (label === "Containers") {
      navigate("/mode/progression/opener");
      return;
    }

    if (label === "Feature Slots") {
      navigate("/mode/progression/feature-slots");
      return;
    }

    if (label === "Notes") {
      if (typeof onOpenNotes === "function") {
        onOpenNotes();
      }
      return;
    }

    if (label === "Ready Up") {
      if (
        currentPhase === "lobby" ||
        (roundNumber === 0 && currentPhase === "standby")
      ) {
        return;
      }

      setConfirmOpen(true);
    }
  }

  return (
    <>
      <ProgressionPanelShell
        kicker="PLAYER"
        title="Player Menu"
        meta={<span>{LEFT_MENU_ITEMS.length + RIGHT_MENU_ITEMS.length} Actions</span>}
        className="progression-panel-fill"
      >
        <div className="progression-player-menu-columns">
          <div className="progression-player-menu-column">
            {LEFT_MENU_ITEMS.map((item) => (
              <button
                key={item.label}
                type="button"
                className={`progression-action-btn progression-player-menu-btn ${item.primary ? "progression-action-btn-primary" : ""}`}
                onClick={() => handlePlayerMenuClick(item.label)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="progression-player-menu-column">
            {RIGHT_MENU_ITEMS.map((item) => (
              <button
                key={item.label}
                type="button"
                className="progression-action-btn progression-player-menu-btn"
                onClick={() => handlePlayerMenuClick(item.label)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </ProgressionPanelShell>

      {confirmOpen ? (
        <div className="progression-results-modal-overlay">
          <div className="progression-results-modal">
            <div className="progression-results-modal-header">
              <div>
                <div className="progression-results-modal-kicker">READY</div>
                <h2 className="progression-results-modal-title">Confirm Ready Up</h2>
              </div>

              <button
                type="button"
                className="progression-results-modal-close-btn"
                onClick={() => setConfirmOpen(false)}
              >
                x
              </button>
            </div>

            <div className="progression-results-modal-body">
              <p className="progression-readyup-copy">{readyPrompt}</p>

              <div className="progression-readyup-actions">
                <button
                  type="button"
                  className="progression-results-score-btn"
                  onClick={() => setConfirmOpen(false)}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="progression-results-score-btn"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await readyUp();
                      setConfirmOpen(false);
                    } catch (error) {
                      console.error("Ready up failed:", error);
                      window.alert(error.message || "Ready Up failed.");
                    }
                  }}
                >
                  {busy ? "Submitting..." : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default ProgressionPlayerMenuPanel;

