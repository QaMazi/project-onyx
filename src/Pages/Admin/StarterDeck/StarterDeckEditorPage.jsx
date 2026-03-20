import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../../components/LauncherLayout";
import { useUser } from "../../../context/UserContext";
import { supabase } from "../../../lib/supabase";
import DeckMainSection from "../../DeckBuilder/Components/DeckMainSection";
import DeckExtraSection from "../../DeckBuilder/Components/DeckExtraSection";
import DeckSideSection from "../../DeckBuilder/Components/DeckSideSection";
import DeckCardHoverTooltip from "../../DeckBuilder/Components/DeckCardHoverTooltip";
import DeckCardImageModal from "../../DeckBuilder/Components/DeckCardImageModal";
import "../../DeckBuilder/DeckBuilderPage.css";
import "./StarterDeckEditorPage.css";

const CARD_SELECT_FIELDS = "id, name, image_url, desc, type, race, attribute, level, atk, def";
const SORT_OPTIONS = [
  { label: "Name", value: "name" },
  { label: "ATK", value: "atk" },
  { label: "DEF", value: "def" },
  { label: "Level", value: "level" },
];
const TYPE_FLAGS = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
  EFFECT: 0x20,
  FUSION: 0x40,
  SYNCHRO: 0x2000,
  XYZ: 0x800000,
  LINK: 0x4000000,
};

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

function buildCardImageUrl(card) {
  if (card?.image_url) return card.image_url;
  return `https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/${card?.id}.jpg`;
}

function isExtraDeckCard(card) {
  const type = Number(card?.type || 0);
  return (
    (type & TYPE_FLAGS.FUSION) === TYPE_FLAGS.FUSION ||
    (type & TYPE_FLAGS.SYNCHRO) === TYPE_FLAGS.SYNCHRO ||
    (type & TYPE_FLAGS.XYZ) === TYPE_FLAGS.XYZ ||
    (type & TYPE_FLAGS.LINK) === TYPE_FLAGS.LINK
  );
}

function getAllowedSections(card) {
  if (!card) return ["main", "side"];
  return isExtraDeckCard(card) ? ["extra", "side"] : ["main", "side"];
}

function sortCards(cards, field, direction) {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...cards].sort((left, right) => {
    if (field === "name") {
      return multiplier * String(left?.name || "").localeCompare(String(right?.name || ""));
    }

    const leftValue = Number(left?.[field] ?? -999999);
    const rightValue = Number(right?.[field] ?? -999999);
    if (leftValue === rightValue) {
      return String(left?.name || "").localeCompare(String(right?.name || ""));
    }
    return multiplier * (leftValue - rightValue);
  });
}

function cloneTemplateRows(rows) {
  return (rows || []).map((row) => ({
    card_id: Number(row.card_id),
    section: row.section || "main",
    quantity: Math.max(1, Number(row.quantity || 1)),
    card: row.card || null,
  }));
}

function getStarterDeckSortGroup(card) {
  const type = Number(card?.type || 0);

  if ((type & TYPE_FLAGS.SPELL) === TYPE_FLAGS.SPELL) return 2;
  if ((type & TYPE_FLAGS.TRAP) === TYPE_FLAGS.TRAP) return 3;
  if ((type & TYPE_FLAGS.MONSTER) === TYPE_FLAGS.MONSTER) {
    return (type & TYPE_FLAGS.EFFECT) === TYPE_FLAGS.EFFECT ? 0 : 1;
  }

  return 4;
}

function getStarterDeckCardName(card, fallbackCardId) {
  const name = String(card?.name || "").trim();
  if (name) return name;
  return `Card ${fallbackCardId}`;
}

function compareStarterDeckRows(left, right) {
  const leftCard = left?.card || null;
  const rightCard = right?.card || null;
  const leftGroup = getStarterDeckSortGroup(leftCard);
  const rightGroup = getStarterDeckSortGroup(rightCard);

  if (leftGroup !== rightGroup) {
    return leftGroup - rightGroup;
  }

  if (leftGroup === 0 || leftGroup === 1) {
    const leftLevel = Number(leftCard?.level || 0);
    const rightLevel = Number(rightCard?.level || 0);
    if (leftLevel !== rightLevel) {
      return rightLevel - leftLevel;
    }
  }

  const nameDiff = getStarterDeckCardName(leftCard, left?.card_id).localeCompare(
    getStarterDeckCardName(rightCard, right?.card_id)
  );
  if (nameDiff !== 0) {
    return nameDiff;
  }

  return Number(left?.card_id || 0) - Number(right?.card_id || 0);
}

function sortStarterDeckTemplateRows(rows) {
  const sectionOrder = ["main", "extra", "side"];
  const rowsBySection = new Map();

  (rows || []).forEach((row) => {
    const section = row?.section || "main";
    if (!rowsBySection.has(section)) {
      rowsBySection.set(section, []);
    }
    rowsBySection.get(section).push(row);
  });

  const sortedRows = [];

  sectionOrder.forEach((section) => {
    const sectionRows = rowsBySection.get(section) || [];
    sortedRows.push(...sectionRows.sort(compareStarterDeckRows));
    rowsBySection.delete(section);
  });

  Array.from(rowsBySection.keys())
    .sort((left, right) => String(left).localeCompare(String(right)))
    .forEach((section) => {
      sortedRows.push(...(rowsBySection.get(section) || []).sort(compareStarterDeckRows));
    });

  return sortedRows;
}

function expandSectionSlots(rows, section) {
  const slots = [];

  rows
    .filter((row) => row.section === section)
    .forEach((row) => {
      const copies = Math.max(1, Number(row.quantity || 1));
      for (let index = 0; index < copies; index += 1) {
        slots.push({
          cardId: Number(row.card_id),
          card: row.card,
          instanceKey: `${section}-${row.card_id}-${index}`,
        });
      }
    });

  return slots;
}

async function fetchCardMap(cardIds) {
  const uniqueIds = [...new Set((cardIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!uniqueIds.length) return new Map();

  const { data, error } = await supabase.from("cards").select(CARD_SELECT_FIELDS).in("id", uniqueIds);
  if (error) throw error;

  return new Map((data || []).map((card) => [String(card.id), card]));
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
  const [seriesAssignments, setSeriesAssignments] = useState(["", "", "", "", "", ""]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [sortField, setSortField] = useState("name");
  const [sortDirection, setSortDirection] = useState("asc");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [hoverPreview, setHoverPreview] = useState(null);
  const [imageModalCard, setImageModalCard] = useState(null);
  const [dragPayload, setDragPayload] = useState(null);
  const [activeDropSection, setActiveDropSection] = useState(null);
  const [mainCollapsed, setMainCollapsed] = useState(false);
  const [extraCollapsed, setExtraCollapsed] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [importedFileName, setImportedFileName] = useState("");
  const ydkInputRef = useRef(null);

  const canUsePage = user?.role === "Admin+" || user?.role === "Admin";

  function applyTemplate(template) {
    setSelectedTemplateId(template?.id || "");
    setTemplateName(template?.name || "");
    setTemplateDescription(template?.description || "");
    setTemplateCards(cloneTemplateRows(template?.cards || []));
    setImportedFileName("");
    setHoverPreview(null);
    setImageModalCard(null);
  }

  async function loadPage(preferredTemplateId = selectedTemplateId, preferredTemplateName = templateName.trim()) {
    setLoading(true);
    setErrorMessage("");

    try {
      const [activeSeriesResponse, templatesResponse, templateCardsResponse, seriesStarterDecksResponse] =
        await Promise.all([
          supabase.from("game_series").select("id, name").eq("is_current", true).maybeSingle(),
          supabase.from("starter_deck_templates").select("*").order("created_at", { ascending: true }),
          supabase
            .from("starter_deck_template_cards")
            .select("*")
            .order("section", { ascending: true })
            .order("card_id", { ascending: true }),
          supabase
            .from("series_starter_decks")
            .select("series_id, slot_number, starter_deck_template_id")
            .order("slot_number", { ascending: true }),
        ]);

      if (activeSeriesResponse.error) throw activeSeriesResponse.error;
      if (templatesResponse.error) throw templatesResponse.error;
      if (templateCardsResponse.error) throw templateCardsResponse.error;
      if (seriesStarterDecksResponse.error) throw seriesStarterDecksResponse.error;

      const nextActiveSeries = activeSeriesResponse.data || null;
      setActiveSeries(nextActiveSeries);

      const templateRows = templateCardsResponse.data || [];
      const cardMap = await fetchCardMap(templateRows.map((row) => row.card_id));
      const cardsByTemplateId = new Map();

      templateRows.forEach((row) => {
        if (!cardsByTemplateId.has(row.starter_deck_template_id)) {
          cardsByTemplateId.set(row.starter_deck_template_id, []);
        }

        cardsByTemplateId.get(row.starter_deck_template_id).push({
          card_id: Number(row.card_id),
          section: row.section || "main",
          quantity: Math.max(1, Number(row.quantity || 1)),
          card: cardMap.get(String(row.card_id)) || {
            id: Number(row.card_id),
            name: `Card ${row.card_id}`,
          },
        });
      });

      const hydratedTemplates = (templatesResponse.data || []).map((template) => ({
        ...template,
        cards: cardsByTemplateId.get(template.id) || [],
      }));

      setTemplates(hydratedTemplates);

      const pickedTemplate =
        hydratedTemplates.find((template) => template.id === preferredTemplateId) ||
        hydratedTemplates.find(
          (template) => !preferredTemplateId && preferredTemplateName && template.name === preferredTemplateName
        ) ||
        hydratedTemplates[0] ||
        null;

      applyTemplate(pickedTemplate);

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
      const query = searchTerm.trim();
      if (query.length < 2) {
        setSearchResults([]);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("cards")
          .select(CARD_SELECT_FIELDS)
          .ilike("name", `%${query}%`)
          .order("name", { ascending: true })
          .limit(60);

        if (error) throw error;
        if (!cancelled) setSearchResults(data || []);
      } catch (error) {
        console.error("Starter deck search failed:", error);
        if (!cancelled) setSearchResults([]);
      }
    }

    runSearch();
    return () => {
      cancelled = true;
    };
  }, [searchTerm]);

  const templateSummary = useMemo(
    () =>
      templateCards.reduce(
        (totals, row) => {
          totals[row.section] += Number(row.quantity || 0);
          return totals;
        },
        { main: 0, extra: 0, side: 0 }
      ),
    [templateCards]
  );

  const sectionUsageByCard = useMemo(() => {
    const usage = new Map();
    templateCards.forEach((row) => {
      const key = String(row.card_id);
      if (!usage.has(key)) usage.set(key, { main: 0, extra: 0, side: 0 });
      usage.get(key)[row.section] += Number(row.quantity || 0);
    });
    return usage;
  }, [templateCards]);

  const cardLookup = useMemo(() => {
    const next = new Map();
    searchResults.forEach((card) => next.set(String(card.id), card));
    templateCards.forEach((row) => {
      if (row.card) next.set(String(row.card_id), row.card);
    });
    return next;
  }, [searchResults, templateCards]);

  const browserCards = useMemo(
    () => sortCards(searchResults, sortField, sortDirection),
    [searchResults, sortField, sortDirection]
  );

  const mainCards = useMemo(() => expandSectionSlots(templateCards, "main"), [templateCards]);
  const extraCards = useMemo(() => expandSectionSlots(templateCards, "extra"), [templateCards]);
  const sideCards = useMemo(() => expandSectionSlots(templateCards, "side"), [templateCards]);

  function addCardToSection(cardId, section) {
    const card = cardLookup.get(String(cardId));
    if (!getAllowedSections(card).includes(section)) return;

    setTemplateCards((prev) => {
      const next = [...prev];
      const existingIndex = next.findIndex(
        (row) => Number(row.card_id) === Number(cardId) && row.section === section
      );

      if (existingIndex === -1) {
        next.push({
          card_id: Number(cardId),
          section,
          quantity: 1,
          card,
        });
      } else {
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: Number(next[existingIndex].quantity || 0) + 1,
          card: next[existingIndex].card || card,
        };
      }

      return next;
    });
  }

  function removeCardFromSection(cardId, section) {
    setHoverPreview(null);
    setImageModalCard(null);

    setTemplateCards((prev) => {
      const next = [...prev];
      const existingIndex = next.findIndex(
        (row) => Number(row.card_id) === Number(cardId) && row.section === section
      );
      if (existingIndex === -1) return prev;

      const currentQuantity = Number(next[existingIndex].quantity || 0);
      if (currentQuantity <= 1) {
        next.splice(existingIndex, 1);
      } else {
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: currentQuantity - 1,
        };
      }
      return next;
    });
  }

  function moveCardToSection(cardId, fromSection, toSection) {
    const card = cardLookup.get(String(cardId));
    if (!getAllowedSections(card).includes(toSection) || fromSection === toSection) return;

    setTemplateCards((prev) => {
      const next = [...prev];
      const sourceIndex = next.findIndex(
        (row) => Number(row.card_id) === Number(cardId) && row.section === fromSection
      );
      if (sourceIndex === -1) return prev;

      const sourceQuantity = Number(next[sourceIndex].quantity || 0);
      if (sourceQuantity <= 1) next.splice(sourceIndex, 1);
      else next[sourceIndex] = { ...next[sourceIndex], quantity: sourceQuantity - 1 };

      const targetIndex = next.findIndex(
        (row) => Number(row.card_id) === Number(cardId) && row.section === toSection
      );
      if (targetIndex === -1) {
        next.push({ card_id: Number(cardId), section: toSection, quantity: 1, card });
      } else {
        next[targetIndex] = {
          ...next[targetIndex],
          quantity: Number(next[targetIndex].quantity || 0) + 1,
          card: next[targetIndex].card || card,
        };
      }

      return next;
    });
  }

  function onDragStartBrowserCard(cardId) {
    setHoverPreview(null);
    setDragPayload({ source: "browser", cardId: String(cardId), fromSection: null });
  }

  function onDragStartDeckCard(cardId, fromSection) {
    setHoverPreview(null);
    setDragPayload({ source: "template", cardId: String(cardId), fromSection });
  }

  function onDragActivateSection(section) {
    setActiveDropSection(section);
  }

  function onDropToSection(section) {
    if (!dragPayload) return;
    if (dragPayload.source === "browser") addCardToSection(dragPayload.cardId, section);
    else moveCardToSection(dragPayload.cardId, dragPayload.fromSection, section);
    setActiveDropSection(null);
    setDragPayload(null);
  }

  function onDragEndCard() {
    setActiveDropSection(null);
    setDragPayload(null);
  }

  function openCardImageModal(cardId) {
    setImageModalCard(cardLookup.get(String(cardId)) || null);
  }

  function showHoverCard(cardId, target) {
    const card = cardLookup.get(String(cardId));
    if (!card || !target) return;

    const usage = sectionUsageByCard.get(String(cardId)) || { main: 0, extra: 0, side: 0 };
    const rect = target.getBoundingClientRect();
    const tooltipWidth = 360;
    const tooltipHeight = 310;
    const showRight = rect.right + tooltipWidth + 24 < window.innerWidth;
    const x = showRight ? rect.right + 14 : Math.max(12, rect.left - tooltipWidth - 14);
    const y = Math.min(window.innerHeight - tooltipHeight - 12, Math.max(12, rect.top - 8));

    setHoverPreview({
      card,
      x,
      y,
      lines: [
        `Card ID ${cardId}`,
        `Template Main ${usage.main} | Extra ${usage.extra} | Side ${usage.side}`,
        `Allowed ${getAllowedSections(card).join(", ")}`,
        Number(card.level || 0) > 0 ? `Level ${card.level}` : null,
        card.atk != null || card.def != null ? `ATK ${card.atk ?? "-"} | DEF ${card.def ?? "-"}` : null,
      ].filter(Boolean),
    });
  }

  function hideHoverCard() {
    setHoverPreview(null);
  }

  async function handleImportFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setErrorMessage("");
    setStatusMessage("");

    try {
      if (!file.name.toLowerCase().endsWith(".ydk")) {
        throw new Error("Please choose a valid .ydk file.");
      }

      const parsedRows = parseYdkText(await file.text());
      if (!parsedRows.length) {
        throw new Error("No valid deck entries were found in that .ydk file.");
      }

      const cardMap = await fetchCardMap(parsedRows.map((row) => row.card_id));
      const hydratedRows = parsedRows.map((row) => ({
        card_id: Number(row.card_id),
        section: row.section || "main",
        quantity: Math.max(1, Number(row.quantity || 1)),
        card: cardMap.get(String(row.card_id)) || { id: Number(row.card_id), name: `Card ${row.card_id}` },
      }));

      setTemplateCards(hydratedRows);
      setImportedFileName(file.name);
      setStatusMessage(`Imported ${file.name}.`);
    } catch (error) {
      console.error("Failed to import .ydk:", error);
      setErrorMessage(error.message || "Failed to import .ydk file.");
    }
  }

  function handleSortTemplateDeck() {
    setTemplateCards((prev) => sortStarterDeckTemplateRows(prev));
    setStatusMessage("Starter deck sorted.");
    setErrorMessage("");
    setHoverPreview(null);
  }

  async function handleSaveTemplate() {
    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      if (!templateName.trim()) {
        throw new Error("Template name is required.");
      }

      const payloadCards = templateCards.map((row) => ({
        card_id: Number(row.card_id),
        section: row.section,
        quantity: Number(row.quantity || 0),
      }));

      if (!payloadCards.length) {
        throw new Error("Add some cards before saving this starter deck template.");
      }

      const { error } = await supabase.rpc("upsert_starter_deck_template", {
        p_template_id: selectedTemplateId || null,
        p_name: templateName.trim(),
        p_description: templateDescription.trim(),
        p_cards: payloadCards,
      });

      if (error) throw error;
      setStatusMessage("Starter deck template saved.");
      await loadPage(selectedTemplateId || "", templateName.trim());
    } catch (error) {
      console.error("Failed to save starter deck template:", error);
      setErrorMessage(error.message || "Failed to save starter deck template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTemplate() {
    if (!selectedTemplateId) return;
    if (!window.confirm("Delete this starter deck template?")) return;

    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const { error } = await supabase.rpc("delete_starter_deck_template", {
        p_template_id: selectedTemplateId,
      });
      if (error) throw error;

      setStatusMessage("Starter deck template deleted.");
      applyTemplate(null);
      await loadPage("", "");
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
        throw new Error("Each starter deck slot must use a different template.");
      }

      const { error } = await supabase.rpc("assign_series_starter_decks", {
        p_series_id: activeSeries.id,
        p_template_ids: seriesAssignments,
      });

      if (error) throw error;
      setStatusMessage("Active series 6-deck starter pool saved.");
      await loadPage(selectedTemplateId, templateName.trim());
    } catch (error) {
      console.error("Failed to save starter pool:", error);
      setErrorMessage(error.message || "Failed to save starter pool.");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (!canUsePage) return <Navigate to="/mode/progression" replace />;

  return (
    <LauncherLayout>
      <div className="deck-builder-page starter-deck-builder-page">
        <div className="deck-builder-topbar">
          <button type="button" className="deck-builder-back-btn" onClick={() => navigate("/mode/progression")}>
            Back
          </button>

          <div className="deck-builder-topbar-info">
            <h1 className="deck-builder-title">Starter Deck Editor</h1>
            <p className="deck-builder-subtitle">
              Build starter templates with the deck-builder layout, import real .ydk files, and manage the active 6-deck pool.
            </p>
          </div>
        </div>

        <div className="starter-deck-status-row">
          <div className="starter-deck-chip">Active Series: {activeSeries?.name || "None"}</div>
          {statusMessage ? <div className="starter-deck-success">{statusMessage}</div> : null}
          {errorMessage ? <div className="starter-deck-error">{errorMessage}</div> : null}
        </div>

        {loading ? (
          <div className="deck-panel starter-deck-empty-panel">Loading starter deck editor...</div>
        ) : (
          <>
            <section className="deck-panel starter-deck-pool-panel">
              <div className="deck-panel-header">
                <div>
                  <h2 className="deck-panel-title">Active Series 6-Deck Pool</h2>
                  <div className="deck-panel-count">Pick the 6 starter templates players can claim in this series.</div>
                </div>

                <button
                  type="button"
                  className="deck-builder-action-btn"
                  onClick={handleSaveSeriesPool}
                  disabled={saving || !activeSeries?.id}
                >
                  Save Active Pool
                </button>
              </div>

              <div className="starter-deck-pool-grid">
                {seriesAssignments.map((value, index) => (
                  <label key={`starter-pool-slot-${index + 1}`} className="starter-deck-pool-field">
                    <span>Slot {index + 1}</span>
                    <select
                      className="deck-binder-select starter-deck-pool-select"
                      value={value}
                      onChange={(event) =>
                        setSeriesAssignments((prev) => {
                          const next = [...prev];
                          next[index] = event.target.value;
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
                  </label>
                ))}
              </div>
            </section>

            <section className="deck-header starter-template-header">
              <div className="starter-template-load">
                <label className="starter-template-label" htmlFor="starter-template-select">
                  Load Template
                </label>
                <select
                  id="starter-template-select"
                  className="deck-binder-select starter-template-select"
                  value={selectedTemplateId}
                  onChange={(event) => {
                    const template = templates.find((entry) => entry.id === event.target.value) || null;
                    applyTemplate(template);
                    setStatusMessage("");
                    setErrorMessage("");
                  }}
                  disabled={saving}
                >
                  <option value="">New template...</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>

                <div className="starter-template-load-actions">
                  <button type="button" className="deck-builder-action-btn" onClick={() => applyTemplate(null)} disabled={saving}>
                    New
                  </button>
                  <button
                    type="button"
                    className="deck-builder-action-btn starter-template-delete-btn"
                    onClick={handleDeleteTemplate}
                    disabled={saving || !selectedTemplateId}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="starter-template-center">
                <label className="starter-template-label" htmlFor="starter-template-name">
                  Template Name
                </label>
                <input
                  id="starter-template-name"
                  className="starter-template-name-input"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="Starter deck name"
                  disabled={saving}
                />

                <label className="starter-template-label" htmlFor="starter-template-description">
                  Description
                </label>
                <textarea
                  id="starter-template-description"
                  className="starter-template-description"
                  value={templateDescription}
                  onChange={(event) => setTemplateDescription(event.target.value)}
                  placeholder="Optional description..."
                  rows={3}
                  disabled={saving}
                />
              </div>

              <div className="starter-template-right">
                <div className="deck-header-counts starter-template-counts">
                  <div className="deck-header-slot">Main {templateSummary.main}</div>
                  <div className="deck-header-slot">Extra {templateSummary.extra}</div>
                  <div className="deck-header-slot">Side {templateSummary.side}</div>
                </div>

                <div className="starter-template-import-note">
                  {importedFileName ? `Imported: ${importedFileName}` : "Import a .ydk file directly from your computer."}
                </div>

                <div className="starter-template-action-row">
                  <button
                    type="button"
                    className="deck-builder-action-btn"
                    onClick={() => ydkInputRef.current?.click()}
                    disabled={saving}
                  >
                    Import .ydk
                  </button>
                  <button
                    type="button"
                    className="deck-builder-action-btn"
                    onClick={handleSortTemplateDeck}
                    disabled={saving || templateCards.length === 0}
                  >
                    Sort Deck
                  </button>
                  <button
                    type="button"
                    className="deck-builder-action-btn starter-template-save-btn"
                    onClick={handleSaveTemplate}
                    disabled={saving}
                  >
                    Save Template
                  </button>
                </div>

                <input
                  ref={ydkInputRef}
                  type="file"
                  accept=".ydk"
                  className="starter-template-file-input"
                  onChange={handleImportFileChange}
                />
              </div>
            </section>

            <div className="deck-builder-layout starter-template-layout">
              <div className="deck-builder-left">
                <DeckMainSection
                  cards={mainCards}
                  count={templateSummary.main}
                  collapsed={mainCollapsed}
                  onToggleCollapsed={() => setMainCollapsed((current) => !current)}
                  activeDropSection={activeDropSection}
                  onDragActivateSection={onDragActivateSection}
                  onDropToSection={onDropToSection}
                  onDragStartCard={onDragStartDeckCard}
                  onDragEndCard={onDragEndCard}
                  onRemoveCard={removeCardFromSection}
                  onOpenCardModal={openCardImageModal}
                  onShowHoverCard={showHoverCard}
                  onHideHoverCard={hideHoverCard}
                  buildCardImageUrl={buildCardImageUrl}
                  interactionDisabled={saving}
                />

                <DeckExtraSection
                  cards={extraCards}
                  count={templateSummary.extra}
                  collapsed={extraCollapsed}
                  onToggleCollapsed={() => setExtraCollapsed((current) => !current)}
                  activeDropSection={activeDropSection}
                  onDragActivateSection={onDragActivateSection}
                  onDropToSection={onDropToSection}
                  onDragStartCard={onDragStartDeckCard}
                  onDragEndCard={onDragEndCard}
                  onRemoveCard={removeCardFromSection}
                  onOpenCardModal={openCardImageModal}
                  onShowHoverCard={showHoverCard}
                  onHideHoverCard={hideHoverCard}
                  buildCardImageUrl={buildCardImageUrl}
                  interactionDisabled={saving}
                />

                <DeckSideSection
                  cards={sideCards}
                  count={templateSummary.side}
                  collapsed={sideCollapsed}
                  onToggleCollapsed={() => setSideCollapsed((current) => !current)}
                  activeDropSection={activeDropSection}
                  onDragActivateSection={onDragActivateSection}
                  onDropToSection={onDropToSection}
                  onDragStartCard={onDragStartDeckCard}
                  onDragEndCard={onDragEndCard}
                  onRemoveCard={removeCardFromSection}
                  onOpenCardModal={openCardImageModal}
                  onShowHoverCard={showHoverCard}
                  onHideHoverCard={hideHoverCard}
                  buildCardImageUrl={buildCardImageUrl}
                  interactionDisabled={saving}
                />
              </div>

              <div className="deck-builder-right starter-template-browser-column">
                <aside className="deck-browser-panel starter-template-browser">
                  <div className="deck-browser-toolbar">
                    <div className="deck-browser-title-row">
                      <div>
                        <h2 className="deck-binder-title">Card Catalog</h2>
                        <div className="deck-binder-count">
                          {searchTerm.trim().length < 2
                            ? "Search 2+ characters to load cards."
                            : `${browserCards.length} matching cards`}
                        </div>
                      </div>
                    </div>

                    <div className="deck-browser-search-row">
                      <input
                        type="text"
                        className="deck-binder-search"
                        placeholder="Search cards..."
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        disabled={saving}
                      />

                      <select
                        className="deck-binder-select"
                        value={sortField}
                        onChange={(event) => setSortField(event.target.value)}
                        disabled={saving}
                      >
                        {SORT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="deck-browser-search-row deck-browser-search-row-sort">
                      <button
                        type="button"
                        className="deck-builder-action-btn"
                        onClick={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))}
                        disabled={saving}
                      >
                        {sortDirection === "asc" ? "Asc" : "Desc"}
                      </button>

                      <div className="starter-template-browser-hint">
                        Click or drag cards into Main, Extra, or Side.
                      </div>
                    </div>
                  </div>

                  <div className="deck-browser-body">
                    <div className="deck-browser-list-panel">
                      {searchTerm.trim().length < 2 ? (
                        <div className="deck-binder-empty">
                          Search by name, then click or drag cards into the starter deck.
                        </div>
                      ) : !browserCards.length ? (
                        <div className="deck-binder-empty">No matching cards found.</div>
                      ) : (
                        <div className="deck-binder-list">
                          {browserCards.map((card) => {
                            const usage = sectionUsageByCard.get(String(card.id)) || {
                              main: 0,
                              extra: 0,
                              side: 0,
                            };
                            const allowedSections = getAllowedSections(card);

                            return (
                              <div
                                key={card.id}
                                className="deck-binder-card starter-template-browser-card"
                                draggable={!saving}
                                onClick={() => openCardImageModal(card.id)}
                                onMouseEnter={(event) => showHoverCard(card.id, event.currentTarget)}
                                onMouseLeave={hideHoverCard}
                                onDragStart={() => onDragStartBrowserCard(card.id)}
                                onDragEnd={onDragEndCard}
                              >
                                <div className="deck-binder-thumb-wrap">
                                  <img
                                    className="deck-binder-thumb"
                                    src={buildCardImageUrl(card)}
                                    alt={card.name || "Card"}
                                  />
                                </div>

                                <div className="deck-binder-meta">
                                  <h3 className="deck-binder-name">{card.name || "Unknown Card"}</h3>
                                  <p className="deck-binder-line">Card ID: {card.id}</p>
                                  <p className="deck-binder-line">
                                    In Template: Main {usage.main} | Extra {usage.extra} | Side {usage.side}
                                  </p>

                                  <div className="deck-binder-actions">
                                    {allowedSections.includes("main") ? (
                                      <button
                                        type="button"
                                        className="deck-binder-action-btn"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          addCardToSection(card.id, "main");
                                        }}
                                        disabled={saving}
                                      >
                                        + Main
                                      </button>
                                    ) : null}

                                    {allowedSections.includes("extra") ? (
                                      <button
                                        type="button"
                                        className="deck-binder-action-btn"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          addCardToSection(card.id, "extra");
                                        }}
                                        disabled={saving}
                                      >
                                        + Extra
                                      </button>
                                    ) : null}

                                    <button
                                      type="button"
                                      className="deck-binder-action-btn"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        addCardToSection(card.id, "side");
                                      }}
                                      disabled={saving}
                                    >
                                      + Side
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </aside>
              </div>
            </div>

            <DeckCardHoverTooltip preview={hoverPreview} buildCardImageUrl={buildCardImageUrl} />
            <DeckCardImageModal
              card={imageModalCard}
              buildCardImageUrl={buildCardImageUrl}
              onClose={() => setImageModalCard(null)}
            />
          </>
        )}
      </div>
    </LauncherLayout>
  );
}

export default StarterDeckEditorPage;
