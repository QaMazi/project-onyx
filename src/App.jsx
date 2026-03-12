import { Routes, Route, useNavigate } from "react-router-dom";

import LauncherLayout from "./components/LauncherLayout";
import ModeSelectPage from "./Pages/ModeSelect/ModeSelectPage";
import ProgressionPage from "./Pages/Progression/ProgressionPage";
import DeckGamePage from "./Pages/DeckGame/DeckGamePage";

import "./App.css";

function LoginSplash() {
  const navigate = useNavigate();

  return (
    <LauncherLayout>
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
            alt="Discord"
          />
          Login with Discord
        </button>

        <div className="dev-link" onClick={() => navigate("/mode")}>
          Go to Mode Select (Testing)
        </div>
      </div>
    </LauncherLayout>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginSplash />} />
      <Route path="/mode" element={<ModeSelectPage />} />
      <Route path="/mode/progression" element={<ProgressionPage />} />
      <Route path="/mode/deckgame" element={<DeckGamePage />} />
    </Routes>
  );
}

export default App;