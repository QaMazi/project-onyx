import { useNavigate } from "react-router-dom";
import ProgressionPanelShell from "./ProgressionPanelShell";

const PLAYER_MENU_ITEMS = [
  { label: "Binder" },
  { label: "Deck Builder" },
  { label: "Store" },
  { label: "Inventory" },
  { label: "Trade" },
  { label: "Container Opener" },
  { label: "Notes" },
  { label: "Ready Up", primary: true },
];

function ProgressionPlayerMenuPanel({ onOpenNotes }) {
  const navigate = useNavigate();

  function handlePlayerMenuClick(label) {
    if (label === "Binder") {
      navigate("/mode/progression/binder");
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

    if (label === "Container Opener") {
      navigate("/mode/progression/opener");
      return;
    }

    if (label === "Notes") {
      if (typeof onOpenNotes === "function") {
        onOpenNotes();
      }
      return;
    }

    if (label === "Ready Up") {
      window.alert("Ready Up logic is not wired yet.");
    }
  }

  return (
    <ProgressionPanelShell
      kicker="PLAYER"
      title="Player Menu"
      meta={<span>{PLAYER_MENU_ITEMS.length} Actions</span>}
      className="progression-panel-fill"
    >
      <div className="progression-action-grid progression-action-grid-player">
        {PLAYER_MENU_ITEMS.map((item) => (
          <button
            key={item.label}
            type="button"
            className={`progression-action-btn ${item.primary ? "progression-action-btn-primary" : ""}`}
            onClick={() => handlePlayerMenuClick(item.label)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </ProgressionPanelShell>
  );
}

export default ProgressionPlayerMenuPanel;