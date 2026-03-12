import { useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import "./ModeSelectPage.css";

function ModeSelectPage() {
  const navigate = useNavigate();
  const { user } = useUser();

  const getRoleClass = () => {
    switch (user.role) {
      case "Admin+":
        return "active-user-role-badge role-adminplus";
      case "Admin":
        return "active-user-role-badge role-admin";
      case "Duelist":
        return "active-user-role-badge role-duelist";
      case "Applicant":
      default:
        return "active-user-role-badge role-applicant";
    }
  };

  const handleProgressionClick = () => {
    if (user.progressionState === "accepted") {
      navigate("/mode/progression");
    }
  };

  const handleLogout = () => {
    navigate("/");
  };

  return (
    <LauncherLayout>
      <img
        src="/ui/project_onyx_logo.png"
        className="launcher-logo mode-logo"
        alt="Project Onyx"
      />

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
              user.progressionState === "accepted"
                ? "mode-panel-clickable"
                : "mode-panel-disabled"
            }`}
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
                  A progression series that rewards smart deck building, and match wins.
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

<div className="mode-panel-badge badge-unavailable">UNAVAILABLE</div>

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

        <div className="active-user-card">
          <div className="active-user-left">
            <div className="active-user-avatar">{user.avatarInitial}</div>

            <div className="active-user-info">
              <div className="active-user-name">{user.username}</div>
              <div className="active-user-status">{user.authStatus}</div>
            </div>
          </div>

          <div className={getRoleClass()}>{user.role}</div>
        </div>

        <div className="mode-footer">
          <div className="mode-footer-inner">
            <button
              className="discord-button logout-button"
              onClick={handleLogout}
            >
              <img
                src="/ui/discord_icon.svg"
                className="discord-icon"
                alt="Discord"
              />
              Logout
            </button>
          </div>
        </div>
      </div>
    </LauncherLayout>
  );
}

export default ModeSelectPage;