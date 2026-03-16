import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";
import "./ModeSelectPage.css";

function isBlockedUser(user) {
  return user?.isBlocked || user?.role === "Blocked" || user?.globalRole === "Blocked";
}

function ModeSelectPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [activeSeries, setActiveSeries] = useState(null);
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadSeriesState() {
      try {
        const { data: series, error } = await supabase
          .from("game_series")
          .select("id, name, max_players")
          .eq("is_current", true)
          .maybeSingle();

        if (error) throw error;
        if (!isMounted) return;

        setActiveSeries(series || null);
      } catch (error) {
        console.error("Series state load error:", error);
        if (isMounted) {
          setActiveSeries(null);
        }
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
  }, []);

  if (authLoading || loading) return null;

  if (!user || isBlockedUser(user)) {
    return <Navigate to="/" replace />;
  }

  const canEnterProgression = Boolean(user?.canAccessProgression);
  const currentSeriesName = activeSeries?.name || null;

  let ctaText = "";
  let description = "";
  let modalTitle = "";
  let modalMessage = "";

  if (canEnterProgression) {
    ctaText = "Enter Progression";
    description = currentSeriesName
      ? `Your current role grants Progression access. Active series: ${currentSeriesName}.`
      : "Your current role grants Progression access. No globally active series is currently set.";
  } else {
    ctaText = "Progression Locked";
    description =
      "This account is currently set to Player. Admin+ can promote it to Duelist or Admin from the Profiles panel.";
    modalTitle = "Progression Locked";
    modalMessage =
      "This account is set to Player. Only Duelist, Admin, or Admin+ can access Progression Mode.";
  }

  function handleRankedClick() {
    if (canEnterProgression) {
      navigate("/mode/progression");
      return;
    }

    setInfoModalOpen(true);
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
            <p className="mode-select-subtitle">Choose your Project Onyx experience</p>
          </div>

          <div className="mode-grid">
            <div
              className={`mode-panel mode-panel-image ${
                canEnterProgression ? "mode-panel-clickable" : "mode-panel-disabled"
              }`}
              onClick={handleRankedClick}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleRankedClick();
                }
              }}
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

        {infoModalOpen && (
          <div className="progression-modal" onClick={() => setInfoModalOpen(false)}>
            <div
              className="progression-modal-content"
              onClick={(event) => event.stopPropagation()}
            >
              <h2>{modalTitle}</h2>
              <p>{modalMessage}</p>
              <div className="progression-modal-actions">
                <button onClick={() => setInfoModalOpen(false)}>Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </LauncherLayout>
  );
}

export default ModeSelectPage;
