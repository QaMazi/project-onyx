import { useState } from "react";

function AdminSystemLogsPanel() {
  const [isOpen, setIsOpen] = useState(false);

  function toggleOpen() {
    setIsOpen((prev) => !prev);
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-header">
        <div
          className="admin-panel-header-main"
          onClick={toggleOpen}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleOpen();
            }
          }}
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
        >
          <p className="admin-panel-kicker">SYSTEM</p>
          <h2 className="admin-panel-title">System Logs</h2>
        </div>

        <div className="admin-panel-header-actions">
          <div className="admin-panel-count">Planned</div>
          <button className="admin-collapse-btn" onClick={toggleOpen} type="button">
            {isOpen ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="admin-panel-body">
          <div className="admin-placeholder-card">
            <h3 className="admin-placeholder-title">Planned</h3>
            <p className="admin-placeholder-text">
              System logging tools are planned for a later Admin+ phase.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export default AdminSystemLogsPanel;