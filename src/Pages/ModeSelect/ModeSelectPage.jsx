import { useNavigate, Navigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import "./ModeSelectPage.css";

function ModeSelectPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  if (authLoading) return null;
  if (!user || user.role === "Blocked") return <Navigate to="/" replace />;

  const handleProgressionClick = () => {
    navigate("/mode/progression");
  };

  return (
    <LauncherLayout>
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
            className="mode-panel mode-panel-image mode-panel-clickable"
            onClick={handleProgressionClick}
          >
            <img
              src="/ui/progression_mode.png"
              className="mode-panel-bg"
              alt="Progression Mode"
            />

            <div className="mode-panel-badge badge-beta">BETA</div>
            <div className="mode-panel-overlay"></div>

            <div className="mode-panel-content">
              <div className="mode-panel-bottom">
                <h2 className="mode-panel-title">RANKED MODE</h2>
                <p className="mode-panel-description">
                  A progression series that rewards smart deck building, and
                  match wins.
                </p>
              </div>
            </div>
          </div>

          <div className="mode-panel mode-panel-image mode-panel-locked-card">
            <img
              src="/ui/deckgame_mode.png"
              className="mode-panel-bg"
              alt="Casual Mode"
            />

            <div className="mode-panel-badge badge-unavailable">
              UNAVAILABLE
            </div>

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
    </LauncherLayout>
  );
}

export default ModeSelectPage;