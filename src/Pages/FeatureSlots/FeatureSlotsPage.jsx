import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { useProgression } from "../../context/ProgressionContext";
import { supabase } from "../../lib/supabase";
import BinderHoverTooltip from "../Binder/Components/BinderHoverTooltip";

import "./FeatureSlotsPage.css";

const CARD_IMAGE_FALLBACK =
  "https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/fallback_image.jpg";

const IDLE_REEL_WORDS = ["Feature", "Coins", "Cards"];

function getSlotId(slot) {
  return slot?.feature_slot_id || slot?.id || "";
}

function buildCardImageUrl(offer) {
  if (offer?.image_url) return offer.image_url;
  if (offer?.card_id) {
    return `https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/${offer.card_id}.jpg`;
  }
  return CARD_IMAGE_FALLBACK;
}

function formatModeLabel(value) {
  return String(value || "slot").replace(/_/g, " ");
}

function formatSlotSubtitle(slot) {
  const pieces = [];

  if (slot?.starting_choices != null) {
    pieces.push(`${slot.starting_choices} starting choices`);
  }

  if (slot?.reroll_count != null) {
    pieces.push(`${slot.reroll_count} rerolls`);
  }

  if (slot?.shard_cost_per_extra != null && Number(slot.shard_cost_per_extra) > 0) {
    pieces.push(`${slot.shard_cost_per_extra} shards for extras`);
  }

  return pieces.join(" | ") || "Machine rules loaded from live slot config.";
}

function getSlotModeCopy(mode) {
  switch (mode) {
    case "picker":
      return {
        headline: "Category lock",
        body: "Pick the lane first, then spin for a cleaner pool inside that category.",
      };
    case "boosted":
      return {
        headline: "Boosted run",
        body: "Load boosts before the pull to buy extra cards and raise the minimum rarity floor.",
      };
    case "regen":
      return {
        headline: "Regen bank",
        body: "Let the machine reveal several outcomes, then keep only the cards worth locking in.",
      };
    default:
      return {
        headline: "Classic pull",
        body: "Spin the reels, let the machine settle, and stop on the card you want to take.",
      };
  }
}

function getOfferKey(offer, index) {
  return [
    offer?.card_id ?? "card",
    offer?.rarity_id ?? offer?.rarity_name ?? "base",
    index,
  ].join("-");
}

function buildReelSymbols(offers, finalOffer, reelIndex) {
  const source = Array.isArray(offers) ? offers.filter(Boolean) : [];

  if (!finalOffer || source.length === 0) {
    return [];
  }

  const loops = source.length === 1 ? 8 : 5;
  const symbols = [];

  for (let cycle = 0; cycle < loops; cycle += 1) {
    for (let offset = 0; offset < source.length; offset += 1) {
      symbols.push(source[(reelIndex + offset + cycle) % source.length]);
    }
  }

  symbols.push(finalOffer);
  return symbols;
}

function getRaisedRarity(cardRarities, baseRarityId, boostCount) {
  const rows = Array.isArray(cardRarities) ? cardRarities : [];
  if (!rows.length) return null;

  const sorted = [...rows].sort(
    (left, right) =>
      Number(left.sort_order ?? 9999) - Number(right.sort_order ?? 9999) ||
      String(left.name || "").localeCompare(String(right.name || ""))
  );

  const baseIndex = Math.max(
    sorted.findIndex((row) => row.id === baseRarityId),
    0
  );
  const targetIndex = Math.min(baseIndex + Math.max(Number(boostCount || 0), 0), sorted.length - 1);
  return sorted[targetIndex] || null;
}

function getHoverPreviewPosition(target) {
  const rect = target.getBoundingClientRect();
  const tooltipWidth = 340;
  const tooltipHeight = 260;
  const showRight = rect.right + tooltipWidth + 24 < window.innerWidth;
  return {
    x: showRight ? rect.right + 14 : Math.max(12, rect.left - tooltipWidth - 14),
    y: Math.min(window.innerHeight - tooltipHeight - 12, Math.max(12, rect.top - 8)),
  };
}

function getFeaturePhaseOptionLabel(option) {
  switch (String(option || "")) {
    case "monster":
      return "Monster";
    case "spell":
      return "Spell";
    case "trap":
      return "Trap";
    case "extra":
      return "Extra Deck";
    case "random_promo_box_key":
      return "Random Promo Box Key";
    case "box_open":
      return "Box Open";
    default:
      return "Unknown";
  }
}

function formatFeaturePhaseTurnSummary(turn) {
  const payload = turn?.resolved_payload || {};
  const choiceOption = String(turn?.choice_option || "");

  if (!choiceOption) return "Waiting to choose";

  if (
    choiceOption === "monster" ||
    choiceOption === "spell" ||
    choiceOption === "trap" ||
    choiceOption === "extra"
  ) {
    const claimedCard = payload?.feature_slot_claim?.claimed_offer?.card_name;
    if (claimedCard) {
      return `Claimed ${claimedCard} from ${getFeaturePhaseOptionLabel(choiceOption)}`;
    }
    return `Picked ${getFeaturePhaseOptionLabel(choiceOption)} reward`;
  }

  if (choiceOption === "random_promo_box_key") {
    return "Received 1 Random Promo Box Key";
  }

  if (choiceOption === "box_open") {
    return `Opened ${payload?.main_open_result?.container_name || "a box"}`;
  }

  return getFeaturePhaseOptionLabel(choiceOption);
}

function FeaturePhaseStatusPanel({ featurePhaseState }) {
  const turns = Array.isArray(featurePhaseState?.turns) ? featurePhaseState.turns : [];

  return (
    <section className="feature-phase-status-panel">
      <div className="feature-phase-status-header">
        <div>
          <div className="feature-slots-kicker">PHASE 4</div>
          <h2 className="feature-phase-title">Feature Phase</h2>
          <p className="feature-phase-copy">
            Resolve the round winner order, claim each Feature reward, then the
            series will move into Draft Phase automatically.
          </p>
        </div>

        <div className="feature-phase-status-pills">
          <div className="feature-phase-status-pill">
            <span>Variant</span>
            <strong>{featurePhaseState?.phase_variant === "x2" ? "X-2" : "X-1"}</strong>
          </div>
          <div className="feature-phase-status-pill">
            <span>Current Turn</span>
            <strong>
              {featurePhaseState?.current_turn_order
                ? `#${featurePhaseState.current_turn_order}`
                : "Complete"}
            </strong>
          </div>
        </div>
      </div>

      <div className="feature-phase-turn-list">
        {turns.map((turn) => (
          <article
            key={`${turn.user_id}-${turn.turn_order}`}
            className={`feature-phase-turn-card ${
              turn.is_current_turn ? "is-current" : ""
            } ${turn.completed_at ? "is-complete" : ""}`}
          >
            <div className="feature-phase-turn-top">
              <div className="feature-phase-turn-player">
                <img
                  src={turn.avatar || CARD_IMAGE_FALLBACK}
                  alt={turn.username || "Player"}
                  className="feature-phase-turn-avatar"
                  onError={(event) => {
                    event.currentTarget.src = CARD_IMAGE_FALLBACK;
                  }}
                />
                <div>
                  <strong>{turn.username || "Player"}</strong>
                  <span>
                    Turn #{turn.turn_order}
                    {turn.last_round_placement
                      ? ` | Last Round #${turn.last_round_placement}`
                      : ""}
                  </span>
                </div>
              </div>

              <div className="feature-phase-turn-state">
                {turn.completed_at
                  ? "Complete"
                  : turn.is_current_turn
                    ? "Current Turn"
                    : "Waiting"}
              </div>
            </div>

            <p className="feature-phase-turn-summary">
              {formatFeaturePhaseTurnSummary(turn)}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function FeatureSlotsPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();
  const { state: progressionState, refresh: refreshProgression } = useProgression();
  const spinTimeoutsRef = useRef([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const [activeSeries, setActiveSeries] = useState(null);
  const [slotState, setSlotState] = useState(null);
  const [cardRarities, setCardRarities] = useState([]);
  const [players, setPlayers] = useState([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [selectedAdminSlotId, setSelectedAdminSlotId] = useState("");

  const [selectedSlot, setSelectedSlot] = useState(null);
  const [machineState, setMachineState] = useState(null);
  const [machineBusy, setMachineBusy] = useState(false);
  const [machineError, setMachineError] = useState("");
  const [spinningOfferIndexes, setSpinningOfferIndexes] = useState([]);
  const [revealedOfferIndexes, setRevealedOfferIndexes] = useState([]);

  const [pickerCategory, setPickerCategory] = useState("monster");
  const [cardAmountBoosts, setCardAmountBoosts] = useState(0);
  const [rarityBoosts, setRarityBoosts] = useState(0);
  const [regenRevealCount, setRegenRevealCount] = useState(1);
  const [selectedRegenIndexes, setSelectedRegenIndexes] = useState([]);
  const [hoverPreview, setHoverPreview] = useState(null);
  const [hoverCardDetailsById, setHoverCardDetailsById] = useState({});
  const [featurePhaseState, setFeaturePhaseState] = useState(null);
  const [featurePhaseBusy, setFeaturePhaseBusy] = useState(false);
  const [selectedFeatureChoiceOption, setSelectedFeatureChoiceOption] = useState("");
  const [selectedFeatureMainBoxId, setSelectedFeatureMainBoxId] = useState("");
  const [selectedBonusCollectorsBoxId, setSelectedBonusCollectorsBoxId] = useState("");
  const [selectedBonusPromoBoxId, setSelectedBonusPromoBoxId] = useState("");

  const canViewPage =
    user?.role === "Admin+" || user?.role === "Admin" || user?.role === "Duelist";
  const isSeriesAdmin = user?.role === "Admin+" || user?.role === "Admin";
  const isFeaturePhaseActive =
    Number(progressionState?.roundNumber || 0) > 0 &&
    String(progressionState?.currentPhase || "").toLowerCase() === "feature";

  const slotCards = useMemo(
    () => (Array.isArray(slotState?.slots) ? slotState.slots : []),
    [slotState]
  );
  const modalSession = machineState?.open_session || null;
  const modalOffers = modalSession?.offers || [];
  const modalMode = machineState?.slot_mode || modalSession?.slot_mode || "drafted";
  const modalModeCopy = useMemo(() => getSlotModeCopy(modalMode), [modalMode]);

  async function getHoverCardDetails(cardId, fallbackCard = null) {
    if (!cardId) return fallbackCard;

    if (hoverCardDetailsById[cardId]) {
      return hoverCardDetailsById[cardId];
    }

    const { data, error } = await supabase
      .from("cards")
      .select("id, name, desc, image_url")
      .eq("id", cardId)
      .maybeSingle();

    if (error) throw error;

    const nextCard = data || fallbackCard;
    if (nextCard) {
      setHoverCardDetailsById((current) => ({
        ...current,
        [cardId]: nextCard,
      }));
    }

    return nextCard;
  }

  async function handleShowRewardHover(card, target) {
    if (!card || !target) return;

    try {
      const cardDetails = await getHoverCardDetails(card.card_id || card.id, {
        id: card.card_id || card.id || null,
        name: card.card_name || card.name || "Unknown Card",
        desc: card.desc || "",
        image_url: card.image_url || "",
      });
      const position = getHoverPreviewPosition(target);
      setHoverPreview({
        card: cardDetails,
        lines: [
          `Rarity: ${card.rarity_name || "Base"}`,
          `Mode: ${formatModeLabel(modalMode)}`,
        ],
        ...position,
      });
    } catch (error) {
      console.warn("Failed to load slot reward hover details:", error);
    }
  }

  function handleHideRewardHover() {
    setHoverPreview(null);
  }
  const reelStrips = useMemo(
    () => modalOffers.map((offer, index) => buildReelSymbols(modalOffers, offer, index)),
    [modalOffers]
  );
  const modalSessionSignature = useMemo(
    () =>
      JSON.stringify({
        slotId: selectedSlot?.feature_slot_id || selectedSlot?.id || "",
        mode: modalMode,
        offers: modalOffers.map((offer, index) => ({
          key: getOfferKey(offer, index),
          name: offer?.card_name || "",
        })),
      }),
    [modalMode, modalOffers, selectedSlot]
  );
  const isMachineSpinning = spinningOfferIndexes.length > 0;
  const regenRefundEstimate = Math.max(
    (Math.max(Number(modalSession?.reveal_count || regenRevealCount), 1) - 1 -
      Math.max(selectedRegenIndexes.length - 1, 0)) *
      5,
    0
  );
  const boostedPreviewFloor = useMemo(
    () =>
      getRaisedRarity(cardRarities, selectedSlot?.min_rarity_floor || null, rarityBoosts),
    [cardRarities, rarityBoosts, selectedSlot]
  );
  const featurePhaseTurns = useMemo(
    () => (Array.isArray(featurePhaseState?.turns) ? featurePhaseState.turns : []),
    [featurePhaseState]
  );
  const featurePhaseAvailableOptions = useMemo(
    () => (Array.isArray(featurePhaseState?.available_options) ? featurePhaseState.available_options : []),
    [featurePhaseState]
  );
  const featurePhaseAvailableMainBoxes = useMemo(
    () =>
      Array.isArray(featurePhaseState?.available_main_boxes)
        ? featurePhaseState.available_main_boxes
        : [],
    [featurePhaseState]
  );
  const bonusCollectorsBoxes = useMemo(
    () =>
      Array.isArray(featurePhaseState?.bonus_collectors_boxes)
        ? featurePhaseState.bonus_collectors_boxes
        : [],
    [featurePhaseState]
  );
  const bonusPromoBoxes = useMemo(
    () =>
      Array.isArray(featurePhaseState?.bonus_promo_boxes)
        ? featurePhaseState.bonus_promo_boxes
        : [],
    [featurePhaseState]
  );

  async function loadPage(currentUser) {
    if (!currentUser?.id) return;

    setLoading(true);
    setErrorMessage("");

    try {
      const { data: currentSeries, error: seriesError } = await supabase
        .from("game_series")
        .select("id, name")
        .eq("is_current", true)
        .maybeSingle();

      if (seriesError) throw seriesError;
      if (!currentSeries?.id) throw new Error("No active series found.");

      setActiveSeries(currentSeries);

      const requests = [
        supabase.rpc("get_my_feature_slot_state", {
          p_series_id: currentSeries.id,
        }),
        supabase.rpc("get_current_feature_phase_state", {
          p_series_id: currentSeries.id,
        }),
        supabase
          .from("card_rarities")
          .select("id, code, name, sort_order")
          .order("sort_order", { ascending: true }),
      ];

      if (isSeriesAdmin) {
        requests.push(
          supabase
            .from("series_players_view")
            .select("user_id, username")
            .eq("series_id", currentSeries.id)
            .order("username", { ascending: true })
        );
      }

      const results = await Promise.all(requests);
      const slotResponse = results[0];
      const featurePhaseResponse = results[1];
      const rarityResponse = results[2];

      if (slotResponse.error) throw slotResponse.error;
      if (featurePhaseResponse.error) throw featurePhaseResponse.error;
      if (rarityResponse.error) throw rarityResponse.error;

      const nextSlotState = slotResponse.data || null;
      const nextSlots = nextSlotState?.slots || [];
      setFeaturePhaseState(featurePhaseResponse.data || null);
      setCardRarities(rarityResponse.data || []);

      setSlotState(nextSlotState);

      if (isSeriesAdmin) {
        const playerResponse = results[3];
        if (playerResponse?.error) throw playerResponse.error;

        const nextPlayers = playerResponse?.data || [];
        setPlayers(nextPlayers);

        if (!selectedPlayerId && nextPlayers.length > 0) {
          setSelectedPlayerId(nextPlayers[0].user_id);
        }

        if (!selectedAdminSlotId && nextSlots.length > 0) {
          setSelectedAdminSlotId(getSlotId(nextSlots[0]));
        }
      } else {
        setPlayers([]);
      }
    } catch (error) {
      console.error("Failed to load Feature Slots page:", error);
      setErrorMessage(error.message || "Failed to load Feature Slots.");
      setSlotState(null);
      setFeaturePhaseState(null);
      setPlayers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && user) {
      loadPage(user);
    }
  }, [
    authLoading,
    user,
    isSeriesAdmin,
    progressionState?.currentPhase,
    progressionState?.roundNumber,
    progressionState?.roundStep,
  ]);

  useEffect(() => {
    if (!isSeriesAdmin) {
      setSelectedPlayerId("");
      setSelectedAdminSlotId("");
      return;
    }

    if (players.length === 0) {
      setSelectedPlayerId("");
    } else if (!players.some((player) => player.user_id === selectedPlayerId)) {
      setSelectedPlayerId(players[0].user_id);
    }

    if (slotCards.length === 0) {
      setSelectedAdminSlotId("");
    } else if (!slotCards.some((slot) => getSlotId(slot) === selectedAdminSlotId)) {
      setSelectedAdminSlotId(getSlotId(slotCards[0]));
    }
  }, [isSeriesAdmin, players, selectedPlayerId, selectedAdminSlotId, slotCards]);

  useEffect(() => {
    if (!featurePhaseState?.active || !featurePhaseState?.is_my_turn) {
      setSelectedFeatureChoiceOption("");
      setSelectedFeatureMainBoxId("");
      setSelectedBonusCollectorsBoxId("");
      setSelectedBonusPromoBoxId("");
      return;
    }

    if (
      featurePhaseState.phase_variant === "x1" &&
      !featurePhaseState.pending_reward_session &&
      featurePhaseAvailableOptions.length > 0 &&
      !featurePhaseAvailableOptions.some(
        (option) => String(option.choice_option || "") === selectedFeatureChoiceOption
      )
    ) {
      setSelectedFeatureChoiceOption(
        String(featurePhaseAvailableOptions[0]?.choice_option || "")
      );
    }

    if (
      featurePhaseState.phase_variant === "x2" &&
      featurePhaseAvailableMainBoxes.length > 0 &&
      !featurePhaseAvailableMainBoxes.some(
        (box) => String(box.id || "") === selectedFeatureMainBoxId
      )
    ) {
      setSelectedFeatureMainBoxId(String(featurePhaseAvailableMainBoxes[0]?.id || ""));
    }

    if (
      featurePhaseState.is_special_round &&
      bonusCollectorsBoxes.length > 0 &&
      !bonusCollectorsBoxes.some((box) => String(box.id || "") === selectedBonusCollectorsBoxId)
    ) {
      setSelectedBonusCollectorsBoxId(String(bonusCollectorsBoxes[0]?.id || ""));
    }

    if (
      featurePhaseState.is_special_round &&
      bonusPromoBoxes.length > 0 &&
      !bonusPromoBoxes.some((box) => String(box.id || "") === selectedBonusPromoBoxId)
    ) {
      setSelectedBonusPromoBoxId(String(bonusPromoBoxes[0]?.id || ""));
    }
  }, [
    bonusCollectorsBoxes,
    bonusPromoBoxes,
    featurePhaseAvailableMainBoxes,
    featurePhaseAvailableOptions,
    featurePhaseState,
    selectedBonusCollectorsBoxId,
    selectedBonusPromoBoxId,
    selectedFeatureChoiceOption,
    selectedFeatureMainBoxId,
  ]);

  useEffect(() => {
    const pendingSlotId = featurePhaseState?.pending_reward_session?.feature_slot_id;
    if (!featurePhaseState?.active || !pendingSlotId || !slotCards.length) return;
    if (getSlotId(selectedSlot) === pendingSlotId) return;

    const pendingSlot = slotCards.find((slot) => getSlotId(slot) === pendingSlotId);
    if (!pendingSlot) return;

    let cancelled = false;
    (async () => {
      if (!cancelled) {
        await openMachineModal(pendingSlot);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [featurePhaseState, selectedSlot, slotCards]);

  useEffect(() => {
    spinTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    spinTimeoutsRef.current = [];

    if (!selectedSlot || !modalSession || modalOffers.length === 0) {
      setSpinningOfferIndexes([]);
      setRevealedOfferIndexes([]);
      return undefined;
    }

    if (modalMode === "regen") {
      setSelectedRegenIndexes([]);
    }

    const indexes = modalOffers.map((_, index) => index);
    setSpinningOfferIndexes(indexes);
    setRevealedOfferIndexes([]);

    indexes.forEach((index, order) => {
      const timeoutId = window.setTimeout(() => {
        setSpinningOfferIndexes((current) => current.filter((value) => value !== index));
        setRevealedOfferIndexes((current) =>
          current.includes(index) ? current : [...current, index]
        );
      }, 1100 + order * 280);

      spinTimeoutsRef.current.push(timeoutId);
    });

    return () => {
      spinTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      spinTimeoutsRef.current = [];
    };
  }, [modalMode, modalOffers.length, modalSession, modalSessionSignature, selectedSlot]);

  async function loadMachineState(slotId) {
    if (!activeSeries?.id || !slotId) return;

    setMachineBusy(true);
    setMachineError("");

    try {
      const { data, error } = await supabase.rpc("get_feature_slot_machine_state", {
        p_series_id: activeSeries.id,
        p_feature_slot_id: slotId,
      });

      if (error) throw error;

      setMachineState(data || null);

      if ((data?.slot_mode || data?.open_session?.slot_mode) === "picker") {
        setPickerCategory(data?.open_session?.selected_category || "monster");
      }

      if ((data?.slot_mode || data?.open_session?.slot_mode) === "boosted") {
        setCardAmountBoosts(Number(data?.open_session?.card_amount_boosts || 0));
        setRarityBoosts(Number(data?.open_session?.rarity_boosts || 0));
      }

      if ((data?.slot_mode || data?.open_session?.slot_mode) === "regen") {
        setRegenRevealCount(Number(data?.open_session?.reveal_count || 1));
      }
    } catch (error) {
      console.error("Failed to load machine state:", error);
      setMachineError(error.message || "Failed to load this machine.");
      setMachineState(null);
    } finally {
      setMachineBusy(false);
    }
  }

  function closeMachineModal() {
    setSelectedSlot(null);
    setMachineState(null);
    setMachineError("");
    setSpinningOfferIndexes([]);
    setRevealedOfferIndexes([]);
  }

  async function openMachineModal(slot) {
    setSelectedSlot(slot);
    setSelectedRegenIndexes([]);
    setCardAmountBoosts(0);
    setRarityBoosts(0);
    setRegenRevealCount(1);
    setPickerCategory("monster");
    await loadMachineState(getSlotId(slot));
  }

  async function mutateMachine(runMutation) {
    try {
      setMachineBusy(true);
      setMachineError("");
      await runMutation();
      await loadPage(user);
      await refreshProgression();
      if (getSlotId(selectedSlot)) {
        await loadMachineState(getSlotId(selectedSlot));
      }
    } catch (error) {
      console.error("Feature Slot action failed:", error);
      setMachineError(error.message || "Feature Slot action failed.");
    } finally {
      setMachineBusy(false);
    }
  }

  async function resolveFeaturePhaseChoice(payload) {
    if (!activeSeries?.id || !featurePhaseState?.active) return;

    setFeaturePhaseBusy(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const { error } = await supabase.rpc("resolve_current_feature_phase_choice", {
        p_series_id: activeSeries.id,
        p_payload: payload,
      });

      if (error) throw error;

      await loadPage(user);
      await refreshProgression();
    } catch (error) {
      console.error("Failed to resolve Feature Phase choice:", error);
      setErrorMessage(error.message || "Failed to resolve Feature Phase choice.");
    } finally {
      setFeaturePhaseBusy(false);
    }
  }

  async function handleOpenMachine() {
    if (!getSlotId(selectedSlot) || !activeSeries?.id) return;

    await mutateMachine(async () => {
      const { error } = await supabase.rpc("open_feature_slot_machine", {
        p_series_id: activeSeries.id,
        p_feature_slot_id: getSlotId(selectedSlot),
        p_selected_category: pickerCategory,
        p_card_amount_boosts: cardAmountBoosts,
        p_rarity_boosts: rarityBoosts,
        p_reveal_count: regenRevealCount,
      });

      if (error) throw error;
    });
  }

  async function handleReroll() {
    if (!getSlotId(selectedSlot) || !activeSeries?.id) return;

    await mutateMachine(async () => {
      const { error } = await supabase.rpc("reroll_feature_slot_machine", {
        p_series_id: activeSeries.id,
        p_feature_slot_id: getSlotId(selectedSlot),
      });

      if (error) throw error;
    });
  }

  async function handleClaim(index) {
    if (!getSlotId(selectedSlot) || !activeSeries?.id) return;

    await mutateMachine(async () => {
      const { error } = await supabase.rpc("claim_feature_slot_machine_card", {
        p_series_id: activeSeries.id,
        p_feature_slot_id: getSlotId(selectedSlot),
        p_offer_index: index,
      });

      if (error) throw error;
    });
  }

  async function handleFinalizeRegen() {
    if (!getSlotId(selectedSlot) || !activeSeries?.id) return;

    await mutateMachine(async () => {
      const { error } = await supabase.rpc("finalize_regen_feature_slot_machine", {
        p_series_id: activeSeries.id,
        p_feature_slot_id: getSlotId(selectedSlot),
        p_selected_offer_indexes: selectedRegenIndexes,
      });

      if (error) throw error;
    });
  }

  async function handleResetSingleSlot(slotId) {
    if (!activeSeries?.id || !selectedPlayerId || !slotId) return;

    setBusy(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const { error } = await supabase.rpc("reset_player_feature_slot_usage", {
        p_series_id: activeSeries.id,
        p_target_user_id: selectedPlayerId,
        p_feature_slot_id: slotId,
      });

      if (error) throw error;

      setStatusMessage("Feature Slot state reset for the selected player.");
      await loadPage(user);
    } catch (error) {
      console.error("Failed to reset feature slot:", error);
      setErrorMessage(error.message || "Failed to reset Feature Slot.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPlayerAll() {
    if (!activeSeries?.id || !selectedPlayerId) return;

    setBusy(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const { error } = await supabase.rpc("reset_player_feature_slot_usage", {
        p_series_id: activeSeries.id,
        p_target_user_id: selectedPlayerId,
      });

      if (error) throw error;

      setStatusMessage("All Feature Slot state reset for the selected player.");
      await loadPage(user);
    } catch (error) {
      console.error("Failed to reset player feature slots:", error);
      setErrorMessage(error.message || "Failed to reset player Feature Slots.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetSeriesAll() {
    if (!activeSeries?.id) return;

    setBusy(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const { error } = await supabase.rpc("reset_series_feature_slot_usage", {
        p_series_id: activeSeries.id,
      });

      if (error) throw error;

      setStatusMessage("All Feature Slot state reset for the active series.");
      await loadPage(user);
    } catch (error) {
      console.error("Failed to reset series feature slots:", error);
      setErrorMessage(error.message || "Failed to reset series Feature Slots.");
    } finally {
      setBusy(false);
    }
  }

  function toggleRegenSelection(index) {
    setSelectedRegenIndexes((current) =>
      current.includes(index)
        ? current.filter((value) => value !== index)
        : [...current, index].sort((left, right) => left - right)
    );
  }

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (user.role === "Blocked") return <Navigate to="/" replace />;
  if (!canViewPage) return <Navigate to="/mode" replace />;

  return (
    <LauncherLayout>
      <div className="feature-slots-page">
        <div className="feature-slots-topbar">
          <div>
            <div className="feature-slots-kicker">PROGRESSION</div>
            <h1 className="feature-slots-title">Feature Slots</h1>
            <p className="feature-slots-subtitle">
              {isFeaturePhaseActive
                ? "Feature Phase is active. Follow the turn order, claim the assigned rewards, and the series will move into Draft automatically."
                : "Spend Feature Coins on animated machine pulls, reroll live reels, and claim only the cards worth keeping."}
            </p>
          </div>

          <div className="feature-slots-topbar-actions">
            <div className="feature-slots-wallet-card">
              <span className="feature-slots-wallet-label">Feature Coins</span>
              <span className="feature-slots-wallet-value">
                {Number(slotState?.feature_coins || 0)}
              </span>
            </div>

            <div className="feature-slots-wallet-card feature-slots-wallet-card-secondary">
              <span className="feature-slots-wallet-label">Shards</span>
              <span className="feature-slots-wallet-value">
                {Number(slotState?.shards || 0)}
              </span>
            </div>

            <button
              type="button"
              className="feature-slots-secondary-btn"
              onClick={() => navigate("/mode/progression")}
            >
              Back
            </button>
          </div>
        </div>

        <div className="feature-slots-status-row">
          <div className="feature-slots-chip">
            Active Series: {activeSeries?.name || "Unknown"}
          </div>
          {statusMessage ? <div className="feature-slots-success">{statusMessage}</div> : null}
          {errorMessage ? <div className="feature-slots-error">{errorMessage}</div> : null}
        </div>

        {loading ? (
          <div className="feature-slots-card feature-slots-empty">
            Loading Feature Slots...
          </div>
        ) : (
          <>
            {featurePhaseState?.active ? (
              <>
                <FeaturePhaseStatusPanel featurePhaseState={featurePhaseState} />

                <section className="feature-slots-card feature-phase-action-card">
                  <div className="feature-slots-kicker">
                    {featurePhaseState?.phase_variant === "x2" ? "X-2 FEATURE" : "X-1 FEATURE"}
                  </div>
                  <h2 className="feature-phase-title">
                    {featurePhaseState?.is_my_turn ? "Your Turn" : "Waiting For Turn"}
                  </h2>
                  <p className="feature-phase-copy">
                    {featurePhaseState?.phase_variant === "x2"
                      ? "Choose one unlocked Deck Box or Promo Box. Duplicate picks recycle only after the current pool is exhausted."
                      : "Choose one unique Feature reward this cycle. Category rewards open a free picker session; Random Promo Box Key grants the inventory item directly."}
                  </p>

                  {featurePhaseState?.is_special_round ? (
                    <div className="feature-phase-special-banner">
                      Special round active: after the main Feature reward, you also open 5
                      Collectors Boxes and 3 Promo Boxes of your choice.
                    </div>
                  ) : null}

                  {!featurePhaseState?.is_my_turn ? (
                    <div className="feature-slots-empty">
                      The current Feature reward turn belongs to another player. Your page
                      will update here when it reaches you.
                    </div>
                  ) : featurePhaseState?.pending_reward_session ? (
                    <div className="feature-phase-reward-session">
                      <div className="feature-slots-slot-meta-row">
                        <span>Open Reward Session</span>
                        <strong>
                          {getFeaturePhaseOptionLabel(featurePhaseState?.my_choice_option)}
                        </strong>
                      </div>
                      <p className="feature-phase-copy">
                        Finish the free picker reward in the machine modal. Claiming that
                        card completes your Feature Phase turn.
                      </p>
                      <div className="feature-slots-modal-actions">
                        <button
                          type="button"
                          className="feature-slots-primary-btn"
                          disabled={machineBusy}
                          onClick={() => {
                            const pendingSlot = slotCards.find(
                              (slot) =>
                                getSlotId(slot) ===
                                featurePhaseState?.pending_reward_session?.feature_slot_id
                            );
                            if (pendingSlot) {
                              openMachineModal(pendingSlot);
                            }
                          }}
                        >
                          Resume Reward Machine
                        </button>
                      </div>
                    </div>
                  ) : featurePhaseState?.phase_variant === "x1" ? (
                    <div className="feature-phase-choice-stack">
                      <div className="feature-phase-option-grid">
                        {featurePhaseAvailableOptions.map((option) => (
                          <button
                            key={option.choice_option}
                            type="button"
                            className={`feature-phase-option-card ${
                              selectedFeatureChoiceOption === option.choice_option
                                ? "is-selected"
                                : ""
                            }`}
                            onClick={() =>
                              setSelectedFeatureChoiceOption(
                                String(option.choice_option || "")
                              )
                            }
                          >
                            <strong>{option.label}</strong>
                            <span>{option.description}</span>
                          </button>
                        ))}
                      </div>

                      {featurePhaseState?.is_special_round ? (
                        <div className="feature-phase-bonus-grid">
                          <div className="feature-slots-field">
                            <label htmlFor="feature-phase-collectors-box">
                              Bonus Collectors Box
                            </label>
                            <select
                              id="feature-phase-collectors-box"
                              className="feature-slots-select"
                              value={selectedBonusCollectorsBoxId}
                              onChange={(event) =>
                                setSelectedBonusCollectorsBoxId(event.target.value)
                              }
                            >
                              <option value="">Choose a Collectors Box...</option>
                              {bonusCollectorsBoxes.map((box) => (
                                <option key={box.id} value={box.id}>
                                  {box.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="feature-slots-field">
                            <label htmlFor="feature-phase-promo-box">Bonus Promo Box</label>
                            <select
                              id="feature-phase-promo-box"
                              className="feature-slots-select"
                              value={selectedBonusPromoBoxId}
                              onChange={(event) =>
                                setSelectedBonusPromoBoxId(event.target.value)
                              }
                            >
                              <option value="">Choose a Promo Box...</option>
                              {bonusPromoBoxes.map((box) => (
                                <option key={box.id} value={box.id}>
                                  {box.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ) : null}

                      <div className="feature-slots-modal-actions">
                        <button
                          type="button"
                          className="feature-slots-primary-btn"
                          disabled={
                            featurePhaseBusy ||
                            !selectedFeatureChoiceOption ||
                            (featurePhaseState?.is_special_round &&
                              (!selectedBonusCollectorsBoxId || !selectedBonusPromoBoxId))
                          }
                          onClick={() =>
                            resolveFeaturePhaseChoice({
                              choice_option: selectedFeatureChoiceOption,
                              bonus_collectors_box_id:
                                selectedBonusCollectorsBoxId || null,
                              bonus_promo_box_id: selectedBonusPromoBoxId || null,
                            })
                          }
                        >
                          {featurePhaseBusy ? "Resolving..." : "Lock Feature Reward"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="feature-phase-choice-stack">
                      <div className="feature-phase-box-grid">
                        {featurePhaseAvailableMainBoxes.map((box) => (
                          <button
                            key={box.id}
                            type="button"
                            className={`feature-phase-box-card ${
                              selectedFeatureMainBoxId === box.id ? "is-selected" : ""
                            }`}
                            onClick={() => setSelectedFeatureMainBoxId(String(box.id || ""))}
                          >
                            <img
                              src={box.image_url || CARD_IMAGE_FALLBACK}
                              alt={box.name}
                              className="feature-phase-box-image"
                              onError={(event) => {
                                event.currentTarget.src = CARD_IMAGE_FALLBACK;
                              }}
                            />
                            <div className="feature-phase-box-copy">
                              <strong>{box.name}</strong>
                              <span>
                                {box.container_type_code === "deck_box"
                                  ? "Deck Box"
                                  : "Promo Box"}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>

                      {featurePhaseState?.is_special_round ? (
                        <div className="feature-phase-bonus-grid">
                          <div className="feature-slots-field">
                            <label htmlFor="feature-phase-collectors-box-x2">
                              Bonus Collectors Box
                            </label>
                            <select
                              id="feature-phase-collectors-box-x2"
                              className="feature-slots-select"
                              value={selectedBonusCollectorsBoxId}
                              onChange={(event) =>
                                setSelectedBonusCollectorsBoxId(event.target.value)
                              }
                            >
                              <option value="">Choose a Collectors Box...</option>
                              {bonusCollectorsBoxes.map((box) => (
                                <option key={box.id} value={box.id}>
                                  {box.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="feature-slots-field">
                            <label htmlFor="feature-phase-promo-box-x2">
                              Bonus Promo Box
                            </label>
                            <select
                              id="feature-phase-promo-box-x2"
                              className="feature-slots-select"
                              value={selectedBonusPromoBoxId}
                              onChange={(event) =>
                                setSelectedBonusPromoBoxId(event.target.value)
                              }
                            >
                              <option value="">Choose a Promo Box...</option>
                              {bonusPromoBoxes.map((box) => (
                                <option key={box.id} value={box.id}>
                                  {box.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ) : null}

                      <div className="feature-slots-modal-actions">
                        <button
                          type="button"
                          className="feature-slots-primary-btn"
                          disabled={
                            featurePhaseBusy ||
                            !selectedFeatureMainBoxId ||
                            (featurePhaseState?.is_special_round &&
                              (!selectedBonusCollectorsBoxId || !selectedBonusPromoBoxId))
                          }
                          onClick={() =>
                            resolveFeaturePhaseChoice({
                              container_id: selectedFeatureMainBoxId,
                              bonus_collectors_box_id:
                                selectedBonusCollectorsBoxId || null,
                              bonus_promo_box_id: selectedBonusPromoBoxId || null,
                            })
                          }
                        >
                          {featurePhaseBusy ? "Opening..." : "Resolve Feature Reward"}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              </>
            ) : (
              <div className="feature-slots-grid">
                {slotCards.length === 0 ? (
                  <div className="feature-slots-card feature-slots-empty">
                    No Feature Slot machines are configured for this series yet.
                  </div>
                ) : null}

                {slotCards.map((slot) => (
                  <article
                    key={getSlotId(slot) || slot.name}
                    className="feature-slots-card feature-slots-slot-card"
                  >
                    <div className="feature-slots-slot-top">
                      <div>
                        <div className="feature-slots-slot-type">
                          {formatModeLabel(slot.slot_mode || slot.slot_type || "slot")}
                        </div>
                        <h2 className="feature-slots-slot-name">{slot.name}</h2>
                      </div>

                      <div className="feature-slots-cost-shell">
                        <span className="feature-slots-cost-label">Next Cost</span>
                        <span className="feature-slots-cost-value">
                          {Number(slot.next_feature_coin_cost || 0)}
                        </span>
                      </div>
                    </div>

                    <div className="feature-slots-machine-preview" aria-hidden="true">
                      {IDLE_REEL_WORDS.map((word, index) => (
                        <div
                          key={`${getSlotId(slot) || slot.name}-${word}`}
                          className="feature-slots-machine-preview-window"
                        >
                          <span>
                            {index === 1
                              ? formatModeLabel(slot.slot_mode || slot.slot_type || "slot")
                              : word}
                          </span>
                        </div>
                      ))}
                    </div>

                    <p className="feature-slots-slot-description">
                      {slot.description || "No description available."}
                    </p>

                    <div className="feature-slots-slot-meta">
                      <div className="feature-slots-slot-meta-row">
                        <span>Current Spin Count</span>
                        <strong>{Number(slot.spin_count || 0)}</strong>
                      </div>

                      <div className="feature-slots-slot-meta-row">
                        <span>Rules</span>
                        <strong>{formatSlotSubtitle(slot)}</strong>
                      </div>

                      <div className="feature-slots-slot-meta-row">
                        <span>Status</span>
                        <strong>
                          {slot.open_session
                            ? "Session Open"
                            : slot.is_locked
                              ? "Locked"
                              : "Ready"}
                        </strong>
                      </div>
                    </div>

                    <div className="feature-slots-slot-actions">
                      <button
                        type="button"
                        className="feature-slots-primary-btn"
                        onClick={() => openMachineModal(slot)}
                      >
                        {slot.open_session ? "Resume Machine" : "Play Machine"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {isSeriesAdmin ? (
              <section className="feature-slots-card feature-slots-admin-card">
                <div className="feature-slots-kicker">ADMIN ONLY</div>
                <h2 className="feature-slots-admin-title">Machine Resets</h2>
                <p className="feature-slots-admin-copy">
                  Reset controls live here only so normal players never see machine cleanup
                  actions in their play flow.
                </p>

                <div className="feature-slots-admin-grid">
                  <div className="feature-slots-field">
                    <label htmlFor="feature-slot-player-select">Player</label>
                    <select
                      id="feature-slot-player-select"
                      className="feature-slots-select"
                      value={selectedPlayerId}
                      onChange={(event) => setSelectedPlayerId(event.target.value)}
                    >
                      <option value="">Choose a player...</option>
                      {players.map((player) => (
                        <option key={player.user_id} value={player.user_id}>
                          {player.username}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="feature-slots-field">
                    <label htmlFor="feature-slot-machine-select">Machine</label>
                    <select
                      id="feature-slot-machine-select"
                      className="feature-slots-select"
                      value={selectedAdminSlotId}
                      onChange={(event) => setSelectedAdminSlotId(event.target.value)}
                    >
                      <option value="">Choose a machine...</option>
                      {slotCards.map((slot) => (
                        <option key={getSlotId(slot) || slot.name} value={getSlotId(slot)}>
                          {slot.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="feature-slots-admin-actions">
                    <button
                      type="button"
                      className="feature-slots-secondary-btn"
                      disabled={busy || !selectedPlayerId || !selectedAdminSlotId}
                      onClick={() => handleResetSingleSlot(selectedAdminSlotId)}
                    >
                      Reset Selected Machine
                    </button>

                    <button
                      type="button"
                      className="feature-slots-secondary-btn"
                      disabled={busy || !selectedPlayerId}
                      onClick={handleResetPlayerAll}
                    >
                      Reset All 4 For Player
                    </button>

                    <button
                      type="button"
                      className="feature-slots-secondary-btn"
                      disabled={busy}
                      onClick={handleResetSeriesAll}
                    >
                      Reset Entire Series
                    </button>
                  </div>
                </div>
              </section>
            ) : null}
          </>
        )}

        {selectedSlot ? (
          <div className="feature-slots-modal-overlay" onClick={closeMachineModal}>
            <div className="feature-slots-modal" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="feature-slots-modal-close"
                onClick={closeMachineModal}
              >
                x
              </button>

              <div className="feature-slots-kicker">MACHINE</div>
              <h2 className="feature-slots-modal-title">{selectedSlot.name}</h2>
              <p className="feature-slots-modal-copy">
                {selectedSlot.description || "No machine description is configured yet."}
              </p>

              {machineError ? <div className="feature-slots-error">{machineError}</div> : null}

              {!machineState ? (
                <div className="feature-slots-empty">Loading machine...</div>
              ) : (
                <div className="feature-slots-machine-shell">
                  <div className="feature-slots-machine-marquee">
                    <div>
                      <div className="feature-slots-machine-marquee-label">
                        {modalModeCopy.headline}
                      </div>
                      <strong>{formatModeLabel(modalMode)} machine online</strong>
                    </div>

                    <div className="feature-slots-machine-lights" aria-hidden="true">
                      {Array.from({ length: 8 }, (_, index) => (
                        <span key={`light-${index}`} />
                      ))}
                    </div>
                  </div>

                  <div className="feature-slots-machine-stage">
                    <div className="feature-slots-reel-bank">
                      {modalSession ? (
                        modalOffers.map((offer, index) => {
                          const isReelSpinning = spinningOfferIndexes.includes(index);
                          const isReelRevealed = revealedOfferIndexes.includes(index);
                          const isSelectedForRegen = selectedRegenIndexes.includes(index);

                          return (
                            <article
                              key={getOfferKey(offer, index)}
                              className={`feature-slots-reel ${
                                isReelSpinning ? "is-spinning" : ""
                              } ${isReelRevealed ? "is-revealed" : ""}`}
                              onMouseEnter={
                                isReelRevealed
                                  ? (event) => handleShowRewardHover(offer, event.currentTarget)
                                  : undefined
                              }
                              onMouseLeave={isReelRevealed ? handleHideRewardHover : undefined}
                            >
                              <div className="feature-slots-reel-window">
                                {isReelSpinning ? (
                                  <div
                                    className="feature-slots-reel-strip"
                                    style={{ "--spin-duration": `${1.15 + index * 0.2}s` }}
                                  >
                                    {reelStrips[index].map((symbol, symbolIndex) => (
                                      <div
                                        key={`${getOfferKey(symbol, symbolIndex)}-strip`}
                                        className="feature-slots-reel-symbol"
                                      >
                                        <img
                                          src={buildCardImageUrl(symbol)}
                                          alt={symbol.card_name}
                                          className="feature-slots-reel-image"
                                          onError={(event) => {
                                            event.currentTarget.src = CARD_IMAGE_FALLBACK;
                                          }}
                                        />
                                        <div className="feature-slots-reel-symbol-copy">
                                          <strong>{symbol.card_name}</strong>
                                          <span>{symbol.rarity_name || "Base"}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="feature-slots-reel-symbol feature-slots-reel-symbol-final">
                                    <img
                                      src={buildCardImageUrl(offer)}
                                      alt={offer.card_name}
                                      className="feature-slots-reel-image"
                                      onError={(event) => {
                                        event.currentTarget.src = CARD_IMAGE_FALLBACK;
                                      }}
                                    />
                                    <div className="feature-slots-reel-symbol-copy">
                                      <strong>{offer.card_name}</strong>
                                      <span>{offer.rarity_name || "Base"}</span>
                                    </div>
                                  </div>
                                )}

                                <div className="feature-slots-reel-glass" />
                              </div>

                              <div className="feature-slots-reel-copy">
                                <strong>
                                  {isReelRevealed ? offer.card_name : "Reel spinning..."}
                                </strong>
                                <span>
                                  {isReelRevealed
                                    ? offer.rarity_name || "Base"
                                    : "Waiting for the stop"}
                                </span>
                              </div>

                              {modalMode === "regen" ? (
                                <button
                                  type="button"
                                  className={`feature-slots-secondary-btn ${
                                    isSelectedForRegen ? "is-selected" : ""
                                  }`}
                                  disabled={!isReelRevealed || isMachineSpinning || machineBusy}
                                  onClick={() => toggleRegenSelection(index)}
                                >
                                  {isSelectedForRegen ? "Card Locked In" : "Keep This Card"}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="feature-slots-primary-btn"
                                  disabled={!isReelRevealed || isMachineSpinning || machineBusy}
                                  onClick={() => handleClaim(index)}
                                >
                                  Take Card
                                </button>
                              )}
                            </article>
                          );
                        })
                      ) : (
                        IDLE_REEL_WORDS.map((word, index) => (
                          <article key={`idle-${word}`} className="feature-slots-reel is-idle">
                            <div className="feature-slots-reel-window">
                              <div className="feature-slots-reel-placeholder">{word}</div>
                              <div className="feature-slots-reel-glass" />
                            </div>
                            <div className="feature-slots-reel-copy">
                              <strong>{index === 1 ? formatModeLabel(modalMode) : "Ready"}</strong>
                              <span>Load settings and pull the lever</span>
                            </div>
                          </article>
                        ))
                      )}
                    </div>

                    <aside className="feature-slots-machine-sidecar">
                      <div className="feature-slots-modal-meta">
                        <div className="feature-slots-slot-meta-row">
                          <span>Next Feature Coin Cost</span>
                          <strong>{Number(machineState.next_feature_coin_cost || 0)}</strong>
                        </div>

                        <div className="feature-slots-slot-meta-row">
                          <span>Mode</span>
                          <strong>{formatModeLabel(modalMode)}</strong>
                        </div>

                        <div className="feature-slots-slot-meta-row">
                          <span>Wallet</span>
                          <strong>
                            {Number(machineState.feature_coins || 0)} FC /{" "}
                            {Number(machineState.shards || 0)} Shards
                          </strong>
                        </div>

                        {modalMode === "boosted" ||
                        machineState?.min_rarity_floor_name ||
                        modalSession?.minimum_rarity_name ? (
                          <div className="feature-slots-slot-meta-row">
                            <span>Minimum Rarity</span>
                            <strong>
                              {modalSession?.minimum_rarity_name ||
                                boostedPreviewFloor?.name ||
                                machineState?.min_rarity_floor_name ||
                                "Base"}
                            </strong>
                          </div>
                        ) : null}

                        {modalSession?.rerolls_remaining > 0 ? (
                          <div className="feature-slots-slot-meta-row">
                            <span>Rerolls Remaining</span>
                            <strong>{Number(modalSession.rerolls_remaining || 0)}</strong>
                          </div>
                        ) : null}
                      </div>

                      <div className="feature-slots-machine-story">
                        <span className="feature-slots-machine-story-label">
                          {modalModeCopy.headline}
                        </span>
                        <p>{modalModeCopy.body}</p>
                      </div>

                      {!modalSession ? (
                        <div className="feature-slots-flow-stack">
                          {modalMode === "picker" ? (
                            <div className="feature-slots-field">
                              <label htmlFor="feature-slot-picker-category">Category</label>
                              <select
                                id="feature-slot-picker-category"
                                className="feature-slots-select"
                                value={pickerCategory}
                                onChange={(event) => setPickerCategory(event.target.value)}
                              >
                                <option value="monster">Monster</option>
                                <option value="spell">Spell</option>
                                <option value="trap">Trap</option>
                                <option value="extra">Extra Deck</option>
                              </select>
                            </div>
                          ) : null}

                          {modalMode === "boosted" ? (
                            <div className="feature-slots-boost-grid">
                              <div className="feature-slots-field">
                                <label htmlFor="feature-slot-card-boost">
                                  Card Amount Boosts
                                </label>
                                <input
                                  id="feature-slot-card-boost"
                                  type="number"
                                  min="0"
                                  className="feature-slots-select"
                                  value={cardAmountBoosts}
                                  onChange={(event) =>
                                    setCardAmountBoosts(Number(event.target.value || 0))
                                  }
                                />
                              </div>

                              <div className="feature-slots-field">
                                <label htmlFor="feature-slot-rarity-boost">
                                  Minimum Rarity Boosts
                                </label>
                                <input
                                  id="feature-slot-rarity-boost"
                                  type="number"
                                  min="0"
                                  className="feature-slots-select"
                                  value={rarityBoosts}
                                  onChange={(event) =>
                                    setRarityBoosts(Number(event.target.value || 0))
                                  }
                                />
                              </div>
                            </div>
                          ) : null}

                          {modalMode === "boosted" ? (
                            <div className="feature-slots-slot-meta-row">
                              <span>Minimum Rarity Floor</span>
                              <strong>{boostedPreviewFloor?.name || "Base"}</strong>
                            </div>
                          ) : null}

                          {modalMode === "regen" ? (
                            <div className="feature-slots-field">
                              <label htmlFor="feature-slot-regen-count">Reveal Count</label>
                              <select
                                id="feature-slot-regen-count"
                                className="feature-slots-select"
                                value={regenRevealCount}
                                onChange={(event) => setRegenRevealCount(Number(event.target.value))}
                              >
                                {[1, 2, 3, 4].map((value) => (
                                  <option key={value} value={value}>
                                    {value}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}

                          <div className="feature-slots-modal-actions">
                            <button
                              type="button"
                              className="feature-slots-primary-btn"
                              disabled={machineBusy || machineState.is_locked}
                              onClick={handleOpenMachine}
                            >
                              {machineBusy ? "Starting..." : "Pull Lever"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="feature-slots-flow-stack">
                          <div className="feature-slots-slot-meta-row">
                            <span>Machine State</span>
                            <strong>
                              {isMachineSpinning
                                ? "Reels spinning"
                                : modalMode === "regen"
                                  ? "Make your keeps"
                                  : "Choose your stop"}
                            </strong>
                          </div>

                          {modalMode === "regen" ? (
                            <div className="feature-slots-slot-meta-row">
                              <span>Locked Picks</span>
                              <strong>
                                {selectedRegenIndexes.length} chosen /{" "}
                                {Math.max(Number(modalSession?.reveal_count || regenRevealCount), 1)}
                              </strong>
                            </div>
                          ) : null}

                          <div className="feature-slots-modal-actions">
                            {modalSession.rerolls_remaining > 0 ? (
                              <button
                                type="button"
                                className="feature-slots-secondary-btn"
                                disabled={machineBusy || isMachineSpinning}
                                onClick={handleReroll}
                              >
                                {machineBusy ? "Spinning..." : "Spin Again"}
                              </button>
                            ) : null}

                            {modalMode === "regen" ? (
                              <button
                                type="button"
                                className="feature-slots-primary-btn"
                                disabled={
                                  machineBusy ||
                                  isMachineSpinning ||
                                  selectedRegenIndexes.length === 0
                                }
                                onClick={handleFinalizeRegen}
                              >
                                {machineBusy
                                  ? "Finalizing..."
                                  : `Finalize Picks (${regenRefundEstimate} shard refund estimate)`}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </aside>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <BinderHoverTooltip
          preview={hoverPreview}
          buildCardImageUrl={buildCardImageUrl}
          CARD_IMAGE_FALLBACK={CARD_IMAGE_FALLBACK}
        />
      </div>
    </LauncherLayout>
  );
}

export default FeatureSlotsPage;
