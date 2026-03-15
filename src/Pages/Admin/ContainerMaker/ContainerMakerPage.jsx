import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../../components/LauncherLayout";
import { useUser } from "../../../context/UserContext";
import { supabase } from "../../../lib/supabase";
import "./ContainerMakerPage.css";

function buildContainerCode(name) {
  return String(name || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function buildDuplicateName(name) {
  const base = String(name || "").trim();
  if (!base) return "New Container Copy";
  if (base.toLowerCase().endsWith(" copy")) return `${base} 2`;
  return `${base} Copy`;
}

function buildDuplicateCode(code) {
  const base = String(code || "").trim();
  if (!base) return "NEW_CONTAINER_COPY";
  if (base.endsWith("_COPY")) return `${base}_2`;
  return `${base}_COPY`;
}

function parseMassCardNames(rawText) {
  return String(rawText || "")
    .split(/\r?\n|,|;/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function ContainerMakerPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [massImportBusy, setMassImportBusy] = useState(false);

  const [containers, setContainers] = useState([]);
  const [containerTypeOptions, setContainerTypeOptions] = useState([]);
  const [cardTiers, setCardTiers] = useState([]);

  const [selectedContainerId, setSelectedContainerId] = useState("");
  const [containerCards, setContainerCards] = useState([]);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [containerTypeId, setContainerTypeId] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [cardCount, setCardCount] = useState(5);
  const [contentMode, setContentMode] = useState("curated");
  const [selectionCount, setSelectionCount] = useState("");
  const [draftPickCount, setDraftPickCount] = useState("");
  const [rarityMode, setRarityMode] = useState("normal");
  const [isEnabled, setIsEnabled] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  const [cardSearch, setCardSearch] = useState("");
  const [cardSearchResults, setCardSearchResults] = useState([]);
  const [selectedTierId, setSelectedTierId] = useState("");

  const [massCardNames, setMassCardNames] = useState("");

  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const canUsePage = user?.role === "Admin+";

  const selectedContainer = useMemo(
    () => containers.find((container) => container.id === selectedContainerId) || null,
    [containers, selectedContainerId]
  );

  useEffect(() => {
    if (!authLoading && user) {
      loadPage();
    }
  }, [authLoading, user]);

  useEffect(() => {
    let cancelled = false;

    async function runCardSearch() {
      const query = cardSearch.trim();

      if (query.length < 2) {
        setCardSearchResults([]);
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
          setCardSearchResults(data || []);
        }
      } catch (error) {
        console.error("Failed to search cards:", error);
        if (!cancelled) {
          setCardSearchResults([]);
        }
      }
    }

    runCardSearch();

    return () => {
      cancelled = true;
    };
  }, [cardSearch]);

  async function hydrateContainerCards(rows) {
    if (!rows.length) return [];

    const uniqueCardIds = [...new Set(rows.map((row) => Number(row.card_id)).filter(Boolean))];

    const { data: cardsData, error: cardsError } = await supabase
      .from("cards")
      .select("id, name")
      .in("id", uniqueCardIds);

    if (cardsError) throw cardsError;

    const nameMap = new Map((cardsData || []).map((row) => [Number(row.id), row.name]));

    return rows.map((row) => ({
      ...row,
      card_name: nameMap.get(Number(row.card_id)) || `Card ${row.card_id}`,
    }));
  }

  async function loadPage() {
    setLoading(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const [
        { data: containerRows, error: containersError },
        { data: typeRows, error: typesError },
        { data: tierRows, error: tiersError },
      ] = await Promise.all([
        supabase
          .from("containers")
          .select("*")
          .order("created_at", { ascending: true }),
        supabase.rpc("get_container_type_options_admin"),
        supabase
          .from("card_tiers")
          .select("id, name, weight_percent, sort_order")
          .order("sort_order", { ascending: true }),
      ]);

      if (containersError) throw containersError;
      if (typesError) throw typesError;
      if (tiersError) throw tiersError;

      setContainers(containerRows || []);
      setContainerTypeOptions(typeRows || []);
      setCardTiers(tierRows || []);

      if (!selectedTierId && tierRows?.length) {
        setSelectedTierId(tierRows[0].id);
      }

      const nextSelected =
        (containerRows || []).find((row) => row.id === selectedContainerId) ||
        (containerRows || [])[0] ||
        null;

      if (nextSelected) {
        await loadContainerIntoEditor(nextSelected);
      } else {
        resetEditor(typeRows || [], tierRows || []);
      }
    } catch (error) {
      console.error("Failed to load container maker:", error);
      setErrorMessage(error.message || "Failed to load container maker.");
    } finally {
      setLoading(false);
    }
  }

  function resetEditor(typeRows = containerTypeOptions, tierRows = cardTiers) {
    setSelectedContainerId("");
    setName("");
    setCode("");
    setDescription("");
    setContainerTypeId(typeRows?.[0]?.id || "");
    setImageUrl("");
    setCardCount(5);
    setContentMode("curated");
    setSelectionCount("");
    setDraftPickCount("");
    setRarityMode("normal");
    setIsEnabled(true);
    setIsLocked(false);
    setContainerCards([]);
    setCardSearch("");
    setCardSearchResults([]);
    setMassCardNames("");
    if (tierRows?.length) {
      setSelectedTierId(tierRows[0].id);
    }
  }

  async function loadContainerIntoEditor(container) {
    setSelectedContainerId(container.id);
    setName(container.name || "");
    setCode(container.code || "");
    setDescription(container.description || "");
    setContainerTypeId(container.container_type_id || "");
    setImageUrl(container.image_url || "");
    setCardCount(Number(container.card_count || 5));
    setContentMode(container.content_mode || "curated");
    setSelectionCount(
      container.selection_count == null ? "" : String(container.selection_count)
    );
    setDraftPickCount(
      container.draft_pick_count == null ? "" : String(container.draft_pick_count)
    );
    setRarityMode(container.rarity_mode || "normal");
    setIsEnabled(Boolean(container.is_enabled));
    setIsLocked(Boolean(container.is_locked));
    setMassCardNames("");

    const { data: cardRows, error } = await supabase
      .from("container_cards")
      .select("*")
      .eq("container_id", container.id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const hydrated = await hydrateContainerCards(cardRows || []);
    setContainerCards(hydrated);
  }

  async function handleSelectContainer(containerId) {
    if (!containerId) {
      resetEditor();
      return;
    }

    const container = containers.find((row) => row.id === containerId);
    if (!container) return;

    setStatusMessage("");
    setErrorMessage("");

    try {
      await loadContainerIntoEditor(container);
    } catch (error) {
      console.error("Failed to load container into editor:", error);
      setErrorMessage(error.message || "Failed to load container.");
    }
  }

  function handleAddCard(card) {
    if (!selectedTierId) return;

    setContainerCards((prev) => [
      ...prev,
      {
        id: `temp-${card.id}-${selectedTierId}-${Date.now()}-${Math.random()}`,
        container_id: selectedContainerId || null,
        card_id: Number(card.id),
        tier_id: selectedTierId,
        is_enabled: true,
        card_name: card.name,
      },
    ]);
  }

  async function handleMassAddCards() {
    const names = parseMassCardNames(massCardNames);

    if (!names.length) {
      setErrorMessage("Paste at least one card name.");
      setStatusMessage("");
      return;
    }

    if (!selectedTierId) {
      setErrorMessage("Select a tier before mass adding cards.");
      setStatusMessage("");
      return;
    }

    setMassImportBusy(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const uniqueNames = [...new Set(names)];

      const { data, error } = await supabase
        .from("cards")
        .select("id, name")
        .in("name", uniqueNames);

      if (error) throw error;

      const foundCards = data || [];
      const foundNameSet = new Set(foundCards.map((card) => card.name));
      const missingNames = uniqueNames.filter((entry) => !foundNameSet.has(entry));

      if (!foundCards.length) {
        throw new Error("No pasted card names matched exact card names in the database.");
      }

      setContainerCards((prev) => [
        ...prev,
        ...foundCards.map((card, index) => ({
          id: `mass-${card.id}-${selectedTierId}-${Date.now()}-${index}`,
          container_id: selectedContainerId || null,
          card_id: Number(card.id),
          tier_id: selectedTierId,
          is_enabled: true,
          card_name: card.name,
        })),
      ]);

      if (missingNames.length > 0) {
        setStatusMessage(
          `Added ${foundCards.length} cards. Not found: ${missingNames.join(", ")}`
        );
      } else {
        setStatusMessage(`Added ${foundCards.length} cards from pasted list.`);
      }
    } catch (error) {
      console.error("Failed to mass add cards:", error);
      setErrorMessage(error.message || "Failed to mass add cards.");
    } finally {
      setMassImportBusy(false);
    }
  }

  function handleRemoveCard(index) {
    setContainerCards((prev) => prev.filter((_, i) => i !== index));
  }

  function handleChangeCardTier(index, tierId) {
    setContainerCards((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        tier_id: tierId,
      };
      return next;
    });
  }

  function handleToggleCardEnabled(index) {
    setContainerCards((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        is_enabled: !next[index].is_enabled,
      };
      return next;
    });
  }

  function handleDuplicateContainer() {
    if (!selectedContainer) return;

    setSelectedContainerId("");
    setName(buildDuplicateName(selectedContainer.name));
    setCode(buildDuplicateCode(selectedContainer.code));
    setDescription(selectedContainer.description || "");
    setContainerTypeId(selectedContainer.container_type_id || "");
    setImageUrl(selectedContainer.image_url || "");
    setCardCount(Number(selectedContainer.card_count || 5));
    setContentMode(selectedContainer.content_mode || "curated");
    setSelectionCount(
      selectedContainer.selection_count == null
        ? ""
        : String(selectedContainer.selection_count)
    );
    setDraftPickCount(
      selectedContainer.draft_pick_count == null
        ? ""
        : String(selectedContainer.draft_pick_count)
    );
    setRarityMode(selectedContainer.rarity_mode || "normal");
    setIsEnabled(Boolean(selectedContainer.is_enabled));
    setIsLocked(false);
    setMassCardNames("");

    setContainerCards((prev) =>
      prev.map((row, index) => ({
        ...row,
        id: `duplicate-${row.card_id}-${row.tier_id}-${Date.now()}-${index}`,
        container_id: null,
      }))
    );

    setStatusMessage("Container duplicated into a new unsaved copy.");
    setErrorMessage("");
  }

  async function handleSaveContainer() {
    setSaving(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      let containerId = selectedContainerId;

      if (!containerId) {
        const { data, error } = await supabase.rpc("create_container_admin", {
          p_name: name,
          p_code: code || buildContainerCode(name),
          p_description: description,
          p_container_type_id: containerTypeId || null,
          p_image_url: imageUrl || null,
          p_card_count: Number(cardCount || 5),
          p_content_mode: contentMode || "curated",
          p_selection_count: selectionCount === "" ? null : Number(selectionCount),
          p_draft_pick_count:
            draftPickCount === "" ? null : Number(draftPickCount),
          p_rarity_mode: rarityMode || "normal",
          p_is_enabled: isEnabled,
          p_is_locked: isLocked,
        });

        if (error) throw error;
        containerId = data?.container_id || null;
      } else {
        const { error } = await supabase.rpc("update_container_admin", {
          p_container_id: containerId,
          p_name: name,
          p_code: code || buildContainerCode(name),
          p_description: description,
          p_container_type_id: containerTypeId || null,
          p_image_url: imageUrl || null,
          p_card_count: Number(cardCount || 5),
          p_content_mode: contentMode || "curated",
          p_selection_count: selectionCount === "" ? null : Number(selectionCount),
          p_draft_pick_count:
            draftPickCount === "" ? null : Number(draftPickCount),
          p_rarity_mode: rarityMode || "normal",
          p_is_enabled: isEnabled,
          p_is_locked: isLocked,
        });

        if (error) throw error;
      }

      const { error: saveCardsError } = await supabase.rpc(
        "save_container_cards_admin",
        {
          p_container_id: containerId,
          p_cards: containerCards.map((row) => ({
            card_id: Number(row.card_id),
            tier_id: row.tier_id,
            is_enabled: Boolean(row.is_enabled),
          })),
        }
      );

      if (saveCardsError) throw saveCardsError;

      setStatusMessage("Container saved successfully.");
      await loadPage();

      if (containerId) {
        const { data: savedContainer, error: savedContainerError } = await supabase
          .from("containers")
          .select("*")
          .eq("id", containerId)
          .maybeSingle();

        if (savedContainerError) throw savedContainerError;
        if (savedContainer) {
          await loadContainerIntoEditor(savedContainer);
        }
      }
    } catch (error) {
      console.error("Failed to save container:", error);
      setErrorMessage(error.message || "Failed to save container.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleLock() {
    if (!selectedContainerId) return;

    setSaving(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const { error } = await supabase.rpc("set_container_lock_admin", {
        p_container_id: selectedContainerId,
        p_is_locked: !isLocked,
      });

      if (error) throw error;

      setIsLocked((prev) => !prev);
      setStatusMessage(`Container ${isLocked ? "unlocked" : "locked"} successfully.`);
      await loadPage();
    } catch (error) {
      console.error("Failed to lock/unlock container:", error);
      setErrorMessage(error.message || "Failed to change lock state.");
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
      <div className="container-maker-page">
        <div className="container-maker-topbar">
          <div>
            <div className="container-maker-kicker">ADMIN</div>
            <h1 className="container-maker-title">Container Maker</h1>
            <p className="container-maker-subtitle">
              Create packs, promo boxes, and deck boxes from one unified container system.
            </p>
          </div>

          <div className="container-maker-topbar-actions">
            <button
              type="button"
              className="container-maker-secondary-btn"
              onClick={() => navigate("/mode/progression")}
            >
              Back
            </button>
          </div>
        </div>

        {loading ? (
          <div className="container-maker-card container-maker-empty">
            Loading container maker...
          </div>
        ) : (
          <>
            <div className="container-maker-status-row">
              {statusMessage ? (
                <div className="container-maker-success">{statusMessage}</div>
              ) : null}

              {errorMessage ? (
                <div className="container-maker-error">{errorMessage}</div>
              ) : null}
            </div>

            <div className="container-maker-layout">
              <section className="container-maker-card container-maker-sidebar">
                <div className="container-maker-section-header">
                  <h2>Containers</h2>
                </div>

                <button
                  type="button"
                  className="container-maker-primary-btn container-maker-new-btn"
                  onClick={() => {
                    setStatusMessage("");
                    setErrorMessage("");
                    resetEditor();
                  }}
                >
                  New Container
                </button>

                <div className="container-maker-container-list">
                  {containers.length === 0 ? (
                    <div className="container-maker-empty small">
                      No containers created yet.
                    </div>
                  ) : (
                    containers.map((container) => (
                      <button
                        key={container.id}
                        type="button"
                        className={`container-maker-container-row ${
                          selectedContainerId === container.id ? "is-selected" : ""
                        }`}
                        onClick={() => handleSelectContainer(container.id)}
                      >
                        <div className="container-maker-container-row-name">
                          {container.name}
                        </div>
                        <div className="container-maker-container-row-meta">
                          {container.code}
                          {container.is_locked ? " • Locked" : ""}
                          {!container.is_enabled ? " • Disabled" : ""}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </section>

              <section className="container-maker-card container-maker-main">
                <div className="container-maker-section-header">
                  <h2>{selectedContainerId ? "Edit Container" : "Create Container"}</h2>
                </div>

                <div className="container-maker-form-grid">
                  <div className="container-maker-field">
                    <label>Name</label>
                    <input
                      className="container-maker-input"
                      value={name}
                      onChange={(event) => {
                        const nextName = event.target.value;
                        setName(nextName);
                        if (!selectedContainerId && !code) {
                          setCode(buildContainerCode(nextName));
                        }
                      }}
                      placeholder="Container name"
                      disabled={saving}
                    />
                  </div>

                  <div className="container-maker-field">
                    <label>Code</label>
                    <input
                      className="container-maker-input"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="Container code"
                      disabled={saving}
                    />
                  </div>

                  <div className="container-maker-field">
                    <label>Container Type</label>
                    <select
                      className="container-maker-select"
                      value={containerTypeId}
                      onChange={(event) => setContainerTypeId(event.target.value)}
                      disabled={saving}
                    >
                      <option value="">Choose type...</option>
                      {containerTypeOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="container-maker-field">
                    <label>Image URL</label>
                    <input
                      className="container-maker-input"
                      value={imageUrl}
                      onChange={(event) => setImageUrl(event.target.value)}
                      placeholder="https://..."
                      disabled={saving}
                    />
                  </div>

                  <div className="container-maker-field">
                    <label>Card Count</label>
                    <input
                      type="number"
                      min="1"
                      className="container-maker-input"
                      value={cardCount}
                      onChange={(event) => setCardCount(event.target.value)}
                      disabled={saving}
                    />
                  </div>

                  <div className="container-maker-field">
                    <label>Content Mode</label>
                    <input
                      className="container-maker-input"
                      value={contentMode}
                      onChange={(event) => setContentMode(event.target.value)}
                      placeholder="curated"
                      disabled={saving}
                    />
                  </div>

                  <div className="container-maker-field">
                    <label>Selection Count</label>
                    <input
                      type="number"
                      min="0"
                      className="container-maker-input"
                      value={selectionCount}
                      onChange={(event) => setSelectionCount(event.target.value)}
                      disabled={saving}
                    />
                  </div>

                  <div className="container-maker-field">
                    <label>Draft Pick Count</label>
                    <input
                      type="number"
                      min="0"
                      className="container-maker-input"
                      value={draftPickCount}
                      onChange={(event) => setDraftPickCount(event.target.value)}
                      disabled={saving}
                    />
                  </div>

                  <div className="container-maker-field">
                    <label>Rarity Mode</label>
                    <input
                      className="container-maker-input"
                      value={rarityMode}
                      onChange={(event) => setRarityMode(event.target.value)}
                      placeholder="normal"
                      disabled={saving}
                    />
                  </div>
                </div>

                <div className="container-maker-field">
                  <label>Description</label>
                  <textarea
                    className="container-maker-textarea"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Optional description..."
                    disabled={saving}
                  />
                </div>

                <div className="container-maker-toggle-row">
                  <label className="container-maker-checkbox">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(event) => setIsEnabled(event.target.checked)}
                      disabled={saving}
                    />
                    <span>Enabled</span>
                  </label>

                  <label className="container-maker-checkbox">
                    <input
                      type="checkbox"
                      checked={isLocked}
                      onChange={(event) => setIsLocked(event.target.checked)}
                      disabled={saving}
                    />
                    <span>Locked</span>
                  </label>
                </div>

                <div className="container-maker-actions">
                  <button
                    type="button"
                    className="container-maker-primary-btn"
                    onClick={handleSaveContainer}
                    disabled={saving || !name || !code || !containerTypeId}
                  >
                    {saving ? "Saving..." : "Save Container"}
                  </button>

                  {selectedContainerId ? (
                    <>
                      <button
                        type="button"
                        className="container-maker-secondary-btn"
                        onClick={handleDuplicateContainer}
                        disabled={saving}
                      >
                        Duplicate Container
                      </button>

                      <button
                        type="button"
                        className="container-maker-secondary-btn"
                        onClick={handleToggleLock}
                        disabled={saving}
                      >
                        {isLocked ? "Unlock Container" : "Lock Container"}
                      </button>
                    </>
                  ) : null}
                </div>
              </section>
            </div>

            <div className="container-maker-card container-maker-cards-card">
              <div className="container-maker-section-header">
                <h2>Container Cards</h2>
              </div>

              <div className="container-maker-mass-import-block">
                <label className="container-maker-mass-import-label">
                  Mass Add by Card Names
                </label>

                <textarea
                  className="container-maker-textarea container-maker-mass-import-textarea"
                  value={massCardNames}
                  onChange={(event) => setMassCardNames(event.target.value)}
                  placeholder={
                    "Paste one card name per line, or use commas/semicolons.\nExample:\nBlue-Eyes White Dragon\nDark Magician\nExodia the Forbidden One"
                  }
                  disabled={saving || massImportBusy}
                />

                <div className="container-maker-mass-import-actions">
                  <button
                    type="button"
                    className="container-maker-primary-btn"
                    onClick={handleMassAddCards}
                    disabled={saving || massImportBusy || !selectedTierId}
                  >
                    {massImportBusy ? "Adding Cards..." : "Mass Add Cards"}
                  </button>
                </div>
              </div>

              <div className="container-maker-card-search-controls">
                <input
                  className="container-maker-input"
                  value={cardSearch}
                  onChange={(event) => setCardSearch(event.target.value)}
                  placeholder="Search cards..."
                  disabled={saving}
                />

                <select
                  className="container-maker-select"
                  value={selectedTierId}
                  onChange={(event) => setSelectedTierId(event.target.value)}
                  disabled={saving}
                >
                  {cardTiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name}{" "}
                      {tier.weight_percent != null ? `(${tier.weight_percent}%)` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="container-maker-search-results">
                {cardSearch.trim().length < 2 ? (
                  <div className="container-maker-empty small">
                    Type at least 2 characters to search cards.
                  </div>
                ) : cardSearchResults.length === 0 ? (
                  <div className="container-maker-empty small">
                    No matching cards found.
                  </div>
                ) : (
                  cardSearchResults.map((card) => (
                    <div className="container-maker-search-row" key={card.id}>
                      <div>
                        <div className="container-maker-row-name">{card.name}</div>
                        <div className="container-maker-row-meta">Card ID: {card.id}</div>
                      </div>

                      <button
                        type="button"
                        className="container-maker-primary-btn small"
                        onClick={() => handleAddCard(card)}
                        disabled={saving || !selectedTierId}
                      >
                        Add
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="container-maker-card-list">
                {containerCards.length === 0 ? (
                  <div className="container-maker-empty">No cards in this container yet.</div>
                ) : (
                  containerCards.map((row, index) => (
                    <div
                      key={`${row.id || "temp"}-${index}`}
                      className="container-maker-card-row"
                    >
                      <div>
                        <div className="container-maker-row-name">
                          {row.card_name || `Card ${row.card_id}`}
                        </div>
                        <div className="container-maker-row-meta">
                          Card ID: {row.card_id}
                        </div>
                      </div>

                      <div className="container-maker-card-row-actions">
                        <select
                          className="container-maker-select small"
                          value={row.tier_id}
                          onChange={(event) =>
                            handleChangeCardTier(index, event.target.value)
                          }
                          disabled={saving}
                        >
                          {cardTiers.map((tier) => (
                            <option key={tier.id} value={tier.id}>
                              {tier.name}
                              {tier.weight_percent != null
                                ? ` (${tier.weight_percent}%)`
                                : ""}
                            </option>
                          ))}
                        </select>

                        <label className="container-maker-inline-checkbox">
                          <input
                            type="checkbox"
                            checked={Boolean(row.is_enabled)}
                            onChange={() => handleToggleCardEnabled(index)}
                            disabled={saving}
                          />
                          <span>Enabled</span>
                        </label>

                        <button
                          type="button"
                          className="container-maker-danger-btn small"
                          onClick={() => handleRemoveCard(index)}
                          disabled={saving}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </LauncherLayout>
  );
}

export default ContainerMakerPage;