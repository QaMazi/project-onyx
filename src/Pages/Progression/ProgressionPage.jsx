import { useState } from "react";
import { Navigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { useProgression } from "../../context/ProgressionContext";

import ProgressionPlayerMenuPanel from "./components/ProgressionPlayerMenuPanel";
import ProgressionSeriesMenuPanel from "./components/ProgressionSeriesMenuPanel";
import ProgressionAdminMenuPanel from "./components/ProgressionAdminMenuPanel";
import ProgressionOnlinePlayersPanel from "./components/ProgressionOnlinePlayersPanel";
import ProgressionScoreboardPanel from "./components/ProgressionScoreboardPanel";
import ProgressionNotesModal from "./components/ProgressionNotesModal";

import "./ProgressionPage.css";

function ProgressionPage() {
  const { user, authLoading } = useUser();
  const { loading, state, statusStrip } = useProgression();
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
  const currentPhase = state?.currentPhase || "standby";

  return (
    <LauncherLayout>
      <div className="progression-root">
        <div className="progression-status-strip-shell">
          <div className="progression-status-strip">
            {loading || statusStrip.length === 0 ? (
              <div className="progression-status-empty">
                Active player status will appear here.
              </div>
            ) : (
              statusStrip.map((row) => {
                const statusClass =
                  currentPhase === "dueling"
                    ? String(row.duelingStatus || "idle").toLowerCase()
                    : String(row.phaseStatus || "idle").toLowerCase();

                return (
                <div
                  key={row.userId}
                  className={`progression-status-player progression-status-player-${statusClass} ${
                    row.protectionRounds > 0
                      ? "progression-status-player-has-protection"
                      : "progression-status-player-no-protection"
                  }`}
                >
                  <div
                    className="progression-status-avatar-shell"
                    title={`${row.username} | ${
                      currentPhase === "dueling"
                        ? row.duelingStatus || "idle"
                        : row.phaseStatus || "idle"
                    }`}
                  >
                    {row.avatar ? (
                      <img
                        src={row.avatar}
                        alt={row.username}
                        className="progression-status-avatar"
                      />
                    ) : (
                      <span className="progression-status-avatar-fallback">
                        {String(row.username || "?").slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </div>

                  {row.protectionRounds > 0 ? (
                    <div className="progression-status-protection-badge">
                      Protection {row.protectionRounds}
                    </div>
                  ) : null}
                </div>
                );
              })
            )}
          </div>
        </div>

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

          <div className="progression-area progression-area-future">
            <ProgressionScoreboardPanel />
          </div>

          <div className="progression-area progression-area-series-info">
            <ProgressionOnlinePlayersPanel />
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
