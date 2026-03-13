function AdminApplicationsPanel() {
  return (
    <section className="admin-panel">
      <div className="admin-panel-header">
        <div>
          <p className="admin-panel-kicker">APPLICATIONS</p>
          <h2 className="admin-panel-title">Progression Access Requests</h2>
        </div>

        <div className="admin-panel-count">0 Pending</div>
      </div>

      <div className="admin-panel-body">
        <div className="admin-empty-state">
          <p className="admin-empty-title">No applications loaded yet</p>
          <p className="admin-empty-text">
            Progression application entries will appear here in a future system
            update.
          </p>
        </div>
      </div>
    </section>
  );
}

export default AdminApplicationsPanel;