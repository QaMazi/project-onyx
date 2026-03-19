import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useUser } from "../../../context/UserContext";

const STATUS_OPTIONS = ["new", "reviewing", "planned", "implemented", "declined"];

function formatDateTime(value) {
  if (!value) return "Not reviewed yet";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function AdminSuggestionsPanel() {
  const { user } = useUser();
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState("");

  const isAdminPlus = Boolean(user?.canAccessHeaderAdmin);

  async function loadSuggestions() {
    if (!isAdminPlus) return;

    setLoading(true);
    setStatusText("");

    try {
      const { data, error } = await supabase.rpc("get_admin_user_suggestions");
      if (error) throw error;

      const nextSuggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
      setSuggestions(nextSuggestions);
      setDrafts(
        Object.fromEntries(
          nextSuggestions.map((suggestion) => [
            suggestion.id,
            {
              status: suggestion.status || "new",
              admin_note: suggestion.admin_note || "",
            },
          ])
        )
      );
    } catch (error) {
      console.error("Failed to load admin suggestions:", error);
      setStatusText(error?.message || "Failed to load suggestions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdminPlus || !isOpen) return;
    loadSuggestions();
  }, [isAdminPlus, isOpen]);

  function toggleOpen() {
    setIsOpen((current) => !current);
  }

  function handleHeaderKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleOpen();
    }
  }

  function updateDraft(id, key, value) {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] || {}),
        [key]: value,
      },
    }));
  }

  async function handleSave(suggestionId) {
    const draft = drafts[suggestionId];
    if (!draft) return;

    setSavingId(suggestionId);
    setStatusText("");

    try {
      const { error } = await supabase.rpc("update_user_suggestion_admin", {
        p_suggestion_id: suggestionId,
        p_status: draft.status,
        p_admin_note: draft.admin_note,
      });

      if (error) throw error;

      setStatusText("Suggestion updated.");
      await loadSuggestions();
    } catch (error) {
      console.error("Failed to update suggestion:", error);
      setStatusText(error?.message || "Failed to update suggestion.");
    } finally {
      setSavingId("");
    }
  }

  const filteredSuggestions = useMemo(() => {
    if (filterStatus === "all") return suggestions;
    return suggestions.filter((suggestion) => suggestion.status === filterStatus);
  }, [filterStatus, suggestions]);

  const countsByStatus = useMemo(() => {
    const counts = {
      all: suggestions.length,
    };

    STATUS_OPTIONS.forEach((status) => {
      counts[status] = suggestions.filter((suggestion) => suggestion.status === status).length;
    });

    return counts;
  }, [suggestions]);

  if (!isAdminPlus) return null;

  return (
    <section className="admin-panel">
      <div className="admin-panel-header">
        <div
          className="admin-panel-header-main"
          onClick={toggleOpen}
          onKeyDown={handleHeaderKeyDown}
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
        >
          <p className="admin-panel-kicker">PLAYER FEEDBACK</p>
          <h2 className="admin-panel-title">Suggestions Inbox</h2>
          <p className="admin-section-description">
            Review user suggestions submitted from Mode Select, add admin notes,
            and mark them for planning, implementation, or decline.
          </p>
        </div>

        <div className="admin-panel-header-actions">
          <div className="admin-panel-count">{suggestions.length} Suggestions</div>
          <button className="admin-collapse-btn" onClick={toggleOpen} type="button">
            {isOpen ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {isOpen ? (
        <div className="admin-panel-body">
          <div className="admin-suggestions-toolbar">
            <div className="admin-suggestions-filter-row">
              <label className="admin-form-label" htmlFor="admin-suggestions-filter">
                Filter
              </label>
              <select
                id="admin-suggestions-filter"
                className="admin-form-input admin-form-select"
                value={filterStatus}
                onChange={(event) => setFilterStatus(event.target.value)}
              >
                <option value="all">All ({countsByStatus.all || 0})</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status} ({countsByStatus[status] || 0})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="admin-secondary-button"
              onClick={() => void loadSuggestions()}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {filteredSuggestions.length === 0 ? (
            <div className="admin-empty-state">No suggestions match this filter yet.</div>
          ) : (
            <div className="admin-suggestions-list">
              {filteredSuggestions.map((suggestion) => {
                const draft = drafts[suggestion.id] || {
                  status: suggestion.status || "new",
                  admin_note: suggestion.admin_note || "",
                };

                return (
                  <article key={suggestion.id} className="admin-suggestion-card">
                    <div className="admin-suggestion-card-top">
                      <div className="admin-player-left">
                        <div className="admin-player-avatar">
                          {suggestion.avatar_url ? (
                            <img src={suggestion.avatar_url} alt={suggestion.username} />
                          ) : (
                            <span>
                              {String(suggestion.username || "?").charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>

                        <div className="admin-player-info">
                          <div className="admin-player-topline">
                            <h4 className="admin-player-name">
                              {suggestion.username || "Unknown User"}
                            </h4>
                            <span className="admin-role-pill">
                              {suggestion.status || "new"}
                            </span>
                          </div>

                          <div className="admin-player-meta">
                            <span>Sent {formatDateTime(suggestion.created_at)}</span>
                            <span>Last review {formatDateTime(suggestion.reviewed_at)}</span>
                            <span>
                              Reviewer {suggestion.reviewed_by_username || "No reviewer yet"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="admin-suggestion-message-shell">
                      <span className="admin-form-label">Suggestion</span>
                      <p className="admin-suggestion-message">{suggestion.message}</p>
                    </div>

                    <div className="admin-suggestion-edit-grid">
                      <div className="admin-form-row">
                        <label className="admin-form-label">Status</label>
                        <select
                          className="admin-form-input admin-form-select"
                          value={draft.status}
                          onChange={(event) =>
                            updateDraft(suggestion.id, "status", event.target.value)
                          }
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="admin-form-row admin-form-row-full">
                        <label className="admin-form-label">Admin Note</label>
                        <textarea
                          className="admin-series-textarea admin-suggestion-note"
                          value={draft.admin_note}
                          onChange={(event) =>
                            updateDraft(suggestion.id, "admin_note", event.target.value)
                          }
                          placeholder="Optional internal reply or resolution note..."
                        />
                      </div>
                    </div>

                    <div className="admin-profile-actions">
                      <button
                        type="button"
                        className="admin-action-button"
                        onClick={() => void handleSave(suggestion.id)}
                        disabled={savingId === suggestion.id}
                      >
                        {savingId === suggestion.id ? "Saving..." : "Save Review"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {statusText ? <p className="admin-status-message">{statusText}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
