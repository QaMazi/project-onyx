import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useUser } from "../../../context/UserContext";

const ASSIGNABLE_ROLE_OPTIONS = ["Player", "Duelist", "Admin"];

function emptyForm() {
  return {
    username: "",
    auth_email: "",
    password: "",
    avatar_url: "",
    global_role: "Player",
  };
}

function normalizeGlobalRole(role) {
  const normalized = String(role || "").trim().toLowerCase();

  if (normalized === "admin+" || normalized === "adminplus") return "Admin+";
  if (normalized === "admin") return "Admin";
  if (normalized === "duelist" || normalized === "duelist+" || normalized === "duelistplus") {
    return "Duelist";
  }
  if (normalized === "player") return "Player";

  return "Player";
}

function getRoleSortOrder(role) {
  const order = {
    "Admin+": 0,
    Admin: 1,
    Duelist: 2,
    Player: 3,
  };

  return order[normalizeGlobalRole(role)] ?? 99;
}

function sortProfiles(list) {
  return [...list].sort((a, b) => {
    const roleCompare = getRoleSortOrder(a.global_role) - getRoleSortOrder(b.global_role);

    if (roleCompare !== 0) return roleCompare;

    return String(a.username || "").localeCompare(String(b.username || ""));
  });
}

function getEditableRoleOptions(profile) {
  const currentRole = normalizeGlobalRole(profile?.global_role);

  if (currentRole === "Admin+") {
    return ["Admin+", ...ASSIGNABLE_ROLE_OPTIONS];
  }

  return ASSIGNABLE_ROLE_OPTIONS;
}

export default function AdminProfilesPanel() {
  const { user, reloadUser } = useUser();

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

      const normalizedProfiles = (data || []).map((profile) => ({
        ...profile,
        global_role: normalizeGlobalRole(profile.global_role),
      }));

      setProfiles(sortProfiles(normalizedProfiles));
    } catch (error) {
      console.error("Failed to load profiles:", error);
      setStatusText(error?.message || "Failed to load profiles.");
    } finally {
      setLoadingProfiles(false);
    }
  }

  useEffect(() => {
    loadProfiles();
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
    const normalizedRole = normalizeGlobalRole(profile.global_role);

    setEditingId(profile.id);
    setEditForm({
      username: profile.username || "",
      auth_email: profile.auth_email || "",
      password: "",
      avatar_url: profile.avatar_url || "",
      global_role: normalizedRole === "Admin+" ? "Admin+" : normalizedRole,
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
        global_role: normalizeGlobalRole(createForm.global_role),
      };

      if (!payload.username || !payload.auth_email || !payload.password) {
        throw new Error("Username, internal email, and password are required.");
      }

      if (payload.global_role === "Admin+") {
        throw new Error("Create new profiles as Player, Duelist, or Admin only.");
      }

      await invokeAuthedFunction("admin-create-profile", payload);

      setCreateForm(emptyForm());
      setStatusText("Profile created successfully.");
      await loadProfiles();
      await reloadUser();
    } catch (error) {
      console.error("Create profile failed:", error);
      setStatusText(error?.message || "Failed to create profile.");
    } finally {
      setSubmittingCreate(false);
    }
  }

  async function handleEditSubmit(event, profile) {
    event.preventDefault();

    setSubmittingEdit(true);
    setStatusText("");

    try {
      const editableRoleOptions = getEditableRoleOptions(profile);
      const nextRole = normalizeGlobalRole(editForm.global_role);

      if (!editableRoleOptions.includes(nextRole)) {
        throw new Error("This role cannot be assigned from this panel state.");
      }

      const payload = {
        profile_id: profile.id,
        username: editForm.username.trim(),
        auth_email: editForm.auth_email.trim().toLowerCase(),
        password: editForm.password.trim() || null,
        avatar_url: editForm.avatar_url.trim() || null,
        global_role: nextRole,
      };

      if (!payload.username || !payload.auth_email) {
        throw new Error("Username and internal email are required.");
      }

      await invokeAuthedFunction("admin-update-profile", payload);

      setStatusText("Profile updated successfully.");
      setEditingId(null);
      setEditForm(emptyForm());
      await loadProfiles();
      await reloadUser();
    } catch (error) {
      console.error("Update profile failed:", error);
      setStatusText(error?.message || "Failed to update profile.");
    } finally {
      setSubmittingEdit(false);
    }
  }

  const filteredProfiles = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    if (!query) return profiles;

    return profiles.filter((profile) => {
      return (
        String(profile.username || "").toLowerCase().includes(query) ||
        String(profile.auth_email || "").toLowerCase().includes(query) ||
        String(normalizeGlobalRole(profile.global_role) || "")
          .toLowerCase()
          .includes(query)
      );
    });
  }, [profiles, searchText]);

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
            Create private site accounts and manage the single global role system from one panel.
            Series placement no longer controls permissions.
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
          <div className="admin-series-active-banner">
            <div className="admin-series-active-copy">
              <span className="admin-series-active-label">Global Role Permissions</span>
              <strong className="admin-series-active-name">Admin+ / Admin / Duelist / Player</strong>
              <span className="admin-series-active-meta">
                Admin+ = full access, Admin = progression admin access, Duelist = progression access,
                Player = future deck-game-only role and default for new profiles.
              </span>
            </div>
          </div>

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
                    {ASSIGNABLE_ROLE_OPTIONS.map((role) => (
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
                    const normalizedRole = normalizeGlobalRole(profile.global_role);
                    const roleOptions = getEditableRoleOptions(profile);

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
                              <span className="admin-role-pill">{normalizedRole}</span>
                            </div>

                            <p className="admin-profile-email">{profile.auth_email}</p>
                          </div>
                        </div>

                        {isEditing ? (
                          <form
                            className="admin-profile-form admin-profile-edit-form"
                            onSubmit={(event) => handleEditSubmit(event, profile)}
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
                                {roleOptions.map((role) => (
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

          {statusText ? <p className="admin-status-message">{statusText}</p> : null}
        </div>
      )}
    </section>
  );
}
