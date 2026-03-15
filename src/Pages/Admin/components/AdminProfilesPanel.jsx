import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useUser } from "../../../context/UserContext";

const ROLE_OPTIONS = ["Duelist", "Admin", "Admin+"];

function emptyForm() {
  return {
    username: "",
    auth_email: "",
    password: "",
    avatar_url: "",
    global_role: "Duelist",
  };
}

function sortProfiles(list) {
  return [...list].sort((a, b) => {
    const aRole = a.global_role || "";
    const bRole = b.global_role || "";

    if (aRole !== bRole) {
      const order = { "Admin+": 0, Admin: 1, Duelist: 2 };
      return (order[aRole] ?? 99) - (order[bRole] ?? 99);
    }

    return String(a.username || "").localeCompare(String(b.username || ""));
  });
}

function normalizePlayerAvatar(profile) {
  return profile.avatar_url || profile.avatar || "";
}

function normalizePlayerRole(profile) {
  return profile.global_role || profile.role || "Applicant";
}

export default function AdminProfilesPanel() {
  const { user, setUser, reloadUser } = useUser();

  const [profiles, setProfiles] = useState([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [createForm, setCreateForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm());
  const [statusText, setStatusText] = useState("");
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const [players, setPlayers] = useState([]);
  const [activeSeries, setActiveSeries] = useState(null);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [playerActionLoadingId, setPlayerActionLoadingId] = useState(null);

  const isAdminPlus = user?.canAccessHeaderAdmin;

  async function getAccessToken() {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) throw error;

    const token = session?.access_token;

    if (!token) {
      throw new Error("No active session token found.");
    }

    return token;
  }

  async function invokeAuthedFunction(functionName, body) {
    const token = await getAccessToken();

    const { data, error } = await supabase.functions.invoke(functionName, {
      body,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    return data;
  }

  async function loadProfiles() {
    if (!isAdminPlus) return;

    setLoadingProfiles(true);
    setStatusText("");

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, avatar_url, auth_email, global_role, created_at, updated_at")
        .order("username", { ascending: true });

      if (error) throw error;

      setProfiles(sortProfiles(data || []));
    } catch (error) {
      console.error("Failed to load profiles:", error);
      setStatusText(error?.message || "Failed to load profiles.");
    } finally {
      setLoadingProfiles(false);
    }
  }

  async function fetchPlayers() {
    if (!isAdminPlus) return;

    setLoadingPlayers(true);

    try {
      const { data: currentSeries, error: currentSeriesError } = await supabase
        .from("series_summary_view")
        .select("*")
        .eq("is_current", true)
        .maybeSingle();

      if (currentSeriesError) throw currentSeriesError;

      setActiveSeries(currentSeries || null);

      const [{ data: profileRows, error: profilesError }, { data: memberships, error: membershipsError }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, username, avatar_url, avatar, global_role, role")
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

      const membershipMap = new Map((memberships || []).map((member) => [member.user_id, member]));

      const hydratedPlayers = (profileRows || []).map((profile) => {
        const membership = membershipMap.get(profile.id) || null;
        const globalRole = normalizePlayerRole(profile);

        return {
          id: profile.id,
          username: profile.username,
          avatar: normalizePlayerAvatar(profile),
          globalRole,
          isBlocked: globalRole === "Blocked",
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
      setLoadingPlayers(false);
    }
  }

  useEffect(() => {
    loadProfiles();
    fetchPlayers();
  }, [isAdminPlus]);

  function toggleOpen() {
    setIsOpen((prev) => !prev);
  }

  function handleHeaderKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleOpen();
    }
  }

  function updateCreateField(key, value) {
    setCreateForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function updateEditField(key, value) {
    setEditForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function beginEdit(profile) {
    setEditingId(profile.id);
    setEditForm({
      username: profile.username || "",
      auth_email: profile.auth_email || "",
      password: "",
      avatar_url: profile.avatar_url || "",
      global_role: profile.global_role || "Duelist",
    });
    setStatusText("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(emptyForm());
    setStatusText("");
  }

  async function handleCreateSubmit(event) {
    event.preventDefault();

    setSubmittingCreate(true);
    setStatusText("");

    try {
      const payload = {
        username: createForm.username.trim(),
        auth_email: createForm.auth_email.trim().toLowerCase(),
        password: createForm.password,
        avatar_url: createForm.avatar_url.trim() || null,
        global_role: createForm.global_role,
      };

      if (!payload.username || !payload.auth_email || !payload.password) {
        throw new Error("Username, internal email, and password are required.");
      }

      await invokeAuthedFunction("admin-create-profile", payload);

      setCreateForm(emptyForm());
      setStatusText("Profile created successfully.");
      await loadProfiles();
      await fetchPlayers();
    } catch (error) {
      console.error("Create profile failed:", error);
      setStatusText(error?.message || "Failed to create profile.");
    } finally {
      setSubmittingCreate(false);
    }
  }

  async function handleEditSubmit(event, profileId) {
    event.preventDefault();

    setSubmittingEdit(true);
    setStatusText("");

    try {
      const payload = {
        profile_id: profileId,
        username: editForm.username.trim(),
        auth_email: editForm.auth_email.trim().toLowerCase(),
        password: editForm.password.trim() || null,
        avatar_url: editForm.avatar_url.trim() || null,
        global_role: editForm.global_role,
      };

      if (!payload.username || !payload.auth_email) {
        throw new Error("Username and internal email are required.");
      }

      await invokeAuthedFunction("admin-update-profile", payload);

      setStatusText("Profile updated successfully.");
      setEditingId(null);
      setEditForm(emptyForm());
      await loadProfiles();
      await fetchPlayers();
    } catch (error) {
      console.error("Update profile failed:", error);
      setStatusText(error?.message || "Failed to update profile.");
    } finally {
      setSubmittingEdit(false);
    }
  }

  async function updateGlobalRole(targetPlayerId, nextGlobalRole) {
    const { error } = await supabase
      .from("profiles")
      .update({
        global_role: nextGlobalRole,
        role: nextGlobalRole,
      })
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

    const { error: insertError } = await supabase.from("series_players").insert({
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
    const confirmed = window.confirm(`${player.isBlocked ? "Unblock" : "Block"} ${player.username}?`);
    if (!confirmed) return;

    setPlayerActionLoadingId(player.id);

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

      await loadProfiles();
      await fetchPlayers();
      await reloadUser();
    } catch (error) {
      console.error("Player moderation failed:", error);
      window.alert("Player moderation failed. Check console for details.");
    } finally {
      setPlayerActionLoadingId(null);
    }
  }

  async function handlePromoteToSeriesAdmin(player) {
    if (!user?.id || player.isOwner || player.globalRole === "Admin+") return;

    const confirmed = window.confirm(`Promote ${player.username} to Admin in the active series?`);
    if (!confirmed) return;

    setPlayerActionLoadingId(player.id);

    try {
      await upsertSeriesMembership(player.id, "admin");
      await fetchPlayers();
      await reloadUser();
    } catch (error) {
      console.error("Failed to promote series admin:", error);
      window.alert("Series promotion failed. Check console for details.");
    } finally {
      setPlayerActionLoadingId(null);
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

    setPlayerActionLoadingId(player.id);

    try {
      await upsertSeriesMembership(player.id, "duelist");
      await fetchPlayers();
      await reloadUser();
    } catch (error) {
      console.error("Failed to set duelist role:", error);
      window.alert("Series role update failed. Check console for details.");
    } finally {
      setPlayerActionLoadingId(null);
    }
  }

  async function handleRemoveFromSeries(player) {
    if (!user?.id || !player.inActiveSeries || player.isOwner || player.globalRole === "Admin+") {
      return;
    }

    const confirmed = window.confirm(`Remove ${player.username} from the active series?`);
    if (!confirmed) return;

    setPlayerActionLoadingId(player.id);

    try {
      await removeFromActiveSeries(player.id);
      await fetchPlayers();
      await reloadUser();
    } catch (error) {
      console.error("Failed to remove player from active series:", error);
      window.alert("Failed to remove player from series. Check console for details.");
    } finally {
      setPlayerActionLoadingId(null);
    }
  }

  function getSeriesRoleLabel(player) {
    if (player.isOwner) return "Owner";
    if (player.membershipRole === "admin") return "Admin";
    if (player.membershipRole === "duelist") return "Duelist";
    return "Applicant";
  }

  const filteredProfiles = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    if (!query) return profiles;

    return profiles.filter((profile) => {
      return (
        String(profile.username || "").toLowerCase().includes(query) ||
        String(profile.auth_email || "").toLowerCase().includes(query) ||
        String(profile.global_role || "").toLowerCase().includes(query)
      );
    });
  }, [profiles, searchText]);

  const loadedPlayerCount = useMemo(() => players.length, [players]);

  if (!isAdminPlus) return null;

  return (
    <section className="admin-panel">
      <div className="admin-panel-header">
        <div
          className="admin-panel-header-main"
          onClick={toggleOpen}
          onKeyDown={handleHeaderKeyDown}
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
        >
          <p className="admin-panel-kicker">ACCOUNT CONTROL</p>
          <h2 className="admin-panel-title">Profiles</h2>
          <p className="admin-section-description">
            Create private site accounts, manage internal login details, assign roles,
            and control active-series player placement from one panel.
          </p>
        </div>

        <div className="admin-panel-header-actions">
          <div className="admin-panel-count">{profiles.length} Profiles</div>
          <button className="admin-collapse-btn" onClick={toggleOpen} type="button">
            {isOpen ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="admin-panel-body">
          <div className="admin-profiles-grid">
            <div className="admin-profiles-create">
              <h3 className="admin-subsection-title">Create Profile</h3>

              <form className="admin-profile-form" onSubmit={handleCreateSubmit}>
                <div className="admin-form-row">
                  <label className="admin-form-label">Username</label>
                  <input
                    className="admin-form-input"
                    type="text"
                    value={createForm.username}
                    onChange={(event) => updateCreateField("username", event.target.value)}
                    placeholder="Player username"
                  />
                </div>

                <div className="admin-form-row">
                  <label className="admin-form-label">Internal Email</label>
                  <input
                    className="admin-form-input"
                    type="text"
                    value={createForm.auth_email}
                    onChange={(event) => updateCreateField("auth_email", event.target.value)}
                    placeholder="player@projectonyx.local"
                  />
                </div>

                <div className="admin-form-row">
                  <label className="admin-form-label">Password</label>
                  <input
                    className="admin-form-input"
                    type="password"
                    value={createForm.password}
                    onChange={(event) => updateCreateField("password", event.target.value)}
                    placeholder="Create password"
                  />
                </div>

                <div className="admin-form-row">
                  <label className="admin-form-label">Avatar URL</label>
                  <input
                    className="admin-form-input"
                    type="text"
                    value={createForm.avatar_url}
                    onChange={(event) => updateCreateField("avatar_url", event.target.value)}
                    placeholder="https://..."
                  />
                </div>

                <div className="admin-form-row">
                  <label className="admin-form-label">Role</label>
                  <select
                    className="admin-form-input admin-form-select"
                    value={createForm.global_role}
                    onChange={(event) => updateCreateField("global_role", event.target.value)}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>

                <button className="admin-action-button" type="submit" disabled={submittingCreate}>
                  {submittingCreate ? "Creating..." : "Create Profile"}
                </button>
              </form>
            </div>

            <div className="admin-profiles-list-shell">
              <div className="admin-profiles-list-topbar">
                <h3 className="admin-subsection-title">Existing Profiles</h3>

                <input
                  className="admin-form-input admin-profiles-search"
                  type="text"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search profiles..."
                />
              </div>

              {loadingProfiles ? (
                <div className="admin-empty-state">Loading profiles...</div>
              ) : filteredProfiles.length === 0 ? (
                <div className="admin-empty-state">No profiles found.</div>
              ) : (
                <div className="admin-profiles-list">
                  {filteredProfiles.map((profile) => {
                    const isEditing = editingId === profile.id;

                    return (
                      <div key={profile.id} className="admin-profile-card">
                        <div className="admin-profile-card-top">
                          <div className="admin-profile-avatar">
                            {profile.avatar_url ? (
                              <img src={profile.avatar_url} alt={profile.username} />
                            ) : (
                              <span>{String(profile.username || "?").charAt(0).toUpperCase()}</span>
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

                        {isEditing ? (
                          <form
                            className="admin-profile-form admin-profile-edit-form"
                            onSubmit={(event) => handleEditSubmit(event, profile.id)}
                          >
                            <div className="admin-form-row">
                              <label className="admin-form-label">Username</label>
                              <input
                                className="admin-form-input"
                                type="text"
                                value={editForm.username}
                                onChange={(event) => updateEditField("username", event.target.value)}
                              />
                            </div>

                            <div className="admin-form-row">
                              <label className="admin-form-label">Internal Email</label>
                              <input
                                className="admin-form-input"
                                type="text"
                                value={editForm.auth_email}
                                onChange={(event) => updateEditField("auth_email", event.target.value)}
                              />
                            </div>

                            <div className="admin-form-row">
                              <label className="admin-form-label">New Password</label>
                              <input
                                className="admin-form-input"
                                type="password"
                                value={editForm.password}
                                onChange={(event) => updateEditField("password", event.target.value)}
                                placeholder="Leave blank to keep current"
                              />
                            </div>

                            <div className="admin-form-row">
                              <label className="admin-form-label">Avatar URL</label>
                              <input
                                className="admin-form-input"
                                type="text"
                                value={editForm.avatar_url}
                                onChange={(event) => updateEditField("avatar_url", event.target.value)}
                              />
                            </div>

                            <div className="admin-form-row">
                              <label className="admin-form-label">Role</label>
                              <select
                                className="admin-form-input admin-form-select"
                                value={editForm.global_role}
                                onChange={(event) => updateEditField("global_role", event.target.value)}
                              >
                                {ROLE_OPTIONS.map((role) => (
                                  <option key={role} value={role}>
                                    {role}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="admin-profile-actions">
                              <button className="admin-action-button" type="submit" disabled={submittingEdit}>
                                {submittingEdit ? "Saving..." : "Save Changes"}
                              </button>

                              <button className="admin-secondary-button" type="button" onClick={cancelEdit}>
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div className="admin-profile-actions">
                            <button
                              className="admin-action-button"
                              type="button"
                              onClick={() => beginEdit(profile)}
                            >
                              Edit Profile
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="admin-player-control-shell">
            <div className="admin-player-control-header">
              <h3 className="admin-subsection-title">Active Series Player Control</h3>
              <p className="admin-section-description">
                Manage who is placed into the global active series and adjust blocked,
                duelist, and series-admin status from here.
              </p>
            </div>

            <div className="admin-series-active-banner">
              <div className="admin-series-active-copy">
                <span className="admin-series-active-label">Current Global Active Series</span>
                <strong className="admin-series-active-name">{activeSeries?.name || "No active series"}</strong>
                <span className="admin-series-active-meta">
                  {activeSeries
                    ? `${activeSeries.player_count || 0}/${activeSeries.max_players || 0} players`
                    : "Series-only Admin and Duelist controls activate when a global series is active."}
                </span>
              </div>
            </div>

            {loadingPlayers ? <p className="admin-loading-text">Loading players...</p> : null}

            {!loadingPlayers && loadedPlayerCount === 0 ? (
              <div className="admin-empty-state">
                <p className="admin-empty-title">No players found</p>
              </div>
            ) : null}

            {!loadingPlayers && loadedPlayerCount > 0 ? (
              <div className="admin-player-list">
                {players.map((player) => {
                  const isBusy = playerActionLoadingId === player.id;
                  const canManageSeries = !player.isOwner && player.globalRole !== "Admin+";
                  const canModerateGlobal = player.globalRole !== "Admin+";

                  return (
                    <div className="admin-player-card" key={player.id}>
                      <div className="admin-player-left">
                        {player.avatar ? (
                          <img src={player.avatar} alt={player.username} className="admin-player-avatar" />
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
                            <span>Series Role: {getSeriesRoleLabel(player)}</span>
                            <span>In Active Series: {player.inActiveSeries ? "Yes" : "No"}</span>
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
            ) : null}
          </div>

          {statusText ? <p className="admin-status-message">{statusText}</p> : null}
        </div>
      )}
    </section>
  );
}
