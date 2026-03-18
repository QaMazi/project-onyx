import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
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

function getStatusLabel(status) {
  return STATUS_LABELS[status] || status || "Unknown";
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

    if (line.startsWith("#")) {
      continue;
    }

    if (!currentStatus) {
      continue;
    }

    const beforeComment = line.split("--")[0].trim();
    if (!beforeComment) continue;

    const parts = beforeComment.split(/\s+/);
    if (parts.length < 2) continue;

    const cardId = Number(parts[0]);
    if (!Number.isFinite(cardId)) continue;

    parsed.push({
      card_id: cardId,
      status: currentStatus,
    });
  }

  return {
    title,
    entries: parsed,
  };
}

function buildBanlistText(title, entries) {
  const grouped = {
    forbidden: [],
    limited: [],
    semi_limited: [],
    unlimited: [],
  };

  entries.forEach((entry) => {
    if (grouped[entry.status]) {
      grouped[entry.status].push(entry);
    }
  });

  const sortByNameThenId = (a, b) => {
    const nameA = (a.card_name || "").toLowerCase();
    const nameB = (b.card_name || "").toLowerCase();

    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return Number(a.card_id) - Number(b.card_id);
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

function BanlistSection({
  title,
  rows,
  onChangeStatus,
  onRemove,
  saving,
}) {
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
                  onChange={(event) =>
                    onChangeStatus(row.card_id, event.target.value)
                  }
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

function BanlistPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [activeSeries, setActiveSeries] = useState(null);
  const [banlistRows, setBanlistRows] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedStatus, setSelectedStatus] = useState("forbidden");

  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const canViewBanlist =
    user?.role === "Admin+" ||
    user?.role === "Admin" ||
    user?.role === "Duelist";

  const isBanlistEditor = user?.role === "Admin+" || user?.role === "Admin";

  async function loadBanlistPage() {
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const { data: currentSeries, error: currentSeriesError } = await supabase
        .from("game_series")
        .select("id, name")
        .eq("is_current", true)
        .maybeSingle();

      if (currentSeriesError) {
        throw currentSeriesError;
      }

      if (!currentSeries?.id) {
        throw new Error("No active series found.");
      }

      setActiveSeries(currentSeries);

      const { data: rawBanlistRows, error: banlistError } = await supabase
        .from("series_banlist_cards")
        .select("id, series_id, card_id, status, notes")
        .eq("series_id", currentSeries.id)
        .order("card_id", { ascending: true });

      if (banlistError) {
        throw banlistError;
      }

      const cardIds = [...new Set((rawBanlistRows || []).map((row) => row.card_id))];

      let cardMap = new Map();

      if (cardIds.length > 0) {
        const { data: cardsData, error: cardsError } = await supabase
          .from("cards")
          .select("id, name")
          .in("id", cardIds);

        if (cardsError) {
          throw cardsError;
        }

        cardMap = new Map(
          (cardsData || []).map((card) => [Number(card.id), card.name])
        );
      }

      const hydratedRows = (rawBanlistRows || []).map((row) => ({
        ...row,
        card_name: cardMap.get(Number(row.card_id)) || `Card ${row.card_id}`,
      }));

      hydratedRows.sort((a, b) => {
        const nameA = (a.card_name || "").toLowerCase();
        const nameB = (b.card_name || "").toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return Number(a.card_id) - Number(b.card_id);
      });

      setBanlistRows(hydratedRows);
    } catch (error) {
      console.error("Failed to load banlist page:", error);
      setErrorMessage(error.message || "Failed to load banlist.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && user) {
      loadBanlistPage();
    }
  }, [authLoading, user]);

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
          .limit(20);

        if (error) {
          throw error;
        }

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

  const forbiddenRows = useMemo(
    () => banlistRows.filter((row) => row.status === "forbidden"),
    [banlistRows]
  );

  const limitedRows = useMemo(
    () => banlistRows.filter((row) => row.status === "limited"),
    [banlistRows]
  );

  const semiLimitedRows = useMemo(
    () => banlistRows.filter((row) => row.status === "semi_limited"),
    [banlistRows]
  );

  const unlimitedRows = useMemo(
    () => banlistRows.filter((row) => row.status === "unlimited"),
    [banlistRows]
  );

  async function handleAddCard(card) {
    if (!activeSeries?.id) return;

    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const existing = banlistRows.find(
        (row) => Number(row.card_id) === Number(card.id)
      );

      if (existing) {
        const { error } = await supabase
          .from("series_banlist_cards")
          .update({ status: selectedStatus })
          .eq("series_id", activeSeries.id)
          .eq("card_id", card.id);

        if (error) {
          throw error;
        }
      } else {
        const { error } = await supabase
          .from("series_banlist_cards")
          .insert({
            series_id: activeSeries.id,
            card_id: card.id,
            status: selectedStatus,
          });

        if (error) {
          throw error;
        }
      }

      setStatusMessage(
        `${card.name} set to ${getStatusLabel(selectedStatus)}.`
      );
      await loadBanlistPage();
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
        .update({ status: nextStatus })
        .eq("series_id", activeSeries.id)
        .eq("card_id", cardId);

      if (error) {
        throw error;
      }

      setStatusMessage(`Card moved to ${getStatusLabel(nextStatus)}.`);
      await loadBanlistPage();
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

      if (error) {
        throw error;
      }

      setStatusMessage("Card removed from banlist.");
      await loadBanlistPage();
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
        exportedText = buildBanlistText(
          activeSeries.name || "Progression Series",
          banlistRows
        );
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
        });
      });

      const rowsToInsert = [...dedupedMap.values()];

      const { error: deleteError } = await supabase
        .from("series_banlist_cards")
        .delete()
        .eq("series_id", activeSeries.id);

      if (deleteError) {
        throw deleteError;
      }

      const { error: insertError } = await supabase
        .from("series_banlist_cards")
        .insert(rowsToInsert);

      if (insertError) {
        throw insertError;
      }

      setStatusMessage(`Imported ${rowsToInsert.length} banlist entries.`);
      await loadBanlistPage();
    } catch (error) {
      console.error("Failed to import banlist:", error);
      setErrorMessage(error.message || "Failed to import banlist.");
    } finally {
      event.target.value = "";
      setSaving(false);
    }
  }

  if (authLoading) return null;

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (user.role === "Blocked") {
    return <Navigate to="/" replace />;
  }

  if (!canViewBanlist) {
    return <Navigate to="/mode" replace />;
  }

  return (
    <LauncherLayout>
      <div className="banlist-page">
        <div className="banlist-header-card">
          <div>
            <div className="banlist-kicker">PROGRESSION</div>
            <h1 className="banlist-title">Series Banlist</h1>
            <p className="banlist-subtitle">
              Manage the active series banlist, import `.lflist.conf`, and export browser downloads.
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

            {isBanlistEditor && (
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
            )}
          </div>
        </div>

        <div className="banlist-status-row">
          <div className="banlist-series-chip">
            Active Series: {activeSeries?.name || "Unknown"}
          </div>

          {statusMessage ? (
            <div className="banlist-status-message">{statusMessage}</div>
          ) : null}

          {errorMessage ? (
            <div className="banlist-error-message">{errorMessage}</div>
          ) : null}
        </div>

        {isBanlistEditor && (
          <div className="banlist-editor-card">
            <div className="banlist-editor-header">
              <h2 className="banlist-editor-title">Add or Update Card</h2>
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
        )}

        {loading ? (
          <div className="banlist-loading-card">Loading banlist...</div>
        ) : (
          <div className="banlist-sections-grid">
            <BanlistSection
              title="Forbidden"
              rows={forbiddenRows}
              onChangeStatus={handleChangeStatus}
              onRemove={handleRemove}
              saving={saving || !isBanlistEditor}
            />

            <BanlistSection
              title="Limited"
              rows={limitedRows}
              onChangeStatus={handleChangeStatus}
              onRemove={handleRemove}
              saving={saving || !isBanlistEditor}
            />

            <BanlistSection
              title="Semi-Limited"
              rows={semiLimitedRows}
              onChangeStatus={handleChangeStatus}
              onRemove={handleRemove}
              saving={saving || !isBanlistEditor}
            />

            <BanlistSection
              title="Unlimited"
              rows={unlimitedRows}
              onChangeStatus={handleChangeStatus}
              onRemove={handleRemove}
              saving={saving || !isBanlistEditor}
            />
          </div>
        )}
      </div>
    </LauncherLayout>
  );
}

export default BanlistPage;
