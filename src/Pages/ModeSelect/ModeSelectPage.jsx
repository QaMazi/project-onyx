import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";
import "./ModeSelectPage.css";

function resolveRole(user) {
  return user?.effectiveRole || user?.globalRole || user?.role || "Applicant";
}

function canEnterProgression(user) {
  const role = resolveRole(user);
  return role === "Admin+" || role === "Admin" || role === "Duelist";
}

function isBlockedUser(user) {
  return user?.isBlocked || resolveRole(user) === "Blocked";
}

function ModeSelectPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [activeSeries, setActiveSeries] = useState(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [hasPendingApplication, setHasPendingApplication] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    async function loadSeriesState() {
      try {
        const { data: series } = await supabase
          .from("game_series")
          .select("id, name, max_players")
          .eq("is_current", true)
          .maybeSingle();

        if (!isMounted) return;

        if (!series) {
          setActiveSeries(null);
          setPlayerCount(0);
          setMaxPlayers(6);
          setHasPendingApplication(false);
          setLoading(false);
          return;
        }

        setActiveSeries(series);
        setMaxPlayers(series.max_players || 6);

        const [{ count }, { data: pending }] = await Promise.all([
          supabase
            .from("series_players")
            .select("*", { count: "exact", head: true })
            .eq("series_id", series.id),
          supabase
            .from("series_applications")
            .select("id")
            .eq("series_id", series.id)
            .eq("user_id", user.id)
            .eq("status", "pending")
            .maybeSingle(),
        ]);

        if (!isMounted) return;

        setPlayerCount(count || 0);
        setHasPendingApplication(!!pending);
      } catch (error) {
        console.error("Series state load error:", error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadSeriesState();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const role = useMemo(() => resolveRole(user), [user]);
  const authorized = useMemo(() => canEnterProgression(user), [user]);
  const seriesFull = playerCount >= maxPlayers;

  if (authLoading || loading) return null;

  if (!user || isBlockedUser(user)) {
    return <Navigate to="/" replace />;
  }

  let ctaText = "";
  let description =
    "A progression series that rewards smart deck building and match wins.";
  let disabled = false;

  if (authorized) {
    ctaText = "Enter Progression";
  } else if (seriesFull) {
    ctaText = "Series Full";
    description = "Applications are unavailable until a player slot opens.";
    disabled = true;
  } else if (hasPendingApplication) {
    ctaText = "Application Pending";
    description = "Your request is awaiting Admin+ review.";
    disabled = true;
  } else {
    ctaText = "Apply to Active Series";
    description = "Submit an application to join the current progression series.";
  }

  async function submitApplication() {
    if (!activeSeries || !user?.id) return;

    try {
      await supabase.from("series_applications").insert({
        series_id: activeSeries.id,
        user_id: user.id,
        status: "pending",
      });

      setHasPendingApplication(true);
      setModalOpen(false);
    } catch (error) {
      console.error("Application failed:", error);
    }
  }

  function handleRankedClick() {
    if (authorized) {
      navigate("/mode/progression");
      return;
    }

    if (!seriesFull && !hasPendingApplication) {
      setModalOpen(true);
    }
  }

  return (
    <LauncherLayout>
      <div className="mode-select-page">
        <div className="launcher-logo-shell mode-logo-shell">
          <div className="launcher-logo-aura"></div>

          <img
            src="/ui/project_onyx_logo.png"
            className="launcher-logo mode-logo"
            alt="Project Onyx"
          />
        </div>

        <div className="mode-select-card">
          <div className="mode-select-header">
            <h1 className="mode-select-title">Mode Select</h1>
            <p className="mode-select-subtitle">
              Choose your Project Onyx experience
            </p>
          </div>

          <div className="mode-grid">
            <div
              className={`mode-panel mode-panel-image ${
                disabled ? "mode-panel-disabled" : "mode-panel-clickable"
              }`}
              onClick={!disabled ? handleRankedClick : undefined}
              role={!disabled ? "button" : undefined}
              tabIndex={!disabled ? 0 : undefined}
              onKeyDown={
                !disabled
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleRankedClick();
                      }
                    }
                  : undefined
              }
            >
              <img
                src="/ui/progression_mode.png"
                className="mode-panel-bg"
                alt="Progression Mode"
              />

              <div className="mode-panel-overlay"></div>

              <div className="mode-panel-content">
                <div className="mode-panel-bottom">
                  <h2 className="mode-panel-title">RANKED MODE</h2>
                  <p className="mode-panel-description">{description}</p>
                  <div className="mode-panel-cta">{ctaText}</div>
                </div>
              </div>
            </div>

            <div className="mode-panel mode-panel-image mode-panel-locked-card">
              <img
                src="/ui/deckgame_mode.png"
                className="mode-panel-bg"
                alt="Casual Mode"
              />

              <div className="mode-panel-overlay"></div>

              <div className="mode-panel-content">
                <div className="mode-panel-bottom">
                  <h2 className="mode-panel-title">CASUAL MODE</h2>
                  <p className="mode-panel-description">
                    Coming Soon. Available in a future update.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {modalOpen && (
          <div className="progression-modal" onClick={() => setModalOpen(false)}>
            <div
              className="progression-modal-content"
              onClick={(event) => event.stopPropagation()}
            >
              <h2>Apply to Active Series</h2>

              <p>
                Submit your request to join the currently active progression
                series. Approval is required before you can enter ranked mode.
              </p>

              <div className="progression-modal-actions">
                <button onClick={submitApplication}>Submit Application</button>
                <button onClick={() => setModalOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </LauncherLayout>
  );
}

export default ModeSelectPage;