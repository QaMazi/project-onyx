import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

function AdminReviewedApplicationsPanel() {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);

  async function fetchReviewedApplications() {
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
        .in("status", ["approved", "denied", "banned"])
        .order("reviewed_at", { ascending: false });

      if (applicationError) throw applicationError;

      const reviewedApplications = applicationRows || [];

      const uniqueUserIds = [
        ...new Set(
          reviewedApplications
            .map((application) => application.user_id)
            .filter(Boolean)
        ),
      ];

      const uniqueReviewerIds = [
        ...new Set(
          reviewedApplications
            .map((application) => application.reviewed_by)
            .filter(Boolean)
        ),
      ];

      const uniqueProfileIds = [...new Set([...uniqueUserIds, ...uniqueReviewerIds])];

      const uniqueSeriesIds = [
        ...new Set(
          reviewedApplications
            .map((application) => application.series_id)
            .filter(Boolean)
        ),
      ];

      const [profilesResult, seriesResult] = await Promise.all([
        uniqueProfileIds.length > 0
          ? supabase
              .from("profiles")
              .select("id, username, avatar, role")
              .in("id", uniqueProfileIds)
          : Promise.resolve({ data: [], error: null }),

        uniqueSeriesIds.length > 0
          ? supabase
              .from("game_series")
              .select("id, name, status")
              .in("id", uniqueSeriesIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (profilesResult.error) throw profilesResult.error;
      if (seriesResult.error) throw seriesResult.error;

      const profileMap = new Map(
        (profilesResult.data || []).map((profile) => [profile.id, profile])
      );

      const seriesMap = new Map(
        (seriesResult.data || []).map((series) => [series.id, series])
      );

      const hydratedApplications = reviewedApplications.map((application) => ({
        ...application,
        profile: profileMap.get(application.user_id) || null,
        reviewer: profileMap.get(application.reviewed_by) || null,
        series: seriesMap.get(application.series_id) || null,
      }));

      setApplications(hydratedApplications);
    } catch (error) {
      console.error("Failed to fetch reviewed applications:", error);
      setApplications([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchReviewedApplications();
  }, []);

  const reviewedCount = useMemo(() => applications.length, [applications]);

  return (
    <section className="admin-panel">
      <div className="admin-panel-header">
        <div>
          <p className="admin-panel-kicker">HISTORY</p>
          <h2 className="admin-panel-title">Recent Decisions</h2>
        </div>

        <div className="admin-reviewed-header-actions">
          <div className="admin-panel-count">{reviewedCount} Reviewed</div>

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
          {loading && (
            <p className="admin-loading-text">Loading reviewed applications...</p>
          )}

          {!loading && applications.length === 0 && (
            <div className="admin-empty-state">
              <p className="admin-empty-title">No reviewed applications yet</p>
              <p className="admin-empty-text">
                Approved, denied, and banned applications will appear here.
              </p>
            </div>
          )}

          {!loading && applications.length > 0 && (
            <div className="admin-application-list">
              {applications.map((application) => (
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

                        <span
                          className={`admin-application-status admin-application-status-${application.status}`}
                        >
                          {application.status}
                        </span>
                      </div>

                      <div className="admin-application-meta">
                        <span>
                          Series: {application.series?.name || "Unknown Series"}
                        </span>
                        <span>
                          Series Status: {application.series?.status || "Unknown"}
                        </span>
                        <span>
                          Current Role: {application.profile?.role || "Unknown"}
                        </span>
                        <span>
                          Reviewed By: {application.reviewer?.username || "Unknown"}
                        </span>
                      </div>

                      <div className="admin-application-date">
                        Reviewed:{" "}
                        {application.reviewed_at
                          ? new Date(application.reviewed_at).toLocaleString()
                          : "Unknown"}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default AdminReviewedApplicationsPanel;