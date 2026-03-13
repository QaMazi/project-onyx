function AdminPlayersPanel() {
  return (
    <section className="admin-panel">
      <div className="admin-panel-header">
        <div>
          <p className="admin-panel-kicker">PLAYERS</p>
          <h2 className="admin-panel-title">User Role Overview</h2>
        </div>

        <div className="admin-panel-count">0 Loaded</div>
      </div>

      <div className="admin-panel-body">
        <div className="admin-empty-state">
          <p className="admin-empty-title">No player data loaded yet</p>
          <p className="admin-empty-text">
            Current users and their roles will appear here once player
            management is connected.
          </p>
        </div>
      </div>
    </section>
  );
}

export default AdminPlayersPanel;