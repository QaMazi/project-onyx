import "./ModeSelectPage.css";

function ModeSelectPage({
  progressionState = "default",
  goToLogin,
  userRole = "Applicant",
}) {
  const getProgressionButtonText = () => {
    switch (progressionState) {
      case "pending":
        return "Waiting for Acceptance";
      case "accepted":
        return "Enter Progression";
      case "default":
      default:
        return "Request Access";
    }
  };

  const getProgressionButtonClass = () => {
    switch (progressionState) {
      case "pending":
        return "mode-button mode-button-pending";
      case "accepted":
        return "mode-button mode-button-accepted";
      case "default":
      default:
        return "mode-button mode-button-primary";
    }
  };

  const getRoleClass = () => {
    switch (userRole) {
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

  return (
    <div className="launcher-root">
      <img
        src="/ui/login_background.png"
        className="launcher-bg"
        alt="background"
      />

      <div className="launcher-overlay"></div>

      <div className="launcher-center">
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
            <div className="mode-panel">
              <div className="mode-panel-top">
                <h2 className="mode-panel-title">Progression</h2>
                <p className="mode-panel-text">
                  Access the progression environment, seasonal systems, and
                  guided play features.
                </p>
              </div>

              <button className={getProgressionButtonClass()}>
                {getProgressionButtonText()}
              </button>
            </div>

            <div className="mode-panel">
              <div className="mode-panel-top">
                <h2 className="mode-panel-title">Deck Game</h2>
                <p className="mode-panel-text">
                  Jump directly into the deck-focused game mode and related
                  features.
                </p>
              </div>

              <button className="mode-button mode-button-primary">
                Enter Deck Game
              </button>
            </div>
          </div>

          <div className="active-user-card">
            <div className="active-user-left">
              <div className="active-user-avatar">Q</div>

              <div className="active-user-info">
                <div className="active-user-name">Qamazi</div>
                <div className="active-user-status">Authenticated User</div>
              </div>
            </div>

            <div className={getRoleClass()}>{userRole}</div>
          </div>

          <div className="mode-footer">
            <div className="mode-footer-inner">
              <button
                className="discord-button logout-button"
                onClick={goToLogin}
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
      </div>
    </div>
  );
}

export default ModeSelectPage;