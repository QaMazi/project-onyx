import ProgressionPanelShell from "./ProgressionPanelShell";

const PLACEHOLDER_PLAYERS = [
  {
    id: 1,
    username: "QaMazi",
    role: "Duelist",
    status: "Online",
  },
  {
    id: 2,
    username: "SKX",
    role: "Admin",
    status: "Dueling",
  },
  {
    id: 3,
    username: "Silverwolf",
    role: "Duelist",
    status: "Away",
  },
  {
    id: 4,
    username: "Blu",
    role: "Duelist",
    status: "Offline",
  },
  {
    id: 5,
    username: "Nightmare",
    role: "Admin+",
    status: "Online",
  },
  {
    id: 6,
    username: "N/A",
    role: "Applicant",
    status: "Offline",
  },
];

function getRoleClassName(role) {
  const normalized = String(role || "")
    .toLowerCase()
    .replace("+", "plus");

  return `progression-player-role progression-player-role-${normalized}`;
}

function getStatusClassName(status) {
  const normalized = String(status || "").toLowerCase();
  return `progression-player-status-dot progression-player-status-dot-${normalized}`;
}

function ProgressionOnlinePlayersPanel() {
  return (
    <ProgressionPanelShell
      kicker="PLAYERS"
      title="Online Players"
      meta={<span>{PLACEHOLDER_PLAYERS.length} Listed</span>}
    >
      <div className="progression-player-list">
        {PLACEHOLDER_PLAYERS.map((player) => (
          <div className="progression-player-card" key={player.id}>
            <div className="progression-player-left">
              <div className="progression-player-avatar progression-player-avatar-placeholder">
                {(player.username || "?").charAt(0).toUpperCase()}
              </div>

              <div className="progression-player-info">
                <div className="progression-player-topline">
                  <span className="progression-player-name">{player.username}</span>
                  <span className={getRoleClassName(player.role)}>
                    {player.role}
                  </span>
                </div>

                <div className="progression-player-status-row">
                  <span className={getStatusClassName(player.status)}></span>
                  <span className="progression-player-status-text">
                    {player.status}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </ProgressionPanelShell>
  );
}

export default ProgressionOnlinePlayersPanel;