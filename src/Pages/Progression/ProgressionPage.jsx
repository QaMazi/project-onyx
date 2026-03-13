import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";

function ProgressionPage() {
  const navigate = useNavigate();
  const { user } = useUser();

  const [loadingPage, setLoadingPage] = useState(true);
  const [pageError, setPageError] = useState("");
  const [seriesList, setSeriesList] = useState([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState("");
  const [applicationStatus, setApplicationStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const isAdmin = user?.role === "Admin" || user?.role === "Admin+";
  const isDuelist = user?.role === "Duelist";
  const isApplicant = user?.role === "Applicant";

  const selectedSeries = useMemo(() => {
    return (
      seriesList.find((series) => series.id === selectedSeriesId) || null
    );
  }, [seriesList, selectedSeriesId]);

  useEffect(() => {
    async function initializePage() {
      if (!user) {
        navigate("/", { replace: true });
        return;
      }

      if (user.role === "Blocked") {
        navigate("/", { replace: true });
        return;
      }

      setLoadingPage(true);
      setPageError("");

      try {
        const { data: seriesData, error: seriesError } = await supabase
          .from("series")
          .select("*")
          .order("created_at", { ascending: false });

        if (seriesError) {
          console.error("Failed to load series:", seriesError);
          setPageError("Failed to load series.");
          return;
        }

        const safeSeries = Array.isArray(seriesData) ? seriesData : [];
        setSeriesList(safeSeries);

        const activeSeries =
          safeSeries.find((series) => series.is_active) || safeSeries[0] || null;

        if (!activeSeries) {
          setPageError("No series found.");
          return;
        }

        setSelectedSeriesId(activeSeries.id);

        const { data: application, error: applicationError } = await supabase
          .from("series_applications")
          .select("id, status, series_id, created_at")
          .eq("user_id", user.id)
          .eq("series_id", activeSeries.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (applicationError) {
          console.error("Failed to load application status:", applicationError);
          setPageError("Failed to load application status.");
          return;
        }

        setApplicationStatus(application?.status ?? null);
      } catch (error) {
        console.error("Progression init crashed:", error);
        setPageError("Something went wrong loading progression.");
      } finally {
        setLoadingPage(false);
      }
    }

    initializePage();
  }, [user, navigate]);

  async function handleSeriesChange(event) {
    const nextSeriesId = event.target.value;
    setSelectedSeriesId(nextSeriesId);
    setApplicationStatus(null);

    if (!user || !nextSeriesId) return;

    const { data: application, error } = await supabase
      .from("series_applications")
      .select("id, status, series_id, created_at")
      .eq("user_id", user.id)
      .eq("series_id", nextSeriesId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Failed to refresh application status:", error);
      setPageError("Failed to load application status.");
      return;
    }

    setApplicationStatus(application?.status ?? null);
  }

  async function submitApplication() {
    if (!user || !selectedSeries || submitting) return;

    setSubmitting(true);
    setPageError("");

    try {
      const payload = {
        user_id: user.id,
        series_id: selectedSeries.id,
        status: "pending",
      };

      const { error } = await supabase
        .from("series_applications")
        .upsert(payload, { onConflict: "user_id,series_id" });

      if (error) {
        console.error("Application submit failed:", error);
        setPageError("Failed to submit application.");
        return;
      }

      setApplicationStatus("pending");
    } catch (error) {
      console.error("Application submit crashed:", error);
      setPageError("Failed to submit application.");
    } finally {
      setSubmitting(false);
    }
  }

  function getSeriesStatus(series) {
    if (!series) return "Unknown";
    if (series.applications_open && series.is_active) return "Active / Applications Open";
    if (series.is_active) return "Active";
    if (series.applications_open) return "Inactive / Applications Open";
    return "Inactive";
  }

  function getPhaseText(series) {
    if (!series) return "Unknown";
    return series.current_phase || "Not Started";
  }

  function getRoundText(series) {
    if (!series) return "Unknown";
    return series.current_round || "0-0";
  }

  function getCapacityText(series) {
    if (!series) return { filled: 0, left: 6, max: 6 };

    const max = Number(series.max_players ?? 6);
    const filled = Number(series.current_players ?? 0);
    const left = Math.max(max - filled, 0);

    return { filled, left, max };
  }

  if (!user) return null;

  const shouldShowModal =
    !loadingPage &&
    !pageError &&
    ((isApplicant || isDuelist) &&
      (applicationStatus === "pending" || isApplicant || !user.activeSeriesId));

  const capacity = getCapacityText(selectedSeries);

  return (
    <LauncherLayout>
      <div style={{ color: "white", padding: "40px", position: "relative" }}>
        <h1>Progression Mode</h1>

        {loadingPage && <p>Loading progression...</p>}
        {!loadingPage && pageError && <p>{pageError}</p>}

        {!loadingPage && !pageError && isAdmin && (
          <p>Admin view — active series will always load here.</p>
        )}

        {!loadingPage && !pageError && isDuelist && !shouldShowModal && (
          <p>Duelist view — active series content will load here.</p>
        )}

        {!loadingPage && !pageError && shouldShowModal && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.72)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
            }}
          >
            <div
              style={{
                width: "min(760px, 92vw)",
                maxHeight: "90vh",
                overflowY: "auto",
                background: "rgba(15, 15, 15, 0.97)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: "18px",
                padding: "28px",
                boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
              }}
            >
              {applicationStatus === "pending" ? (
                <>
                  <h2 style={{ marginTop: 0 }}>Application Processing</h2>
                  <p>
                    Your application for{" "}
                    <strong>{selectedSeries?.name || "the selected series"}</strong>{" "}
                    has been submitted and is awaiting admin review.
                  </p>

                  <div
                    style={{
                      marginTop: "20px",
                      padding: "16px",
                      borderRadius: "14px",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    <p style={{ margin: 0 }}>
                      Please wait for approval. Disruptive behavior, abuse, or
                      bad-faith participation may result in denial or a ban.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <h2 style={{ marginTop: 0 }}>Apply For Ranked Series</h2>
                  <p>
                    Review the series information and your submitted account
                    information below before applying.
                  </p>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.2fr 1fr",
                      gap: "18px",
                      marginTop: "20px",
                    }}
                  >
                    <div
                      style={{
                        padding: "18px",
                        borderRadius: "16px",
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.1)",
                      }}
                    >
                      <h3 style={{ marginTop: 0 }}>Series Details</h3>

                      <label style={{ display: "block", marginBottom: "8px" }}>
                        Series
                      </label>
                      <select
                        value={selectedSeriesId}
                        onChange={handleSeriesChange}
                        style={{
                          width: "100%",
                          padding: "12px",
                          borderRadius: "10px",
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: "rgba(255,255,255,0.04)",
                          color: "white",
                          marginBottom: "16px",
                        }}
                      >
                        {seriesList.map((series) => (
                          <option key={series.id} value={series.id}>
                            {series.name}
                            {series.is_active ? " — ACTIVE" : ""}
                          </option>
                        ))}
                      </select>

                      <div style={{ display: "grid", gap: "10px" }}>
                        <div>
                          <strong>Status:</strong>{" "}
                          {getSeriesStatus(selectedSeries)}
                        </div>
                        <div>
                          <strong>Phase:</strong> {getPhaseText(selectedSeries)}
                        </div>
                        <div>
                          <strong>Round:</strong> {getRoundText(selectedSeries)}
                        </div>
                        <div>
                          <strong>Slots Filled:</strong> {capacity.filled}/{capacity.max}
                        </div>
                        <div>
                          <strong>Slots Left:</strong> {capacity.left}
                        </div>
                        <div>
                          <strong>Series Type:</strong>{" "}
                          {selectedSeries?.series_type || "Ranked"}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        padding: "18px",
                        borderRadius: "16px",
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.1)",
                      }}
                    >
                      <h3 style={{ marginTop: 0 }}>Submitted Account Info</h3>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "14px",
                          marginBottom: "16px",
                        }}
                      >
                        <div
                          style={{
                            width: "56px",
                            height: "56px",
                            borderRadius: "50%",
                            overflow: "hidden",
                            background: "rgba(255,255,255,0.08)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 700,
                          }}
                        >
                          {user.avatar ? (
                            <img
                              src={user.avatar}
                              alt={user.username}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                              }}
                            />
                          ) : (
                            (user.username?.[0] || "U").toUpperCase()
                          )}
                        </div>

                        <div>
                          <div><strong>{user.username}</strong></div>
                          <div style={{ opacity: 0.8, fontSize: "14px" }}>
                            {user.role}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: "10px" }}>
                        <div>
                          <strong>Discord Name:</strong> {user.username}
                        </div>
                        <div>
                          <strong>Discord ID:</strong>{" "}
                          {user.discordUserId || "Not Available Yet"}
                        </div>
                        <div>
                          <strong>Avatar:</strong> Included automatically
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: "18px",
                      padding: "18px",
                      borderRadius: "16px",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    <h3 style={{ marginTop: 0 }}>Important Notices</h3>
                    <div style={{ display: "grid", gap: "8px" }}>
                      <div>• Applications are reviewed by Admin or Admin+.</div>
                      <div>• Approval is not automatic. Please wait for review after submitting.</div>
                      <div>• Approved players are expected to follow all series rules and conduct standards.</div>
                      <div>• Disruptive behavior, abuse, or bad-faith participation can result in denial or ban.</div>
                    </div>
                  </div>

                  <div style={{ marginTop: "20px" }}>
                    <button
                      onClick={submitApplication}
                      disabled={submitting || !selectedSeries}
                      style={{
                        padding: "12px 18px",
                        borderRadius: "10px",
                        border: "none",
                        cursor:
                          submitting || !selectedSeries ? "default" : "pointer",
                        fontWeight: 700,
                        opacity: submitting || !selectedSeries ? 0.7 : 1,
                      }}
                    >
                      {submitting ? "Submitting..." : "Submit Application"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </LauncherLayout>
  );
}

export default ProgressionPage;