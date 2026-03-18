import { useState } from "react";
import { useNavigate } from "react-router-dom";
import ProgressionPanelShell from "./ProgressionPanelShell";
import { useUser } from "../../../context/UserContext";
import { supabase } from "../../../lib/supabase";
import ReportBracketResultsModal from "./ReportBracketResultsModal";
import { useProgression } from "../../../context/ProgressionContext";

const ADMIN_MENU_ITEMS = [
  { label: "Advance Phase" },
  { label: "Bracket Generator" },
  { label: "Report Results" },
  { label: "Reward Giver" },
  { label: "Round Rewards" },
  { label: "Starter Deck Editor" },
  { label: "Container Maker" },
  { label: "Store Editor" },
  { label: "Player Items" },
];

function formatPhaseLabel(phase) {
  switch (phase) {
    case "standby":
      return "Standby Phase";
    case "deckbuilding":
      return "Deckbuilding Phase";
    case "dueling":
      return "Dueling Phase";
    case "reward":
      return "Reward Phase";
    case "lobby":
      return "Lobby";
    default:
      return phase || "Unknown";
  }
}

function formatRoundLabel(roundNumber, roundStep) {
  const safeRoundNumber = Number(roundNumber || 0);
  const safeRoundStep = roundStep == null ? null : Number(roundStep);

  if (safeRoundNumber === 0) {
    return "Round 0";
  }

  return `Round ${safeRoundNumber}-${safeRoundStep || 1}`;
}

function ProgressionAdminMenuPanel() {
  const navigate = useNavigate();
  const { user } = useUser();
  const {
    activeSeriesId,
    state,
    rewardErrors,
    refresh,
    clearRewardError,
  } = useProgression();

  const currentPhase = state?.currentPhase || "";
  const roundNumber = Number(state?.roundNumber || 0);
  const roundStep = state?.roundStep == null ? null : Number(state.roundStep);

  const [phaseBusy, setPhaseBusy] = useState(false);
  const [bracketBusy, setBracketBusy] = useState(false);
  const [phaseMessage, setPhaseMessage] = useState("");
  const [resultsModalOpen, setResultsModalOpen] = useState(false);
  const [advanceConfirmOpen, setAdvanceConfirmOpen] = useState(false);
  const [forceAdvance, setForceAdvance] = useState(false);

  if (!user || (user.role !== "Admin" && user.role !== "Admin+")) {
    return null;
  }

  async function handleAdvancePhase(force = false) {
    if (!activeSeriesId || phaseBusy) return;

    setPhaseBusy(true);
    setPhaseMessage("");

    try {
      const { data, error } = await supabase.rpc("advance_series_phase", {
        p_series_id: activeSeriesId,
        p_force: force,
      });

      if (error) throw error;

      const nextPhase = data?.current_phase || "";
      const nextRoundNumber = Number(data?.round_number || 0);
      const nextRoundStep =
        data?.round_step == null ? null : Number(data.round_step);

      setPhaseMessage(
        `Phase advanced to ${formatPhaseLabel(nextPhase)} | ${formatRoundLabel(
          nextRoundNumber,
          nextRoundStep
        )}`
      );

      window.dispatchEvent(
        new CustomEvent("onyx-phase-changed", {
          detail: {
            phase: nextPhase,
            roundNumber: nextRoundNumber,
            roundStep: nextRoundStep,
          },
        })
      );

      await refresh();
    } catch (error) {
      console.error("Failed to advance phase:", error);
      setPhaseMessage(error.message || "Failed to advance phase.");
    } finally {
      setPhaseBusy(false);
    }
  }

  async function handleGenerateBracket() {
    if (!activeSeriesId || bracketBusy) return;

    setBracketBusy(true);
    setPhaseMessage("");

    try {
      const { data, error } = await supabase.rpc("generate_series_bracket", {
        p_series_id: activeSeriesId,
      });

      if (error) throw error;

      setPhaseMessage("Bracket generated successfully.");

      window.dispatchEvent(
        new CustomEvent("onyx-bracket-changed", {
          detail: {
            bracketId: data?.bracket_id || null,
          },
        })
      );

      await refresh();
    } catch (error) {
      console.error("Failed to generate bracket:", error);
      setPhaseMessage(error.message || "Failed to generate bracket.");
    } finally {
      setBracketBusy(false);
    }
  }

  function handleAdminMenuClick(label) {
    if (label === "Advance Phase") {
      setForceAdvance(false);
      setAdvanceConfirmOpen(true);
      return;
    }

    if (label === "Bracket Generator") {
      handleGenerateBracket();
      return;
    }

    if (label === "Report Results") {
      setResultsModalOpen(true);
      return;
    }

    if (label === "Reward Giver") {
      navigate("/mode/progression/admin/reward-giver");
      return;
    }

    if (label === "Round Rewards") {
      navigate("/mode/progression/admin/round-rewards");
      return;
    }

    if (label === "Starter Deck Editor") {
      navigate("/mode/progression/admin/starter-decks");
      return;
    }

    if (label === "Container Maker") {
      navigate("/mode/progression/admin/container-maker");
      return;
    }

    if (label === "Store Editor") {
      navigate("/mode/progression/admin/store-editor");
      return;
    }

    if (label === "Player Items") {
      navigate("/mode/progression/admin/player-items");
    }
  }

  return (
    <>
      <ProgressionPanelShell
        kicker="ADMIN"
        title="Admin Menu"
        meta={<span>{ADMIN_MENU_ITEMS.length} Tools</span>}
      >
        <div className="progression-admin-phase-bar">
          <span className="progression-admin-phase-label">
            Current Phase: {formatPhaseLabel(currentPhase)}
          </span>

          <span className="progression-admin-round-label">
            Current Round: {formatRoundLabel(roundNumber, roundStep)}
          </span>

          {phaseMessage ? (
            <span className="progression-admin-phase-message">{phaseMessage}</span>
          ) : null}
        </div>

        <div className="progression-action-grid progression-action-grid-series">
          {ADMIN_MENU_ITEMS.map((item) => {
            const isPhaseButton = item.label === "Advance Phase";
            const isBracketButton = item.label === "Bracket Generator";

            return (
              <button
                key={item.label}
                type="button"
                className="progression-action-btn"
                onClick={() => handleAdminMenuClick(item.label)}
                disabled={
                  (isPhaseButton && (phaseBusy || !activeSeriesId)) ||
                  (isBracketButton && (bracketBusy || !activeSeriesId))
                }
              >
                {isPhaseButton && phaseBusy
                  ? "Advancing Phase..."
                  : isBracketButton && bracketBusy
                    ? "Generating Bracket..."
                    : item.label}
              </button>
            );
          })}
        </div>

        {rewardErrors.length > 0 ? (
          <div className="progression-admin-error-stack">
            <div className="progression-admin-error-title">Reward Fix List</div>
            {rewardErrors.map((row) => (
              <div className="progression-admin-error-row" key={row.id}>
                <div className="progression-admin-error-copy">
                  <strong>{row.user_id || "Series Error"}</strong>
                  <span>{row.message || "Reward processing failed."}</span>
                </div>

                <button
                  type="button"
                  className="progression-results-score-btn"
                  onClick={async () => {
                    try {
                      await clearRewardError(row.id);
                    } catch (error) {
                      console.error("Failed to clear reward error:", error);
                      window.alert(error.message || "Failed to clear reward error.");
                    }
                  }}
                >
                  Clear
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </ProgressionPanelShell>

      <ReportBracketResultsModal
        isOpen={resultsModalOpen}
        onClose={() => setResultsModalOpen(false)}
        activeSeriesId={activeSeriesId}
        onReported={(data) => {
          window.dispatchEvent(
            new CustomEvent("onyx-bracket-changed", {
              detail: {
                bracketCompleted: Boolean(data?.bracket_completed),
              },
            })
          );

          if (data?.bracket_completed) {
            setPhaseMessage(
              "Grand Final recorded. The round state, scoreboard, and reward flow were updated."
            );
          } else {
            setPhaseMessage("Match result recorded successfully.");
          }

          refresh();
        }}
      />

      {advanceConfirmOpen ? (
        <div className="progression-results-modal-overlay">
          <div className="progression-results-modal">
            <div className="progression-results-modal-header">
              <div>
                <div className="progression-results-modal-kicker">ADMIN</div>
                <h2 className="progression-results-modal-title">Advance Phase</h2>
              </div>

              <button
                type="button"
                className="progression-results-modal-close-btn"
                onClick={() => setAdvanceConfirmOpen(false)}
              >
                x
              </button>
            </div>

            <div className="progression-results-modal-body">
              <p className="progression-readyup-copy">
                Advance from {formatPhaseLabel(currentPhase)} into the next phase
                for {formatRoundLabel(roundNumber, roundStep)}.
              </p>

              <label className="progression-admin-force-toggle">
                <input
                  type="checkbox"
                  checked={forceAdvance}
                  onChange={(event) => setForceAdvance(event.target.checked)}
                />
                <span>Force advance even if the normal phase conditions are not met.</span>
              </label>

              <div className="progression-readyup-actions">
                <button
                  type="button"
                  className="progression-results-score-btn"
                  onClick={() => setAdvanceConfirmOpen(false)}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="progression-results-score-btn"
                  disabled={phaseBusy}
                  onClick={async () => {
                    await handleAdvancePhase(forceAdvance);
                    setAdvanceConfirmOpen(false);
                  }}
                >
                  {phaseBusy
                    ? "Advancing..."
                    : forceAdvance
                      ? "Force Advance"
                      : "Advance"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default ProgressionAdminMenuPanel;

