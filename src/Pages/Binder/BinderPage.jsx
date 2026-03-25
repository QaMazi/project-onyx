import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { useProgression } from "../../context/ProgressionContext";
import { supabase } from "../../lib/supabase";
import useResponsiveGridPageSize from "../../hooks/useResponsiveGridPageSize";

import BinderFilters from "./Components/BinderFilters";
import BinderGrid from "./Components/BinderGrid";
import BinderHoverTooltip from "./Components/BinderHoverTooltip";
import BinderCardModal from "./Components/BinderCardModal";
import BinderPagination from "./Components/BinderPagination";

import "./BinderPage.css";

const CARD_IMAGE_FALLBACK =
  "https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/fallback_image.jpg";

const TYPE_FLAGS = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
};

const SORT_OPTIONS = [
  { label: "Name", value: "name" },
  { label: "Quantity", value: "quantity" },
  { label: "Locked Copies", value: "locked" },
  { label: "Rarity Count", value: "rarities" },
];

const CARD_KIND_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Monster", value: "monster" },
  { label: "Spell", value: "spell" },
  { label: "Trap", value: "trap" },
];

const TRADE_STATUS_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Tradeable", value: "tradeable" },
  { label: "Has Locked Copies", value: "locked" },
];

const BINDER_PHASE_OPTION_META = {
  binder_removal: {
    label: "Option 1 - Binder Removal",
    shortLabel: "Binder Removal",
    description:
      "Remove 1 card name family from an eligible opponent's binder. All copies across every rarity and alternate artwork are removed.",
    requiresTarget: true,
  },
  forced_trade: {
    label: "Option 2 - Forced Trade",
    shortLabel: "Forced Trade",
    description:
      "Force a 2-for-2 trade with an eligible opponent. You can only take equal or lower rarities.",
    requiresTarget: true,
  },
  card_lockout: {
    label: "Option 3 - Card Lockout",
    shortLabel: "Card Lockout",
    description:
      "Choose 3 different card names from an eligible opponent and apply the Hex-style lockout effect.",
    requiresTarget: true,
  },
  gambled_removal: {
    label: "Option 4 - Gambled Removal",
    shortLabel: "Gambled Removal",
    description:
      "Remove 2 card families from an eligible opponent, then choose the promo box they open twice.",
    requiresTarget: true,
  },
  binder_stack: {
    label: "Option 5 - Binder Stack",
    shortLabel: "Binder Stack",
    description:
      "Choose one of your binder cards and raise it to 3 total copies, capped at Infused rarity.",
  },
  ban_list_cards: {
    label: "Option 6 - Ban List Cards",
    shortLabel: "Ban List Cards",
    description:
      "Claim 2 cards currently on the ban list. The same card can be chosen twice.",
  },
  promo_box_open: {
    label: "Option 7 - Progression Series Promo Box",
    shortLabel: "Promo Box Open",
    description: "Choose 1 promo box and open it twice immediately.",
  },
  draft_pack_keys: {
    label: "Option 8 - Draft Packs",
    shortLabel: "Draft Pack Keys",
    description: "Receive 4 Random Draft Pack Keys immediately.",
  },
};

function buildCardImageUrl(card) {
  if (card?.image_url) return card.image_url;
  return `https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/${card?.id}.jpg`;
}

function clampPage(page, totalPages) {
  if (totalPages <= 0) return 1;
  if (page < 1) return 1;
  if (page > totalPages) return totalPages;
  return page;
}

function buildVisiblePages(currentPage, totalPages) {
  if (totalPages <= 1) return [1];

  const pages = new Set([
    1,
    totalPages,
    currentPage - 2,
    currentPage - 1,
    currentPage,
    currentPage + 1,
    currentPage + 2,
  ]);

  return Array.from(pages)
    .filter((pageNumber) => pageNumber >= 1 && pageNumber <= totalPages)
    .sort((a, b) => a - b);
}

function getCardKindKey(card) {
  const normalized = Number(card?.type || 0);
  if ((normalized & TYPE_FLAGS.MONSTER) === TYPE_FLAGS.MONSTER) return "monster";
  if ((normalized & TYPE_FLAGS.SPELL) === TYPE_FLAGS.SPELL) return "spell";
  if ((normalized & TYPE_FLAGS.TRAP) === TYPE_FLAGS.TRAP) return "trap";
  return "unknown";
}

function normalizeBinderRows(rows) {
  return (rows || []).map((row) => ({
    id: row.id,
    quantity: Number(row.quantity || 0),
    isTradeLocked: Boolean(row.is_trade_locked),
    cardId: row.card_id,
    rarityId: row.rarity_id,
    card: {
      id: row.card_id,
      name: row.card_name,
      image_url: row.image_url,
      desc: row.card_description,
      type: row.type,
      race: row.race,
      attribute: row.attribute,
      level: row.level,
      atk: row.atk,
      def: row.def,
    },
    rarity: {
      id: row.rarity_id,
      code: row.rarity_code,
      name: row.rarity_name,
      sort_order: row.rarity_sort_order,
      shard_value: row.rarity_shard_value,
    },
  }));
}

function groupBinderCards(rows) {
  const groupedMap = new Map();

  for (const row of rows) {
    if (!row.card) continue;

    const groupKey = String(row.cardId);

    if (!groupedMap.has(groupKey)) {
      groupedMap.set(groupKey, {
        groupKey,
        cardId: row.cardId,
        card: row.card,
        totalQuantity: 0,
        totalLockedQuantity: 0,
        copies: [],
        rarities: [],
      });
    }

    const group = groupedMap.get(groupKey);
    group.copies.push(row);
    group.totalQuantity += row.quantity;

    if (row.isTradeLocked) {
      group.totalLockedQuantity += row.quantity;
    }
  }

  return Array.from(groupedMap.values())
    .map((group) => {
      const rarityMap = new Map();

      for (const copy of group.copies) {
        const rarityKey = copy.rarityId || "unknown";

        if (!rarityMap.has(rarityKey)) {
          rarityMap.set(rarityKey, {
            rarityId: copy.rarityId,
            rarity: copy.rarity,
            quantity: 0,
            lockedQuantity: 0,
          });
        }

        const rarityEntry = rarityMap.get(rarityKey);
        rarityEntry.quantity += copy.quantity;

        if (copy.isTradeLocked) {
          rarityEntry.lockedQuantity += copy.quantity;
        }
      }

      return {
        ...group,
        rarities: Array.from(rarityMap.values()).sort((a, b) => {
          const aOrder = Number(a.rarity?.sort_order ?? 9999);
          const bOrder = Number(b.rarity?.sort_order ?? 9999);
          if (aOrder !== bOrder) return aOrder - bOrder;
          return String(a.rarity?.name || "").localeCompare(String(b.rarity?.name || ""));
        }),
      };
    })
    .sort((a, b) =>
      String(a.card?.name || "").localeCompare(String(b.card?.name || ""))
    );
}

function groupBinderCardsByName(rows) {
  const groupedMap = new Map();

  for (const row of rows) {
    if (!row.card) continue;

    const cardName = String(row.card?.name || "").trim();
    if (!cardName) continue;

    const groupKey = `name:${cardName.toLowerCase()}`;

    if (!groupedMap.has(groupKey)) {
      groupedMap.set(groupKey, {
        groupKey,
        cardId: row.cardId,
        card: row.card,
        cardName,
        totalQuantity: 0,
        totalLockedQuantity: 0,
        copies: [],
        rarities: [],
      });
    }

    const group = groupedMap.get(groupKey);
    group.copies.push(row);
    group.totalQuantity += row.quantity;

    if (row.isTradeLocked) {
      group.totalLockedQuantity += row.quantity;
    }
  }

  return Array.from(groupedMap.values())
    .map((group) => {
      const rarityMap = new Map();

      for (const copy of group.copies) {
        const rarityKey = `${copy.rarityId || "unknown"}:${copy.cardId}`;

        if (!rarityMap.has(rarityKey)) {
          rarityMap.set(rarityKey, {
            rarityId: copy.rarityId,
            rarity: copy.rarity,
            quantity: 0,
            lockedQuantity: 0,
          });
        }

        const rarityEntry = rarityMap.get(rarityKey);
        rarityEntry.quantity += copy.quantity;

        if (copy.isTradeLocked) {
          rarityEntry.lockedQuantity += copy.quantity;
        }
      }

      return {
        ...group,
        rarities: Array.from(rarityMap.values()).sort((a, b) => {
          const aOrder = Number(a.rarity?.sort_order ?? 9999);
          const bOrder = Number(b.rarity?.sort_order ?? 9999);
          if (aOrder !== bOrder) return aOrder - bOrder;
          return String(a.rarity?.name || "").localeCompare(String(b.rarity?.name || ""));
        }),
      };
    })
    .sort((a, b) =>
      String(a.card?.name || "").localeCompare(String(b.card?.name || ""))
    );
}

function buildBinderGroupFromRow(row) {
  return {
    groupKey: `row-${row.id}`,
    cardId: row.cardId,
    card: row.card,
    totalQuantity: row.quantity,
    totalLockedQuantity: row.isTradeLocked ? row.quantity : 0,
    copies: [row],
    rarities: [
      {
        rarityId: row.rarityId,
        rarity: row.rarity,
        quantity: row.quantity,
        lockedQuantity: row.isTradeLocked ? row.quantity : 0,
      },
    ],
  };
}

function formatBinderPhaseOptionLabel(optionCode) {
  return BINDER_PHASE_OPTION_META[optionCode]?.shortLabel || "Unknown Option";
}

function formatBinderPhaseTurnSummary(turn) {
  const optionCode = String(turn?.choice_option || "");
  const payload = turn?.resolved_payload || {};

  if (!optionCode) return "Waiting to choose";
  if (!turn?.completed_at) return `Selected ${formatBinderPhaseOptionLabel(optionCode)}`;

  if (optionCode === "binder_removal") {
    return `Removed ${payload.removed_card_name || "a card"} from ${payload.target_username || "opponent"}`;
  }

  if (optionCode === "forced_trade") {
    return `Forced trade with ${payload.target_username || "opponent"}`;
  }

  if (optionCode === "card_lockout") {
    return `Locked 3 cards for ${payload.target_username || "opponent"}`;
  }

  if (optionCode === "gambled_removal") {
    const removedCount = Array.isArray(payload.removed) ? payload.removed.length : 0;
    return `Removed ${removedCount || 2} card families from ${payload.target_username || "opponent"}`;
  }

  if (optionCode === "binder_stack") {
    return `Stacked ${payload.card_name || "a card"} to 3 copies`;
  }

  if (optionCode === "ban_list_cards") {
    return "Claimed 2 banlist cards";
  }

  if (optionCode === "promo_box_open") {
    return `Opened ${payload.open_result?.container_name || "Promo Box"} x2`;
  }

  if (optionCode === "draft_pack_keys") {
    return "Received 4 Random Draft Pack Keys";
  }

  return formatBinderPhaseOptionLabel(optionCode);
}

function getBinderPhaseHostileOptions(hostileTargets) {
  return new Set(hostileTargets.map((row) => String(row.user_id || "")));
}

function sumSelectionMap(selectionMap) {
  return Object.values(selectionMap || {}).reduce(
    (sum, value) => sum + Number(value || 0),
    0
  );
}

function BinderPhaseStatusPanel({ binderPhaseState, binderPhaseBusy, onConfirm }) {
  const turns = Array.isArray(binderPhaseState?.turns) ? binderPhaseState.turns : [];

  return (
    <section className="binder-phase-status-panel">
      <div className="binder-phase-status-header">
        <div>
          <div className="binder-phase-kicker">PHASE 3</div>
          <h2 className="binder-phase-title">Binder Phase</h2>
          <p className="binder-phase-copy">
            Resolve the round winner order, then confirm the final Binder results to move into Feature Phase.
          </p>
        </div>

        <div className="binder-phase-status-pills">
          <div className="binder-phase-status-pill">
            <span>Current Turn</span>
            <strong>
              {binderPhaseState?.current_turn_order
                ? `#${binderPhaseState.current_turn_order}`
                : "Complete"}
            </strong>
          </div>
          <div className="binder-phase-status-pill">
            <span>Confirmations</span>
            <strong>
              {Number(binderPhaseState?.confirmation_count || 0)}/
              {Number(binderPhaseState?.player_count || 0)}
            </strong>
          </div>
          <div className="binder-phase-status-pill">
            <span>Your State</span>
            <strong>{String(binderPhaseState?.my_action_state || "waiting").replaceAll("_", " ")}</strong>
          </div>
        </div>
      </div>

      <div className="binder-phase-turn-order">
        {turns.map((turn) => (
          <article
            key={`${turn.user_id}-${turn.turn_order}`}
            className={`binder-phase-turn-card ${turn.is_current_turn ? "is-current-turn" : ""}`}
          >
            <div className="binder-phase-turn-head">
              <div className="binder-phase-turn-rank">#{turn.turn_order}</div>
              <div className="binder-phase-turn-player">
                <strong>{turn.username || "Player"}</strong>
                <span>
                  Last Round: {turn.last_round_placement ?? "-"} | Overall: {turn.overall_position ?? "-"}
                </span>
              </div>
            </div>
            <div className="binder-phase-turn-summary">
              {formatBinderPhaseTurnSummary(turn)}
            </div>
          </article>
        ))}
      </div>

      {binderPhaseState?.can_confirm ? (
        <div className="binder-phase-confirm-row">
          <button
            type="button"
            className="binder-phase-confirm-btn"
            onClick={onConfirm}
            disabled={binderPhaseBusy}
          >
            {binderPhaseBusy ? "Confirming..." : "Confirm Binder Results"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function BinderPhaseOptionModal({
  hostileTargets,
  promoBoxes,
  banlistCards,
  onChoose,
  busy,
  errorText,
}) {
  const hasHostileTargets = hostileTargets.length > 0;
  const visibleOptions = Object.entries(BINDER_PHASE_OPTION_META).filter(([, option]) =>
    option.requiresTarget ? hasHostileTargets : true
  );

  return (
    <div className="binder-phase-modal-backdrop">
      <div className="binder-phase-modal">
        <div className="binder-phase-modal-kicker">BINDER CHOICE</div>
        <h2 className="binder-phase-modal-title">Choose Your Binder Phase Option</h2>
        <p className="binder-phase-modal-copy">
          Your option resolves immediately after you finish its selections. The turn order will continue once you are done.
        </p>

        {errorText ? <div className="progression-global-error">{errorText}</div> : null}

        {!hasHostileTargets ? (
          <div className="binder-phase-modal-copy">
            Hostile options are hidden because nobody is ahead of you, or tied with you, on the
            overall scoreboard right now.
          </div>
        ) : null}

        <div className="binder-phase-option-grid">
          {visibleOptions.map(([optionCode, option]) => {
            const isHostileOption = option.requiresTarget;
            const disabled =
              busy ||
              (isHostileOption && hostileTargets.length <= 0) ||
              (optionCode === "promo_box_open" && promoBoxes.length <= 0) ||
              (optionCode === "gambled_removal" && promoBoxes.length <= 0) ||
              (optionCode === "ban_list_cards" && banlistCards.length <= 0);

            return (
              <button
                key={optionCode}
                type="button"
                className="binder-phase-option-card"
                disabled={disabled}
                onClick={() => onChoose(optionCode)}
              >
                <div className="binder-phase-option-label">{option.label}</div>
                <div className="binder-phase-option-description">{option.description}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BinderPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();
  const {
    loading: progressionLoading,
    state: progressionState,
    readyUp,
    refresh: refreshProgression,
  } = useProgression();

  const activeSeriesId = progressionState?.activeSeriesId || null;
  const isBinderPhaseActive =
    Boolean(activeSeriesId) &&
    String(progressionState?.currentPhase || "").toLowerCase() === "binder" &&
    Number(progressionState?.roundNumber || 0) > 0;

  const [binderRows, setBinderRows] = useState([]);
  const [binderGroups, setBinderGroups] = useState([]);
  const [vaultSummary, setVaultSummary] = useState(null);
  const [binderPhaseState, setBinderPhaseState] = useState(null);
  const [binderPhaseTargetRows, setBinderPhaseTargetRows] = useState([]);
  const [loadingBinder, setLoadingBinder] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [binderPhaseBusy, setBinderPhaseBusy] = useState(false);
  const [binderPhaseError, setBinderPhaseError] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("name");
  const [sortDirection, setSortDirection] = useState("asc");
  const [cardKindFilter, setCardKindFilter] = useState("all");
  const [rarityFilter, setRarityFilter] = useState("all");
  const [tradeStatusFilter, setTradeStatusFilter] = useState("all");

  const [hoveredGroupKey, setHoveredGroupKey] = useState(null);
  const [hoverPreview, setHoverPreview] = useState(null);
  const [modalGroupKey, setModalGroupKey] = useState(null);
  const binderGridCardRef = useRef(null);

  const [page, setPage] = useState(1);
  const [pageJumpInput, setPageJumpInput] = useState("1");

  const [binderPhaseTargetUserId, setBinderPhaseTargetUserId] = useState("");
  const [binderPhaseSelectedTargetCardIds, setBinderPhaseSelectedTargetCardIds] = useState([]);
  const [binderPhaseSelectedBinderRowId, setBinderPhaseSelectedBinderRowId] = useState("");
  const [binderPhaseSelectedPromoBoxId, setBinderPhaseSelectedPromoBoxId] = useState("");
  const [binderPhaseGiveSelections, setBinderPhaseGiveSelections] = useState({});
  const [binderPhaseTakeSelections, setBinderPhaseTakeSelections] = useState({});
  const [binderPhaseBanlistCardIds, setBinderPhaseBanlistCardIds] = useState(["", ""]);

  const binderPageSizeOptions = useMemo(
    () => ({
      fallback: 24,
      minPageSize: 6,
      minColumnWidth: 172,
      columnGap: 14,
      rowGap: 16,
      paddingX: 32,
      paddingY: 32,
      textHeight: 34,
      extraHeight: 34,
    }),
    []
  );

  const pageSize = useResponsiveGridPageSize(binderGridCardRef, binderPageSizeOptions);

  const hostileTargets = useMemo(
    () => (Array.isArray(binderPhaseState?.hostile_targets) ? binderPhaseState.hostile_targets : []),
    [binderPhaseState]
  );
  const promoBoxes = useMemo(
    () => (Array.isArray(binderPhaseState?.promo_boxes) ? binderPhaseState.promo_boxes : []),
    [binderPhaseState]
  );
  const banlistCards = useMemo(
    () => (Array.isArray(binderPhaseState?.banlist_cards) ? binderPhaseState.banlist_cards : []),
    [binderPhaseState]
  );
  const currentBinderPhaseOption = String(binderPhaseState?.my_choice_option || "");
  const showBinderPhaseChoiceModal =
    isBinderPhaseActive && binderPhaseState?.my_action_state === "choose_option";
  const showBinderPhaseResolveModal =
    isBinderPhaseActive && binderPhaseState?.my_action_state === "resolve_choice";

  const targetBinderGroups = useMemo(
    () => groupBinderCards(binderPhaseTargetRows),
    [binderPhaseTargetRows]
  );
  const targetBinderNameGroups = useMemo(
    () => groupBinderCardsByName(binderPhaseTargetRows),
    [binderPhaseTargetRows]
  );

  const binderGroupTotals = useMemo(() => {
    const map = new Map();
    for (const group of binderGroups) {
      map.set(String(group.cardId), Number(group.totalQuantity || 0));
    }
    return map;
  }, [binderGroups]);

  const stackEligibleRows = useMemo(
    () =>
      binderRows
        .filter((row) => {
          const rarityOrder = Number(row.rarity?.sort_order ?? 9999);
          const totalCopies = Number(binderGroupTotals.get(String(row.cardId)) || 0);
          return rarityOrder <= 3 && totalCopies < 3;
        })
        .sort((a, b) => {
          const aName = String(a.card?.name || "");
          const bName = String(b.card?.name || "");
          if (aName !== bName) return aName.localeCompare(bName);
          return Number(a.rarity?.sort_order ?? 9999) - Number(b.rarity?.sort_order ?? 9999);
        }),
    [binderGroupTotals, binderRows]
  );

  const hostileTargetIdSet = useMemo(
    () => getBinderPhaseHostileOptions(hostileTargets),
    [hostileTargets]
  );

  const selectedGiveCount = useMemo(
    () => sumSelectionMap(binderPhaseGiveSelections),
    [binderPhaseGiveSelections]
  );
  const selectedTakeCount = useMemo(
    () => sumSelectionMap(binderPhaseTakeSelections),
    [binderPhaseTakeSelections]
  );

  const rarityOptions = useMemo(() => {
    const options = new Map();

    for (const group of binderGroups) {
      for (const entry of group.rarities || []) {
        const value = String(entry.rarityId || entry.rarity?.name || "unknown");
        if (!options.has(value)) {
          options.set(value, {
            value,
            label: entry.rarity?.name || "Unknown",
            sortOrder: Number(entry.rarity?.sort_order ?? 9999),
          });
        }
      }
    }

    return [
      { label: "All", value: "all" },
      ...Array.from(options.values()).sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.label.localeCompare(b.label);
      }),
    ];
  }, [binderGroups]);

  const loadBinderData = useCallback(async () => {
    if (!user?.id || !activeSeriesId) {
      setBinderRows([]);
      setBinderGroups([]);
      setVaultSummary(null);
      setBinderPhaseState(null);
      setLoadingBinder(false);
      return;
    }

    setLoadingBinder(true);
    setLoadError("");

    try {
      const requests = [
        isBinderPhaseActive
          ? supabase.rpc("get_current_binder_phase_visible_binder_cards", {
              p_series_id: activeSeriesId,
            })
          : supabase.rpc("get_my_binder_cards", {
              p_series_id: activeSeriesId,
            }),
        supabase.rpc("get_my_vault_summary", {
          p_series_id: activeSeriesId,
        }),
      ];

      if (isBinderPhaseActive) {
        requests.push(
          supabase.rpc("get_current_binder_phase_state", {
            p_series_id: activeSeriesId,
          })
        );
      }

      const [binderResponse, summaryResponse, phaseResponse] = await Promise.all(requests);

      if (binderResponse.error) throw binderResponse.error;
      if (summaryResponse.error) throw summaryResponse.error;
      if (phaseResponse?.error) throw phaseResponse.error;

      const normalizedRows = normalizeBinderRows(binderResponse.data || []);
      setBinderRows(normalizedRows);
      setBinderGroups(groupBinderCards(normalizedRows));
      setVaultSummary(summaryResponse.data || null);
      setBinderPhaseState(phaseResponse?.data || null);
      setBinderPhaseError("");
    } catch (error) {
      console.error("Failed to fetch binder:", error);
      setBinderRows([]);
      setBinderGroups([]);
      setVaultSummary(null);
      setBinderPhaseState(null);
      setLoadError(error.message || "Failed to load binder.");
    } finally {
      setLoadingBinder(false);
    }
  }, [activeSeriesId, isBinderPhaseActive, user?.id]);

  const loadTargetBinderData = useCallback(async () => {
    if (!isBinderPhaseActive || !activeSeriesId || !binderPhaseTargetUserId) {
      setBinderPhaseTargetRows([]);
      return;
    }

    if (!hostileTargetIdSet.has(String(binderPhaseTargetUserId))) {
      setBinderPhaseTargetRows([]);
      return;
    }

    try {
      const { data, error } = await supabase.rpc(
        "get_current_binder_phase_visible_binder_cards",
        {
          p_series_id: activeSeriesId,
          p_target_user_id: binderPhaseTargetUserId,
        }
      );

      if (error) throw error;
      setBinderPhaseTargetRows(normalizeBinderRows(data || []));
    } catch (error) {
      console.error("Failed to load Binder Phase target binder:", error);
      setBinderPhaseTargetRows([]);
      setBinderPhaseError(error.message || "Failed to load the selected opponent binder.");
    }
  }, [activeSeriesId, binderPhaseTargetUserId, hostileTargetIdSet, isBinderPhaseActive]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearchTerm(searchInput.trim().toLowerCase());
    }, 200);

    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    setPageJumpInput(String(page));
  }, [page]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, sortField, sortDirection, cardKindFilter, rarityFilter, tradeStatusFilter]);

  useEffect(() => {
    if (!authLoading && !progressionLoading) {
      loadBinderData();
    }
  }, [authLoading, progressionLoading, loadBinderData]);

  useEffect(() => {
    if (!showBinderPhaseResolveModal) {
      setBinderPhaseTargetRows([]);
    }
  }, [showBinderPhaseResolveModal]);

  useEffect(() => {
    if (!showBinderPhaseResolveModal) return;

    if (
      ["binder_removal", "forced_trade", "card_lockout", "gambled_removal"].includes(
        currentBinderPhaseOption
      ) &&
      hostileTargets.length > 0 &&
      !hostileTargetIdSet.has(String(binderPhaseTargetUserId))
    ) {
      setBinderPhaseTargetUserId(String(hostileTargets[0]?.user_id || ""));
    }
  }, [
    binderPhaseTargetUserId,
    currentBinderPhaseOption,
    hostileTargetIdSet,
    hostileTargets,
    showBinderPhaseResolveModal,
  ]);

  useEffect(() => {
    if (!showBinderPhaseResolveModal) return;
    if (
      ["binder_removal", "forced_trade", "card_lockout", "gambled_removal"].includes(
        currentBinderPhaseOption
      )
    ) {
      loadTargetBinderData();
    }
  }, [currentBinderPhaseOption, loadTargetBinderData, showBinderPhaseResolveModal]);

  useEffect(() => {
    setBinderPhaseError("");
    setBinderPhaseSelectedTargetCardIds([]);
    setBinderPhaseSelectedBinderRowId("");
    setBinderPhaseGiveSelections({});
    setBinderPhaseTakeSelections({});
    setBinderPhaseBanlistCardIds(["", ""]);
  }, [currentBinderPhaseOption, binderPhaseState?.current_turn_order]);

  useEffect(() => {
    if (promoBoxes.length > 0 && !promoBoxes.some((box) => box.id === binderPhaseSelectedPromoBoxId)) {
      setBinderPhaseSelectedPromoBoxId(String(promoBoxes[0]?.id || ""));
    }
  }, [promoBoxes, binderPhaseSelectedPromoBoxId]);

  const filteredGroups = useMemo(() => {
    return binderGroups
      .filter((group) => {
        if (
          searchTerm &&
          !String(group.card?.name || "").toLowerCase().includes(searchTerm)
        ) {
          return false;
        }

        if (cardKindFilter !== "all" && getCardKindKey(group.card) !== cardKindFilter) {
          return false;
        }

        if (
          rarityFilter !== "all" &&
          !(group.rarities || []).some(
            (entry) => String(entry.rarityId || entry.rarity?.name || "unknown") === rarityFilter
          )
        ) {
          return false;
        }

        if (tradeStatusFilter === "tradeable" && group.totalQuantity <= group.totalLockedQuantity) {
          return false;
        }

        if (tradeStatusFilter === "locked" && group.totalLockedQuantity <= 0) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortField === "quantity") {
          return sortDirection === "asc"
            ? a.totalQuantity - b.totalQuantity
            : b.totalQuantity - a.totalQuantity;
        }

        if (sortField === "locked") {
          return sortDirection === "asc"
            ? a.totalLockedQuantity - b.totalLockedQuantity
            : b.totalLockedQuantity - a.totalLockedQuantity;
        }

        if (sortField === "rarities") {
          return sortDirection === "asc"
            ? (a.rarities?.length || 0) - (b.rarities?.length || 0)
            : (b.rarities?.length || 0) - (a.rarities?.length || 0);
        }

        return sortDirection === "asc"
          ? String(a.card?.name || "").localeCompare(String(b.card?.name || ""))
          : String(b.card?.name || "").localeCompare(String(a.card?.name || ""));
      });
  }, [
    binderGroups,
    cardKindFilter,
    rarityFilter,
    searchTerm,
    sortDirection,
    sortField,
    tradeStatusFilter,
  ]);

  const totalCount = filteredGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = clampPage(page, totalPages);

  const visiblePages = useMemo(
    () => buildVisiblePages(safePage, totalPages),
    [safePage, totalPages]
  );

  useEffect(() => {
    if (safePage !== page) {
      setPage(safePage);
    }
  }, [page, safePage]);

  const paginatedGroups = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredGroups.slice(start, start + pageSize);
  }, [filteredGroups, safePage, pageSize]);

  useEffect(() => {
    const hoveredStillExists = filteredGroups.some(
      (group) => group.groupKey === hoveredGroupKey
    );

    if (!hoveredStillExists) {
      setHoveredGroupKey(null);
      setHoverPreview(null);
    }

    const modalStillExists =
      filteredGroups.some((group) => group.groupKey === modalGroupKey) ||
      binderGroups.some((group) => group.groupKey === modalGroupKey);

    if (!modalStillExists) {
      setModalGroupKey(null);
    }
  }, [filteredGroups, binderGroups, hoveredGroupKey, modalGroupKey]);

  const modalGroup = useMemo(
    () =>
      filteredGroups.find((group) => group.groupKey === modalGroupKey) ||
      binderGroups.find((group) => group.groupKey === modalGroupKey) ||
      null,
    [filteredGroups, binderGroups, modalGroupKey]
  );

  function handleHoverGroup(group, target) {
    if (!group || !target) return;

    const rect = target.getBoundingClientRect();
    const tooltipWidth = 340;
    const tooltipHeight = 260;
    const showRight = rect.right + tooltipWidth + 24 < window.innerWidth;
    const x = showRight ? rect.right + 14 : Math.max(12, rect.left - tooltipWidth - 14);
    const y = Math.min(window.innerHeight - tooltipHeight - 12, Math.max(12, rect.top - 8));

    setHoveredGroupKey(group.groupKey);
    setHoverPreview({ group, x, y });
  }

  function handleLeaveGroup() {
    setHoveredGroupKey(null);
    setHoverPreview(null);
  }

  function handleOpenModal(group) {
    setModalGroupKey(group?.groupKey || null);
    setHoveredGroupKey(null);
    setHoverPreview(null);
  }

  function handleClearFilters() {
    setSearchInput("");
    setSearchTerm("");
    setSortField("name");
    setSortDirection("asc");
    setCardKindFilter("all");
    setRarityFilter("all");
    setTradeStatusFilter("all");
  }

  async function handleSellCards({ binderCardId, quantity }) {
    const { data, error } = await supabase.rpc("sell_binder_cards_for_shards", {
      p_binder_card_id: binderCardId,
      p_quantity: Number(quantity || 0),
    });

    if (error) throw error;

    await loadBinderData();
    return data;
  }

  async function handleVaultCards({ binderCardId }) {
    const { data, error } = await supabase.rpc("move_binder_card_family_to_vault", {
      p_binder_card_id: binderCardId,
    });

    if (error) throw error;

    await loadBinderData();
    return data;
  }

  async function refreshBinderAndProgression() {
    await refreshProgression();
    await loadBinderData();
  }

  async function handleChooseBinderOption(optionCode) {
    if (!activeSeriesId || binderPhaseBusy) return;

    setBinderPhaseBusy(true);
    setBinderPhaseError("");

    try {
      const { error } = await supabase.rpc("choose_current_binder_phase_option", {
        p_series_id: activeSeriesId,
        p_choice_option: optionCode,
      });

      if (error) throw error;
      await refreshBinderAndProgression();
    } catch (error) {
      console.error("Failed to choose Binder Phase option:", error);
      setBinderPhaseError(error.message || "Failed to choose Binder Phase option.");
    } finally {
      setBinderPhaseBusy(false);
    }
  }

  function toggleTargetCardSelection(cardId, maxSelections) {
    setBinderPhaseSelectedTargetCardIds((current) => {
      const normalized = String(cardId);
      if (current.includes(normalized)) {
        return current.filter((value) => value !== normalized);
      }

      if (current.length >= maxSelections) {
        return current;
      }

      return [...current, normalized];
    });
  }

  function updateTradeSelection(setter, rowId, nextQuantity, maxQuantity, maxTotal) {
    setter((current) => {
      const totalWithoutCurrent =
        Object.entries(current).reduce((sum, [key, value]) => {
          if (key === rowId) return sum;
          return sum + Number(value || 0);
        }, 0) || 0;

      const clampedQuantity = Math.max(
        0,
        Math.min(Number(nextQuantity || 0), Number(maxQuantity || 0), maxTotal - totalWithoutCurrent)
      );

      const next = { ...current };
      if (clampedQuantity <= 0) {
        delete next[rowId];
      } else {
        next[rowId] = clampedQuantity;
      }
      return next;
    });
  }

  async function handleResolveBinderChoice() {
    if (!activeSeriesId || binderPhaseBusy || !currentBinderPhaseOption) return;

    let payload = {};

    if (currentBinderPhaseOption === "binder_removal") {
      if (!binderPhaseTargetUserId || binderPhaseSelectedTargetCardIds.length !== 1) {
        setBinderPhaseError("Choose one eligible opponent and one card family to remove.");
        return;
      }

      payload = {
        target_user_id: binderPhaseTargetUserId,
        card_id: Number(binderPhaseSelectedTargetCardIds[0]),
      };
    } else if (currentBinderPhaseOption === "forced_trade") {
      const giveSelections = Object.entries(binderPhaseGiveSelections)
        .filter(([, quantity]) => Number(quantity || 0) > 0)
        .map(([binder_card_id, quantity]) => ({
          binder_card_id,
          quantity: Number(quantity),
        }));
      const takeSelections = Object.entries(binderPhaseTakeSelections)
        .filter(([, quantity]) => Number(quantity || 0) > 0)
        .map(([binder_card_id, quantity]) => ({
          binder_card_id,
          quantity: Number(quantity),
        }));

      if (!binderPhaseTargetUserId || selectedGiveCount !== 2 || selectedTakeCount !== 2) {
        setBinderPhaseError("Forced Trade needs exactly 2 cards from each player.");
        return;
      }

      payload = {
        target_user_id: binderPhaseTargetUserId,
        give_selections: giveSelections,
        take_selections: takeSelections,
      };
    } else if (currentBinderPhaseOption === "card_lockout") {
      if (!binderPhaseTargetUserId || binderPhaseSelectedTargetCardIds.length !== 3) {
        setBinderPhaseError("Choose one eligible opponent and 3 different card names.");
        return;
      }

      payload = {
        target_user_id: binderPhaseTargetUserId,
        card_ids: binderPhaseSelectedTargetCardIds.map((value) => Number(value)),
      };
    } else if (currentBinderPhaseOption === "gambled_removal") {
      if (
        !binderPhaseTargetUserId ||
        binderPhaseSelectedTargetCardIds.length !== 2 ||
        !binderPhaseSelectedPromoBoxId
      ) {
        setBinderPhaseError("Choose an opponent, 2 different card names, and 1 promo box.");
        return;
      }

      payload = {
        target_user_id: binderPhaseTargetUserId,
        container_id: binderPhaseSelectedPromoBoxId,
        card_ids: binderPhaseSelectedTargetCardIds.map((value) => Number(value)),
      };
    } else if (currentBinderPhaseOption === "binder_stack") {
      if (!binderPhaseSelectedBinderRowId) {
        setBinderPhaseError("Choose one of your binder rows to stack.");
        return;
      }

      payload = {
        binder_card_id: binderPhaseSelectedBinderRowId,
      };
    } else if (currentBinderPhaseOption === "ban_list_cards") {
      if (!binderPhaseBanlistCardIds[0] || !binderPhaseBanlistCardIds[1]) {
        setBinderPhaseError("Choose exactly 2 banlist cards.");
        return;
      }

      payload = {
        card_ids: binderPhaseBanlistCardIds.map((value) => Number(value)),
      };
    } else if (currentBinderPhaseOption === "promo_box_open") {
      if (!binderPhaseSelectedPromoBoxId) {
        setBinderPhaseError("Choose 1 promo box to open.");
        return;
      }

      payload = {
        container_id: binderPhaseSelectedPromoBoxId,
      };
    } else {
      setBinderPhaseError("That option does not need extra selections.");
      return;
    }

    setBinderPhaseBusy(true);
    setBinderPhaseError("");

    try {
      const { error } = await supabase.rpc("resolve_current_binder_phase_choice", {
        p_series_id: activeSeriesId,
        p_payload: payload,
      });

      if (error) throw error;
      await refreshBinderAndProgression();
    } catch (error) {
      console.error("Failed to resolve Binder Phase option:", error);
      setBinderPhaseError(error.message || "Failed to resolve the Binder Phase option.");
    } finally {
      setBinderPhaseBusy(false);
    }
  }

  async function handleConfirmBinderPhase() {
    if (!activeSeriesId || binderPhaseBusy) return;

    setBinderPhaseBusy(true);
    setBinderPhaseError("");

    try {
      await readyUp();
      await loadBinderData();
    } catch (error) {
      console.error("Failed to confirm Binder Phase:", error);
      setBinderPhaseError(error.message || "Failed to confirm Binder Phase.");
    } finally {
      setBinderPhaseBusy(false);
    }
  }

  const selectedHostileTarget = useMemo(
    () =>
      hostileTargets.find(
        (target) => String(target.user_id || "") === String(binderPhaseTargetUserId || "")
      ) || null,
    [binderPhaseTargetUserId, hostileTargets]
  );

  if (authLoading || progressionLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (user.role === "Blocked") return <Navigate to="/" replace />;
  if (user.role !== "Admin+" && user.role !== "Admin" && user.role !== "Duelist") {
    return <Navigate to="/mode" replace />;
  }

  return (
    <LauncherLayout>
      <div className="binder-page">
        <div className="binder-topbar">
          <button
            type="button"
            className="binder-back-btn"
            onClick={() => navigate("/mode/progression")}
          >
            Back
          </button>
        </div>

        {isBinderPhaseActive && binderPhaseState ? (
          <BinderPhaseStatusPanel
            binderPhaseState={binderPhaseState}
            binderPhaseBusy={binderPhaseBusy}
            onConfirm={handleConfirmBinderPhase}
          />
        ) : null}

        <div className="binder-layout">
          <BinderFilters
            panelTitle="Binder"
            countLabel="cards"
            totalCount={totalCount}
            searchInput={searchInput}
            setSearchInput={setSearchInput}
            sortField={sortField}
            setSortField={setSortField}
            sortDirection={sortDirection}
            setSortDirection={setSortDirection}
            cardKindFilter={cardKindFilter}
            setCardKindFilter={setCardKindFilter}
            rarityFilter={rarityFilter}
            setRarityFilter={setRarityFilter}
            rarityOptions={rarityOptions}
            tradeStatusFilter={tradeStatusFilter}
            setTradeStatusFilter={setTradeStatusFilter}
            handleClearFilters={handleClearFilters}
            SORT_OPTIONS={SORT_OPTIONS}
            CARD_KIND_OPTIONS={CARD_KIND_OPTIONS}
            TRADE_STATUS_OPTIONS={TRADE_STATUS_OPTIONS}
          />

          <main className="binder-center-panel">
            <BinderGrid
              loadError={loadError}
              loadingBinder={loadingBinder}
              hasActiveSeries={Boolean(activeSeriesId)}
              groups={paginatedGroups}
              gridCardRef={binderGridCardRef}
              activeGroupKey={modalGroupKey}
              hoveredGroupKey={hoveredGroupKey}
              onHoverGroup={handleHoverGroup}
              onLeaveGroup={handleLeaveGroup}
              onOpenGroupModal={handleOpenModal}
              buildCardImageUrl={buildCardImageUrl}
              CARD_IMAGE_FALLBACK={CARD_IMAGE_FALLBACK}
            />

            <BinderPagination
              page={safePage}
              setPage={setPage}
              totalPages={totalPages}
              visiblePages={visiblePages}
              pageJumpInput={pageJumpInput}
              setPageJumpInput={setPageJumpInput}
              clampPage={clampPage}
            />
          </main>
        </div>
      </div>

      <BinderHoverTooltip
        preview={hoverPreview}
        buildCardImageUrl={buildCardImageUrl}
        CARD_IMAGE_FALLBACK={CARD_IMAGE_FALLBACK}
      />
      <BinderCardModal
        group={modalGroup}
        buildCardImageUrl={buildCardImageUrl}
        CARD_IMAGE_FALLBACK={CARD_IMAGE_FALLBACK}
        onSellCards={isBinderPhaseActive ? undefined : handleSellCards}
        onVaultCards={isBinderPhaseActive ? undefined : handleVaultCards}
        vaultSlotsUsed={Number(vaultSummary?.vault_slots_used || 0)}
        vaultSlotsTotal={Number(vaultSummary?.vault_slots_total || 0)}
        onClose={() => setModalGroupKey(null)}
      />

      {showBinderPhaseChoiceModal ? (
        <BinderPhaseOptionModal
          hostileTargets={hostileTargets}
          promoBoxes={promoBoxes}
          banlistCards={banlistCards}
          onChoose={handleChooseBinderOption}
          busy={binderPhaseBusy}
          errorText={binderPhaseError}
        />
      ) : null}

      {showBinderPhaseResolveModal ? (
        <div className="binder-phase-modal-backdrop">
          <div className="binder-phase-modal binder-phase-modal-large">
            <div className="binder-phase-modal-kicker">BINDER RESOLUTION</div>
            <h2 className="binder-phase-modal-title">
              {BINDER_PHASE_OPTION_META[currentBinderPhaseOption]?.label || "Resolve Binder Phase Choice"}
            </h2>
            <p className="binder-phase-modal-copy">
              {BINDER_PHASE_OPTION_META[currentBinderPhaseOption]?.description}
            </p>

            {binderPhaseError ? (
              <div className="progression-global-error">{binderPhaseError}</div>
            ) : null}

            {["binder_removal", "forced_trade", "card_lockout", "gambled_removal"].includes(
              currentBinderPhaseOption
            ) ? (
              <div className="binder-phase-field-group">
                <label className="binder-filter-label" htmlFor="binder-phase-target-user">
                  Eligible Opponent
                </label>
                <select
                  id="binder-phase-target-user"
                  className="binder-filter-input"
                  value={binderPhaseTargetUserId}
                  onChange={(event) => setBinderPhaseTargetUserId(event.target.value)}
                  disabled={binderPhaseBusy}
                >
                  {hostileTargets.map((target) => (
                    <option key={target.user_id} value={target.user_id}>
                      #{target.overall_position ?? "-"} {target.username || "Player"}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {currentBinderPhaseOption === "binder_removal" ? (
              <div className="binder-phase-selection-grid">
                {targetBinderNameGroups.map((group) => {
                  const isSelected = binderPhaseSelectedTargetCardIds[0] === String(group.cardId);
                  return (
                    <button
                      key={`remove-${group.groupKey}`}
                      type="button"
                      className={`binder-phase-card-choice ${isSelected ? "is-selected" : ""}`}
                      onClick={() => setBinderPhaseSelectedTargetCardIds([String(group.cardId)])}
                      onMouseEnter={(event) => handleHoverGroup(group, event.currentTarget)}
                      onMouseLeave={handleLeaveGroup}
                    >
                      <img
                        src={buildCardImageUrl(group.card)}
                        alt={group.card?.name || "Card"}
                        onError={(event) => {
                          if (event.currentTarget.src !== CARD_IMAGE_FALLBACK) {
                            event.currentTarget.src = CARD_IMAGE_FALLBACK;
                          }
                        }}
                      />
                      <strong>{group.card?.name}</strong>
                      <span>x{group.totalQuantity}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {currentBinderPhaseOption === "card_lockout" ? (
              <div className="binder-phase-selection-grid">
                {targetBinderGroups.map((group) => {
                  const isSelected = binderPhaseSelectedTargetCardIds.includes(String(group.cardId));
                  return (
                    <button
                      key={`lockout-${group.groupKey}`}
                      type="button"
                      className={`binder-phase-card-choice ${isSelected ? "is-selected" : ""}`}
                      onClick={() => toggleTargetCardSelection(group.cardId, 3)}
                      onMouseEnter={(event) => handleHoverGroup(group, event.currentTarget)}
                      onMouseLeave={handleLeaveGroup}
                    >
                      <img
                        src={buildCardImageUrl(group.card)}
                        alt={group.card?.name || "Card"}
                        onError={(event) => {
                          if (event.currentTarget.src !== CARD_IMAGE_FALLBACK) {
                            event.currentTarget.src = CARD_IMAGE_FALLBACK;
                          }
                        }}
                      />
                      <strong>{group.card?.name}</strong>
                      <span>x{group.totalQuantity}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {currentBinderPhaseOption === "gambled_removal" ? (
              <>
                <div className="binder-phase-selection-grid">
                  {targetBinderGroups.map((group) => {
                    const isSelected = binderPhaseSelectedTargetCardIds.includes(String(group.cardId));
                    return (
                      <button
                        key={`gamble-${group.groupKey}`}
                        type="button"
                        className={`binder-phase-card-choice ${isSelected ? "is-selected" : ""}`}
                        onClick={() => toggleTargetCardSelection(group.cardId, 2)}
                        onMouseEnter={(event) => handleHoverGroup(group, event.currentTarget)}
                        onMouseLeave={handleLeaveGroup}
                      >
                        <img
                          src={buildCardImageUrl(group.card)}
                          alt={group.card?.name || "Card"}
                          onError={(event) => {
                            if (event.currentTarget.src !== CARD_IMAGE_FALLBACK) {
                              event.currentTarget.src = CARD_IMAGE_FALLBACK;
                            }
                          }}
                        />
                        <strong>{group.card?.name}</strong>
                        <span>x{group.totalQuantity}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="binder-phase-field-group">
                  <label className="binder-filter-label" htmlFor="binder-phase-promo-box">
                    Promo Box Choice
                  </label>
                  <select
                    id="binder-phase-promo-box"
                    className="binder-filter-input"
                    value={binderPhaseSelectedPromoBoxId}
                    onChange={(event) => setBinderPhaseSelectedPromoBoxId(event.target.value)}
                    disabled={binderPhaseBusy}
                  >
                    {promoBoxes.map((box) => (
                      <option key={box.id} value={box.id}>
                        {box.code || "PROMO"} - {box.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}

            {currentBinderPhaseOption === "forced_trade" ? (
              <div className="binder-phase-trade-layout">
                <section className="binder-phase-trade-panel">
                  <div className="binder-phase-panel-head">
                    <h3>Your 2 Cards</h3>
                    <span>{selectedGiveCount}/2 selected</span>
                  </div>
                  <div className="binder-phase-trade-row-list">
                    {binderRows.map((row) => {
                      const selectedQuantity = Number(binderPhaseGiveSelections[row.id] || 0);
                      return (
                        <div className="binder-phase-trade-row" key={`give-${row.id}`}>
                          <button
                            type="button"
                            className="binder-phase-trade-card"
                            onMouseEnter={(event) =>
                              handleHoverGroup(buildBinderGroupFromRow(row), event.currentTarget)
                            }
                            onMouseLeave={handleLeaveGroup}
                          >
                            <img
                              src={buildCardImageUrl(row.card)}
                              alt={row.card?.name || "Card"}
                              onError={(event) => {
                                if (event.currentTarget.src !== CARD_IMAGE_FALLBACK) {
                                  event.currentTarget.src = CARD_IMAGE_FALLBACK;
                                }
                              }}
                            />
                            <div>
                              <strong>{row.card?.name}</strong>
                              <span>{row.rarity?.name || "Unknown"} | {row.quantity} available</span>
                            </div>
                          </button>

                          <div className="binder-phase-trade-qty">
                            <button
                              type="button"
                              onClick={() =>
                                updateTradeSelection(
                                  setBinderPhaseGiveSelections,
                                  row.id,
                                  selectedQuantity - 1,
                                  row.quantity,
                                  2
                                )
                              }
                              disabled={binderPhaseBusy || selectedQuantity <= 0}
                            >
                              -
                            </button>
                            <span>{selectedQuantity}</span>
                            <button
                              type="button"
                              onClick={() =>
                                updateTradeSelection(
                                  setBinderPhaseGiveSelections,
                                  row.id,
                                  selectedQuantity + 1,
                                  row.quantity,
                                  2
                                )
                              }
                              disabled={
                                binderPhaseBusy ||
                                selectedQuantity >= row.quantity ||
                                selectedGiveCount >= 2
                              }
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="binder-phase-trade-panel">
                  <div className="binder-phase-panel-head">
                    <h3>{selectedHostileTarget?.username || "Opponent"} 2 Cards</h3>
                    <span>{selectedTakeCount}/2 selected</span>
                  </div>
                  <div className="binder-phase-trade-row-list">
                    {binderPhaseTargetRows.map((row) => {
                      const selectedQuantity = Number(binderPhaseTakeSelections[row.id] || 0);
                      return (
                        <div className="binder-phase-trade-row" key={`take-${row.id}`}>
                          <button
                            type="button"
                            className="binder-phase-trade-card"
                            onMouseEnter={(event) =>
                              handleHoverGroup(buildBinderGroupFromRow(row), event.currentTarget)
                            }
                            onMouseLeave={handleLeaveGroup}
                          >
                            <img
                              src={buildCardImageUrl(row.card)}
                              alt={row.card?.name || "Card"}
                              onError={(event) => {
                                if (event.currentTarget.src !== CARD_IMAGE_FALLBACK) {
                                  event.currentTarget.src = CARD_IMAGE_FALLBACK;
                                }
                              }}
                            />
                            <div>
                              <strong>{row.card?.name}</strong>
                              <span>{row.rarity?.name || "Unknown"} | {row.quantity} available</span>
                            </div>
                          </button>

                          <div className="binder-phase-trade-qty">
                            <button
                              type="button"
                              onClick={() =>
                                updateTradeSelection(
                                  setBinderPhaseTakeSelections,
                                  row.id,
                                  selectedQuantity - 1,
                                  row.quantity,
                                  2
                                )
                              }
                              disabled={binderPhaseBusy || selectedQuantity <= 0}
                            >
                              -
                            </button>
                            <span>{selectedQuantity}</span>
                            <button
                              type="button"
                              onClick={() =>
                                updateTradeSelection(
                                  setBinderPhaseTakeSelections,
                                  row.id,
                                  selectedQuantity + 1,
                                  row.quantity,
                                  2
                                )
                              }
                              disabled={
                                binderPhaseBusy ||
                                selectedQuantity >= row.quantity ||
                                selectedTakeCount >= 2
                              }
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            ) : null}

            {currentBinderPhaseOption === "binder_stack" ? (
              <div className="binder-phase-trade-row-list">
                {stackEligibleRows.map((row) => {
                  const isSelected = binderPhaseSelectedBinderRowId === row.id;
                  return (
                    <button
                      key={`stack-${row.id}`}
                      type="button"
                      className={`binder-phase-card-choice binder-phase-card-choice-row ${isSelected ? "is-selected" : ""}`}
                      onClick={() => setBinderPhaseSelectedBinderRowId(row.id)}
                      onMouseEnter={(event) =>
                        handleHoverGroup(buildBinderGroupFromRow(row), event.currentTarget)
                      }
                      onMouseLeave={handleLeaveGroup}
                    >
                      <img
                        src={buildCardImageUrl(row.card)}
                        alt={row.card?.name || "Card"}
                        onError={(event) => {
                          if (event.currentTarget.src !== CARD_IMAGE_FALLBACK) {
                            event.currentTarget.src = CARD_IMAGE_FALLBACK;
                          }
                        }}
                      />
                      <div>
                        <strong>{row.card?.name}</strong>
                        <span>
                          {row.rarity?.name || "Unknown"} | Family Total {binderGroupTotals.get(String(row.cardId)) || 0}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {currentBinderPhaseOption === "ban_list_cards" ? (
              <div className="binder-phase-form-grid">
                <div className="binder-phase-field-group">
                  <label className="binder-filter-label" htmlFor="binder-phase-banlist-1">
                    Ban List Card 1
                  </label>
                  <select
                    id="binder-phase-banlist-1"
                    className="binder-filter-input"
                    value={binderPhaseBanlistCardIds[0]}
                    onChange={(event) =>
                      setBinderPhaseBanlistCardIds((current) => [event.target.value, current[1]])
                    }
                    disabled={binderPhaseBusy}
                  >
                    <option value="">Choose a card</option>
                    {banlistCards.map((row) => (
                      <option key={`ban-one-${row.card_id}`} value={row.card_id}>
                        {row.card_name} ({row.status})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="binder-phase-field-group">
                  <label className="binder-filter-label" htmlFor="binder-phase-banlist-2">
                    Ban List Card 2
                  </label>
                  <select
                    id="binder-phase-banlist-2"
                    className="binder-filter-input"
                    value={binderPhaseBanlistCardIds[1]}
                    onChange={(event) =>
                      setBinderPhaseBanlistCardIds((current) => [current[0], event.target.value])
                    }
                    disabled={binderPhaseBusy}
                  >
                    <option value="">Choose a card</option>
                    {banlistCards.map((row) => (
                      <option key={`ban-two-${row.card_id}`} value={row.card_id}>
                        {row.card_name} ({row.status})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}

            {currentBinderPhaseOption === "promo_box_open" ? (
              <div className="binder-phase-field-group">
                <label className="binder-filter-label" htmlFor="binder-phase-promo-only">
                  Promo Box Choice
                </label>
                <select
                  id="binder-phase-promo-only"
                  className="binder-filter-input"
                  value={binderPhaseSelectedPromoBoxId}
                  onChange={(event) => setBinderPhaseSelectedPromoBoxId(event.target.value)}
                  disabled={binderPhaseBusy}
                >
                  {promoBoxes.map((box) => (
                    <option key={box.id} value={box.id}>
                      {box.code || "PROMO"} - {box.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="binder-phase-modal-actions">
              <button
                type="button"
                className="binder-phase-confirm-btn"
                onClick={handleResolveBinderChoice}
                disabled={binderPhaseBusy}
              >
                {binderPhaseBusy ? "Resolving..." : "Resolve Binder Choice"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </LauncherLayout>
  );
}

export default BinderPage;
