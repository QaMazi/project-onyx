import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useProgression } from "../../context/ProgressionContext";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";
import "./BanlistPage.css";

const STATUS_OPTIONS = [
  { value: "forbidden", label: "Forbidden", exportValue: 0 },
  { value: "limited", label: "Limited", exportValue: 1 },
  { value: "semi_limited", label: "Semi-Limited", exportValue: 2 },
  { value: "unlimited", label: "Unlimited", exportValue: 3 },
];

const STATUS_LABELS = {
  forbidden: "Forbidden",
  limited: "Limited",
  semi_limited: "Semi-Limited",
  unlimited: "Unlimited",
};

const SOURCE_KIND_LABELS = {
  era: "Era",
  custom: "Custom",
  system: "System",
};

const BAN_PHASE_OPTION_COPY = {
  forbidden: "Choose one card to make Forbidden this round.",
  limited: "Choose one card to make Limited this round.",
  semi_limited: "Choose one card to make Semi-Limited this round.",
  unlimited: "Choose one currently banned card to return to Unlimited.",
  pass: "Take the Random Draft Pack Key reward instead.",
};

const IMPORT_SECTION_TO_STATUS = {
  "#forbidden": "forbidden",
  "#limited": "limited",
  "#semi-limited": "semi_limited",
  "#unlimited": "unlimited",
};

const STATUS_TO_EXPORT_VALUE = {
  forbidden: 0,
  limited: 1,
  semi_limited: 2,
  unlimited: 3,
};

const SECTION_CONFIG = [
  { status: "forbidden", title: "Forbidden" },
  { status: "limited", title: "Limited" },
  { status: "semi_limited", title: "Semi-Limited" },
  { status: "unlimited", title: "Unlimited" },
];

function getStatusLabel(status) {
  return STATUS_LABELS[status] || status || "Unknown";
}

function getSourceKindLabel(sourceKind) {
  return SOURCE_KIND_LABELS[sourceKind] || "Custom";
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function parseBanlistText(rawText) {
  const lines = rawText.split(/\r?\n/);
  const parsed = [];
  let currentStatus = null;
  let title = "Progression Series";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("!")) {
      title = line.slice(1).trim() || title;
      continue;
    }

    const normalized = line.toLowerCase();
    if (IMPORT_SECTION_TO_STATUS[normalized]) {
      currentStatus = IMPORT_SECTION_TO_STATUS[normalized];
      continue;
    }

    if (line.startsWith("#") || !currentStatus) continue;

    const beforeComment = line.split("--")[0].trim();
    if (!beforeComment) continue;

    const parts = beforeComment.split(/\s+/);
    if (parts.length < 2) continue;

    const cardId = Number(parts[0]);
    if (!Number.isFinite(cardId)) continue;

    parsed.push({ card_id: cardId, status: currentStatus });
  }

  return { title, entries: parsed };
}

function buildBanlistText(title, entries) {
  const grouped = {
    forbidden: [],
    limited: [],
    semi_limited: [],
    unlimited: [],
  };

  entries.forEach((entry) => {
    if (grouped[entry.status]) grouped[entry.status].push(entry);
  });

  const sortByNameThenId = (left, right) => {
    const nameA = String(left.card_name || "").toLowerCase();
    const nameB = String(right.card_name || "").toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return Number(left.card_id) - Number(right.card_id);
  };

  Object.keys(grouped).forEach((key) => grouped[key].sort(sortByNameThenId));

  function renderSection(heading, rows, statusKey) {
    const block = [heading];
    rows.forEach((row) => {
      block.push(
        `${row.card_id} ${STATUS_TO_EXPORT_VALUE[statusKey]} --${row.card_name}`
      );
    });
    return block.join("\n");
  }

  return [
    `!${title || "Progression Series"}`,
    renderSection("#forbidden", grouped.forbidden, "forbidden"),
    renderSection("#limited", grouped.limited, "limited"),
    renderSection("#semi-limited", grouped.semi_limited, "semi_limited"),
    renderSection("#unlimited", grouped.unlimited, "unlimited"),
  ].join("\n\n");
}

function describeBanPhaseRow(row) {
  const sourceKind = String(row?.source_kind || "custom").toLowerCase();
  if (sourceKind === "era") return "Official era baseline";
  if (sourceKind === "system") {
    return `System ban for Round ${row?.source_round_number ?? "?"}-${row?.source_round_step ?? "?"}`;
  }
  if (row?.modified_round_number && row?.modified_round_step) {
    return `Custom ban from Round ${row.modified_round_number}-${row.modified_round_step}`;
  }
  return "Custom player ban";
}

function isModifiedThisRound(row, banPhaseState) {
  return (
    Number(row?.modified_round_number || 0) === Number(banPhaseState?.round_number || 0) &&
    Number(row?.modified_round_step || 0) === Number(banPhaseState?.round_step || 0)
  );
}

function isCardSelectableForBanChoice(cardId, choiceOption, rowsByCardId, banPhaseState) {
  if (!cardId || !choiceOption) return false;
  const existingRow = rowsByCardId.get(Number(cardId));

  if (choiceOption === "unlimited") {
    if (!existingRow) return false;
    if (String(existingRow.status || "").toLowerCase() === "unlimited") return false;
    return !isModifiedThisRound(existingRow, banPhaseState);
  }

  if (existingRow?.source_kind === "era") return false;
  if (existingRow && isModifiedThisRound(existingRow, banPhaseState)) return false;
  return true;
}

function getBanPhaseSearchHint(choiceOption) {
  if (choiceOption === "unlimited") {
    return "Search for a card currently on the series banlist. Era bans can only be changed with Unlimited.";
  }

  if (choiceOption === "forbidden" || choiceOption === "limited" || choiceOption === "semi_limited") {
    return "Search for a card, then drag it into the matching section below or click the result to place it there.";
  }

  return "Wait for your turn to choose a ban option.";
}

function formatTurnPosition(turn) {
  const parts = [];
  if (Number(turn?.last_round_placement || 0) > 0) {
    parts.push(`Last Round: ${turn.last_round_placement}`);
  }
  if (Number(turn?.overall_position || 0) > 0) {
    parts.push(`Overall: ${turn.overall_position}`);
  }
  return parts.join(" | ") || "Awaiting placement data";
}

function BanlistSection({ title, rows, onChangeStatus, onRemove, saving }) {
  return (
    <section className="banlist-section-card">
      <div className="banlist-section-header">
        <h2 className="banlist-section-title">{title}</h2>
        <span className="banlist-section-count">{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <div className="banlist-empty-state">No cards in this section.</div>
      ) : (
        <div className="banlist-table">
          {rows.map((row) => (
            <div className="banlist-row" key={row.card_id}>
              <div className="banlist-row-main">
                <div className="banlist-row-name">{row.card_name}</div>
                <div className="banlist-row-meta">Card ID: {row.card_id}</div>
              </div>

              <div className="banlist-row-actions">
                <select
                  className="banlist-select"
                  value={row.status}
                  onChange={(event) => onChangeStatus(row.card_id, event.target.value)}
                  disabled={saving}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  className="banlist-remove-btn"
                  onClick={() => onRemove(row.card_id)}
                  disabled={saving}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BanPhaseOptionModal({ availableOptions, busy, onChooseOption }) {
  return (
    <div className="ban-phase-modal-backdrop">
      <div className="ban-phase-option-modal">
        <div className="banlist-kicker">BAN PHASE</div>
        <h2 className="ban-phase-option-title">Choose Your Ban Option</h2>
        <p className="ban-phase-option-copy">
          Each player gets one option this round. The matching card pick comes next.
        </p>

        <div className="ban-phase-option-grid">
          {[...STATUS_OPTIONS, { value: "pass", label: "Pass" }].map((option) => {
            const available = Boolean(availableOptions?.[option.value]);
            return (
              <button
                key={option.value}
                type="button"
                className={`ban-phase-option-btn ${available ? "" : "is-disabled"}`}
                onClick={() => onChooseOption(option.value)}
                disabled={busy || !available}
              >
                <span>{option.label}</span>
                <small>{BAN_PHASE_OPTION_COPY[option.value]}</small>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BanPhaseTurnOrder({ turns, currentTurnUserId, currentUserId }) {
  return (
    <section className="ban-phase-card">
      <div className="ban-phase-card-header">
        <h2>Ban Order</h2>
        <span>{turns.length} Players</span>
      </div>

      <div className="ban-phase-turn-stack">
        {turns.map((turn) => {
          const isCurrentTurn = turn.user_id === currentTurnUserId;
          const isMyTurn = turn.user_id === currentUserId;
          return (
            <article
              key={`${turn.turn_order}-${turn.user_id}`}
              className={`ban-phase-turn-card ${isCurrentTurn ? "is-current" : ""} ${isMyTurn ? "is-mine" : ""}`}
            >
              <div className="ban-phase-turn-top">
                <strong>
                  #{turn.turn_order} {turn.username || "Player"}
                </strong>
                <span>
                  {turn.completed_at
                    ? turn.choice_option === "pass"
                      ? "Passed"
                      : getStatusLabel(turn.choice_option)
                    : isCurrentTurn
                      ? "Current Turn"
                      : "Waiting"}
                </span>
              </div>

              <div className="ban-phase-turn-meta">{formatTurnPosition(turn)}</div>

              {turn.selected_card_name ? (
                <div className="ban-phase-turn-result">
                  {turn.selected_card_name} {"->"} {getStatusLabel(turn.choice_option)}
                </div>
              ) : null}

              {turn.choice_option === "pass" ? (
                <div className="ban-phase-turn-result">
                  Pass Reward: {turn.reward_item_name || "Random Draft Pack Key"}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function BanPhaseBanlistSection({
  title,
  status,
  rows,
  dropEnabled,
  dropActive,
  onDropCard,
  onDragActivate,
  onDragClear,
}) {
  return (
    <section
      className={`banlist-section-card ban-phase-section-card ${dropEnabled ? "is-droppable" : ""} ${dropActive ? "is-drop-active" : ""}`}
      onDragOver={(event) => {
        if (!dropEnabled) return;
        event.preventDefault();
        onDragActivate();
      }}
      onDragLeave={() => {
        if (dropEnabled) onDragClear();
      }}
      onDrop={(event) => {
        if (!dropEnabled) return;
        event.preventDefault();
        const cardId = Number(event.dataTransfer.getData("text/plain"));
        onDragClear();
        if (Number.isFinite(cardId)) {
          onDropCard(cardId);
        }
      }}
    >
      <div className="banlist-section-header">
        <h2 className="banlist-section-title">{title}</h2>
        <span className="banlist-section-count">{rows.length}</span>
      </div>

      {dropEnabled ? (
        <div className="ban-phase-drop-hint">
          Drag a card here to set it to {getStatusLabel(status)}.
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="banlist-empty-state">No cards in this section.</div>
      ) : (
        <div className="banlist-table">
          {rows.map((row) => (
            <div className="banlist-row ban-phase-row" key={`${status}-${row.card_id}`}>
              <div className="banlist-row-main">
                <div className="banlist-row-name">{row.card_name}</div>
                <div className="ban-phase-row-badges">
                  <span className={`ban-phase-source-badge source-${row.source_kind || "custom"}`}>
                    {getSourceKindLabel(row.source_kind)}
                  </span>
                </div>
                <div className="banlist-row-meta">{describeBanPhaseRow(row)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BanPhaseSystemBans({ rows }) {
  if (!rows.length) return null;

  return (
    <section className="ban-phase-card">
      <div className="ban-phase-card-header">
        <h2>System Ban Rolls</h2>
        <span>{rows.length} Applied</span>
      </div>

      <div className="ban-phase-system-grid">
        {rows.map((row) => (
          <article
            key={`${row.target_user_id}-${row.card_id}-${row.applied_status}`}
            className="ban-phase-system-card"
          >
            <strong>{row.username || "Player"}</strong>
            <div>{row.card_name || `Card ${row.card_id}`}</div>
            <small>
              {row.deck_section || "main"} copy #{row.deck_copy_index || 1} {"->"}{" "}
              {getStatusLabel(row.applied_status)}
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}

function BanlistPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const { user, authLoading } = useUser();
  const {
    state: progressionState,
    readyUp,
    refresh: refreshProgression,
    busy: progressionBusy,
  } = useProgression();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banPhaseBusy, setBanPhaseBusy] = useState(false);

  const [activeSeries, setActiveSeries] = useState(null);
  const [banlistRows, setBanlistRows] = useState([]);
  const [banPhaseState, setBanPhaseState] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedStatus, setSelectedStatus] = useState("forbidden");
  const [dropTargetStatus, setDropTargetStatus] = useState("");

  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const canViewBanlist =
    user?.role === "Admin+" ||
    user?.role === "Admin" ||
    user?.role === "Duelist";

  const isBanlistEditor = user?.role === "Admin+" || user?.role === "Admin";
  const isBanPhaseMode =
    String(progressionState?.currentPhase || "").toLowerCase() === "ban" &&
    Number(progressionState?.roundNumber || 0) > 0 &&
    Boolean(progressionState?.activeSeriesId);

  const rowsByCardId = useMemo(
    () => new Map(banlistRows.map((row) => [Number(row.card_id), row])),
    [banlistRows]
  );

  const groupedRows = useMemo(
    () =>
      SECTION_CONFIG.reduce((accumulator, section) => {
        accumulator[section.status] = banlistRows.filter(
          (row) => row.status === section.status
        );
        return accumulator;
      }, {}),
    [banlistRows]
  );

  const filteredBanPhaseSearchResults = useMemo(() => {
    if (!isBanPhaseMode || banPhaseState?.my_action_state !== "choose_card") {
      return [];
    }

    return searchResults.filter((card) =>
      isCardSelectableForBanChoice(
        card.id,
        banPhaseState?.my_choice_option,
        rowsByCardId,
        banPhaseState
      )
    );
  }, [banPhaseState, isBanPhaseMode, rowsByCardId, searchResults]);

  async function fetchHydratedBanlistRows(seriesId) {
    const { data: rawRows, error: banlistError } = await supabase
      .from("series_banlist_cards")
      .select(
        "id, series_id, card_id, status, notes, source_kind, source_round_number, source_round_step, modified_round_number, modified_round_step, modified_by_user_id"
      )
      .eq("series_id", seriesId)
      .order("card_id", { ascending: true });

    if (banlistError) throw banlistError;

    const cardIds = [...new Set((rawRows || []).map((row) => Number(row.card_id)).filter(Boolean))];
    let cardMap = new Map();

    if (cardIds.length > 0) {
      const { data: cardsData, error: cardsError } = await supabase
        .from("cards")
        .select("id, name")
        .in("id", cardIds);

      if (cardsError) throw cardsError;
      cardMap = new Map((cardsData || []).map((card) => [Number(card.id), card.name]));
    }

    return (rawRows || [])
      .map((row) => ({
        ...row,
        card_name: cardMap.get(Number(row.card_id)) || `Card ${row.card_id}`,
      }))
      .sort((left, right) => {
        const nameCompare = String(left.card_name).localeCompare(String(right.card_name));
        if (nameCompare !== 0) return nameCompare;
        return Number(left.card_id) - Number(right.card_id);
      });
  }

  async function loadBanlistPage(options = {}) {
    const preserveMessages = Boolean(options.preserveMessages);
    setLoading(true);

    if (!preserveMessages) {
      setErrorMessage("");
      setStatusMessage("");
    }

    try {
      const preferredSeriesId = progressionState?.activeSeriesId || null;
      let seriesRow = null;

      if (preferredSeriesId) {
        const { data, error } = await supabase
          .from("game_series")
          .select("id, name")
          .eq("id", preferredSeriesId)
          .maybeSingle();

        if (error) throw error;
        seriesRow = data;
      } else {
        const { data, error } = await supabase
          .from("game_series")
          .select("id, name")
          .eq("is_current", true)
          .maybeSingle();

        if (error) throw error;
        seriesRow = data;
      }

      if (!seriesRow?.id) {
        throw new Error("No active series found.");
      }

      setActiveSeries(seriesRow);
      setBanlistRows(await fetchHydratedBanlistRows(seriesRow.id));

      if (isBanPhaseMode) {
        const { data, error } = await supabase.rpc("get_current_ban_phase_state", {
          p_series_id: seriesRow.id,
        });

        if (error) throw error;
        setBanPhaseState(data || null);
      } else {
        setBanPhaseState(null);
      }
    } catch (error) {
      console.error("Failed to load banlist page:", error);
      setErrorMessage(error.message || "Failed to load banlist.");
      setBanlistRows([]);
      setBanPhaseState(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && user) {
      loadBanlistPage();
    }
  }, [
    authLoading,
    user,
    progressionState?.activeSeriesId,
    progressionState?.currentPhase,
    progressionState?.roundNumber,
    progressionState?.roundStep,
  ]);

  useEffect(() => {
    if (!isBanPhaseMode || !activeSeries?.id) return undefined;

    const intervalId = window.setInterval(() => {
      loadBanlistPage({ preserveMessages: true });
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [activeSeries?.id, isBanPhaseMode]);

  useEffect(() => {
    let isCancelled = false;

    async function runCardSearch() {
      const query = searchText.trim();

      if (query.length < 2) {
        setSearchResults([]);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("cards")
          .select("id, name")
          .ilike("name", `%${query}%`)
          .order("name", { ascending: true })
          .limit(30);

        if (error) throw error;
        if (!isCancelled) {
          setSearchResults(data || []);
        }
      } catch (error) {
        console.error("Card search failed:", error);
        if (!isCancelled) {
          setSearchResults([]);
        }
      }
    }

    runCardSearch();

    return () => {
      isCancelled = true;
    };
  }, [searchText]);

  async function handleAddCard(card) {
    if (!activeSeries?.id) return;

    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const existing = banlistRows.find((row) => Number(row.card_id) === Number(card.id));

      if (existing) {
        const { error } = await supabase
          .from("series_banlist_cards")
          .update({
            status: selectedStatus,
            source_kind: "era",
            source_round_number: null,
            source_round_step: null,
            modified_round_number: null,
            modified_round_step: null,
            modified_by_user_id: null,
          })
          .eq("series_id", activeSeries.id)
          .eq("card_id", card.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("series_banlist_cards")
          .insert({
            series_id: activeSeries.id,
            card_id: card.id,
            status: selectedStatus,
            source_kind: "era",
          });

        if (error) throw error;
      }

      setStatusMessage(`${card.name} set to ${getStatusLabel(selectedStatus)}.`);
      await loadBanlistPage({ preserveMessages: true });
    } catch (error) {
      console.error("Failed to add/update banlist card:", error);
      setErrorMessage(error.message || "Failed to update banlist.");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangeStatus(cardId, nextStatus) {
    if (!activeSeries?.id) return;

    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const { error } = await supabase
        .from("series_banlist_cards")
        .update({
          status: nextStatus,
          source_kind: "era",
          source_round_number: null,
          source_round_step: null,
          modified_round_number: null,
          modified_round_step: null,
          modified_by_user_id: null,
        })
        .eq("series_id", activeSeries.id)
        .eq("card_id", cardId);

      if (error) throw error;
      setStatusMessage(`Card moved to ${getStatusLabel(nextStatus)}.`);
      await loadBanlistPage({ preserveMessages: true });
    } catch (error) {
      console.error("Failed to change banlist status:", error);
      setErrorMessage(error.message || "Failed to update card status.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(cardId) {
    if (!activeSeries?.id) return;

    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const { error } = await supabase
        .from("series_banlist_cards")
        .delete()
        .eq("series_id", activeSeries.id)
        .eq("card_id", cardId);

      if (error) throw error;
      setStatusMessage("Card removed from banlist.");
      await loadBanlistPage({ preserveMessages: true });
    } catch (error) {
      console.error("Failed to remove banlist card:", error);
      setErrorMessage(error.message || "Failed to remove card.");
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    if (!activeSeries?.id) return;

    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      let exportedText = "";
      const { data, error } = await supabase.rpc("export_series_banlist", {
        p_series_id: activeSeries.id,
      });

      if (!error && typeof data === "string" && data.trim()) {
        exportedText = data;
      } else {
        exportedText = buildBanlistText(activeSeries.name || "Progression Series", banlistRows);
      }

      downloadTextFile(
        `${(activeSeries.name || "ProgressionSeries").replace(/\s+/g, "_")}.lflist.conf`,
        exportedText
      );

      setStatusMessage("Banlist exported.");
    } catch (error) {
      console.error("Failed to export banlist:", error);
      setErrorMessage(error.message || "Failed to export banlist.");
    } finally {
      setSaving(false);
    }
  }

  async function handleImportFile(event) {
    const file = event.target.files?.[0];
    if (!file || !activeSeries?.id) return;

    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const text = await file.text();
      const parsed = parseBanlistText(text);

      if (!parsed.entries.length) {
        throw new Error("No valid banlist entries found in file.");
      }

      const dedupedMap = new Map();
      parsed.entries.forEach((entry) => {
        dedupedMap.set(Number(entry.card_id), {
          series_id: activeSeries.id,
          card_id: Number(entry.card_id),
          status: entry.status,
          source_kind: "era",
        });
      });

      const rowsToInsert = [...dedupedMap.values()];

      const { error: deleteError } = await supabase
        .from("series_banlist_cards")
        .delete()
        .eq("series_id", activeSeries.id);

      if (deleteError) throw deleteError;

      const { error: insertError } = await supabase
        .from("series_banlist_cards")
        .insert(rowsToInsert);

      if (insertError) throw insertError;

      setStatusMessage(`Imported ${rowsToInsert.length} banlist entries.`);
      await loadBanlistPage({ preserveMessages: true });
    } catch (error) {
      console.error("Failed to import banlist:", error);
      setErrorMessage(error.message || "Failed to import banlist.");
    } finally {
      event.target.value = "";
      setSaving(false);
    }
  }

  async function handleChooseBanPhaseOption(choiceOption) {
    if (!activeSeries?.id) return;

    setBanPhaseBusy(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const { error } = await supabase.rpc("choose_current_ban_phase_option", {
        p_series_id: activeSeries.id,
        p_choice_option: choiceOption,
      });

      if (error) throw error;

      setStatusMessage(
        choiceOption === "pass"
          ? "Pass selected. Random Draft Pack Key was added to your inventory."
          : `${getStatusLabel(choiceOption)} selected. Search for a card and place it into the matching section.`
      );

      await refreshProgression();
      await loadBanlistPage({ preserveMessages: true });
    } catch (error) {
      console.error("Failed to choose Ban Phase option:", error);
      setErrorMessage(error.message || "Failed to choose a Ban Phase option.");
    } finally {
      setBanPhaseBusy(false);
    }
  }

  async function handleSubmitBanPhaseCard(cardId) {
    if (!activeSeries?.id || !Number.isFinite(Number(cardId))) return;

    setBanPhaseBusy(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const { error } = await supabase.rpc("submit_current_ban_phase_card", {
        p_series_id: activeSeries.id,
        p_card_id: Number(cardId),
      });

      if (error) throw error;

      setStatusMessage("Ban Phase card submitted.");
      setSearchText("");
      setSearchResults([]);
      await refreshProgression();
      await loadBanlistPage({ preserveMessages: true });
    } catch (error) {
      console.error("Failed to submit Ban Phase card:", error);
      setErrorMessage(error.message || "Failed to submit the ban card.");
    } finally {
      setBanPhaseBusy(false);
    }
  }

  async function handleConfirmBanPhase() {
    setBanPhaseBusy(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      await readyUp();
      setStatusMessage("Banlist confirmed. Waiting for the phase to advance.");
      await loadBanlistPage({ preserveMessages: true });
    } catch (error) {
      console.error("Failed to confirm Ban Phase:", error);
      setErrorMessage(error.message || "Failed to confirm the banlist.");
    } finally {
      setBanPhaseBusy(false);
    }
  }

  if (authLoading) return null;
  if (!user || user.role === "Blocked") {
    return <Navigate to="/" replace />;
  }
  if (!canViewBanlist) {
    return <Navigate to="/mode" replace />;
  }

  const banPhaseChoiceCardRows =
    isBanPhaseMode && banPhaseState?.my_action_state === "choose_card"
      ? filteredBanPhaseSearchResults
      : searchResults;

  return (
    <LauncherLayout>
      <div className="banlist-page">
        <div className="banlist-header-card">
          <div>
            <div className="banlist-kicker">PROGRESSION</div>
            <h1 className="banlist-title">{isBanPhaseMode ? "Ban Phase" : "Series Banlist"}</h1>
            <p className="banlist-subtitle">
              {isBanPhaseMode
                ? "Turn-based bans happen here first, then the system rolls one random deck ban for every player."
                : "Manage the active series era banlist, import `.lflist.conf`, and export browser downloads."}
            </p>
          </div>

          <div className="banlist-header-actions">
            <button
              type="button"
              className="banlist-secondary-btn"
              onClick={() => navigate("/mode/progression")}
            >
              Back
            </button>

            {!isBanPhaseMode && isBanlistEditor ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".conf,.lflist,.txt"
                  className="banlist-hidden-file-input"
                  onChange={handleImportFile}
                />

                <button
                  type="button"
                  className="banlist-secondary-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving || loading}
                >
                  Import
                </button>

                <button
                  type="button"
                  className="banlist-primary-btn"
                  onClick={handleExport}
                  disabled={saving || loading}
                >
                  Export
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="banlist-status-row">
          <div className="banlist-series-chip">
            Active Series: {activeSeries?.name || "Unknown"}
          </div>

          {isBanPhaseMode && banPhaseState ? (
            <div className="banlist-series-chip">
              Round {banPhaseState.round_number}-{banPhaseState.round_step} Ban Phase
            </div>
          ) : null}

          {statusMessage ? <div className="banlist-status-message">{statusMessage}</div> : null}
          {errorMessage ? <div className="banlist-error-message">{errorMessage}</div> : null}
        </div>

        {isBanPhaseMode ? (
          <>
            <div className="ban-phase-layout">
              <BanPhaseTurnOrder
                turns={Array.isArray(banPhaseState?.turns) ? banPhaseState.turns : []}
                currentTurnUserId={banPhaseState?.current_turn_user_id}
                currentUserId={user.id}
              />

              <section className="ban-phase-card">
                <div className="ban-phase-card-header">
                  <h2>Current Ban State</h2>
                  <span>
                    {Number(banPhaseState?.confirmation_count || 0)}/
                    {Number(banPhaseState?.player_count || 0)} confirmed
                  </span>
                </div>

                <div className="ban-phase-summary-grid">
                  <div className="ban-phase-summary-item">
                    <span>Current Turn</span>
                    <strong>
                      {Array.isArray(banPhaseState?.turns)
                        ? banPhaseState.turns.find(
                            (turn) => turn.user_id === banPhaseState.current_turn_user_id
                          )?.username || "Waiting"
                        : "Waiting"}
                    </strong>
                  </div>

                  <div className="ban-phase-summary-item">
                    <span>Your State</span>
                    <strong>
                      {banPhaseState?.my_action_state === "choose_option"
                        ? "Choose Option"
                        : banPhaseState?.my_action_state === "choose_card"
                          ? `Choose ${getStatusLabel(banPhaseState?.my_choice_option)} Card`
                          : banPhaseState?.my_action_state === "confirm"
                            ? "Confirm Banlist"
                            : banPhaseState?.my_action_state === "confirmed"
                              ? "Confirmed"
                              : "Waiting"}
                    </strong>
                  </div>

                  <div className="ban-phase-summary-item">
                    <span>Passes Allowed</span>
                    <strong>{banPhaseState?.pass_limit || 1}</strong>
                  </div>
                </div>

                <div className="ban-phase-summary-copy">
                  {banPhaseState?.my_action_state === "choose_card"
                    ? getBanPhaseSearchHint(banPhaseState?.my_choice_option)
                    : banPhaseState?.my_action_state === "confirm"
                      ? "All player choices and system bans are ready. Confirm the banlist so the phase can advance."
                      : "Wait for the turn order to resolve, then confirm once the system bans are visible."}
                </div>
              </section>
            </div>

            {banPhaseState?.my_action_state === "choose_card" ? (
              <div className="banlist-editor-card ban-phase-search-card">
                <div className="banlist-editor-header">
                  <h2 className="banlist-editor-title">
                    Choose a {getStatusLabel(banPhaseState?.my_choice_option)} Card
                  </h2>
                </div>

                <div className="banlist-editor-controls">
                  <input
                    type="text"
                    className="banlist-search-input"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="Search card name..."
                    disabled={banPhaseBusy}
                  />

                  <div className="ban-phase-search-status">
                    Target Section: {getStatusLabel(banPhaseState?.my_choice_option)}
                  </div>
                </div>

                <div className="banlist-search-results">
                  {searchText.trim().length < 2 ? (
                    <div className="banlist-empty-state">
                      Type at least 2 characters to search cards.
                    </div>
                  ) : banPhaseChoiceCardRows.length === 0 ? (
                    <div className="banlist-empty-state">
                      No valid cards match this choice for the current round.
                    </div>
                  ) : (
                    banPhaseChoiceCardRows.map((card) => (
                      <div
                        className="banlist-search-row ban-phase-search-row"
                        key={card.id}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", String(card.id));
                        }}
                      >
                        <div className="banlist-row-main">
                          <div className="banlist-row-name">{card.name}</div>
                          <div className="banlist-row-meta">Card ID: {card.id}</div>
                        </div>

                        <button
                          type="button"
                          className="banlist-primary-btn"
                          onClick={() => handleSubmitBanPhaseCard(card.id)}
                          disabled={banPhaseBusy}
                        >
                          Set {getStatusLabel(banPhaseState?.my_choice_option)}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            {loading ? (
              <div className="banlist-loading-card">Loading Ban Phase...</div>
            ) : (
              <div className="banlist-sections-grid">
                {SECTION_CONFIG.map((section) => (
                  <BanPhaseBanlistSection
                    key={section.status}
                    title={section.title}
                    status={section.status}
                    rows={groupedRows[section.status] || []}
                    dropEnabled={
                      banPhaseState?.my_action_state === "choose_card" &&
                      banPhaseState?.my_choice_option === section.status
                    }
                    dropActive={dropTargetStatus === section.status}
                    onDragActivate={() => setDropTargetStatus(section.status)}
                    onDragClear={() => setDropTargetStatus("")}
                    onDropCard={handleSubmitBanPhaseCard}
                  />
                ))}
              </div>
            )}

            <BanPhaseSystemBans rows={banPhaseState?.system_bans || []} />

            {banPhaseState?.can_confirm || banPhaseState?.already_confirmed ? (
              <div className="ban-phase-confirm-bar">
                <div>
                  {banPhaseState?.already_confirmed
                    ? "You confirmed the Ban Phase. Waiting for the remaining players."
                    : "Confirm the banlist after reviewing the system bans."}
                </div>

                <button
                  type="button"
                  className="banlist-primary-btn"
                  onClick={handleConfirmBanPhase}
                  disabled={
                    banPhaseBusy || progressionBusy || Boolean(banPhaseState?.already_confirmed)
                  }
                >
                  {banPhaseState?.already_confirmed ? "Confirmed" : "Confirm Banlist"}
                </button>
              </div>
            ) : null}

            {banPhaseState?.my_action_state === "choose_option" ? (
              <BanPhaseOptionModal
                availableOptions={banPhaseState?.available_options}
                busy={banPhaseBusy}
                onChooseOption={handleChooseBanPhaseOption}
              />
            ) : null}
          </>
        ) : (
          <>
            {isBanlistEditor ? (
              <div className="banlist-editor-card">
                <div className="banlist-editor-header">
                  <h2 className="banlist-editor-title">Add or Update Era Ban Card</h2>
                </div>

                <div className="banlist-editor-controls">
                  <input
                    type="text"
                    className="banlist-search-input"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="Search card name..."
                    disabled={saving || loading}
                  />

                  <select
                    className="banlist-select"
                    value={selectedStatus}
                    onChange={(event) => setSelectedStatus(event.target.value)}
                    disabled={saving || loading}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="banlist-search-results">
                  {searchText.trim().length < 2 ? (
                    <div className="banlist-empty-state">
                      Type at least 2 characters to search cards.
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="banlist-empty-state">No matching cards found.</div>
                  ) : (
                    searchResults.map((card) => (
                      <div className="banlist-search-row" key={card.id}>
                        <div className="banlist-row-main">
                          <div className="banlist-row-name">{card.name}</div>
                          <div className="banlist-row-meta">Card ID: {card.id}</div>
                        </div>

                        <button
                          type="button"
                          className="banlist-primary-btn"
                          onClick={() => handleAddCard(card)}
                          disabled={saving}
                        >
                          Set {getStatusLabel(selectedStatus)}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            {loading ? (
              <div className="banlist-loading-card">Loading banlist...</div>
            ) : (
              <div className="banlist-sections-grid">
                <BanlistSection
                  title="Forbidden"
                  rows={groupedRows.forbidden || []}
                  onChangeStatus={handleChangeStatus}
                  onRemove={handleRemove}
                  saving={saving || !isBanlistEditor}
                />

                <BanlistSection
                  title="Limited"
                  rows={groupedRows.limited || []}
                  onChangeStatus={handleChangeStatus}
                  onRemove={handleRemove}
                  saving={saving || !isBanlistEditor}
                />

                <BanlistSection
                  title="Semi-Limited"
                  rows={groupedRows.semi_limited || []}
                  onChangeStatus={handleChangeStatus}
                  onRemove={handleRemove}
                  saving={saving || !isBanlistEditor}
                />

                <BanlistSection
                  title="Unlimited"
                  rows={groupedRows.unlimited || []}
                  onChangeStatus={handleChangeStatus}
                  onRemove={handleRemove}
                  saving={saving || !isBanlistEditor}
                />
              </div>
            )}
          </>
        )}
      </div>
    </LauncherLayout>
  );
}

export default BanlistPage;
