import LauncherLayout from "../../components/LauncherLayout";
import AdminApplicationsPanel from "./components/AdminApplicationsPanel";
import AdminPlayersPanel from "./components/AdminPlayersPanel";
import AdminFoundationPanel from "./components/AdminFoundationPanel";
import "./AdminPanelPage.css";

function AdminPanelPage() {
  return (
    <LauncherLayout>
      <div className="admin-page-wrap">
        <div className="admin-page-card">
          <div className="admin-page-header">
            <div>
              <p className="admin-page-eyebrow">PROJECT ONYX CONTROL</p>
              <h1 className="admin-page-title">Admin Panel</h1>
              <p className="admin-page-subtitle">
                Manage applications, player roles, and future moderation tools.
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
              This panel is the foundation for Project Onyx administration.
              Applications and player oversight live here now, with room for
              series management, approvals, and moderation systems later.
            </p>
          </div>

          <div className="admin-layout">
            <div className="admin-main-column">
              <AdminApplicationsPanel />
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