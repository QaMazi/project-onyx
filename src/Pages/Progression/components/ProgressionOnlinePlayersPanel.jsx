import { useEffect, useState } from "react";
import ProgressionPanelShell from "./ProgressionPanelShell";
import { supabase } from "../../../lib/supabase";

function getRoleClassName(role) {
  const normalized = String(role || "").toLowerCase().replace("+", "plus");
  return `progression-player-role progression-player-role-${normalized}`;
}

function getInitial(name) {
  return (name || "?").charAt(0).toUpperCase();
}

function computeStatus(lastActiveAt, isDueling) {
  if (isDueling) return "Dueling";
  if (!lastActiveAt) return "Offline";

  const last = new Date(lastActiveAt);
  const now = new Date();
  const diffMs = now - last;
  const diffMinutes = diffMs / 1000 / 60;

  if (diffMinutes <= 10) return "Online";
  return "Away";
}

export default function ProgressionOnlinePlayersPanel({ currentUserId }) {
  const [players, setPlayers] = useState([]);
  const [heartbeat, setHeartbeat] = useState(Date.now());

  // Heartbeat to refresh online/away status every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => setHeartbeat(Date.now()), 10000);
    return () => clearInterval(interval);
  }, []);

  // Fetch all users
  useEffect(() => {
    async function fetchPlayers() {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, username, avatar, role, last_active_at")
          .order("username");

        if (error) {
          console.error("Failed to fetch online players:", error);
          setPlayers([]);
          return;
        }

        // mark current user if they exist
        const updatedPlayers = (data || []).map((p) => ({
          ...p,
          isDueling: false, // could be updated later per session
        }));

        // sort online first
        updatedPlayers.sort((a, b) => {
          const statusOrder = { Online: 0, Dueling: 1, Away: 2, Offline: 3 };
          const aStatus = computeStatus(a.last_active_at, a.isDueling);
          const bStatus = computeStatus(b.last_active_at, b.isDueling);
          return statusOrder[aStatus] - statusOrder[bStatus];
        });

        setPlayers(updatedPlayers);
      } catch (err) {
        console.error("Error fetching players:", err);
      }
    }

    fetchPlayers();
  }, [heartbeat]);

  return (
    <ProgressionPanelShell
      kicker="PLAYERS"
      title="Online Players"
      meta={<span>{players.length} Listed</span>}
    >
      <div className="progression-player-list">
        {players.map((player) => {
          const status = computeStatus(player.last_active_at, player.isDueling);
          const statusDotClass = {
            Online: "progression-player-status-dot-online",
            Away: "progression-player-status-dot-away",
            Dueling: "progression-player-status-dot-dueling",
            Offline: "progression-player-status-dot-offline",
          }[status];

          return (
            <div className="progression-player-card" key={player.id}>
              <div className="progression-player-left">
                <div className="progression-player-avatar">
                  {player.avatar ? (
                    <img src={player.avatar} alt={player.username} />
                  ) : (
                    getInitial(player.username)
                  )}
                </div>

                <div className="progression-player-info">
                  <div className="progression-player-topline">
                    <span className="progression-player-name">{player.username}</span>
                    <span className={getRoleClassName(player.role)}>{player.role}</span>
                  </div>

                  <div className="progression-player-status-row">
                    <span className={`progression-player-status-dot ${statusDotClass}`}></span>
                    <span className="progression-player-status-text">{status}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Optional: empty slots placeholder */}
        {/* Example for 6 slots minus current number of users */}
        {Array.from({ length: Math.max(0, 6 - players.length) }).map((_, i) => (
          <div className="progression-series-empty-slot" key={`empty-${i}`}>
            <div className="progression-series-empty-slot-icon">+</div>
            <div className="progression-player-info">
              <span className="progression-player-name">Empty Slot</span>
              <span className="progression-series-empty-slot-text">
                Waiting for player
              </span>
            </div>
          </div>
        ))}
      </div>
    </ProgressionPanelShell>
  );
}