import ProgressionPanelShell from "./ProgressionPanelShell";

const SERIES_MENU_ITEMS = [
  { label: "Series Info" },
  { label: "Banlist" },
  { label: "Starter Decks" },
  { label: "Phases & Rules" },
  { label: "Card Database" },
  { label: "Pack Opener & Database" },
  { label: "Deck Box Opener & Database" },
  { label: "Promo Box Opener & Database" },
  { label: "Roadmap" },
];

function ProgressionSeriesMenuPanel() {
  return (
    <ProgressionPanelShell
      kicker="SERIES"
      title="Series Menu"
      meta={<span>{SERIES_MENU_ITEMS.length} Links</span>}
    >
      <div className="progression-action-grid progression-action-grid-series">
        {SERIES_MENU_ITEMS.map((item) => (
          <button
            key={item.label}
            type="button"
            className="progression-action-btn"
          >
            {item.label}
          </button>
        ))}
      </div>
    </ProgressionPanelShell>
  );
}

export default ProgressionSeriesMenuPanel;