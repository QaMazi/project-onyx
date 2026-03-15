import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";

function ReportBracketResultsModal({ isOpen, onClose, activeSeriesId, onReported }) {
  const [loading, setLoading] = useState(false);
  const [reportingMatchId, setReportingMatchId] = useState(null);
  const [matches, setMatches] = useState([]);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [errorMessage, setErrorMessage] = useState("");

  const reportOptions = [
    { p1: 2, p2: 0, label: "2-0" },
    { p1: 2, p2: 1, label: "2-1" },
    { p1: 1, p2: 2, label: "1-2" },
    { p1: 0, p2: 2, label: "0-2" },
  ];

  useEffect(() => {
    if (!isOpen || !activeSeriesId) return;

    let isMounted = true;

    async function loadModalData() {
      setLoading(true);
      setErrorMessage("");

      try {
        const { data: currentSeries, error: currentSeriesError } = await supabase
          .from("game_series")
          .select("round_number, round_step")
          .eq("id", activeSeriesId)
          .maybeSingle();

        if (currentSeriesError) throw currentSeriesError;

        const roundNumber = Number(currentSeries?.round_number || 0);
        const roundStep = currentSeries?.round_step == null ? 0 : Number(currentSeries.round_step);

        const { data: bracket, error: bracketError } = await supabase
          .from("series_brackets")
          .select("id, status")
          .eq("series_id", activeSeriesId)
          .eq("round_number", roundNumber)
          .eq("round_step", roundStep)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (bracketError) throw bracketError;

        if (!bracket?.id) {
          if (isMounted) {
            setMatches([]);
          }
          return;
        }

        const [{ data: matchRows, error: matchError }, { data: players, error: playersError }] =
          await Promise.all([
            supabase
              .from("series_bracket_matches")
              .select("*")
              .eq("bracket_id", bracket.id)
              .order("display_order", { ascending: true }),
            supabase
              .from("series_players_view")
              .select("user_id, username")
              .eq("series_id", activeSeriesId),
          ]);

        if (matchError) throw matchError;
        if (playersError) throw playersError;

        if (!isMounted) return;

        setMatches(matchRows || []);
        setPlayersMap(new Map((players || []).map((row) => [row.user_id, row.username])));
      } catch (error) {
        console.error("Failed to load report modal:", error);
        if (isMounted) {
          setErrorMessage(error.message || "Failed to load bracket matches.");
          setMatches([]);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadModalData();

    function handleEscape(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      isMounted = false;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, activeSeriesId, onClose]);

  const reportableMatches = useMemo(() => {
    return matches.filter(
      (match) =>
        match.status !== "completed" &&
        match.player1_user_id &&
        match.player2_user_id
    );
  }, [matches]);

  async function handleReport(matchId, p1Score, p2Score) {
    setReportingMatchId(matchId);
    setErrorMessage("");

    try {
      const { data, error } = await supabase.rpc("report_series_bracket_result", {
        p_match_id: matchId,
        p_player1_score: p1Score,
        p_player2_score: p2Score,
      });

      if (error) {
        throw error;
      }

      if (onReported) {
        onReported(data);
      }

      onClose();
    } catch (error) {
      console.error("Failed to report result:", error);
      setErrorMessage(error.message || "Failed to report result.");
    } finally {
      setReportingMatchId(null);
    }
  }

  function handleOverlayClick(event) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  if (!isOpen) return null;

  return (
    <div className="progression-results-modal-overlay" onClick={handleOverlayClick}>
      <div className="progression-results-modal">
        <div className="progression-results-modal-header">
          <div>
            <div className="progression-results-modal-kicker">ADMIN</div>
            <h2 className="progression-results-modal-title">Report Match Results</h2>
          </div>

          <button
            type="button"
            className="progression-results-modal-close-btn"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="progression-results-modal-body">
          {loading ? (
            <div className="progression-results-modal-empty">Loading reportable matches...</div>
          ) : reportableMatches.length === 0 ? (
            <div className="progression-results-modal-empty">
              No reportable matches are ready right now.
            </div>
          ) : (
            <div className="progression-results-match-list">
              {reportableMatches.map((match) => (
                <div className="progression-results-match-card" key={match.id}>
                  <div className="progression-results-match-info">
                    <div className="progression-results-match-label">{match.match_label}</div>
                    <div className="progression-results-match-players">
                      <span>{playersMap.get(match.player1_user_id) || "Player 1"}</span>
                      <span className="progression-results-vs">vs</span>
                      <span>{playersMap.get(match.player2_user_id) || "Player 2"}</span>
                    </div>
                  </div>

                  <div className="progression-results-match-actions">
                    {reportOptions.map((option) => (
                      <button
                        key={`${match.id}-${option.label}`}
                        type="button"
                        className="progression-results-score-btn"
                        onClick={() => handleReport(match.id, option.p1, option.p2)}
                        disabled={reportingMatchId === match.id}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {errorMessage ? (
            <div className="progression-results-modal-error">{errorMessage}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default ReportBracketResultsModal;