import { useState } from "react";

function AdminSeriesArchivesPanel() {
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
          <p className="admin-panel-kicker">ARCHIVES</p>
          <h2 className="admin-panel-title">Series Archives</h2>
          <p className="admin-section-description">
            This section will hold current series statistics, past series statistics,
            and archived progression history.
          </p>
        </div>

        <div className="admin-panel-header-actions">
          <div className="admin-panel-count">Archives</div>
          <button className="admin-collapse-btn" onClick={toggleOpen} type="button">
            {isOpen ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="admin-panel-body">
          <div className="admin-placeholder-card">
            <h3 className="admin-placeholder-title">Series statistics and archive hub</h3>
            <p className="admin-placeholder-text">
              This panel is reserved for current series stats, past-series stats,
              archive browsing, and historical Admin+ review tools.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export default AdminSeriesArchivesPanel;