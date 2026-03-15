import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../../lib/supabase";
import ProgressionPanelShell from "./ProgressionPanelShell";

const SERIES_MENU_ITEMS = [
  { label: "Banlist" },
  { label: "Starter Decks" },
  { label: "Phases & Rules" },
  { label: "Card Database" },
  { label: "Pack Database" },
  { label: "Deck Box Database" },
  { label: "Promo Box Database" },
];

function formatPhaseRulesText() {
  return [
    "Standby Phase",
    "• Buy items from the store",
    "• Sell cards from binder",
    "• Trade with other players",
    "• Use inventory items",
    "• Open packs / boxes / feature slots",
    "• Manage binder",
    "• Manage decks",
    "",
    "Deckbuilding Phase",
    "• Build decks using cards from binder",
    "• Decks must follow the current banlist",
    "• Decks must follow card ownership",
    "• Decks are exported manually as .ydk files",
    "",
    "Dueling Phase",
    "• Duel externally using exported decks",
    "• No inventory actions",
    "• No store access",
    "• No trading",
    "• No pack / box opening",
    "• No item usage",
    "",
    "Reward Phase",
    "• Admin enters final match results",
    "• Rewards are distributed after placements are finalized",
    "• Then the series returns to Standby Phase",
  ].join("\n");
}

function ProgressionSeriesMenuPanel() {
  const navigate = useNavigate();

  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [starterDeckLoading, setStarterDeckLoading] = useState(true);
  const [starterDeckBusy, setStarterDeckBusy] = useState(false);
  const [starterDeckClaimed, setStarterDeckClaimed] = useState(false);
  const [starterDeckClaimedName, setStarterDeckClaimedName] = useState("");
  const [remainingDecks, setRemainingDecks] = useState(0);
  const [starterDeckMessage, setStarterDeckMessage] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadStarterDeckStatus() {
      setStarterDeckLoading(true);
      setStarterDeckMessage("");

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
          if (isMounted) {
            setActiveSeriesId(null);
            setStarterDeckClaimed(false);
            setStarterDeckClaimedName("");
            setRemainingDecks(0);
          }
          return;
        }

        if (!isMounted) return;

        setActiveSeriesId(activeSeries.id);

        const { data, error } = await supabase.rpc(
          "get_my_starter_deck_claim_status",
          {
            p_series_id: activeSeries.id,
          }
        );

        if (error) {
          throw error;
        }

        if (!isMounted) return;

        setStarterDeckClaimed(Boolean(data?.already_claimed));
        setStarterDeckClaimedName(data?.claimed_deck_name || "");
        setRemainingDecks(Number(data?.remaining_decks || 0));

        if (data?.already_claimed && data?.claimed_deck_name) {
          setStarterDeckMessage(`Claimed: ${data.claimed_deck_name}`);
        } else if (Number(data?.remaining_decks || 0) <= 0) {
          setStarterDeckMessage("No starter decks remain.");
        } else {
          setStarterDeckMessage("");
        }
      } catch (error) {
        console.error("Failed to load starter deck claim status:", error);
        if (isMounted) {
          setStarterDeckMessage("Starter deck status unavailable.");
        }
      } finally {
        if (isMounted) {
          setStarterDeckLoading(false);
        }
      }
    }

    loadStarterDeckStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleClaimStarterDeck() {
    if (!activeSeriesId || starterDeckBusy || starterDeckClaimed) {
      return;
    }

    setStarterDeckBusy(true);
    setStarterDeckMessage("");

    try {
      const { data, error } = await supabase.rpc("claim_random_starter_deck", {
        p_series_id: activeSeriesId,
      });

      if (error) {
        throw error;
      }

      const claimedName = data?.starter_deck_name || "Starter Deck";

      setStarterDeckClaimed(true);
      setStarterDeckClaimedName(claimedName);
      setRemainingDecks((prev) => Math.max(0, prev - 1));
      setStarterDeckMessage(`Claimed: ${claimedName}`);

      window.alert(
        `Starter deck claim successful.\n\nYou received: ${claimedName}`
      );
    } catch (error) {
      console.error("Failed to claim starter deck:", error);
      const message = error?.message || "Failed to claim starter deck.";
      setStarterDeckMessage(message);
      window.alert(message);
    } finally {
      setStarterDeckBusy(false);
    }
  }

  function handleSeriesMenuClick(label) {
    if (label === "Banlist") {
      navigate("/mode/progression/banlist");
      return;
    }

    if (label === "Card Database") {
      navigate("/mode/progression/cards");
      return;
    }

    if (label === "Starter Decks") {
      handleClaimStarterDeck();
      return;
    }

    if (label === "Phases & Rules") {
      window.alert(formatPhaseRulesText());
      return;
    }

    if (label === "Pack Database") {
      window.alert("Pack Database is not built yet.");
      return;
    }

    if (label === "Deck Box Database") {
      window.alert("Deck Box Database is not built yet.");
      return;
    }

    if (label === "Promo Box Database") {
      window.alert("Promo Box Database is not built yet.");
    }
  }

  function getStarterDeckButtonLabel() {
    if (starterDeckLoading) {
      return "Starter Decks";
    }

    if (starterDeckClaimed) {
      return "Starter Deck Claimed";
    }

    if (remainingDecks <= 0) {
      return "Starter Decks Unavailable";
    }

    if (starterDeckBusy) {
      return "Claiming Starter Deck...";
    }

    return "Starter Decks";
  }

  return (
    <ProgressionPanelShell
      kicker="SERIES"
      title="Series Menu"
      meta={<span>{SERIES_MENU_ITEMS.length} Links</span>}
      className="progression-panel-fill"
    >
      <div className="progression-action-grid progression-action-grid-series">
        {SERIES_MENU_ITEMS.map((item) => {
          const isStarterDeckButton = item.label === "Starter Decks";
          const starterDeckDisabled =
            isStarterDeckButton &&
            (starterDeckLoading ||
              starterDeckBusy ||
              starterDeckClaimed ||
              remainingDecks <= 0);

          return (
            <button
              key={item.label}
              type="button"
              className={`progression-action-btn ${
                isStarterDeckButton && starterDeckClaimed
                  ? "progression-action-btn-starter-claimed"
                  : ""
              }`}
              onClick={() => handleSeriesMenuClick(item.label)}
              disabled={starterDeckDisabled}
            >
              {isStarterDeckButton ? getStarterDeckButtonLabel() : item.label}
            </button>
          );
        })}
      </div>

      <div className="progression-series-starterdeck-status">
        {starterDeckClaimed ? (
          <span className="progression-series-starterdeck-message">
            Claimed starter deck: {starterDeckClaimedName || "Starter Deck"}
          </span>
        ) : starterDeckMessage ? (
          <span className="progression-series-starterdeck-message">
            {starterDeckMessage}
          </span>
        ) : (
          <span className="progression-series-starterdeck-message">
            Remaining starter decks in pool: {remainingDecks}
          </span>
        )}
      </div>
    </ProgressionPanelShell>
  );
}

export default ProgressionSeriesMenuPanel;
