import { useState } from "react";
import { Navigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";

import ProgressionPlayerMenuPanel from "./components/ProgressionPlayerMenuPanel";
import ProgressionSeriesMenuPanel from "./components/ProgressionSeriesMenuPanel";
import ProgressionAdminMenuPanel from "./components/ProgressionAdminMenuPanel";
import ProgressionOnlinePlayersPanel from "./components/ProgressionOnlinePlayersPanel";
import ProgressionScoreboardPanel from "./components/ProgressionScoreboardPanel";
import ProgressionNotesModal from "./components/ProgressionNotesModal";

import "./ProgressionPage.css";

function ProgressionPage() {
  const { user, authLoading } = useUser();
  const [notesOpen, setNotesOpen] = useState(false);

  if (authLoading) return null;

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (user.role === "Blocked") {
    return <Navigate to="/" replace />;
  }

  if (
    user.role !== "Admin+" &&
    user.role !== "Admin" &&
    user.role !== "Duelist"
  ) {
    return <Navigate to="/mode" replace />;
  }

  const isSeriesAdmin = user.role === "Admin+" || user.role === "Admin";

  return (
    <LauncherLayout>
      <div className="progression-root">
        <div
          className={`progression-dashboard ${
            isSeriesAdmin
              ? "progression-dashboard-with-admin"
              : "progression-dashboard-no-admin"
          }`}
        >
          <div className="progression-area progression-area-player">
            <ProgressionPlayerMenuPanel onOpenNotes={() => setNotesOpen(true)} />
          </div>

          {isSeriesAdmin ? (
            <div className="progression-area progression-area-admin">
              <ProgressionAdminMenuPanel />
            </div>
          ) : null}

          <div className="progression-area progression-area-series-info">
            <ProgressionOnlinePlayersPanel />
          </div>

          <div className="progression-area progression-area-future">
            <ProgressionScoreboardPanel />
          </div>

          <div className="progression-area progression-area-series-menu">
            <ProgressionSeriesMenuPanel />
          </div>
        </div>
      </div>

      <ProgressionNotesModal
        isOpen={notesOpen}
        onClose={() => setNotesOpen(false)}
      />
    </LauncherLayout>
  );
}

export default ProgressionPage;
