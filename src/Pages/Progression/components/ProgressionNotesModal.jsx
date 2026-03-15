import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase.js";

function ProgressionNotesModal({ isOpen, onClose }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seriesId, setSeriesId] = useState(null);
  const [notes, setNotes] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    async function loadNotes() {
      setLoading(true);
      setErrorMessage("");
      setSavedMessage("");

      try {
        const { data: activeSeries, error: activeSeriesError } = await supabase
          .from("game_series")
          .select("id")
          .eq("is_current", true)
          .maybeSingle();

        if (activeSeriesError) {
          throw activeSeriesError;
        }

        if (!activeSeries?.id) {
          throw new Error("No active series found.");
        }

        if (!isMounted) return;

        setSeriesId(activeSeries.id);

        const { data: noteData, error: noteError } = await supabase.rpc(
          "get_my_series_note",
          {
            p_series_id: activeSeries.id,
          }
        );

        if (noteError) {
          throw noteError;
        }

        if (!isMounted) return;

        setNotes(noteData?.notes || "");
      } catch (error) {
        console.error("Failed to load series notes:", error);
        if (isMounted) {
          setErrorMessage(error.message || "Failed to load notes.");
          setNotes("");
          setSeriesId(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    loadNotes();
    window.addEventListener("keydown", handleEscape);

    return () => {
      isMounted = false;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  async function handleSave() {
    if (!seriesId) {
      setErrorMessage("No active series found.");
      return;
    }

    setSaving(true);
    setErrorMessage("");
    setSavedMessage("");

    try {
      const { data, error } = await supabase.rpc("save_my_series_note", {
        p_series_id: seriesId,
        p_notes: notes,
      });

      if (error) {
        throw error;
      }

      setNotes(data?.notes || "");
      setSavedMessage("Saved");
    } catch (error) {
      console.error("Failed to save notes:", error);
      setErrorMessage(error.message || "Failed to save notes.");
    } finally {
      setSaving(false);
    }
  }

  function handleOverlayClick(event) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  if (!isOpen) return null;

  return (
    <div className="progression-notes-modal-overlay" onClick={handleOverlayClick}>
      <div className="progression-notes-modal">
        <div className="progression-notes-modal-header">
          <div>
            <div className="progression-notes-modal-kicker">PLAYER</div>
            <h2 className="progression-notes-modal-title">Series Notes</h2>
          </div>

          <button
            type="button"
            className="progression-notes-modal-close-btn"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="progression-notes-modal-body">
          <p className="progression-notes-modal-subtitle">
            Private notes for your current active series.
          </p>

          {loading ? (
            <div className="progression-notes-modal-status">Loading notes...</div>
          ) : (
            <>
              <textarea
                className="progression-notes-modal-textarea"
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value);
                  if (savedMessage) {
                    setSavedMessage("");
                  }
                }}
                placeholder="Keep notes here for buys, steals, banlist plans, reminders, or anything you want to track for this series."
              />

              {(errorMessage || savedMessage) && (
                <div className="progression-notes-modal-feedback-row">
                  {errorMessage ? (
                    <span className="progression-notes-modal-error">
                      {errorMessage}
                    </span>
                  ) : null}

                  {!errorMessage && savedMessage ? (
                    <span className="progression-notes-modal-saved">
                      {savedMessage}
                    </span>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>

        <div className="progression-notes-modal-footer">
          <button
            type="button"
            className="progression-notes-modal-secondary-btn"
            onClick={onClose}
            disabled={saving}
          >
            Close
          </button>

          <button
            type="button"
            className="progression-notes-modal-primary-btn"
            onClick={handleSave}
            disabled={loading || saving}
          >
            {saving ? "Saving..." : "Save Notes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProgressionNotesModal;