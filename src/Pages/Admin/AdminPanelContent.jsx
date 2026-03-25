import AdminProfilesPanel from "./components/AdminProfilesPanel";
import AdminPremiumStorePanel from "./components/AdminPremiumStorePanel";
import AdminSeriesPanel from "./components/AdminSeriesPanel";
import AdminSeriesArchivesPanel from "./components/AdminSeriesArchivesPanel";
import AdminSystemLogsPanel from "./components/AdminSystemLogsPanel";
import AdminDeckGameControlPanel from "./components/AdminDeckGameControlPanel";
import AdminSuggestionsPanel from "./components/AdminSuggestionsPanel";

function AdminPanelContent({ onBack, backLabel = "Back" }) {
  return (
    <div className="admin-page-card">
      <div className="admin-page-topbar">
        <button className="admin-back-button" onClick={onBack} type="button">
          {backLabel}
        </button>
        <div className="admin-page-topbar-pill">Admin+ Access</div>
      </div>

      <div className="admin-page-header admin-page-header-compact">
        <div>
          <p className="admin-page-eyebrow">PROJECT ONYX CONTROL</p>
          <h1 className="admin-page-title">Admin+ Panel</h1>
          <p className="admin-page-subtitle">
            Central control for accounts, premium systems, progression oversight,
            suggestions, and global maintenance tools.
          </p>
        </div>
      </div>

      <div className="admin-page-intro admin-page-intro-hero">
        <div className="admin-page-intro-copy">
          <h2 className="admin-intro-title">Administration Overview</h2>
          <p className="admin-intro-text">
            Use this panel to control core account setup, manage the globally
            active progression series, oversee player placement, and access
            future Admin+ systems.
          </p>
        </div>

        <div className="admin-page-overview-grid">
          <div className="admin-page-overview-card">
            <span className="admin-page-overview-label">Accounts</span>
            <strong>Profiles, roles, and access</strong>
          </div>
          <div className="admin-page-overview-card">
            <span className="admin-page-overview-label">Premium</span>
            <strong>Tokens, prices, and cosmetics</strong>
          </div>
          <div className="admin-page-overview-card">
            <span className="admin-page-overview-label">Progression</span>
            <strong>Series, archives, and control</strong>
          </div>
          <div className="admin-page-overview-card">
            <span className="admin-page-overview-label">Support</span>
            <strong>Suggestions, logs, and review</strong>
          </div>
        </div>
      </div>

      <div className="admin-main-column admin-main-column-full">
        <AdminProfilesPanel />
        <AdminSuggestionsPanel />
        <AdminPremiumStorePanel />
        <AdminDeckGameControlPanel />
        <AdminSeriesPanel />
        <AdminSeriesArchivesPanel />
        <AdminSystemLogsPanel />
      </div>
    </div>
  );
}

export default AdminPanelContent;
