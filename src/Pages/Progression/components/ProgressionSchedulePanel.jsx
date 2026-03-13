import ProgressionPanelShell from "./ProgressionPanelShell";

const SCHEDULE_ITEMS = [
  {
    label: "Current Phase",
    value: "Deck Building",
  },
  {
    label: "Current Round",
    value: "1-1",
  },
  {
    label: "Next Match",
    value: "QaMazi vs Silverwolf",
  },
  {
    label: "Bracket Preview",
    value: "Double Elim • Upper Round 2",
  },
];

function ProgressionSchedulePanel() {
  return (
    <ProgressionPanelShell
      kicker="SCHEDULE"
      title="Schedule / Bracket"
      meta={<span>Display Only</span>}
    >
      <div className="progression-info-list">
        {SCHEDULE_ITEMS.map((item) => (
          <div className="progression-info-row" key={item.label}>
            <span className="progression-info-label">{item.label}</span>
            <span className="progression-info-value">{item.value}</span>
          </div>
        ))}
      </div>
    </ProgressionPanelShell>
  );
}

export default ProgressionSchedulePanel;