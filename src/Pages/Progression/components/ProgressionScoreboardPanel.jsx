import { useEffect, useMemo, useState } from "react";
import ProgressionPanelShell from "./ProgressionPanelShell";
import { supabase } from "../../../lib/supabase";

function formatPhaseLabel(phase) {
  switch (phase) {
    case "standby":
      return "STANDBY PHASE";
    case "deckbuilding":
      return "DECKBUILDING PHASE";
    case "dueling":
      return "DUELING PHASE";
    case "reward":
      return "REWARD PHASE";
    case "lobby":
      return "LOBBY";
    default:
      return phase ? String(phase).toUpperCase() : "UNKNOWN PHASE";
  }
}

function formatRoundLabel(roundNumber, roundStep) {
  const safeRoundNumber = Number(roundNumber || 0);
  const safeRoundStep = roundStep == null ? null : Number(roundStep);

  if (safeRoundNumber === 0) {
    return "ROUND 0";
  }

  return `ROUND ${safeRoundNumber}-${safeRoundStep || 1}`;
}

function buildMatchLabel(match) {
  return match.match_label || match.match_key || "Match";
}

function ProgressionScoreboardPanel() {
  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [currentPhase, setCurrentPhase] = useState("");
  const [roundNumber, setRoundNumber] = useState(0);
  const [roundStep, setRoundStep] = useState(null);
  const [matches, setMatches] = useState([]);
  const [playersMap, setPlayersMap] = useState(new Map());
  const [scoreboardRows, setScoreboardRows] = useState([]);
  const [loading, setLoading] = useState(true);

  async function loadPanelData() {
    setLoading(true);

    try {
      const { data: activeSeries, error: activeSeriesError } = await supabase
        .from("game_series")
        .select("id, current_phase, round_number, round_step")
        .eq("is_current", true)
        .maybeSingle();

      if (activeSeriesError) throw activeSeriesError;

      const nextSeriesId = activeSeries?.id || null;
      const nextRoundNumber = Number(activeSeries?.round_number || 0);
      const nextRoundStep = activeSeries?.round_step == null ? null : Number(activeSeries.round_step);

      setActiveSeriesId(nextSeriesId);
      setCurrentPhase(activeSeries?.current_phase || "");
      setRoundNumber(nextRoundNumber);
      setRoundStep(nextRoundStep);

      if (!nextSeriesId) {
        setMatches([]);
        setPlayersMap(new Map());
        setScoreboardRows([]);
        return;
      }

      const bracketRoundStep = nextRoundStep == null ? 0 : nextRoundStep;

      const [
        { data: bracket, error: bracketError },
        { data: players, error: playersError },
        { data: roundResults, error: roundResultsError },
      ] = await Promise.all([
        supabase
          .from("series_brackets")
          .select("id, status")
          .eq("series_id", nextSeriesId)
          .eq("round_number", nextRoundNumber)
          .eq("round_step", bracketRoundStep)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("series_players_view")
          .select("user_id, username")
          .eq("series_id", nextSeriesId),
        supabase
          .from("series_round_results")
          .select("user_id, placement, score_awarded, shards_awarded, round_number, round_step")
          .eq("series_id", nextSeriesId),
      ]);

      if (bracketError) throw bracketError;
      if (playersError) throw playersError;
      if (roundResultsError) throw roundResultsError;

      const nextPlayersMap = new Map((players || []).map((row) => [row.user_id, row.username]));
      setPlayersMap(nextPlayersMap);

      if (bracket?.id) {
        const { data: matchRows, error: matchError } = await supabase
          .from("series_bracket_matches")
          .select("*")
          .eq("bracket_id", bracket.id)
          .order("display_order", { ascending: true });

        if (matchError) throw matchError;

        setMatches(matchRows || []);
      } else {
        setMatches([]);
      }

      const aggregateMap = new Map();

      (players || []).forEach((player) => {
        aggregateMap.set(player.user_id, {
          user_id: player.user_id,
          username: player.username,
          total_points: 0,
          total_shards: 0,
          rounds_played: 0,
          latest_placement: null,
        });
      });

      (roundResults || []).forEach((row) => {
        if (!aggregateMap.has(row.user_id)) return;

        const current = aggregateMap.get(row.user_id);

        current.total_points += Number(row.score_awarded || 0);
        current.total_shards += Number(row.shards_awarded || 0);
        current.rounds_played += 1;
        current.latest_placement = Number(row.placement || 0);
      });

      const nextScoreboardRows = [...aggregateMap.values()].sort((a, b) => {
        if (b.total_points !== a.total_points) {
          return b.total_points - a.total_points;
        }

        if (b.total_shards !== a.total_shards) {
          return b.total_shards - a.total_shards;
        }

        return String(a.username || "").localeCompare(String(b.username || ""));
      });

      setScoreboardRows(nextScoreboardRows);
    } catch (error) {
      console.error("Failed to load scoreboard panel:", error);
      setMatches([]);
      setScoreboardRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPanelData();

    function handlePanelRefresh(event) {
      const nextPhase = event?.detail?.phase;
      const nextRoundNumber = event?.detail?.roundNumber;
      const nextRoundStep = event?.detail?.roundStep;

      if (nextPhase) {
        setCurrentPhase(nextPhase);
      }

      if (typeof nextRoundNumber === "number") {
        setRoundNumber(nextRoundNumber);
      }

      if (nextRoundStep === null || typeof nextRoundStep === "number") {
        setRoundStep(nextRoundStep);
      }

      loadPanelData();
    }

    window.addEventListener("onyx-phase-changed", handlePanelRefresh);
    window.addEventListener("onyx-bracket-changed", handlePanelRefresh);

    return () => {
      window.removeEventListener("onyx-phase-changed", handlePanelRefresh);
      window.removeEventListener("onyx-bracket-changed", handlePanelRefresh);
    };
  }, []);

  const matchupRows = useMemo(() => {
    const pending = matches.filter((match) => match.status !== "completed");
    const completed = matches.filter((match) => match.status === "completed");
    return [...pending, ...completed];
  }, [matches]);

  return (
    <ProgressionPanelShell
      kicker="SERIES"
      title="Tracker"
      meta={<span>Live Bracket</span>}
      className="progression-panel-fill"
    >
      <div className="progression-scoreboard-phase-banner">
        {loading ? "LOADING PHASE..." : formatPhaseLabel(currentPhase)}
      </div>

      <div className="progression-scoreboard-round-banner">
        {loading ? "LOADING ROUND..." : formatRoundLabel(roundNumber, roundStep)}
      </div>

      <div className="progression-scoreboard-block">
        <h3 className="progression-scoreboard-block-title">Current Matchups</h3>

        {!activeSeriesId ? (
          <div className="progression-scoreboard-empty">No active series.</div>
        ) : matchupRows.length === 0 ? (
          <div className="progression-scoreboard-empty">
            No bracket generated for the current round yet.
          </div>
        ) : (
          <div className="progression-scoreboard-match-list">
            {matchupRows.map((match) => {
              const p1Name = match.player1_user_id
                ? playersMap.get(match.player1_user_id) || "Player 1"
                : "Awaiting Player";
              const p2Name = match.player2_user_id
                ? playersMap.get(match.player2_user_id) || "Player 2"
                : "Awaiting Player";

              return (
                <div className="progression-scoreboard-match-card" key={match.id}>
                  <div className="progression-scoreboard-match-top">
                    <span className="progression-scoreboard-match-label">
                      {buildMatchLabel(match)}
                    </span>

                    <span className="progression-scoreboard-match-status">
                      {match.status === "completed"
                        ? `${match.player1_score}-${match.player2_score}`
                        : "Pending"}
                    </span>
                  </div>

                  <div className="progression-scoreboard-match-players">
                    <span className="progression-scoreboard-player-name">{p1Name}</span>
                    <span className="progression-scoreboard-vs">vs</span>
                    <span className="progression-scoreboard-player-name">{p2Name}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="progression-scoreboard-block">
        <h3 className="progression-scoreboard-block-title">Overall Scoreboard</h3>

        {scoreboardRows.length === 0 ? (
          <div className="progression-scoreboard-empty">
            No scoreboard results have been recorded yet.
          </div>
        ) : (
          <div className="progression-scoreboard-table">
            {scoreboardRows.map((row, index) => (
              <div className="progression-scoreboard-table-row" key={row.user_id}>
                <div className="progression-scoreboard-rank">#{index + 1}</div>

                <div className="progression-scoreboard-user">
                  <div className="progression-scoreboard-user-name">{row.username}</div>
                  <div className="progression-scoreboard-user-meta">
                    Rounds: {row.rounds_played}
                    {row.latest_placement ? ` • Latest Placement: ${row.latest_placement}` : ""}
                  </div>
                </div>

                <div className="progression-scoreboard-points">
                  <span>{row.total_points}</span>
                  <small>PTS</small>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ProgressionPanelShell>
  );
}

export default ProgressionScoreboardPanel;