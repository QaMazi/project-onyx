import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useUser } from "../../../context/UserContext";

const MAX_OWNED_SERIES = 5;

const DEFAULT_CREATE_FORM = {
  name: "",
  description: "",
  maxPlayers: 6,
};

function normalizeSeriesMemberRole(globalRole) {
  const normalized = String(globalRole || "").trim().toLowerCase();

  if (normalized === "admin+" || normalized === "adminplus" || normalized === "admin") {
    return "admin";
  }

  return "duelist";
}

function AdminSeriesPanel() {
  const { user, reloadUser } = useUser();

  const [seriesList, setSeriesList] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [seriesMembersById, setSeriesMembersById] = useState({});
  const [globalActiveSeries, setGlobalActiveSeries] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [memberActionSeriesId, setMemberActionSeriesId] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [createForm, setCreateForm] = useState(DEFAULT_CREATE_FORM);
  const [memberSearchBySeries, setMemberSearchBySeries] = useState({});

  async function fetchSeriesData() {
    if (!user?.id) {
      setSeriesList([]);
      setProfiles([]);
      setSeriesMembersById({});
      setGlobalActiveSeries(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const [
        { data: ownedSeries, error: ownedError },
        { data: activeSeries, error: activeError },
        { data: profileRows, error: profilesError },
      ] = await Promise.all([
        supabase
          .from("series_summary_view")
          .select("*")
          .eq("created_by", user.id)
          .order("created_at", { ascending: false }),

        supabase
          .from("series_summary_view")
          .select("*")
          .eq("is_current", true)
          .maybeSingle(),

        supabase
          .from("profiles")
          .select("id, username, avatar_url, auth_email, global_role")
          .order("username", { ascending: true }),
      ]);

      if (ownedError) throw ownedError;
      if (activeError) throw activeError;
      if (profilesError) throw profilesError;

      const nextOwnedSeries = ownedSeries || [];
      const ownedSeriesIds = nextOwnedSeries.map((series) => series.id).filter(Boolean);
      let nextMembersById = {};

      if (ownedSeriesIds.length > 0) {
        const { data: memberRows, error: membersError } = await supabase
          .from("series_players_view")
          .select("*")
          .in("series_id", ownedSeriesIds)
          .order("is_owner", { ascending: false })
          .order("username", { ascending: true });

        if (membersError) throw membersError;

        nextMembersById = (memberRows || []).reduce((acc, member) => {
          const seriesId = member.series_id;

          if (!acc[seriesId]) {
            acc[seriesId] = [];
          }

          acc[seriesId].push(member);
          return acc;
        }, {});
      }

      setSeriesList(nextOwnedSeries);
      setProfiles(profileRows || []);
      setSeriesMembersById(nextMembersById);
      setGlobalActiveSeries(activeSeries || null);
    } catch (error) {
      console.error("Failed to fetch series:", error);
      setSeriesList([]);
      setProfiles([]);
      setSeriesMembersById({});
      setGlobalActiveSeries(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSeriesData();
  }, [user?.id]);

  const ownedSeriesCount = useMemo(() => seriesList.length, [seriesList]);

  const canCreateSeries = useMemo(
    () => ownedSeriesCount < MAX_OWNED_SERIES,
    [ownedSeriesCount]
  );

  function handleCreateFormChange(field, value) {
    setCreateForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function handleMemberSearchChange(seriesId, value) {
    setMemberSearchBySeries((prev) => ({
      ...prev,
      [seriesId]: value,
    }));
  }

  async function ensureCreatorMembership(seriesId) {
    const { data: existingMembership, error: existingMembershipError } = await supabase
      .from("series_players")
      .select("id")
      .eq("series_id", seriesId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingMembershipError) throw existingMembershipError;

    if (existingMembership) return;

    const { error: membershipInsertError } = await supabase
      .from("series_players")
      .insert({
        series_id: seriesId,
        user_id: user.id,
        is_owner: true,
        role: "admin",
      });

    if (membershipInsertError) throw membershipInsertError;
  }

  async function handleCreateSeries(event) {
    event.preventDefault();

    if (!user?.id) return;
    if (user.globalRole !== "Admin+") return;

    if (!canCreateSeries) {
      window.alert(
        `You already own ${MAX_OWNED_SERIES} series. Delete one before creating another.`
      );
      return;
    }

    const trimmedName = createForm.name.trim();
    const trimmedDescription = createForm.description.trim();

    if (!trimmedName) {
      window.alert("Series name is required.");
      return;
    }

    setCreating(true);

    try {
      const payload = {
        name: trimmedName,
        description: trimmedDescription || null,
        status: "lobby",
        current_phase: "lobby",
        max_players: Number(createForm.maxPlayers) || 6,
        is_current: false,
        created_by: user.id,
      };

      const { data: createdSeries, error: createError } = await supabase
        .from("game_series")
        .insert(payload)
        .select("id")
        .single();

      if (createError) throw createError;

      await ensureCreatorMembership(createdSeries.id);

      setCreateForm(DEFAULT_CREATE_FORM);
      await fetchSeriesData();
      await reloadUser();
    } catch (error) {
      console.error("Failed to create series:", error);
      window.alert("Series creation failed. Check console for details.");
    } finally {
      setCreating(false);
    }
  }

  async function handleAddPlayerToSeries(series, profile) {
    if (!user?.id || !series?.id || !profile?.id) return;
    if (user.globalRole !== "Admin+") return;
    if (series.created_by !== user.id) return;

    const currentMembers = seriesMembersById[series.id] || [];
    const alreadyMember = currentMembers.some((member) => member.user_id === profile.id);

    if (alreadyMember) {
      window.alert(`${profile.username} is already in this series.`);
      return;
    }

    const maxPlayers = Number(series.max_players || 0);

    if (maxPlayers > 0 && currentMembers.length >= maxPlayers) {
      window.alert(`"${series.name}" is already at its player limit.`);
      return;
    }

    setMemberActionSeriesId(series.id);

    try {
      const { error } = await supabase.from("series_players").insert({
        series_id: series.id,
        user_id: profile.id,
        is_owner: false,
        role: normalizeSeriesMemberRole(profile.global_role),
      });

      if (error) throw error;

      handleMemberSearchChange(series.id, "");
      await fetchSeriesData();
      await reloadUser();
    } catch (error) {
      console.error("Failed to add player to series:", error);
      window.alert(error?.message || "Failed to add player to series.");
    } finally {
      setMemberActionSeriesId(null);
    }
  }

  async function clearGlobalActiveSeries() {
    const { error } = await supabase
      .from("game_series")
      .update({ is_current: false })
      .eq("is_current", true);

    if (error) throw error;
  }

  async function handleStartSeries(series) {
    if (!user?.id || !series?.id) return;
    if (user.globalRole !== "Admin+") return;
    if (series.created_by !== user.id) return;
    if (series.status !== "lobby") return;

    const confirmed = window.confirm(
      `Start "${series.name}"? Any currently active series will become inactive.`
    );

    if (!confirmed) return;

    setActionLoadingId(series.id);

    try {
      await ensureCreatorMembership(series.id);
      await clearGlobalActiveSeries();

      const now = new Date().toISOString();

      const { error } = await supabase
        .from("game_series")
        .update({
          status: "active",
          current_phase: "lobby",
          is_current: true,
          started_at: series.started_at || now,
          paused_at: null,
          last_used_at: now,
        })
        .eq("id", series.id)
        .eq("created_by", user.id);

      if (error) throw error;

      await fetchSeriesData();
      await reloadUser();
    } catch (error) {
      console.error("Failed to start series:", error);
      window.alert("Failed to start series. Check console for details.");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handlePauseSeries(series) {
    if (!user?.id || !series?.id) return;
    if (user.globalRole !== "Admin+") return;
    if (series.created_by !== user.id) return;
    if (series.status !== "active") return;

    setActionLoadingId(series.id);

    try {
      const { error } = await supabase
        .from("game_series")
        .update({
          status: "paused",
          is_current: false,
          paused_at: new Date().toISOString(),
        })
        .eq("id", series.id)
        .eq("created_by", user.id);

      if (error) throw error;

      await fetchSeriesData();
      await reloadUser();
    } catch (error) {
      console.error("Failed to pause series:", error);
      window.alert("Failed to pause series. Check console for details.");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleResumeSeries(series) {
    if (!user?.id || !series?.id) return;
    if (user.globalRole !== "Admin+") return;
    if (series.created_by !== user.id) return;
    if (series.status !== "paused") return;

    const confirmed = window.confirm(
      `Resume "${series.name}"? Any currently active series will become inactive.`
    );

    if (!confirmed) return;

    setActionLoadingId(series.id);

    try {
      await ensureCreatorMembership(series.id);
      await clearGlobalActiveSeries();

      const { error } = await supabase
        .from("game_series")
        .update({
          status: "active",
          is_current: true,
          paused_at: null,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", series.id)
        .eq("created_by", user.id);

      if (error) throw error;

      await fetchSeriesData();
      await reloadUser();
    } catch (error) {
      console.error("Failed to resume series:", error);
      window.alert("Failed to resume series. Check console for details.");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleDeleteSeries(series) {
    if (!user?.id || !series?.id) return;
    if (user.globalRole !== "Admin+") return;
    if (series.created_by !== user.id) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete "${series.name}"?\n\nThis cannot be undone.`
    );

    if (!confirmed) return;

    setActionLoadingId(series.id);

    try {
      const { error } = await supabase
        .from("game_series")
        .delete()
        .eq("id", series.id)
        .eq("created_by", user.id);

      if (error) throw error;

      await fetchSeriesData();
      await reloadUser();
    } catch (error) {
      console.error("Failed to delete series:", error);
      window.alert("Failed to delete series. Check console for details.");
    } finally {
      setActionLoadingId(null);
    }
  }

  function handlePlaceholderAction(label) {
    window.alert(`${label} is not built yet. Placeholder only for now.`);
  }

  function formatDate(value) {
    if (!value) return "—";
    return new Date(value).toLocaleString();
  }

  function getStatusClassName(status) {
    const normalized = String(status || "").toLowerCase();

    if (normalized === "active") return "admin-series-status-active";
    if (normalized === "paused") return "admin-series-status-paused";
    if (normalized === "ended") return "admin-series-status-ended";
    if (normalized === "lobby") return "admin-series-status-draft";

    return "admin-series-status-neutral";
  }

  function getStatusLabel(status) {
    const normalized = String(status || "").toLowerCase();

    if (normalized === "lobby") return "Lobby";
    if (normalized === "active") return "Active";
    if (normalized === "paused") return "Paused";
    if (normalized === "ended") return "Ended";

    return "Unknown";
  }

  function getMemberRoleLabel(member) {
    if (member?.is_owner) return "Owner";
    if (String(member?.role || "").toLowerCase() === "admin") return "Admin";
    return "Duelist";
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-header">
        <div
          className="admin-panel-header-main"
          onClick={() => setIsOpen((prev) => !prev)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setIsOpen((prev) => !prev);
            }
          }}
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
        >
          <p className="admin-panel-kicker">SERIES</p>
          <h2 className="admin-panel-title">Series Management</h2>
        </div>

        <div className="admin-reviewed-header-actions">
          <div className="admin-panel-count">
            {ownedSeriesCount}/{MAX_OWNED_SERIES} Owned
          </div>

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
              <span className="admin-series-active-label">Global Active Series</span>
              <strong className="admin-series-active-name">
                {globalActiveSeries?.name || "No active series set"}
              </strong>
              <span className="admin-series-active-meta">
                {globalActiveSeries
                  ? `${getStatusLabel(globalActiveSeries.status)} • Phase: ${
                      globalActiveSeries.current_phase || "lobby"
                    }`
                  : "Starting or resuming one of your series will make it the active global series."}
              </span>
            </div>
          </div>

          <form className="admin-series-create-card" onSubmit={handleCreateSeries}>
            <div className="admin-series-create-header">
              <div>
                <p className="admin-series-create-kicker">CREATE</p>
                <h3 className="admin-series-create-title">New Series</h3>
              </div>

              <button
                type="submit"
                className="admin-action-btn admin-action-approve"
                disabled={creating || !canCreateSeries || user?.globalRole !== "Admin+"}
              >
                {creating ? "Creating..." : "Create Series"}
              </button>
            </div>

            <div className="admin-series-create-grid">
              <label className="admin-series-field">
                <span className="admin-series-field-label">Series Name</span>
                <input
                  type="text"
                  className="admin-series-input"
                  value={createForm.name}
                  onChange={(e) => handleCreateFormChange("name", e.target.value)}
                  placeholder="DM Era Progression"
                  maxLength={80}
                />
              </label>

              <label className="admin-series-field">
                <span className="admin-series-field-label">Max Players</span>
                <select
                  className="admin-series-input"
                  value={createForm.maxPlayers}
                  onChange={(e) => handleCreateFormChange("maxPlayers", e.target.value)}
                >
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                  <option value="6">6</option>
                </select>
              </label>

              <label className="admin-series-field admin-series-field-full">
                <span className="admin-series-field-label">Description</span>
                <textarea
                  className="admin-series-textarea"
                  value={createForm.description}
                  onChange={(e) => handleCreateFormChange("description", e.target.value)}
                  placeholder="Optional notes for admins."
                  rows={3}
                />
              </label>
            </div>

            {!canCreateSeries ? (
              <p className="admin-loading-text">
                You already own {MAX_OWNED_SERIES} series. Delete one before creating another.
              </p>
            ) : null}
          </form>

          {loading ? <p className="admin-loading-text">Loading series...</p> : null}

          {!loading && seriesList.length === 0 ? (
            <div className="admin-empty-state">
              <p className="admin-empty-title">No owned series found</p>
              <p className="admin-empty-text">
                Create your first series to begin managing progression.
              </p>
            </div>
          ) : null}

          {!loading && seriesList.length > 0 ? (
            <div className="admin-series-list">
              {seriesList.map((series) => {
                const isBusy = actionLoadingId === series.id;
                const isAddingMember = memberActionSeriesId === series.id;
                const statusLabel = getStatusLabel(series.status);
                const currentMembers = seriesMembersById[series.id] || [];
                const memberIds = new Set(currentMembers.map((member) => member.user_id));
                const memberSearch = String(memberSearchBySeries[series.id] || "").trim().toLowerCase();
                const openSlots = Math.max(
                  0,
                  Number(series.max_players || 0) - currentMembers.length
                );
                const candidateProfiles = profiles
                  .filter((profile) => !memberIds.has(profile.id))
                  .filter((profile) => {
                    if (!memberSearch) return true;

                    return (
                      String(profile.username || "").toLowerCase().includes(memberSearch) ||
                      String(profile.auth_email || "").toLowerCase().includes(memberSearch)
                    );
                  })
                  .slice(0, 8);

                return (
                  <div className="admin-series-card" key={series.id}>
                    <div className="admin-series-card-top">
                      <div className="admin-series-card-heading">
                        <div className="admin-series-title-row">
                          <span className="admin-series-name">{series.name}</span>

                          {series.is_current ? (
                            <span className="admin-series-current-pill">GLOBAL ACTIVE</span>
                          ) : null}

                          <span
                            className={`admin-series-status-pill ${getStatusClassName(
                              series.status
                            )}`}
                          >
                            {statusLabel}
                          </span>
                        </div>

                        <p className="admin-series-description">
                          {series.description || "No description provided."}
                        </p>
                      </div>
                    </div>

                    <div className="admin-series-meta">
                      <span>Phase: {series.current_phase || "lobby"}</span>
                      <span>
                        Players: {series.player_count ?? "—"} / {series.max_players ?? "—"}
                      </span>
                      <span>Created: {formatDate(series.created_at)}</span>
                      <span>Started: {formatDate(series.started_at)}</span>
                      <span>Paused: {formatDate(series.paused_at)}</span>
                      <span>Ended: {formatDate(series.ended_at)}</span>
                    </div>

                    <div className="admin-series-actions">
                      <button
                        className="admin-action-btn admin-action-approve"
                        onClick={() => handleStartSeries(series)}
                        disabled={isBusy || series.status !== "lobby"}
                        type="button"
                      >
                        {isBusy && series.status === "lobby" ? "Working..." : "Start"}
                      </button>

                      <button
                        className="admin-action-btn"
                        onClick={() => handlePauseSeries(series)}
                        disabled={isBusy || series.status !== "active"}
                        type="button"
                      >
                        {isBusy && series.status === "active" ? "Working..." : "Pause"}
                      </button>

                      <button
                        className="admin-action-btn"
                        onClick={() => handleResumeSeries(series)}
                        disabled={isBusy || series.status !== "paused"}
                        type="button"
                      >
                        {isBusy && series.status === "paused" ? "Working..." : "Resume"}
                      </button>

                      <button
                        className="admin-action-btn"
                        onClick={() => handlePlaceholderAction("Rename series")}
                        type="button"
                        disabled={isBusy}
                      >
                        Rename
                      </button>

                      <button
                        className="admin-action-btn admin-action-ban"
                        onClick={() => handleDeleteSeries(series)}
                        type="button"
                        disabled={isBusy}
                      >
                        {isBusy ? "Working..." : "Delete"}
                      </button>
                    </div>

                    <div className="admin-player-control-shell">
                      <div className="admin-player-control-header">
                        <h4 className="admin-subsection-title">Series Players</h4>
                        <p className="admin-series-active-meta">
                          {currentMembers.length} joined, {openSlots} open slot
                          {openSlots === 1 ? "" : "s"}.
                        </p>
                      </div>

                      {currentMembers.length > 0 ? (
                        <div className="admin-player-list">
                          {currentMembers.map((member) => (
                            <div className="admin-player-card" key={`${series.id}-${member.user_id}`}>
                              <div className="admin-player-left">
                                <div className="admin-player-avatar">
                                  {member.avatar ? (
                                    <img src={member.avatar} alt={member.username} />
                                  ) : (
                                    <span>
                                      {String(member.username || "?").charAt(0).toUpperCase()}
                                    </span>
                                  )}
                                </div>

                                <div className="admin-player-info">
                                  <div className="admin-player-topline">
                                    <h4 className="admin-player-name">{member.username}</h4>
                                    <span className="admin-player-role-pill">
                                      {getMemberRoleLabel(member)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="admin-empty-state">
                          No players added yet beyond owner membership.
                        </div>
                      )}

                      <div className="admin-series-create-card">
                        <div className="admin-series-create-header">
                          <div>
                            <p className="admin-series-create-kicker">ADD PLAYERS</p>
                            <h4 className="admin-series-create-title">Search Profiles</h4>
                          </div>
                        </div>

                        <div className="admin-form-row">
                          <label className="admin-form-label">Search Username Or Email</label>
                          <input
                            className="admin-form-input"
                            type="text"
                            value={memberSearchBySeries[series.id] || ""}
                            onChange={(event) =>
                              handleMemberSearchChange(series.id, event.target.value)
                            }
                            placeholder="Search active accounts..."
                            disabled={isAddingMember}
                          />
                        </div>

                        {openSlots === 0 ? (
                          <div className="admin-empty-state">
                            This series is full. Increase capacity or remove a player before adding more.
                          </div>
                        ) : candidateProfiles.length === 0 ? (
                          <div className="admin-empty-state">
                            {memberSearch
                              ? "No matching profiles are available to add."
                              : "All available profiles are already in this series."}
                          </div>
                        ) : (
                          <div className="admin-profiles-list admin-series-member-search-results">
                            {candidateProfiles.map((profile) => (
                              <div className="admin-profile-card" key={`${series.id}-${profile.id}`}>
                                <div className="admin-profile-card-top">
                                  <div className="admin-profile-avatar">
                                    {profile.avatar_url ? (
                                      <img src={profile.avatar_url} alt={profile.username} />
                                    ) : (
                                      <span>
                                        {String(profile.username || "?").charAt(0).toUpperCase()}
                                      </span>
                                    )}
                                  </div>

                                  <div className="admin-profile-meta">
                                    <div className="admin-profile-name-row">
                                      <h4 className="admin-profile-name">{profile.username}</h4>
                                      <span className="admin-role-pill">{profile.global_role}</span>
                                    </div>

                                    <p className="admin-profile-email">{profile.auth_email}</p>
                                  </div>
                                </div>

                                <div className="admin-profile-actions">
                                  <button
                                    className="admin-action-button"
                                    type="button"
                                    onClick={() => handleAddPlayerToSeries(series, profile)}
                                    disabled={isAddingMember}
                                  >
                                    {isAddingMember ? "Adding..." : "Add To Series"}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

export default AdminSeriesPanel;
