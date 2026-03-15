import { useEffect, useMemo, useState } from "react";
import ProgressionPanelShell from "./ProgressionPanelShell";
import { supabase } from "../../../lib/supabase";

function getRoleClassName(role) {
  const normalized = String(role || "")
    .toLowerCase()
    .replace("+", "plus");

  return `progression-series-player-role progression-series-player-role-${normalized}`;
}

function getInitial(name) {
  return (name || "?").charAt(0).toUpperCase();
}

export default function ProgressionOnlinePlayersPanel() {
  const [seriesData, setSeriesData] = useState(null);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);

  async function fetchSeriesInfo() {
    setLoading(true);

    try {
      const { data: activeSeries, error: activeSeriesError } = await supabase
        .from("series_summary_view")
        .select("*")
        .eq("is_current", true)
        .maybeSingle();

      if (activeSeriesError) {
        console.error("Failed to fetch active series:", activeSeriesError);
        setSeriesData(null);
        setPlayers([]);
        return;
      }

      if (!activeSeries) {
        setSeriesData(null);
        setPlayers([]);
        return;
      }

      const { data: members, error: membersError } = await supabase
        .from("series_players_view")
        .select("*")
        .eq("series_id", activeSeries.id)
        .order("is_owner", { ascending: false })
        .order("username", { ascending: true });

      if (membersError) {
        console.error("Failed to fetch series players:", membersError);
        setSeriesData(activeSeries);
        setPlayers([]);
        return;
      }

      setSeriesData(activeSeries);
      setPlayers(members || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSeriesInfo();

    function handlePhaseChange(event) {
      const nextPhase = event?.detail?.phase;

      if (!nextPhase) return;

      setSeriesData((prev) =>
        prev
          ? {
              ...prev,
              current_phase: nextPhase,
            }
          : prev
      );
    }

    window.addEventListener("onyx-phase-changed", handlePhaseChange);

    return () => {
      window.removeEventListener("onyx-phase-changed", handlePhaseChange);
    };
  }, []);

  const owner = useMemo(
    () => players.find((player) => player.is_owner) || null,
    [players]
  );

  const duelists = useMemo(
    () => players.filter((player) => !player.is_owner),
    [players]
  );

  const emptySlotCount = Math.max(
    0,
    Number(seriesData?.max_players || 0) - players.length
  );

  return (
    <ProgressionPanelShell
      kicker="SERIES"
      title="Series Info"
      meta={
        <span>
          {seriesData ? `${players.length} / ${seriesData.max_players} Players` : "No Active Series"}
        </span>
      }
      className="progression-panel-fill"
    >
      {loading ? (
        <div className="progression-series-empty-state">
          <h2 className="progression-series-empty-state-title">Loading Series</h2>
          <p className="progression-series-empty-state-text">
            Pulling current progression series data.
          </p>
        </div>
      ) : !seriesData ? (
        <div className="progression-series-empty-state">
          <h2 className="progression-series-empty-state-title">No Active Series</h2>
          <p className="progression-series-empty-state-text">
            There is currently no active progression series.
          </p>
        </div>
      ) : (
        <>
          <div className="progression-series-summary-header">
            <h2 className="progression-series-summary-title">{seriesData.name}</h2>

            <p className="progression-series-summary-description">
              {seriesData.description || "No description provided."}
            </p>
          </div>

          <div className="progression-series-meta">
            <div className="progression-series-meta-card">
              <span className="progression-series-meta-label">Status</span>
              <span className="progression-series-meta-value">
                {seriesData.status || "Unknown"}
              </span>
            </div>

            <div className="progression-series-meta-card">
              <span className="progression-series-meta-label">Phase</span>
              <span className="progression-series-meta-value">
                {seriesData.current_phase || "Unknown"}
              </span>
            </div>

            <div className="progression-series-meta-card">
              <span className="progression-series-meta-label">Players</span>
              <span className="progression-series-meta-value">
                {players.length} / {seriesData.max_players}
              </span>
            </div>
          </div>

          <div className="progression-series-section">
            <h3 className="progression-series-section-title">ADMIN</h3>

            <div className="progression-series-player-list">
              {owner ? (
                <div className="progression-series-player-card">
                  <div className="progression-series-player-avatar">
                    {owner.avatar ? (
                      <img src={owner.avatar} alt={owner.username} />
                    ) : (
                      getInitial(owner.username)
                    )}
                  </div>

                  <div className="progression-series-player-info">
                    <div className="progression-series-player-name-row">
                      <span className="progression-series-player-name">
                        {owner.username}
                      </span>
                    </div>

                    <div>
                      <span className={getRoleClassName("admin")}>Owner</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="progression-series-empty-slot">
                  <div className="progression-series-empty-slot-icon">—</div>
                  <div className="progression-series-player-info">
                    <span className="progression-series-player-name">
                      No Series Admin
                    </span>
                    <span className="progression-series-empty-slot-text">
                      No owner is currently assigned.
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="progression-series-section">
            <h3 className="progression-series-section-title">DUELISTS</h3>

            <div className="progression-series-player-list">
              {duelists.map((player) => (
                <div className="progression-series-player-card" key={player.user_id}>
                  <div className="progression-series-player-avatar">
                    {player.avatar ? (
                      <img src={player.avatar} alt={player.username} />
                    ) : (
                      getInitial(player.username)
                    )}
                  </div>

                  <div className="progression-series-player-info">
                    <div className="progression-series-player-name-row">
                      <span className="progression-series-player-name">
                        {player.username}
                      </span>
                    </div>

                    <div>
                      <span
                        className={getRoleClassName(
                          player.role === "admin" ? "admin" : "duelist"
                        )}
                      >
                        {player.role === "admin" ? "Admin" : "Duelist"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {Array.from({ length: emptySlotCount }).map((_, index) => (
                <div className="progression-series-empty-slot" key={`empty-${index}`}>
                  <div className="progression-series-empty-slot-icon">+</div>
                  <div className="progression-series-player-info">
                    <span className="progression-series-player-name">Empty Slot</span>
                    <span className="progression-series-empty-slot-text">
                      Waiting for player
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </ProgressionPanelShell>
  );
}
