import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";
import "./SuggestionsPage.css";

const MAX_SUGGESTION_LENGTH = 2000;

function formatDateTime(value) {
  if (!value) return "Not reviewed yet";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function SuggestionsPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();
  const [message, setMessage] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadSuggestions() {
      setLoading(true);
      setErrorText("");

      try {
        const { data, error } = await supabase.rpc("get_my_user_suggestions");
        if (error) throw error;
        if (!isMounted) return;
        setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
      } catch (error) {
        console.error("Failed to load suggestions:", error);
        if (!isMounted) return;
        setSuggestions([]);
        setErrorText(error?.message || "Failed to load your suggestions.");
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    if (user && !user.isBlocked) {
      loadSuggestions();
    } else {
      setSuggestions([]);
      setLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [user]);

  const characterCount = useMemo(() => message.trim().length, [message]);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmed = message.trim();
    if (!trimmed) {
      setErrorText("Suggestion text is required.");
      return;
    }

    setSubmitting(true);
    setErrorText("");
    setStatusText("");

    try {
      const { data, error } = await supabase.rpc("submit_user_suggestion", {
        p_message: trimmed,
      });

      if (error) throw error;

      const nextSuggestion = data?.suggestion;
      setSuggestions((current) =>
        nextSuggestion ? [nextSuggestion, ...current] : current
      );
      setMessage("");
      setStatusText("Suggestion submitted to the Admin+ review panel.");
    } catch (error) {
      console.error("Failed to submit suggestion:", error);
      setErrorText(error?.message || "Failed to submit suggestion.");
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || loading) return null;

  if (!user || user.isBlocked) {
    return <Navigate to="/" replace />;
  }

  return (
    <LauncherLayout>
      <div className="suggestions-page">
        <div className="suggestions-topbar">
          <div>
            <p className="suggestions-kicker">PLAYER FEEDBACK</p>
            <h1 className="suggestions-title">Suggestions</h1>
            <p className="suggestions-subtitle">
              Drop ideas, polish notes, or problem reports here and they will land
              in the Admin+ modal for review.
            </p>
          </div>

          <button
            type="button"
            className="suggestions-back-button"
            onClick={() => navigate("/mode")}
          >
            Back
          </button>
        </div>

        <div className="suggestions-layout">
          <section className="suggestions-panel">
            <div className="suggestions-panel-header">
              <div>
                <p className="suggestions-section-kicker">Submit Something New</p>
                <h2>Send Suggestion</h2>
              </div>
            </div>

            <form className="suggestions-form" onSubmit={handleSubmit}>
              <label htmlFor="user-suggestion-message">Suggestion</label>
              <textarea
                id="user-suggestion-message"
                value={message}
                maxLength={MAX_SUGGESTION_LENGTH}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="What should we add, polish, or fix?"
              />

              <div className="suggestions-form-footer">
                <span className="suggestions-counter">
                  {characterCount} / {MAX_SUGGESTION_LENGTH}
                </span>

                <button type="submit" disabled={submitting}>
                  {submitting ? "Submitting..." : "Submit Suggestion"}
                </button>
              </div>
            </form>

            {statusText ? <div className="suggestions-inline-status">{statusText}</div> : null}
            {errorText ? <div className="suggestions-inline-error">{errorText}</div> : null}
          </section>

          <section className="suggestions-panel">
            <div className="suggestions-panel-header">
              <div>
                <p className="suggestions-section-kicker">Your Recent Inbox</p>
                <h2>Past Suggestions</h2>
              </div>

              <div className="suggestions-count-pill">{suggestions.length} Total</div>
            </div>

            {suggestions.length === 0 ? (
              <div className="suggestions-empty-state">
                No suggestions sent yet. Your first submission will show up here with
                review status once Admin+ looks at it.
              </div>
            ) : (
              <div className="suggestions-list">
                {suggestions.map((suggestion) => (
                  <article key={suggestion.id} className="suggestions-entry">
                    <div className="suggestions-entry-topline">
                      <span className={`suggestions-status-pill is-${suggestion.status || "new"}`}>
                        {suggestion.status || "new"}
                      </span>
                      <span className="suggestions-entry-date">
                        Sent {formatDateTime(suggestion.created_at)}
                      </span>
                    </div>

                    <p className="suggestions-entry-message">{suggestion.message}</p>

                    <div className="suggestions-entry-meta">
                      <div>
                        <span>Last Review</span>
                        <strong>{formatDateTime(suggestion.reviewed_at)}</strong>
                      </div>

                      <div>
                        <span>Admin Note</span>
                        <strong>{suggestion.admin_note || "No admin note yet"}</strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </LauncherLayout>
  );
}

export default SuggestionsPage;
