import { useLocation, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import AdminProfilesPanel from "./components/AdminProfilesPanel";
import AdminSeriesPanel from "./components/AdminSeriesPanel";
import AdminSeriesArchivesPanel from "./components/AdminSeriesArchivesPanel";
import AdminSystemLogsPanel from "./components/AdminSystemLogsPanel";
import AdminDeckGameControlPanel from "./components/AdminDeckGameControlPanel";
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

          <div className="admin-page-header admin-page-header-compact">
            <div>
              <p className="admin-page-eyebrow">PROJECT ONYX CONTROL</p>
              <h1 className="admin-page-title">Admin+ Panel</h1>
            </div>
          </div>

          <div className="admin-page-intro">
            <h2 className="admin-intro-title">Administration Overview</h2>
            <p className="admin-intro-text">
              Use this panel to control core account setup, manage the globally
              active progression series, oversee player placement, and access
              future Admin+ systems.
            </p>
          </div>

          <div className="admin-main-column admin-main-column-full">
            <AdminProfilesPanel />
            <AdminDeckGameControlPanel />
            <AdminSeriesPanel />
            <AdminSeriesArchivesPanel />
            <AdminSystemLogsPanel />
          </div>
        </div>
      </div>
    </LauncherLayout>
  );
}

export default AdminPanelPage;
