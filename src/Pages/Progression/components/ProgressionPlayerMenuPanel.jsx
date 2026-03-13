import ProgressionPanelShell from "./ProgressionPanelShell";

const PLAYER_MENU_ITEMS = [
  { label: "Ready Up", primary: true },
  { label: "Deck" },
  { label: "Binder" },
  { label: "Inventory" },
  { label: "Trade" },
  { label: "Store" },
  { label: "Notes" },
  { label: "Opener" },
];

function ProgressionPlayerMenuPanel() {
  return (
    <ProgressionPanelShell
      kicker="PLAYER"
      title="Player Menu"
      meta={<span>{PLAYER_MENU_ITEMS.length} Actions</span>}
    >
      <div className="progression-player-menu-layout">
        <div className="progression-action-grid">
          {PLAYER_MENU_ITEMS.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`progression-action-btn ${
                item.primary ? "progression-action-btn-primary" : ""
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="progression-player-menu-footer">
          <button
            type="button"
            className="progression-action-btn progression-player-menu-back-btn"
          >
            Back To Mode Select
          </button>
        </div>
      </div>
    </ProgressionPanelShell>
  );
}

export default ProgressionPlayerMenuPanel;