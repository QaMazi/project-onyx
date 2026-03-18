import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../../components/LauncherLayout";
import { useUser } from "../../../context/UserContext";
import { supabase } from "../../../lib/supabase";
import "./StarterDeckEditorPage.css";

const SECTION_OPTIONS = [
  { value: "main", label: "Main" },
  { value: "extra", label: "Extra" },
  { value: "side", label: "Side" },
];

function parseYdkText(rawText) {
  const lines = rawText.split(/\r?\n/);
  const counts = new Map();
  let currentSection = "main";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line === "#main") {
      currentSection = "main";
      continue;
    }

    if (line === "#extra") {
      currentSection = "extra";
      continue;
    }

    if (line === "!side") {
      currentSection = "side";
      continue;
    }

    const cardId = Number(line);
    if (!Number.isFinite(cardId)) continue;

    const key = `${cardId}::${currentSection}`;
    const existing = counts.get(key);

    counts.set(key, {
      card_id: cardId,
      section: currentSection,
      quantity: Number(existing?.quantity || 0) + 1,
    });
  }

  return [...counts.values()];
}

function StarterDeckEditorPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [activeSeries, setActiveSeries] = useState(null);

  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateCards, setTemplateCards] = useState([]);

  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedSection, setSelectedSection] = useState("main");

  const [ydkText, setYdkText] = useState("");

  const [seriesAssignments, setSeriesAssignments] = useState([
    "",
    "",
    "",
    "",
    "",
    "",
  ]);

  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const canUsePage = user?.role === "Admin+" || user?.role === "Admin";

  async function hydrateCardsWithNames(rows) {
    const uniqueIds = [...new Set(rows.map((row) => Number(row.card_id)).filter(Boolean))];

    if (!uniqueIds.length) {
      return rows.map((row) => ({
        ...row,
        card_name: row.card_name || `Card ${row.card_id}`,
      }));
    }

    const { data, error } = await supabase
      .from("cards")
      .select("id, name")
      .in("id", uniqueIds);

    if (error) {
      throw error;
    }

    const nameMap = new Map((data || []).map((card) => [Number(card.id), card.name]));

    return rows.map((row) => ({
      ...row,
      card_name: nameMap.get(Number(row.card_id)) || row.card_name || `Card ${row.card_id}`,
    }));
  }

  async function loadPage() {
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const [
        activeSeriesResponse,
        templatesResponse,
        templateCardsResponse,
        seriesStarterDecksResponse,
      ] = await Promise.all([
        supabase
          .from("game_series")
          .select("id, name")
          .eq("is_current", true)
          .maybeSingle(),

        supabase
          .from("starter_deck_templates")
          .select("*")
          .order("created_at", { ascending: true }),

        supabase
          .from("starter_deck_template_cards")
          .select("*")
          .order("section", { ascending: true })
          .order("card_id", { ascending: true }),

        supabase
          .from("series_starter_decks")
          .select("id, series_id, slot_number, starter_deck_template_id, claimed_by_user_id, claimed_at")
          .order("slot_number", { ascending: true }),
      ]);

      if (activeSeriesResponse.error) throw activeSeriesResponse.error;
      if (templatesResponse.error) throw templatesResponse.error;
      if (templateCardsResponse.error) throw templateCardsResponse.error;
      if (seriesStarterDecksResponse.error) throw seriesStarterDecksResponse.error;

      const nextActiveSeries = activeSeriesResponse.data || null;
      setActiveSeries(nextActiveSeries);

      const cardsByTemplateId = new Map();

      (templateCardsResponse.data || []).forEach((row) => {
        if (!cardsByTemplateId.has(row.starter_deck_template_id)) {
          cardsByTemplateId.set(row.starter_deck_template_id, []);
        }

        cardsByTemplateId.get(row.starter_deck_template_id).push({
          card_id: Number(row.card_id),
          section: row.section,
          quantity: Number(row.quantity || 0),
        });
      });

      const hydratedTemplates = [];
      for (const template of templatesResponse.data || []) {
        const hydratedCards = await hydrateCardsWithNames(
          cardsByTemplateId.get(template.id) || []
        );

        hydratedTemplates.push({
          ...template,
          cards: hydratedCards,
        });
      }

      setTemplates(hydratedTemplates);

      const pickedTemplate =
        hydratedTemplates.find((template) => template.id === selectedTemplateId) ||
        hydratedTemplates[0] ||
        null;

      if (pickedTemplate) {
        setSelectedTemplateId(pickedTemplate.id);
        setTemplateName(pickedTemplate.name || "");
        setTemplateDescription(pickedTemplate.description || "");
        setTemplateCards(pickedTemplate.cards || []);
      } else {
        setSelectedTemplateId("");
        setTemplateName("");
        setTemplateDescription("");
        setTemplateCards([]);
      }

      const nextAssignments = ["", "", "", "", "", ""];
      (seriesStarterDecksResponse.data || [])
        .filter((row) => row.series_id === nextActiveSeries?.id)
        .forEach((row) => {
          if (row.slot_number >= 1 && row.slot_number <= 6) {
            nextAssignments[row.slot_number - 1] = row.starter_deck_template_id || "";
          }
        });

      setSeriesAssignments(nextAssignments);
    } catch (error) {
      console.error("Failed to load starter deck editor:", error);
      setErrorMessage(error.message || "Failed to load starter deck editor.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && user) {
      loadPage();
    }
  }, [authLoading, user]);

  useEffect(() => {
    let cancelled = false;

    async function runSearch() {
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

        if (error) throw error;

        if (!cancelled) {
          setSearchResults(data || []);
        }
      } catch (error) {
        console.error("Starter deck search failed:", error);
        if (!cancelled) {
          setSearchResults([]);
        }
      }
    }

    runSearch();

    return () => {
      cancelled = true;
    };
  }, [searchText]);

  const templateSummary = useMemo(() => {
    return templateCards.reduce(
      (totals, row) => {
        totals[row.section] += Number(row.quantity || 0);
        return totals;
      },
      { main: 0, extra: 0, side: 0 }
    );
  }, [templateCards]);

  async function handleTemplateChange(nextTemplateId) {
    setSelectedTemplateId(nextTemplateId);

    if (!nextTemplateId) {
      setTemplateName("");
      setTemplateDescription("");
      setTemplateCards([]);
      return;
    }

    const template = templates.find((entry) => entry.id === nextTemplateId);

    if (!template) return;

    setTemplateName(template.name || "");
    setTemplateDescription(template.description || "");
    setTemplateCards(template.cards || []);
  }

  function handleNewTemplate() {
    setSelectedTemplateId("");
    setTemplateName("");
    setTemplateDescription("");
    setTemplateCards([]);
    setYdkText("");
    setSearchText("");
    setSearchResults([]);
    setStatusMessage("");
    setErrorMessage("");
  }

  function handleAddCard(card) {
    setTemplateCards((prev) => {
      const existingIndex = prev.findIndex(
        (row) =>
          Number(row.card_id) === Number(card.id) &&
          row.section === selectedSection
      );

      if (existingIndex === -1) {
        return [
          ...prev,
          {
            card_id: Number(card.id),
            section: selectedSection,
            quantity: 1,
            card_name: card.name,
          },
        ];
      }

      const next = [...prev];
      next[existingIndex] = {
        ...next[existingIndex],
        quantity: Number(next[existingIndex].quantity || 0) + 1,
      };
      return next;
    });
  }

  function handleSectionChange(index, section) {
    setTemplateCards((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], section };
      return next;
    });
  }

  function handleQuantityChange(index, quantity) {
    setTemplateCards((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        quantity: Math.max(1, Number(quantity || 1)),
      };
      return next;
    });
  }

  function handleRemoveCard(index) {
    setTemplateCards((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleImportYdk() {
    setErrorMessage("");
    setStatusMessage("");

    try {
      const parsedRows = parseYdkText(ydkText);

      if (!parsedRows.length) {
        throw new Error("No valid .ydk entries found.");
      }

      const hydratedRows = await hydrateCardsWithNames(parsedRows);
      setTemplateCards(hydratedRows);
      setStatusMessage(`Imported ${hydratedRows.length} rows from .ydk text.`);
    } catch (error) {
      console.error("Failed to import ydk:", error);
      setErrorMessage(error.message || "Failed to import .ydk.");
    }
  }

  async function handleSaveTemplate() {
    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const { error } = await supabase.rpc("upsert_starter_deck_template", {
        p_template_id: selectedTemplateId || null,
        p_name: templateName,
        p_description: templateDescription,
        p_cards: templateCards.map((row) => ({
          card_id: Number(row.card_id),
          section: row.section,
          quantity: Number(row.quantity || 0),
        })),
      });

      if (error) throw error;

      setStatusMessage("Starter deck template saved.");
      await loadPage();
    } catch (error) {
      console.error("Failed to save starter deck template:", error);
      setErrorMessage(error.message || "Failed to save starter deck template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTemplate() {
    if (!selectedTemplateId) return;

    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const { error } = await supabase.rpc("delete_starter_deck_template", {
        p_template_id: selectedTemplateId,
      });

      if (error) throw error;

      setStatusMessage("Starter deck template deleted.");
      handleNewTemplate();
      await loadPage();
    } catch (error) {
      console.error("Failed to delete starter deck template:", error);
      setErrorMessage(error.message || "Failed to delete starter deck template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSeriesPool() {
    if (!activeSeries?.id) return;

    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      if (seriesAssignments.some((value) => !value)) {
        throw new Error("All 6 starter deck slots must be assigned.");
      }

      if (new Set(seriesAssignments).size !== 6) {
        throw new Error("Each of the 6 starter deck slots must use a different template.");
      }

      const { error } = await supabase.rpc("assign_series_starter_decks", {
        p_series_id: activeSeries.id,
        p_template_ids: seriesAssignments,
      });

      if (error) throw error;

      setStatusMessage("Active series 6-deck starter pool saved.");
      await loadPage();
    } catch (error) {
      console.error("Failed to save series starter pool:", error);
      setErrorMessage(error.message || "Failed to save series starter pool.");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) return null;

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (!canUsePage) {
    return <Navigate to="/mode/progression" replace />;
  }

  return (
    <LauncherLayout>
      <div className="starter-deck-page">
        <div className="starter-deck-topbar">
          <div>
            <div className="starter-deck-kicker">ADMIN</div>
            <h1 className="starter-deck-title">Starter Deck Editor</h1>
            <p className="starter-deck-subtitle">
              Build starter deck templates, import .ydk lists, and assign the 6-deck starter pool for the active series.
            </p>
          </div>

          <div className="starter-deck-topbar-actions">
            <button
              type="button"
              className="starter-deck-secondary-btn"
              onClick={() => navigate("/mode/progression")}
            >
              Back
            </button>
          </div>
        </div>

        {loading ? (
          <div className="starter-deck-card starter-deck-empty">
            Loading starter deck editor...
          </div>
        ) : (
          <>
            <div className="starter-deck-status-row">
              <div className="starter-deck-chip">
                Active Series: {activeSeries?.name || "None"}
              </div>

              {statusMessage ? (
                <div className="starter-deck-success">{statusMessage}</div>
              ) : null}

              {errorMessage ? (
                <div className="starter-deck-error">{errorMessage}</div>
              ) : null}
            </div>

            <div className="starter-deck-layout">
              <section className="starter-deck-card starter-deck-editor-card">
                <div className="starter-deck-section-header">
                  <h2>Template Editor</h2>

                  <div className="starter-deck-section-actions">
                    <button
                      type="button"
                      className="starter-deck-secondary-btn"
                      onClick={handleNewTemplate}
                      disabled={saving}
                    >
                      New Template
                    </button>
                  </div>
                </div>

                <div className="starter-deck-form-grid">
                  <div className="starter-deck-field">
                    <label>Load Template</label>
                    <select
                      className="starter-deck-select"
                      value={selectedTemplateId}
                      onChange={(e) => handleTemplateChange(e.target.value)}
                      disabled={saving}
                    >
                      <option value="">New template...</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="starter-deck-field">
                    <label>Template Name</label>
                    <input
                      className="starter-deck-input"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="Starter deck name"
                      disabled={saving}
                    />
                  </div>
                </div>

                <div className="starter-deck-field">
                  <label>Description</label>
                  <textarea
                    className="starter-deck-textarea"
                    value={templateDescription}
                    onChange={(e) => setTemplateDescription(e.target.value)}
                    placeholder="Optional description..."
                    disabled={saving}
                  />
                </div>

                <div className="starter-deck-summary-row">
                  <div className="starter-deck-chip">Main {templateSummary.main}</div>
                  <div className="starter-deck-chip">Extra {templateSummary.extra}</div>
                  <div className="starter-deck-chip">Side {templateSummary.side}</div>
                </div>

                <div className="starter-deck-search-block">
                  <div className="starter-deck-search-controls">
                    <input
                      className="starter-deck-input"
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      placeholder="Search cards..."
                      disabled={saving}
                    />

                    <select
                      className="starter-deck-select"
                      value={selectedSection}
                      onChange={(e) => setSelectedSection(e.target.value)}
                      disabled={saving}
                    >
                      {SECTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="starter-deck-search-results">
                    {searchText.trim().length < 2 ? (
                      <div className="starter-deck-empty small">
                        Type at least 2 characters to search cards.
                      </div>
                    ) : searchResults.length === 0 ? (
                      <div className="starter-deck-empty small">
                        No matching cards found.
                      </div>
                    ) : (
                      searchResults.map((card) => (
                        <div className="starter-deck-search-row" key={card.id}>
                          <div>
                            <div className="starter-deck-row-name">{card.name}</div>
                            <div className="starter-deck-row-meta">Card ID: {card.id}</div>
                          </div>

                          <button
                            type="button"
                            className="starter-deck-primary-btn"
                            onClick={() => handleAddCard(card)}
                            disabled={saving}
                          >
                            Add to {selectedSection}
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="starter-deck-ydk-block">
                  <label>.ydk Import</label>
                  <textarea
                    className="starter-deck-textarea starter-deck-ydk-textarea"
                    value={ydkText}
                    onChange={(e) => setYdkText(e.target.value)}
                    placeholder={"#main\n12345678\n12345678\n#extra\n...\n!side\n..."}
                    disabled={saving}
                  />

                  <button
                    type="button"
                    className="starter-deck-secondary-btn"
                    onClick={handleImportYdk}
                    disabled={saving}
                  >
                    Import .ydk Text
                  </button>
                </div>

                <div className="starter-deck-editor-actions">
                  <button
                    type="button"
                    className="starter-deck-primary-btn"
                    onClick={handleSaveTemplate}
                    disabled={saving}
                  >
                    Save Template
                  </button>

                  <button
                    type="button"
                    className="starter-deck-danger-btn"
                    onClick={handleDeleteTemplate}
                    disabled={saving || !selectedTemplateId}
                  >
                    Delete Template
                  </button>
                </div>
              </section>

              <section className="starter-deck-card starter-deck-cards-card">
                <div className="starter-deck-section-header">
                  <h2>Template Cards</h2>
                </div>

                {templateCards.length === 0 ? (
                  <div className="starter-deck-empty">No cards in this template.</div>
                ) : (
                  <div className="starter-deck-card-list">
                    {templateCards.map((row, index) => (
                      <div
                        className="starter-deck-card-row"
                        key={`${row.card_id}-${row.section}-${index}`}
                      >
                        <div>
                          <div className="starter-deck-row-name">
                            {row.card_name || `Card ${row.card_id}`}
                          </div>
                          <div className="starter-deck-row-meta">
                            Card ID: {row.card_id}
                          </div>
                        </div>

                        <div className="starter-deck-card-row-actions">
                          <select
                            className="starter-deck-select small"
                            value={row.section}
                            onChange={(e) => handleSectionChange(index, e.target.value)}
                            disabled={saving}
                          >
                            {SECTION_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>

                          <input
                            type="number"
                            min="1"
                            className="starter-deck-input small"
                            value={row.quantity}
                            onChange={(e) => handleQuantityChange(index, e.target.value)}
                            disabled={saving}
                          />

                          <button
                            type="button"
                            className="starter-deck-danger-btn small"
                            onClick={() => handleRemoveCard(index)}
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
            </div>

            <section className="starter-deck-card starter-deck-pool-card">
              <div className="starter-deck-section-header">
                <h2>Active Series 6-Deck Pool</h2>
              </div>

              <div className="starter-deck-pool-grid">
                {seriesAssignments.map((value, index) => (
                  <div className="starter-deck-field" key={`starter-pool-slot-${index + 1}`}>
                    <label>Slot {index + 1}</label>
                    <select
                      className="starter-deck-select"
                      value={value}
                      onChange={(e) =>
                        setSeriesAssignments((prev) => {
                          const next = [...prev];
                          next[index] = e.target.value;
                          return next;
                        })
                      }
                      disabled={saving}
                    >
                      <option value="">Choose template...</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="starter-deck-editor-actions">
                <button
                  type="button"
                  className="starter-deck-primary-btn"
                  onClick={handleSaveSeriesPool}
                  disabled={saving || !activeSeries?.id}
                >
                  Save 6-Deck Series Pool
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </LauncherLayout>
  );
}

export default StarterDeckEditorPage;
