import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ProgressionPanelShell from "./ProgressionPanelShell";
import { useUser } from "../../../context/UserContext";
import { supabase } from "../../../lib/supabase";
import ReportBracketResultsModal from "./ReportBracketResultsModal";

const ADMIN_MENU_ITEMS = [
  { label: "Next Phase" },
  { label: "Bracket Generator" },
  { label: "Report Results" },
  { label: "Reward Giver" },
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

  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [currentPhase, setCurrentPhase] = useState("");
  const [roundNumber, setRoundNumber] = useState(0);
  const [roundStep, setRoundStep] = useState(null);

  const [phaseBusy, setPhaseBusy] = useState(false);
  const [bracketBusy, setBracketBusy] = useState(false);
  const [phaseMessage, setPhaseMessage] = useState("");
  const [resultsModalOpen, setResultsModalOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadActiveSeriesState() {
      try {
        const { data, error } = await supabase
          .from("game_series")
          .select("id, current_phase, round_number, round_step")
          .eq("is_current", true)
          .maybeSingle();

        if (error) throw error;

        if (!isMounted) return;

        setActiveSeriesId(data?.id || null);
        setCurrentPhase(data?.current_phase || "");
        setRoundNumber(Number(data?.round_number || 0));
        setRoundStep(data?.round_step == null ? null : Number(data.round_step));
      } catch (error) {
        console.error("Failed to load current phase/round:", error);
        if (isMounted) {
          setActiveSeriesId(null);
          setCurrentPhase("");
          setRoundNumber(0);
          setRoundStep(null);
        }
      }
    }

    loadActiveSeriesState();

    function handleExternalPhaseChange(event) {
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
    }

    window.addEventListener("onyx-phase-changed", handleExternalPhaseChange);

    return () => {
      isMounted = false;
      window.removeEventListener("onyx-phase-changed", handleExternalPhaseChange);
    };
  }, []);

  if (!user || (user.role !== "Admin" && user.role !== "Admin+")) {
    return null;
  }

  async function handleAdvancePhase() {
    if (!activeSeriesId || phaseBusy) return;

    setPhaseBusy(true);
    setPhaseMessage("");

    try {
      const { data, error } = await supabase.rpc("advance_series_phase", {
        p_series_id: activeSeriesId,
      });

      if (error) throw error;

      const nextPhase = data?.current_phase || "";
      const nextRoundNumber = Number(data?.round_number || 0);
      const nextRoundStep =
        data?.round_step == null ? null : Number(data.round_step);

      setCurrentPhase(nextPhase);
      setRoundNumber(nextRoundNumber);
      setRoundStep(nextRoundStep);
      setPhaseMessage(
        `Phase advanced to ${formatPhaseLabel(nextPhase)} • ${formatRoundLabel(
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
    } catch (error) {
      console.error("Failed to generate bracket:", error);
      setPhaseMessage(error.message || "Failed to generate bracket.");
    } finally {
      setBracketBusy(false);
    }
  }

  function handleAdminMenuClick(label) {
    if (label === "Next Phase") {
      handleAdvancePhase();
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

    if (label === "Starter Deck Editor") {
      navigate("/mode/progression/admin/starter-decks");
      return;
    }

    if (label === "Container Maker") {
      navigate("/mode/progression/admin/container-maker");
      return;
    }

    if (label === "Store Editor") {
      window.alert("Store Editor is not built yet.");
      return;
    }

    if (label === "Player Items") {
      window.alert("Player Items is not built yet.");
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
            const isPhaseButton = item.label === "Next Phase";
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
            window.alert(
              "Grand Final recorded. Placements, scoreboard, and shard rewards have been applied."
            );
          }
        }}
      />
    </>
  );
}

export default ProgressionAdminMenuPanel;