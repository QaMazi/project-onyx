import "./App.css";
import { useState } from "react";
import ModeSelectPage from "./pages/ModeSelect/ModeSelectPage";

function App() {
  const [page, setPage] = useState("login");

  if (page === "modeSelect") {
    return (
      <ModeSelectPage
        goToLogin={() => setPage("login")}
      />
    );
  }

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
          className="launcher-logo"
          alt="Project Onyx"
        />

        <div className="login-card">

          <button className="discord-button">
            <img
              src="/ui/discord_icon.svg"
              className="discord-icon"
            />
            Login with Discord
          </button>

          <div
            className="dev-link"
            onClick={() => setPage("modeSelect")}
          >
            Go to Mode Select (Testing)
          </div>

        </div>

      </div>
    </div>
  );
}

export default App;