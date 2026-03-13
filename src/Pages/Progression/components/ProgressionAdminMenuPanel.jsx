import ProgressionPanelShell from "./ProgressionPanelShell";
import { useUser } from "../../../context/UserContext";

const ADMIN_MENU_ITEMS = [
  { label: "Round Results" },
  { label: "All Player Decks" },
  { label: "All Player Binders" },
  { label: "All Player Inventories" },
  { label: "Starter Deck Editor" },
  { label: "Activity Database" },
  { label: "Schedule Maker" },
  { label: "Bracket Maker" },
  { label: "Promo Box Maker" },
  { label: "Pack Maker" },
  { label: "Deck Box Maker" },
  { label: "Roadmap Updater" },
  { label: "Reward Giver" },
];

function ProgressionAdminMenuPanel() {
  const { user } = useUser();

  if (!user || (user.role !== "Admin" && user.role !== "Admin+")) {
    return null;
  }

  return (
    <ProgressionPanelShell
      kicker="ADMIN"
      title="Admin Menu"
      meta={<span>{ADMIN_MENU_ITEMS.length} Tools</span>}
    >
      <div className="progression-action-grid progression-action-grid-series">
        {ADMIN_MENU_ITEMS.map((item) => (
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

export default ProgressionAdminMenuPanel;