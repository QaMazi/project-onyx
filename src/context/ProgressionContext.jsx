import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "../lib/supabase";
import { useUser } from "./UserContext";
import "./ProgressionContext.css";

const ProgressionContext = createContext(null);

function normalizeStripRows(rows) {
  return (rows || []).map((row) => ({
    userId: row.user_id,
    username: row.username || "Unknown Duelist",
    avatar: row.avatar || "",
    isReady: Boolean(row.is_ready),
    readyReason: row.ready_reason || "",
    phaseStatus: row.phase_status || "idle",
    duelingStatus: row.dueling_status || "idle",
    role: row.role || "duelist",
    starterClaimed: Boolean(row.starter_claimed),
    protectionRounds: Number(row.protection_rounds || 0),
  }));
}

function getPageAllowance(pageKey, state, user) {
  if (!state?.activeSeriesId) {
    return {
      allowed: true,
      reason: "",
      showBeginModal: false,
      showLobbyModal: false,
      showRoundZeroWaitingModal: false,
      showWaitingOverlay: false,
    };
  }

  const isAdmin = user?.role === "Admin+" || user?.role === "Admin";
  const roundNumber = Number(state.roundNumber || 0);
  const phase = String(state.currentPhase || "standby").toLowerCase();
  const duelStatus = String(state.duelingStatus || "idle").toLowerCase();
  const starterClaimed = Boolean(state.starterDeckClaimed);
  const everyoneStarterClaimed = Boolean(state.everyoneStarterClaimed);
  const isSeriesMember = Boolean(state.isSeriesMember);
  const isRoundZeroStandby = roundNumber === 0 && phase === "standby";

  if (phase === "lobby") {
    if (isAdmin) {
      return {
        allowed: true,
        reason: "",
        showBeginModal: false,
        showLobbyModal: false,
        showRoundZeroWaitingModal: false,
        showWaitingOverlay: false,
      };
    }

    const reason =
      "Series setup is still in Lobby. Wait for an admin to advance into Round 0.";

    return {
      allowed: pageKey === "progression",
      reason,
      showBeginModal: false,
      showLobbyModal: pageKey === "progression",
      showRoundZeroWaitingModal: false,
      showWaitingOverlay: pageKey !== "progression",
    };
  }

  if (isRoundZeroStandby) {
    const showRoundZeroFlow = !isAdmin || isSeriesMember;

    if (!starterClaimed) {
      return {
        allowed: isAdmin || pageKey === "progression",
        reason: "Begin the series to unlock progression systems.",
        showBeginModal: showRoundZeroFlow && pageKey === "progression",
        showLobbyModal: false,
        showRoundZeroWaitingModal: false,
        showWaitingOverlay: !isAdmin && pageKey !== "progression",
      };
    }

    return {
      allowed: isAdmin || pageKey === "progression",
      reason: everyoneStarterClaimed
        ? "Final Round 0 setup is finishing."
        : "Waiting for every player in the series to claim a starter deck.",
      showBeginModal: false,
      showLobbyModal: false,
      showRoundZeroWaitingModal: showRoundZeroFlow && pageKey === "progression",
      showWaitingOverlay: !isAdmin && pageKey !== "progression",
    };
  }

  if (isAdmin) {
    return {
      allowed: true,
      reason: "",
      showBeginModal: false,
      showLobbyModal: false,
      showRoundZeroWaitingModal: false,
      showWaitingOverlay: false,
    };
  }

  if (phase === "reward") {
    return {
      allowed: pageKey === "progression",
      reason: "Rewards are processing. You will unlock again when the next phase begins.",
      showBeginModal: false,
      showLobbyModal: false,
      showRoundZeroWaitingModal: false,
      showWaitingOverlay: pageKey !== "progression",
    };
  }

  if (phase === "deckbuilding") {
    const allowedPages = new Set([
      "progression",
      "deck",
      "cards",
      "banlist",
      "containers-db",
    ]);

    return {
      allowed: allowedPages.has(pageKey),
      reason: "This system is locked during Deckbuilding Phase.",
      showBeginModal: false,
      showLobbyModal: false,
      showRoundZeroWaitingModal: false,
      showWaitingOverlay: !allowedPages.has(pageKey),
    };
  }

  if (phase === "dueling") {
    if (duelStatus === "red" || duelStatus === "yellow") {
      return {
        allowed: pageKey === "progression",
        reason:
          duelStatus === "red"
            ? "You are the current active duel pair."
            : "You are locked until your duel state resolves.",
        showBeginModal: false,
        showLobbyModal: false,
        showRoundZeroWaitingModal: false,
        showWaitingOverlay: true,
      };
    }
  }

  return {
    allowed: true,
    reason: "",
    showBeginModal: false,
    showLobbyModal: false,
    showRoundZeroWaitingModal: false,
    showWaitingOverlay: false,
  };
}

function formatRewardChoiceOptionLabel(option) {
  const optionKind = String(option?.option_kind || "");

  if (optionKind === "shards") {
    return `${Number(option?.exact_quantity || 0)} Shards`;
  }

  if (optionKind === "feature_coins") {
    return `${Number(option?.exact_quantity || 0)} Feature Coins`;
  }

  if (optionKind === "specific_item") {
    return `${option?.item_name || "Unknown Item"} x${Number(option?.exact_quantity || 0)}`;
  }

  if (optionKind === "random_item") {
    const poolCount = Array.isArray(option?.pool_item_ids) ? option.pool_item_ids.length : 0;
    return poolCount
      ? `Random Item from Pool (${poolCount}) x${Number(option?.exact_quantity || 0)}`
      : `Random Eligible Item x${Number(option?.exact_quantity || 0)}`;
  }

  return "Unknown Choice";
}

function RewardNotificationModal({
  notification,
  pendingChoices,
  onClaimChoice,
  claimingChoiceId,
  actionError,
  onDismiss,
  dismissing,
}) {
  const [selectedChoices, setSelectedChoices] = useState({});

  useEffect(() => {
    setSelectedChoices({});
  }, [notification?.id, pendingChoices]);

  if (!notification) return null;

  const payload = notification.payload || {};
  const grants = payload.grants || [];
  const standings = payload.scoreboard || [];
  const currentStanding = standings.find(
    (row) => row.user_id === notification.user_id
  );
  const grantStatus = payload.grant_status || "complete";
  const unresolvedChoices = Array.isArray(pendingChoices) ? pendingChoices : [];
  const hasPendingChoices = unresolvedChoices.length > 0;

  function toggleChoiceOption(choiceEntryId, optionId, maxSelections) {
    setSelectedChoices((current) => {
      const existing = current[choiceEntryId] || [];
      if (existing.includes(optionId)) {
        return {
          ...current,
          [choiceEntryId]: existing.filter((value) => value !== optionId),
        };
      }

      if (existing.length >= maxSelections) {
        return current;
      }

      return {
        ...current,
        [choiceEntryId]: [...existing, optionId],
      };
    });
  }

  return (
    <div className="progression-global-modal-backdrop">
      <div
        className="progression-global-modal progression-reward-notice-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="progression-reward-notice-shell">
          <div className="progression-global-modal-kicker">ROUND REWARD</div>
          <h2 className="progression-global-modal-title">
            Round {payload.round_label || "Reward"}
          </h2>

          <div className="progression-reward-notice-scroll">
            <div className="progression-reward-notice-grid">
              <div className="progression-reward-notice-card">
                <div className="progression-reward-notice-label">Placement</div>
                <div className="progression-reward-notice-value">
                  {payload.placement ?? "-"}
                </div>
              </div>

              <div className="progression-reward-notice-card">
                <div className="progression-reward-notice-label">Points</div>
                <div className="progression-reward-notice-value">
                  {payload.points_awarded ?? "-"}
                </div>
              </div>

              <div className="progression-reward-notice-card">
                <div className="progression-reward-notice-label">Current Points</div>
                <div className="progression-reward-notice-value">
                  {currentStanding?.points ?? payload.current_points ?? "-"}
                </div>
              </div>
            </div>

            {grantStatus !== "complete" ? (
              <div className="progression-global-error">
                Rewards need an admin-side manual fix, but this is the reward package
                you were supposed to receive.
              </div>
            ) : null}

            {actionError ? (
              <div className="progression-global-error">{actionError}</div>
            ) : null}

            {hasPendingChoices ? (
              <section className="progression-reward-notice-section">
                <h3>Choice Rewards</h3>
                <div className="progression-reward-choice-stack">
                  {unresolvedChoices.map((choiceEntry) => {
                    const selectedOptionIds = selectedChoices[choiceEntry.id] || [];
                    const requiredSelections = Number(choiceEntry.choices_remaining || choiceEntry.choices_required || 1);
                    const optionSnapshots = Array.isArray(choiceEntry.option_snapshots)
                      ? choiceEntry.option_snapshots
                      : [];

                    return (
                      <article key={choiceEntry.id} className="progression-reward-choice-card">
                        <div className="progression-reward-choice-header">
                          <div>
                            <div className="progression-reward-notice-label">Choice Reward</div>
                            <strong>Pick {requiredSelections} option{requiredSelections === 1 ? "" : "s"}</strong>
                          </div>
                          <span>
                            {selectedOptionIds.length}/{requiredSelections} selected
                          </span>
                        </div>

                        <div className="progression-reward-choice-options">
                          {optionSnapshots.map((option) => {
                            const optionId = option?.id;
                            const isSelected = selectedOptionIds.includes(optionId);
                            return (
                              <button
                                key={optionId}
                                type="button"
                                className={`progression-reward-choice-option ${isSelected ? "is-selected" : ""}`}
                                onClick={() =>
                                  toggleChoiceOption(choiceEntry.id, optionId, requiredSelections)
                                }
                              >
                                <strong>{formatRewardChoiceOptionLabel(option)}</strong>
                              </button>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          className="progression-global-primary-btn"
                          disabled={
                            claimingChoiceId === choiceEntry.id ||
                            selectedOptionIds.length !== requiredSelections
                          }
                          onClick={() => onClaimChoice(choiceEntry.id, selectedOptionIds)}
                        >
                          {claimingChoiceId === choiceEntry.id
                            ? "Claiming..."
                            : `Confirm ${requiredSelections} Choice${requiredSelections === 1 ? "" : "s"}`}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section className="progression-reward-notice-section">
              <h3>Rewards</h3>
              {grants.length === 0 ? (
                <div className="progression-reward-notice-empty">
                  No direct rewards were attached to this round.
                </div>
              ) : (
                <div className="progression-reward-notice-list">
                  {grants.map((grant, index) => (
                    <div
                      key={`${notification.id}-grant-${index}`}
                      className="progression-reward-notice-row"
                    >
                      <span>{grant.label}</span>
                      <strong>{grant.value}</strong>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="progression-reward-notice-section">
              <h3>Standings</h3>
              {standings.length === 0 ? (
                <div className="progression-reward-notice-empty">
                  Scoreboard data is not available yet.
                </div>
              ) : (
                <div className="progression-reward-notice-list">
                  {standings.map((row, index) => (
                    <div
                      key={`${notification.id}-standing-${row.user_id || index}`}
                      className="progression-reward-notice-row"
                    >
                      <span>
                        #{row.position ?? index + 1} {row.username || "Player"}
                      </span>
                      <strong>{row.points ?? 0} pts</strong>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="progression-global-modal-actions">
            <button
              type="button"
              className="progression-global-primary-btn"
              disabled={dismissing || hasPendingChoices}
              onClick={onDismiss}
            >
              {dismissing
                ? "Saving..."
                : hasPendingChoices
                ? "Resolve Choice Rewards First"
                : "Close Reward Panel"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BeginSeriesModal({ busy, errorText, onBegin }) {
  return (
    <div className="progression-global-modal-backdrop">
      <div className="progression-global-modal progression-begin-series-modal">
        <div className="progression-global-modal-kicker">ROUND 0</div>
        <h2 className="progression-global-modal-title">Begin Series</h2>
        <p className="progression-global-modal-copy">
          Claim your Round 0 starter setup to receive shards, a unique starter
          deck, your first active deck, and base-rarity binder copies.
        </p>

        {errorText ? (
          <div className="progression-global-error">{errorText}</div>
        ) : null}

        <div className="progression-global-modal-actions">
          <button
            type="button"
            className="progression-global-primary-btn"
            disabled={busy}
            onClick={onBegin}
          >
            {busy ? "Beginning..." : "Begin Series"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RoundZeroWaitingModal({ everyoneClaimed }) {
  return (
    <div className="progression-global-modal-backdrop">
      <div className="progression-global-modal progression-begin-series-modal">
        <div className="progression-global-modal-kicker">ROUND 0</div>
        <h2 className="progression-global-modal-title">
          {everyoneClaimed ? "Finalizing Round 0" : "Waiting On Starter Claims"}
        </h2>
        <p className="progression-global-modal-copy">
          {everyoneClaimed
            ? "Every player has claimed a starter deck. The system is wrapping up Round 0 and unlocking the next phase."
            : "Your starter deck is claimed. This modal stays up until every player in the series has claimed theirs too."}
        </p>
      </div>
    </div>
  );
}

function LobbyKickoffModal() {
  return (
    <div className="progression-global-modal-backdrop">
      <div className="progression-global-modal progression-begin-series-modal">
        <div className="progression-global-modal-kicker">LOBBY</div>
        <h2 className="progression-global-modal-title">Waiting For Kickoff</h2>
        <p className="progression-global-modal-copy">
          Admin setup is still in progress. Progression systems unlock when an admin
          advances the series into Round 0.
        </p>
      </div>
    </div>
  );
}

function PageLockOverlay({ reason }) {
  return (
    <div className="progression-route-lock-overlay">
      <div className="progression-route-lock-card">
        <div className="progression-route-lock-kicker">PHASE LOCK</div>
        <h2 className="progression-route-lock-title">Access Restricted</h2>
        <p className="progression-route-lock-copy">{reason}</p>
      </div>
    </div>
  );
}

export function ProgressionSystemProvider({ pageKey, children }) {
  const { user } = useUser();

  const [state, setState] = useState(null);
  const [statusStrip, setStatusStrip] = useState([]);
  const [rewardNotification, setRewardNotification] = useState(null);
  const [pendingRewardChoices, setPendingRewardChoices] = useState([]);
  const [rewardErrors, setRewardErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dismissingReward, setDismissingReward] = useState(false);
  const [claimingRewardChoiceId, setClaimingRewardChoiceId] = useState("");
  const [rewardModalError, setRewardModalError] = useState("");
  const [beginSeriesError, setBeginSeriesError] = useState("");

  const activeSeriesId = state?.activeSeriesId || null;

  const loadState = useCallback(async () => {
    if (!user || user.isBlocked || !user.canAccessProgression) {
      setState(null);
      setStatusStrip([]);
      setRewardNotification(null);
      setPendingRewardChoices([]);
      setRewardErrors([]);
      setRewardModalError("");
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const { data: activeSeries, error: activeSeriesError } = await supabase
        .from("game_series")
        .select("id")
        .eq("is_current", true)
        .maybeSingle();

      if (activeSeriesError) throw activeSeriesError;

      if (!activeSeries?.id) {
        setState({
          activeSeriesId: null,
          currentPhase: "standby",
          roundNumber: 0,
          roundStep: null,
        starterDeckClaimed: false,
        isSeriesMember: false,
        isReady: false,
        canBypassLocks: user.role === "Admin+" || user.role === "Admin",
        duelingStatus: "idle",
        });
        setStatusStrip([]);
        setRewardNotification(null);
        setPendingRewardChoices([]);
        setRewardErrors([]);
        setRewardModalError("");
        return;
      }

      const requests = [
        supabase.rpc("get_my_progression_state", {
          p_series_id: activeSeries.id,
        }),
        supabase.rpc("get_series_progression_status_strip", {
          p_series_id: activeSeries.id,
        }),
        supabase.rpc("get_series_player_protection_strip", {
          p_series_id: activeSeries.id,
        }),
        supabase
          .from("player_round_reward_notifications")
          .select("*")
          .eq("series_id", activeSeries.id)
          .eq("user_id", user.id)
          .is("dismissed_at", null)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ];

      if (user.role === "Admin" || user.role === "Admin+") {
        requests.push(
          supabase
            .from("series_reward_processing_errors")
            .select("*")
            .eq("series_id", activeSeries.id)
            .is("cleared_at", null)
            .order("created_at", { ascending: true })
        );
      }

      const responses = await Promise.all(requests);

      const [
        stateResponse,
        stripResponse,
        protectionResponse,
        rewardResponse,
        errorResponse,
      ] = responses;

      if (stateResponse.error) throw stateResponse.error;
      if (stripResponse.error) throw stripResponse.error;
      if (protectionResponse.error) throw protectionResponse.error;
      if (rewardResponse.error) throw rewardResponse.error;
      if (errorResponse?.error) throw errorResponse.error;

      const protectionByUserId = new Map(
        (protectionResponse.data || []).map((row) => [
          row.user_id,
          Number(row.rounds_remaining || 0),
        ])
      );

      const nextState = {
        ...(stateResponse.data || {}),
        activeSeriesId: activeSeries.id,
        isSeriesMember: (stripResponse.data || []).some(
          (row) => row.user_id === user.id
        ),
        everyoneStarterClaimed:
          (stripResponse.data || []).length > 0 &&
          (stripResponse.data || []).every((row) => Boolean(row.starter_claimed)),
      };

      setState(nextState);
      setStatusStrip(
        normalizeStripRows(
          (stripResponse.data || []).map((row) => ({
            ...row,
            protection_rounds: protectionByUserId.get(row.user_id) || 0,
          }))
        )
      );
      setRewardNotification(rewardResponse.data || null);
      if (rewardResponse.data?.id) {
        const { data: pendingChoiceData, error: pendingChoiceError } = await supabase.rpc(
          "get_my_pending_round_reward_choices",
          {
            p_notification_id: rewardResponse.data.id,
          }
        );

        if (pendingChoiceError) throw pendingChoiceError;
        setPendingRewardChoices(Array.isArray(pendingChoiceData) ? pendingChoiceData : []);
      } else {
        setPendingRewardChoices([]);
      }
      setRewardModalError("");
      setRewardErrors(errorResponse?.data || []);
    } catch (error) {
      console.error("Failed to load progression state:", error);
      setState({
        activeSeriesId: null,
        currentPhase: "standby",
        roundNumber: 0,
        roundStep: null,
        starterDeckClaimed: false,
        everyoneStarterClaimed: false,
        isSeriesMember: false,
        isReady: false,
        canBypassLocks: user.role === "Admin+" || user.role === "Admin",
        duelingStatus: "idle",
        loadError: error.message || "Failed to load progression state.",
      });
      setStatusStrip([]);
      setRewardNotification(null);
      setPendingRewardChoices([]);
      setRewardErrors([]);
      setRewardModalError("");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  useEffect(() => {
    function handleExternalRefresh() {
      loadState();
    }

    window.addEventListener("onyx-phase-changed", handleExternalRefresh);
    window.addEventListener("onyx-bracket-changed", handleExternalRefresh);

    return () => {
      window.removeEventListener("onyx-phase-changed", handleExternalRefresh);
      window.removeEventListener("onyx-bracket-changed", handleExternalRefresh);
    };
  }, [loadState]);

  const allowance = useMemo(
    () => getPageAllowance(pageKey, state, user),
    [pageKey, state, user]
  );

  const beginSeries = useCallback(async () => {
    if (!activeSeriesId || busy) return;

    setBusy(true);
    setBeginSeriesError("");

    try {
      const { error } = await supabase.rpc("begin_series_for_player", {
        p_series_id: activeSeriesId,
      });

      if (error) throw error;
      await loadState();
    } catch (error) {
      console.error("Failed to begin series:", error);
      setBeginSeriesError(error.message || "Failed to begin the series.");
    } finally {
      setBusy(false);
    }
  }, [activeSeriesId, busy, loadState]);

  const readyUp = useCallback(async () => {
    if (!activeSeriesId || busy) return;

    setBusy(true);

    try {
      const { error } = await supabase.rpc("ready_up_current_series_phase", {
        p_series_id: activeSeriesId,
      });

      if (error) throw error;
      await loadState();
    } finally {
      setBusy(false);
    }
  }, [activeSeriesId, busy, loadState]);

  const recordDeckExport = useCallback(
    async (deckId) => {
      if (!activeSeriesId || !deckId) return;

      const { error } = await supabase.rpc("record_active_deck_export", {
        p_series_id: activeSeriesId,
        p_deck_id: deckId,
      });

      if (error) throw error;
      await loadState();
    },
    [activeSeriesId, loadState]
  );

  const dismissReward = useCallback(async () => {
    if (!rewardNotification?.id || dismissingReward) return;

    setDismissingReward(true);
    setRewardModalError("");

    try {
      const { error } = await supabase.rpc("dismiss_round_reward_notification", {
        p_notification_id: rewardNotification.id,
      });

      if (error) throw error;
      await loadState();
    } catch (error) {
      console.error("Failed to dismiss reward notification:", error);
      setRewardModalError(error.message || "Failed to close reward panel.");
    } finally {
      setDismissingReward(false);
    }
  }, [dismissingReward, loadState, rewardNotification]);

  const claimRewardChoice = useCallback(
    async (choiceEntryId, optionIds) => {
      if (!choiceEntryId || claimingRewardChoiceId) return;

      setClaimingRewardChoiceId(choiceEntryId);
      setRewardModalError("");

      try {
        const { error } = await supabase.rpc("claim_round_reward_choice", {
          p_choice_entry_id: choiceEntryId,
          p_option_ids: optionIds,
        });

        if (error) throw error;
        await loadState();
      } catch (error) {
        console.error("Failed to claim reward choice:", error);
        setRewardModalError(error.message || "Failed to claim reward choice.");
      } finally {
        setClaimingRewardChoiceId("");
      }
    },
    [claimingRewardChoiceId, loadState]
  );

  const clearRewardError = useCallback(
    async (errorId) => {
      if (!errorId) return;

      const { error } = await supabase.rpc("clear_series_reward_processing_error", {
        p_error_id: errorId,
      });

      if (error) throw error;
      await loadState();
    },
    [loadState]
  );

  const value = useMemo(
    () => ({
      loading,
      busy,
      state,
      statusStrip,
      pendingRewardChoices,
      rewardErrors,
      activeSeriesId,
      refresh: loadState,
      beginSeries,
      readyUp,
      recordDeckExport,
      dismissReward,
      claimRewardChoice,
      clearRewardError,
      pageAllowance: allowance,
    }),
    [
      loading,
      busy,
      state,
      statusStrip,
      pendingRewardChoices,
      rewardErrors,
      activeSeriesId,
      loadState,
      beginSeries,
      readyUp,
      recordDeckExport,
      dismissReward,
      claimRewardChoice,
      clearRewardError,
      allowance,
    ]
  );

  return (
    <ProgressionContext.Provider value={value}>
      {children}

      {allowance.showBeginModal ? (
        <BeginSeriesModal
          busy={busy}
          errorText={beginSeriesError}
          onBegin={beginSeries}
        />
      ) : null}

      {allowance.showLobbyModal ? <LobbyKickoffModal /> : null}

      {allowance.showRoundZeroWaitingModal ? (
        <RoundZeroWaitingModal
          everyoneClaimed={Boolean(state?.everyoneStarterClaimed)}
        />
      ) : null}

      {rewardNotification ? (
        <RewardNotificationModal
          notification={rewardNotification}
          pendingChoices={pendingRewardChoices}
          claimingChoiceId={claimingRewardChoiceId}
          actionError={rewardModalError}
          dismissing={dismissingReward}
          onClaimChoice={claimRewardChoice}
          onDismiss={dismissReward}
        />
      ) : null}

      {!loading && allowance.showWaitingOverlay && !allowance.showBeginModal ? (
        <PageLockOverlay reason={allowance.reason} />
      ) : null}
    </ProgressionContext.Provider>
  );
}

export function useProgression() {
  const context = useContext(ProgressionContext);

  if (!context) {
    return {
      loading: false,
      busy: false,
      state: null,
      statusStrip: [],
      pendingRewardChoices: [],
      rewardErrors: [],
      activeSeriesId: null,
      refresh: async () => {},
      beginSeries: async () => {},
      readyUp: async () => {},
      recordDeckExport: async () => {},
      dismissReward: async () => {},
      claimRewardChoice: async () => {},
      clearRewardError: async () => {},
      pageAllowance: {
        allowed: true,
        reason: "",
        showBeginModal: false,
        showLobbyModal: false,
        showRoundZeroWaitingModal: false,
        showWaitingOverlay: false,
      },
    };
  }

  return context;
}

