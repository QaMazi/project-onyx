import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useUser } from "../../../context/UserContext";

const MAX_OWNED_SERIES = 5;

const DEFAULT_CREATE_FORM = {
  name: "",
  description: "",
  maxPlayers: 6,
};

function AdminSeriesPanel() {
  const { user, reloadUser } = useUser();

  const [seriesList, setSeriesList] = useState([]);
  const [globalActiveSeries, setGlobalActiveSeries] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [isOpen, setIsOpen] = useState(true);
  const [createForm, setCreateForm] = useState(DEFAULT_CREATE_FORM);

  async function fetchSeriesData() {
    if (!user?.id) {
      setSeriesList([]);
      setGlobalActiveSeries(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const [{ data: ownedSeries, error: ownedError }, { data: activeSeries, error: activeError }] =
        await Promise.all([
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
        ]);

      if (ownedError) throw ownedError;
      if (activeError) throw activeError;

      setSeriesList(ownedSeries || []);
      setGlobalActiveSeries(activeSeries || null);
    } catch (error) {
      console.error("Failed to fetch series:", error);
      setSeriesList([]);
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

  return (
    <section className="admin-panel">
      <div className="admin-panel-header">
        <div>
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
                  onChange={(e) =>
                    handleCreateFormChange("maxPlayers", e.target.value)
                  }
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
                  onChange={(e) =>
                    handleCreateFormChange("description", e.target.value)
                  }
                  placeholder="Optional notes for admins."
                  rows={3}
                />
              </label>
            </div>

            {!canCreateSeries && (
              <p className="admin-loading-text">
                You already own {MAX_OWNED_SERIES} series. Delete one before creating another.
              </p>
            )}
          </form>

          {loading && <p className="admin-loading-text">Loading series...</p>}

          {!loading && seriesList.length === 0 && (
            <div className="admin-empty-state">
              <p className="admin-empty-title">No owned series found</p>
              <p className="admin-empty-text">
                Create your first series to begin managing progression.
              </p>
            </div>
          )}

          {!loading && seriesList.length > 0 && (
            <div className="admin-series-list">
              {seriesList.map((series) => {
                const isBusy = actionLoadingId === series.id;
                const statusLabel = getStatusLabel(series.status);

                return (
                  <div className="admin-series-card" key={series.id}>
                    <div className="admin-series-card-top">
                      <div className="admin-series-card-heading">
                        <div className="admin-series-title-row">
                          <span className="admin-series-name">{series.name}</span>

                          {series.is_current && (
                            <span className="admin-series-current-pill">GLOBAL ACTIVE</span>
                          )}

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
                      <span>Players: {series.player_count ?? "—"} / {series.max_players ?? "—"}</span>
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

export default AdminSeriesPanel;
