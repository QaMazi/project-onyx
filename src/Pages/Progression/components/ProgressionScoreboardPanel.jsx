import ProgressionPanelShell from "./ProgressionPanelShell";

const PLACEHOLDER_STANDINGS = [
  { rank: 1, player: "QaMazi", record: "3-0" },
  { rank: 2, player: "SKX", record: "2-1" },
  { rank: 3, player: "Silverwolf", record: "2-1" },
  { rank: 4, player: "Blu", record: "1-2" },
  { rank: 5, player: "Nightmare", record: "1-2" },
  { rank: 6, player: "N/A", record: "0-3" },
];

function ProgressionScoreboardPanel() {
  return (
    <ProgressionPanelShell
      kicker="STANDINGS"
      title="Scoreboard"
      meta={<span>{PLACEHOLDER_STANDINGS.length} Players</span>}
    >
      <div className="progression-info-list">
        {PLACEHOLDER_STANDINGS.map((row) => (
          <div className="progression-info-row" key={row.rank}>
            <span className="progression-info-label">
              #{row.rank} {row.player}
            </span>
            <span className="progression-info-value">
              {row.record}
            </span>
          </div>
        ))}
      </div>
    </ProgressionPanelShell>
  );
}

export default ProgressionScoreboardPanel;