function AdminFoundationPanel() {
  return (
    <section className="admin-side-panel">
      <div className="admin-panel-header">
        <div>
          <p className="admin-panel-kicker">FOUNDATION</p>
          <h2 className="admin-panel-title">Prepared Systems</h2>
        </div>
      </div>

      <div className="admin-side-list">
        <div className="admin-side-item">
          <span className="admin-side-item-title">Series Management</span>
          <span className="admin-side-item-status">Planned</span>
        </div>

        <div className="admin-side-item">
          <span className="admin-side-item-title">Player Role Management</span>
          <span className="admin-side-item-status">Planned</span>
        </div>

        <div className="admin-side-item">
          <span className="admin-side-item-title">Application Approval</span>
          <span className="admin-side-item-status">Planned</span>
        </div>

        <div className="admin-side-item">
          <span className="admin-side-item-title">Moderation Tools</span>
          <span className="admin-side-item-status">Planned</span>
        </div>
      </div>
    </section>
  );
}

export default AdminFoundationPanel;