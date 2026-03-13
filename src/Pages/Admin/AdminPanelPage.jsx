import { useLocation, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import AdminApplicationsPanel from "./components/AdminApplicationsPanel";
import AdminReviewedApplicationsPanel from "./components/AdminReviewedApplicationsPanel";
import AdminSeriesPanel from "./components/AdminSeriesPanel";
import AdminPlayersPanel from "./components/AdminPlayersPanel";
import AdminFoundationPanel from "./components/AdminFoundationPanel";
import "./AdminPanelPage.css";

function AdminPanelPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const backTarget = location.state?.from || "/mode";

  return (
    <LauncherLayout>
      <div className="admin-page-wrap">
        <div className="admin-page-card">
          <div className="admin-page-topbar">
            <button
              className="admin-back-button"
              onClick={() => navigate(backTarget)}
              type="button"
            >
              ← Back
            </button>
          </div>

          <div className="admin-page-header">
            <div>
              <p className="admin-page-eyebrow">PROJECT ONYX CONTROL</p>
              <h1 className="admin-page-title">Admin Panel</h1>
              <p className="admin-page-subtitle">
                Manage progression access, owned series, player roles, and future admin systems.
              </p>
            </div>

            <div className="admin-page-status">
              <span className="admin-status-label">Access</span>
              <span className="admin-status-pill">ADMIN ONLY</span>
            </div>
          </div>

          <div className="admin-page-intro">
            <h2 className="admin-intro-title">Administration Overview</h2>
            <p className="admin-intro-text">
              Create and manage your own series, control the one globally active
              progression series, review access requests, and oversee player role
              assignments. Series begin in Lobby and can later be started, paused,
              resumed, or deleted by their owner.
            </p>
          </div>

          <div className="admin-layout">
            <div className="admin-main-column">
              <AdminApplicationsPanel />
              <AdminReviewedApplicationsPanel />
              <AdminSeriesPanel />
              <AdminPlayersPanel />
            </div>

            <aside className="admin-side-column">
              <AdminFoundationPanel />
            </aside>
          </div>
        </div>
      </div>
    </LauncherLayout>
  );
}

export default AdminPanelPage;