import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useUser } from "../../../context/UserContext";

function AdminApplicationsPanel() {
  const { user, setUser, reloadUser } = useUser();

  const [applications, setApplications] = useState([]);
  const [activeSeries, setActiveSeries] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [isOpen, setIsOpen] = useState(false);

  async function fetchApplications() {
    setLoading(true);

    try {
      const { data: applicationRows, error: applicationError } = await supabase
        .from("series_applications")
        .select(`
          id,
          user_id,
          series_id,
          status,
          created_at,
          reviewed_at,
          reviewed_by
        `)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (applicationError) throw applicationError;

      const pendingApplications = applicationRows || [];

      const uniqueUserIds = [
        ...new Set(
          pendingApplications
            .map((application) => application.user_id)
            .filter(Boolean)
        ),
      ];

      const uniqueSeriesIds = [
        ...new Set(
          pendingApplications
            .map((application) => application.series_id)
            .filter(Boolean)
        ),
      ];

      const [profilesResult, seriesResult, activeSeriesResult] = await Promise.all([
        uniqueUserIds.length > 0
          ? supabase
              .from("profiles")
              .select("id, username, avatar, role")
              .in("id", uniqueUserIds)
          : Promise.resolve({ data: [], error: null }),

        uniqueSeriesIds.length > 0
          ? supabase
              .from("series_summary_view")
              .select("*")
              .in("id", uniqueSeriesIds)
          : Promise.resolve({ data: [], error: null }),

        supabase
          .from("series_summary_view")
          .select("*")
          .eq("is_current", true)
          .maybeSingle(),
      ]);

      if (profilesResult.error) throw profilesResult.error;
      if (seriesResult.error) throw seriesResult.error;
      if (activeSeriesResult.error) throw activeSeriesResult.error;

      const profileMap = new Map(
        (profilesResult.data || []).map((profile) => [profile.id, profile])
      );

      const seriesMap = new Map(
        (seriesResult.data || []).map((series) => [series.id, series])
      );

      const hydratedApplications = pendingApplications.map((application) => ({
        ...application,
        profile: profileMap.get(application.user_id) || null,
        series: seriesMap.get(application.series_id) || null,
      }));

      setApplications(hydratedApplications);
      setActiveSeries(activeSeriesResult.data || null);
    } catch (error) {
      console.error("Failed to fetch applications:", error);
      setApplications([]);
      setActiveSeries(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchApplications();
  }, []);

  const pendingCount = useMemo(() => applications.length, [applications]);

  function isApplicationForGlobalActiveSeries(application) {
    if (!activeSeries?.id) return false;
    return application.series_id === activeSeries.id;
  }

  async function getFilledSeriesSlots(seriesId) {
    if (!seriesId) return 0;

    const { count, error } = await supabase
      .from("series_players")
      .select("id", { count: "exact", head: true })
      .eq("series_id", seriesId);

    if (error) throw error;

    return count || 0;
  }

  async function getExistingMembership(seriesId, userId) {
    const { data, error } = await supabase
      .from("series_players")
      .select("id, role, is_owner")
      .eq("series_id", seriesId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;

    return data || null;
  }

  async function handleReview(application, action) {
    if (!user?.id) return;

    const isApprove = action === "approve";
    const isDeny = action === "deny";
    const isBan = action === "ban";

    if (!isApprove && !isDeny && !isBan) return;

    if (isBan) {
      const confirmed = window.confirm(
        `Ban ${application.profile?.username || "this user"}? This will set their global role to Blocked.`
      );
      if (!confirmed) return;
    }

    setActionLoadingId(application.id);

    try {
      const reviewStatus = isApprove
        ? "approved"
        : isDeny
        ? "denied"
        : "banned";

      if (isApprove) {
        if (!application.series) {
          throw new Error("Application series could not be loaded.");
        }

        const existingMembership = await getExistingMembership(
          application.series_id,
          application.user_id
        );

        if (!existingMembership) {
          const filledSlots = await getFilledSeriesSlots(application.series_id);
          const maxPlayers = application.series.max_players || 6;

          if (filledSlots >= maxPlayers) {
            window.alert(
              `This series is already full (${filledSlots}/${maxPlayers}).`
            );
            setActionLoadingId(null);
            return;
          }
        }
      }

      const { error: applicationUpdateError } = await supabase
        .from("series_applications")
        .update({
          status: reviewStatus,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        })
        .eq("id", application.id);

      if (applicationUpdateError) throw applicationUpdateError;

      if (isApprove) {
        const existingMembership = await getExistingMembership(
          application.series_id,
          application.user_id
        );

        if (!existingMembership) {
          const { error: membershipInsertError } = await supabase
            .from("series_players")
            .insert({
              series_id: application.series_id,
              user_id: application.user_id,
              is_owner: false,
              role: "duelist",
            });

          if (membershipInsertError) throw membershipInsertError;
        }
      }

      if (isBan) {
        const { error: profileUpdateError } = await supabase
          .from("profiles")
          .update({
            role: "Blocked",
          })
          .eq("id", application.user_id);

        if (profileUpdateError) throw profileUpdateError;

        if (application.user_id === user.id) {
          setUser({
            ...user,
            globalRole: "Blocked",
            role: "Blocked",
            activeSeriesId: null,
            seriesMembershipRole: null,
          });
        }
      }

      await fetchApplications();
      await reloadUser();
    } catch (error) {
      console.error("Application review failed:", error);
      window.alert("Application action failed. Check console for details.");
    } finally {
      setActionLoadingId(null);
    }
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-header">
        <div>
          <p className="admin-panel-kicker">APPLICATIONS</p>
          <h2 className="admin-panel-title">Progression Access Requests</h2>
        </div>

        <div className="admin-reviewed-header-actions">
          <div className="admin-panel-count">{pendingCount} Pending</div>

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
                  ? `Status: ${activeSeries.status || "unknown"}`
                  : "Applications can still be reviewed, but only accepted players in the active series become Duelists."}
              </span>
            </div>
          </div>

          {loading && <p className="admin-loading-text">Loading applications...</p>}

          {!loading && applications.length === 0 && (
            <div className="admin-empty-state">
              <p className="admin-empty-title">No pending applications</p>
              <p className="admin-empty-text">
                Reviewed applications are removed from this panel to keep it clean.
              </p>
            </div>
          )}

          {!loading && applications.length > 0 && (
            <div className="admin-application-list">
              {applications.map((application) => {
                const isBusy = actionLoadingId === application.id;
                const joinsActiveSeries = isApplicationForGlobalActiveSeries(application);

                return (
                  <div className="admin-application-card" key={application.id}>
                    <div className="admin-application-left">
                      {application.profile?.avatar ? (
                        <img
                          src={application.profile.avatar}
                          alt={application.profile?.username || "User avatar"}
                          className="admin-application-avatar"
                        />
                      ) : (
                        <div className="admin-application-avatar admin-application-avatar-placeholder">
                          {(application.profile?.username || "?").charAt(0).toUpperCase()}
                        </div>
                      )}

                      <div className="admin-application-info">
                        <div className="admin-application-topline">
                          <span className="admin-application-username">
                            {application.profile?.username || "Unknown User"}
                          </span>

                          <span className="admin-application-status admin-application-status-pending">
                            pending
                          </span>
                        </div>

                        <div className="admin-application-meta">
                          <span>
                            Global Role: {application.profile?.role || "Unknown"}
                          </span>
                          <span>
                            Series: {application.series?.name || "Unknown Series"}
                          </span>
                          <span>
                            On Approval: {joinsActiveSeries ? "Duelist" : "Series Member"}
                          </span>
                        </div>

                        <div className="admin-application-date">
                          Submitted: {new Date(application.created_at).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="admin-application-actions">
                      <button
                        className="admin-action-btn admin-action-approve"
                        onClick={() => handleReview(application, "approve")}
                        disabled={isBusy}
                        type="button"
                      >
                        {isBusy ? "Working..." : "Approve"}
                      </button>

                      <button
                        className="admin-action-btn admin-action-deny"
                        onClick={() => handleReview(application, "deny")}
                        disabled={isBusy}
                        type="button"
                      >
                        {isBusy ? "Working..." : "Deny"}
                      </button>

                      <button
                        className="admin-action-btn admin-action-ban"
                        onClick={() => handleReview(application, "ban")}
                        disabled={isBusy}
                        type="button"
                      >
                        {isBusy ? "Working..." : "Ban"}
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

export default AdminApplicationsPanel;
