import { Navigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";

import "./ProgressionPage.css";

function ProgressionPage() {
  const { user, authLoading } = useUser();

  /* ===============================
     Access protection
  =============================== */

  if (authLoading) return null;

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (user.role === "Blocked") {
    return <Navigate to="/mode" replace />;
  }

  /* ===============================
     Page
  =============================== */

  return (
    <LauncherLayout>
      <div className="progression-root">

        {/* HERO LOGO */}

        <div className="progression-hero">
          <img
            src="/ui/progression_logo.png"
            alt="Progression Series"
            className="progression-hero-logo"
          />
        </div>

        {/* TOP PANEL ROW */}

        <div className="progression-row progression-row-top">

          <div className="progression-panel">
            <h3>Player Menu</h3>
            <p>Decks, Binder, Inventory, Store</p>
          </div>

          <div className="progression-panel">
            <h3>Series Menu</h3>
            <p>Series info, phase, packs</p>
          </div>

          {user.role === "Admin" || user.role === "Admin+" ? (
            <div className="progression-panel">
              <h3>Admin Menu</h3>
              <p>Admin progression controls</p>
            </div>
          ) : (
            <div className="progression-panel progression-panel-placeholder">
              <h3>Series Info</h3>
              <p>General series info</p>
            </div>
          )}

        </div>

        {/* BOTTOM PANEL ROW */}

        <div className="progression-row progression-row-bottom">

          <div className="progression-panel">
            <h3>Online Players</h3>
            <p>Who's online</p>
          </div>

          <div className="progression-panel">
            <h3>Schedule</h3>
            <p>Round schedule</p>
          </div>

          <div className="progression-panel">
            <h3>Scoreboard</h3>
            <p>Series standings</p>
          </div>

        </div>

      </div>
    </LauncherLayout>
  );
}

export default ProgressionPage;