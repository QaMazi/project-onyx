import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ProgressionPanelShell from "./ProgressionPanelShell";
import { supabase } from "../../../lib/supabase";

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

function getRoleClassName(role) {
  const normalized = String(role || "")
    .toLowerCase()
    .replace("+", "plus");

  return `progression-series-player-role progression-series-player-role-${normalized}`;
}

function getInitial(name) {
  return (name || "?").charAt(0).toUpperCase();
}

function ProgressionSeriesMenuPanel() {
  const navigate = useNavigate();

  const [seriesData, setSeriesData] = useState(null);
  const [players, setPlayers] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);

  async function openSeriesInfo() {
    const { data: activeSeries, error: activeSeriesError } = await supabase
      .from("game_series")
      .select("*")
      .eq("is_current", true)
      .maybeSingle();

    if (activeSeriesError) {
      console.error("Failed to fetch active series:", activeSeriesError);
      setSeriesData(null);
      setPlayers([]);
      setModalOpen(true);
      return;
    }

    if (!activeSeries) {
      setSeriesData(null);
      setPlayers([]);
      setModalOpen(true);
      return;
    }

    const { data: members, error: membersError } = await supabase
      .from("series_players")
      .select("*")
      .eq("series_id", activeSeries.id);

    if (membersError) {
      console.error("Failed to fetch series members:", membersError);
      setSeriesData(activeSeries);
      setPlayers([]);
      setModalOpen(true);
      return;
    }

    const userIds = (members || []).map((member) => member.user_id);

    let profiles = [];

    if (userIds.length > 0) {
      const { data: profileRows, error: profilesError } = await supabase
        .from("profiles")
        .select("id, username, avatar, role")
        .in("id", userIds);

      if (profilesError) {
        console.error("Failed to fetch player profiles:", profilesError);
      } else {
        profiles = profileRows || [];
      }
    }

    const mergedPlayers = (members || []).map((member) => {
      const profile = profiles.find((p) => p.id === member.user_id);

      return {
        id: member.user_id,
        username: profile?.username || "Unknown User",
        avatar: profile?.avatar || "",
        role: profile?.role || "Applicant",
        is_owner: member.is_owner,
      };
    });

    setSeriesData(activeSeries);
    setPlayers(mergedPlayers);
    setModalOpen(true);
  }

  function handleSeriesMenuClick(label) {
    if (label === "Series Info") {
      openSeriesInfo();
      return;
    }

    if (label === "Card Database") {
      navigate("/mode/progression/cards");
    }
  }

  const owner = players.find((player) => player.is_owner) || null;
  const duelists = players.filter((player) => !player.is_owner);
  const emptySlotCount = Math.max(
    0,
    Number(seriesData?.max_players || 0) - players.length
  );

  return (
    <>
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
              onClick={() => handleSeriesMenuClick(item.label)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </ProgressionPanelShell>

      {modalOpen && (
        <div className="progression-modal" onClick={() => setModalOpen(false)}>
          <div
            className="progression-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="progression-modal-close"
              onClick={() => setModalOpen(false)}
              type="button"
            >
              ×
            </button>

            {!seriesData ? (
              <div className="progression-series-empty-state">
                <h2 className="progression-series-empty-state-title">
                  No Active Series
                </h2>
                <p className="progression-series-empty-state-text">
                  There is currently no active progression series.
                </p>
              </div>
            ) : (
              <>
                <h2 className="progression-modal-title">{seriesData.name}</h2>

                <p className="progression-modal-description">
                  {seriesData.description || "No description provided."}
                </p>

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
                            <span className={getRoleClassName(owner.role)}>
                              {owner.role}
                            </span>
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
                      <div className="progression-series-player-card" key={player.id}>
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
                            <span className={getRoleClassName(player.role)}>
                              {player.role}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}

                    {Array.from({ length: emptySlotCount }).map((_, index) => (
                      <div className="progression-series-empty-slot" key={index}>
                        <div className="progression-series-empty-slot-icon">+</div>
                        <div className="progression-series-player-info">
                          <span className="progression-series-player-name">
                            Empty Slot
                          </span>
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
          </div>
        </div>
      )}
    </>
  );
}

export default ProgressionSeriesMenuPanel;