import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useUser } from "../../../context/UserContext";

function AdminPlayersPanel() {
  const { user, setUser, reloadUser } = useUser();

  const [players, setPlayers] = useState([]);
  const [activeSeries, setActiveSeries] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [isOpen, setIsOpen] = useState(false);

  async function fetchPlayers() {
    setLoading(true);

    try {
      const { data: currentSeries, error: currentSeriesError } = await supabase
        .from("series_summary_view")
        .select("*")
        .eq("is_current", true)
        .maybeSingle();

      if (currentSeriesError) throw currentSeriesError;

      setActiveSeries(currentSeries || null);

      const [{ data: profiles, error: profilesError }, { data: memberships, error: membershipsError }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, username, avatar, role")
            .order("username", { ascending: true }),

          currentSeries?.id
            ? supabase
                .from("series_players_view")
                .select("*")
                .eq("series_id", currentSeries.id)
                .order("is_owner", { ascending: false })
                .order("username", { ascending: true })
            : Promise.resolve({ data: [], error: null }),
        ]);

      if (profilesError) throw profilesError;
      if (membershipsError) throw membershipsError;

      const membershipMap = new Map(
        (memberships || []).map((member) => [member.user_id, member])
      );

      const hydratedPlayers = (profiles || []).map((profile) => {
        const membership = membershipMap.get(profile.id) || null;

        return {
          id: profile.id,
          username: profile.username,
          avatar: profile.avatar,
          globalRole: profile.role,
          isBlocked: profile.role === "Blocked",
          inActiveSeries: !!membership,
          membershipRole: membership?.role || null,
          isOwner: Boolean(membership?.is_owner),
        };
      });

      setPlayers(hydratedPlayers);
    } catch (error) {
      console.error("Failed to fetch players:", error);
      setPlayers([]);
      setActiveSeries(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPlayers();
  }, []);

  const loadedCount = useMemo(() => players.length, [players]);

  async function updateGlobalRole(targetPlayerId, nextGlobalRole) {
    const { error } = await supabase
      .from("profiles")
      .update({ role: nextGlobalRole })
      .eq("id", targetPlayerId);

    if (error) throw error;
  }

  async function upsertSeriesMembership(targetPlayerId, nextMembershipRole) {
    if (!activeSeries?.id) {
      throw new Error("No active series available.");
    }

    const { data: existingMembership, error: existingMembershipError } = await supabase
      .from("series_players")
      .select("id, is_owner")
      .eq("series_id", activeSeries.id)
      .eq("user_id", targetPlayerId)
      .maybeSingle();

    if (existingMembershipError) throw existingMembershipError;

    if (existingMembership) {
      if (existingMembership.is_owner) return;

      const { error: updateError } = await supabase
        .from("series_players")
        .update({ role: nextMembershipRole })
        .eq("id", existingMembership.id);

      if (updateError) throw updateError;

      return;
    }

    const { error: insertError } = await supabase
      .from("series_players")
      .insert({
        series_id: activeSeries.id,
        user_id: targetPlayerId,
        is_owner: false,
        role: nextMembershipRole,
      });

    if (insertError) throw insertError;
  }

  async function removeFromActiveSeries(targetPlayerId) {
    if (!activeSeries?.id) {
      throw new Error("No active series available.");
    }

    const { error } = await supabase
      .from("series_players")
      .delete()
      .eq("series_id", activeSeries.id)
      .eq("user_id", targetPlayerId)
      .eq("is_owner", false);

    if (error) throw error;
  }

  async function handleBlockToggle(player) {
    if (!user?.id) return;
    if (player.globalRole === "Admin+") return;

    const nextGlobalRole = player.isBlocked ? "Applicant" : "Blocked";

    const confirmed = window.confirm(
      `${player.isBlocked ? "Unblock" : "Block"} ${player.username}?`
    );

    if (!confirmed) return;

    setActionLoadingId(player.id);

    try {
      await updateGlobalRole(player.id, nextGlobalRole);

      if (player.id === user.id && nextGlobalRole === "Blocked") {
        setUser({
          ...user,
          globalRole: "Blocked",
          role: "Blocked",
          activeSeriesId: null,
          seriesMembershipRole: null,
        });
      }

      await fetchPlayers();
      await reloadUser();
    } catch (error) {
      console.error("Player moderation failed:", error);
      window.alert("Player moderation failed. Check console for details.");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handlePromoteToSeriesAdmin(player) {
    if (!user?.id || player.isOwner || player.globalRole === "Admin+") return;

    const confirmed = window.confirm(
      `Promote ${player.username} to Admin in the active series?`
    );

    if (!confirmed) return;

    setActionLoadingId(player.id);

    try {
      await upsertSeriesMembership(player.id, "admin");
      await fetchPlayers();
      await reloadUser();
    } catch (error) {
      console.error("Failed to promote series admin:", error);
      window.alert("Series promotion failed. Check console for details.");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleSetAsDuelist(player) {
    if (!user?.id || player.isOwner || player.globalRole === "Admin+") return;

    const confirmed = window.confirm(
      player.inActiveSeries
        ? `Set ${player.username} to Duelist in the active series?`
        : `Add ${player.username} to the active series as a Duelist?`
    );

    if (!confirmed) return;

    setActionLoadingId(player.id);

    try {
      await upsertSeriesMembership(player.id, "duelist");
      await fetchPlayers();
      await reloadUser();
    } catch (error) {
      console.error("Failed to set duelist role:", error);
      window.alert("Series role update failed. Check console for details.");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleRemoveFromSeries(player) {
    if (!user?.id || !player.inActiveSeries || player.isOwner || player.globalRole === "Admin+") return;

    const confirmed = window.confirm(
      `Remove ${player.username} from the active series?`
    );

    if (!confirmed) return;

    setActionLoadingId(player.id);

    try {
      await removeFromActiveSeries(player.id);
      await fetchPlayers();
      await reloadUser();
    } catch (error) {
      console.error("Failed to remove player from active series:", error);
      window.alert("Failed to remove player from series. Check console for details.");
    } finally {
      setActionLoadingId(null);
    }
  }

  function getSeriesRoleLabel(player) {
    if (player.isOwner) return "Owner";
    if (player.membershipRole === "admin") return "Admin";
    if (player.membershipRole === "duelist") return "Duelist";
    return "Applicant";
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-header">
        <div>
          <p className="admin-panel-kicker">PLAYERS</p>
          <h2 className="admin-panel-title">Active Series Player Control</h2>
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
          <div className="admin-series-active-banner">
            <div className="admin-series-active-copy">
              <span className="admin-series-active-label">Current Global Active Series</span>
              <strong className="admin-series-active-name">
                {activeSeries?.name || "No active series"}
              </strong>
              <span className="admin-series-active-meta">
                {activeSeries
                  ? `${activeSeries.player_count || 0}/${activeSeries.max_players || 0} players`
                  : "Series-only Admin and Duelist controls activate when a global series is active."}
              </span>
            </div>
          </div>

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
                const canManageSeries =
                  !player.isOwner && player.globalRole !== "Admin+";
                const canModerateGlobal =
                  player.globalRole !== "Admin+";

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
                            className={`admin-player-role-pill admin-player-role-${String(
                              player.globalRole || "applicant"
                            )
                              .toLowerCase()
                              .replace("+", "plus")}`}
                          >
                            {player.isBlocked ? "Blocked" : player.globalRole}
                          </span>
                        </div>

                        <div className="admin-player-meta">
                          <span>
                            Series Role: {getSeriesRoleLabel(player)}
                          </span>
                          <span>
                            In Active Series: {player.inActiveSeries ? "Yes" : "No"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="admin-application-actions">
                      <button
                        className="admin-action-btn"
                        onClick={() => handleSetAsDuelist(player)}
                        disabled={isBusy || !canManageSeries || player.isBlocked}
                        type="button"
                      >
                        {isBusy ? "Working..." : player.inActiveSeries ? "Set Duelist" : "Add Duelist"}
                      </button>

                      <button
                        className="admin-action-btn admin-action-approve"
                        onClick={() => handlePromoteToSeriesAdmin(player)}
                        disabled={isBusy || !canManageSeries || player.isBlocked}
                        type="button"
                      >
                        {isBusy ? "Working..." : "Promote Admin"}
                      </button>

                      <button
                        className="admin-action-btn admin-action-deny"
                        onClick={() => handleRemoveFromSeries(player)}
                        disabled={isBusy || !canManageSeries || !player.inActiveSeries}
                        type="button"
                      >
                        {isBusy ? "Working..." : "Remove"}
                      </button>

                      <button
                        className="admin-action-btn admin-action-ban"
                        onClick={() => handleBlockToggle(player)}
                        disabled={isBusy || !canModerateGlobal}
                        type="button"
                      >
                        {isBusy ? "Working..." : player.isBlocked ? "Unblock" : "Block"}
                      </button>
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
