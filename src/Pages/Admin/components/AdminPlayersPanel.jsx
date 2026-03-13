import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useUser } from "../../../context/UserContext";

function AdminPlayersPanel() {
  const { user, setUser } = useUser();

  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [isOpen, setIsOpen] = useState(false);

  const isAdminPlus = user?.role === "Admin+";
  const isAdmin = user?.role === "Admin";

  async function fetchPlayers() {
    setLoading(true);

    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, avatar, role, progression_state, active_series_id")
      .order("username", { ascending: true });

    if (error) {
      console.error("Failed to fetch players:", error);
      setPlayers([]);
      setLoading(false);
      return;
    }

    setPlayers(data || []);
    setLoading(false);
  }

  useEffect(() => {
    fetchPlayers();
  }, []);

  const loadedCount = useMemo(() => players.length, [players]);

  function getRoleOptionsForCurrentUser() {
    if (isAdminPlus) {
      return ["Applicant", "Duelist", "Admin", "Blocked"];
    }

    if (isAdmin) {
      return ["Applicant", "Duelist", "Blocked"];
    }

    return [];
  }

  function canEditTarget(targetPlayer) {
    if (!user) return false;

    if (isAdminPlus) return true;

    if (isAdmin) {
      return targetPlayer.role !== "Admin" && targetPlayer.role !== "Admin+";
    }

    return false;
  }

  async function handleRoleChange(targetPlayer, nextRole) {
    if (!user?.id) return;
    if (!canEditTarget(targetPlayer)) return;
    if (!getRoleOptionsForCurrentUser().includes(nextRole)) return;
    if (targetPlayer.role === nextRole) return;

    const confirmed = window.confirm(
      `Change ${targetPlayer.username} from ${targetPlayer.role} to ${nextRole}?`
    );

    if (!confirmed) return;

    setActionLoadingId(targetPlayer.id);

    try {
      const updatePayload = {
        role: nextRole,
      };

      if (nextRole !== "Duelist") {
        updatePayload.active_series_id = null;
      }

      const { error } = await supabase
        .from("profiles")
        .update(updatePayload)
        .eq("id", targetPlayer.id);

      if (error) throw error;

      if (targetPlayer.id === user.id) {
        setUser({
          ...user,
          role: nextRole,
          activeSeriesId: nextRole === "Duelist" ? user.activeSeriesId : null,
        });
      }

      await fetchPlayers();
    } catch (error) {
      console.error("Role update failed:", error);
      window.alert("Role update failed. Check console for details.");
    } finally {
      setActionLoadingId(null);
    }
  }

  const roleOptions = getRoleOptionsForCurrentUser();

  return (
    <section className="admin-panel">
      <div className="admin-panel-header">
        <div>
          <p className="admin-panel-kicker">PLAYERS</p>
          <h2 className="admin-panel-title">User Role Overview</h2>
        </div>

        <div className="admin-reviewed-header-actions">
          <div className="admin-panel-count">{loadedCount} Loaded</div>

          <button
            className="admin-collapse-btn"
            onClick={() => setIsOpen((prev) => !prev)}
            type="button"
          >
            {isOpen ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="admin-panel-body">
          {loading && <p className="admin-loading-text">Loading players...</p>}

          {!loading && players.length === 0 && (
            <div className="admin-empty-state">
              <p className="admin-empty-title">No players found</p>
            </div>
          )}

          {!loading && players.length > 0 && (
            <div className="admin-player-list">
              {players.map((player) => {
                const isBusy = actionLoadingId === player.id;
                const editable = canEditTarget(player);

                const safeValue = roleOptions.includes(player.role)
                  ? player.role
                  : "";

                return (
                  <div className="admin-player-card" key={player.id}>
                    <div className="admin-player-left">
                      {player.avatar ? (
                        <img
                          src={player.avatar}
                          alt={player.username}
                          className="admin-player-avatar"
                        />
                      ) : (
                        <div className="admin-player-avatar admin-player-avatar-placeholder">
                          {(player.username || "?").charAt(0).toUpperCase()}
                        </div>
                      )}

                      <div className="admin-player-info">
                        <div className="admin-player-topline">
                          <span className="admin-player-name">{player.username}</span>
                          <span
                            className={`admin-player-role-pill admin-player-role-${player.role
                              .toLowerCase()
                              .replace("+", "plus")}`}
                          >
                            {player.role}
                          </span>
                        </div>

                        <div className="admin-player-meta">
                          <span>
                            Progression State: {player.progression_state || "None"}
                          </span>
                          <span>
                            Active Series: {player.active_series_id ? "Assigned" : "None"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="admin-player-actions">
                      <select
                        className="admin-role-select"
                        value={safeValue}
                        disabled={!editable || isBusy}
                        onChange={(e) => handleRoleChange(player, e.target.value)}
                      >
                        {!roleOptions.includes(player.role) && (
                          <option value={player.role}>{player.role}</option>
                        )}

                        {roleOptions.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default AdminPlayersPanel;