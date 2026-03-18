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

const PACK_TYPE_CODES = new Set(["full_pack", "draft_pack"]);
const CONTENT_MODE_OPTIONS = [
  { value: "official", label: "Official" },
  { value: "curated", label: "Curated" },
];
const CONTAINER_IMAGE_BUCKET = "container-images";

function normalizeTypeCode(value) {
  return String(value || "").trim().toLowerCase();
}

function isPackTypeCode(value) {
  return PACK_TYPE_CODES.has(normalizeTypeCode(value));
}

function filterTypeOptionsForMode(options, mode) {
  return (options || []).filter((option) => {
    const isPackType = isPackTypeCode(option?.code);
    return mode === "pack" ? isPackType : !isPackType;
  });
}

function filterContainersForMode(containers, typeOptions, mode) {
  const typeCodeById = new Map(
    (typeOptions || []).map((option) => [option.id, normalizeTypeCode(option.code)])
  );

  return (containers || []).filter((container) => {
    const isPackContainer = isPackTypeCode(typeCodeById.get(container.container_type_id));
    return mode === "pack" ? isPackContainer : !isPackContainer;
  });
}

function buildModeCopy(mode) {
  if (mode === "pack") {
    return {
      title: "Pack Maker",
      subtitle:
        "Create pack products from a dedicated 9-slot builder. Draft and full pack variants are handled separately here.",
      collectionLabel: "Packs",
      newLabel: "New Pack",
      emptyLabel: "No packs created yet.",
      editLabel: "Edit Pack",
      createLabel: "Create Pack",
      saveLabel: "Save Pack",
      savingLabel: "Saving Pack...",
      duplicateLabel: "Duplicate Pack",
      lockLabel: "Lock Pack",
      unlockLabel: "Unlock Pack",
      deleteLabel: "Delete Pack",
      deletedLabel: "Pack deleted.",
      deleteConfirm:
        "Delete this pack? This removes the pack and its card pool from the admin list.",
      duplicateMessage: "Pack duplicated into a new unsaved copy.",
      uploadMessage: "Pack image uploaded.",
      loadingLabel: "Loading pack maker...",
      saveSuccess: "Pack saved successfully.",
      topbarKicker: "ADMIN",
      formTypeLabel: "Pack Type",
      cardsHeader: "Pack Cards",
    };
  }

  return {
    title: "Box Maker",
    subtitle:
      "Create promo boxes, deck boxes, and other non-pack container products from the live box system.",
    collectionLabel: "Boxes",
    newLabel: "New Box",
    emptyLabel: "No boxes created yet.",
    editLabel: "Edit Box",
    createLabel: "Create Box",
    saveLabel: "Save Box",
    savingLabel: "Saving Box...",
    duplicateLabel: "Duplicate Box",
    lockLabel: "Lock Box",
    unlockLabel: "Unlock Box",
    deleteLabel: "Delete Box",
    deletedLabel: "Box deleted.",
    deleteConfirm:
      "Delete this box? This removes the box and its card pool from the admin list.",
    duplicateMessage: "Box duplicated into a new unsaved copy.",
    uploadMessage: "Box image uploaded.",
    loadingLabel: "Loading box maker...",
    saveSuccess: "Box saved successfully.",
    topbarKicker: "ADMIN",
    formTypeLabel: "Box Type",
    cardsHeader: "Box Cards",
  };
}

function ContainerMakerPage({ mode = "box" }) {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [massImportBusy, setMassImportBusy] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

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
  const [selectedPackSlot, setSelectedPackSlot] = useState("1");

  const [massCardNames, setMassCardNames] = useState("");

  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const canUsePage = user?.role === "Admin+";
  const modeCopy = useMemo(() => buildModeCopy(mode), [mode]);

  const visibleContainerTypeOptions = useMemo(
    () => filterTypeOptionsForMode(containerTypeOptions, mode),
    [containerTypeOptions, mode]
  );

  const visibleContainers = useMemo(
    () => filterContainersForMode(containers, containerTypeOptions, mode),
    [containers, containerTypeOptions, mode]
  );

  const selectedContainer = useMemo(
    () =>
      visibleContainers.find((container) => container.id === selectedContainerId) || null,
    [visibleContainers, selectedContainerId]
  );

  const selectedContainerTypeCode = useMemo(
    () =>
      containerTypeOptions.find((option) => option.id === containerTypeId)?.code || "",
    [containerTypeId, containerTypeOptions]
  );

  const isPackType = isPackTypeCode(selectedContainerTypeCode);

  const packSlotNumbers = useMemo(() => {
    const safeCount = Math.max(1, Number(cardCount || 1));
    return Array.from({ length: safeCount }, (_, index) => index + 1);
  }, [cardCount]);

  const groupedContainerCards = useMemo(() => {
    if (!isPackType) return [];

    return packSlotNumbers.map((slotNumber) => ({
      slotNumber,
      rows: containerCards.filter(
        (row) => Number(row.slot_index || 0) === Number(slotNumber)
      ),
    }));
  }, [containerCards, isPackType, packSlotNumbers]);

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

  useEffect(() => {
    if (!isPackType) {
      setSelectedPackSlot("1");
      return;
    }

    const maxSlot = Math.max(1, Number(cardCount || 1));
    if (Number(selectedPackSlot || 1) > maxSlot) {
      setSelectedPackSlot(String(maxSlot));
    }
  }, [cardCount, isPackType, selectedPackSlot]);

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

  async function handleImageUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setUploadingImage(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const extension = file.name.includes(".")
        ? file.name.split(".").pop().toLowerCase()
        : "png";

      const baseCode = buildContainerCode(code || name || "container") || "CONTAINER";
      const filePath = `${baseCode.toLowerCase()}-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(CONTAINER_IMAGE_BUCKET)
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type || undefined,
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from(CONTAINER_IMAGE_BUCKET)
        .getPublicUrl(filePath);

      if (!publicUrlData?.publicUrl) {
        throw new Error("Failed to generate a public image URL.");
      }

      setImageUrl(publicUrlData.publicUrl);
      setStatusMessage(modeCopy.uploadMessage);
    } catch (error) {
      console.error("Failed to upload container image:", error);
      setErrorMessage(error.message || "Failed to upload the image.");
    } finally {
      setUploadingImage(false);
    }
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

      const nextContainerRows = containerRows || [];
      const nextTypeRows = typeRows || [];
      const filteredContainers = filterContainersForMode(
        nextContainerRows,
        nextTypeRows,
        mode
      );
      const filteredTypes = filterTypeOptionsForMode(nextTypeRows, mode);

      setContainers(nextContainerRows);
      setContainerTypeOptions(nextTypeRows);
      setCardTiers(tierRows || []);

      if (!selectedTierId && tierRows?.length) {
        setSelectedTierId(tierRows[0].id);
      }

      const nextSelected =
        filteredContainers.find((row) => row.id === selectedContainerId) ||
        filteredContainers[0] ||
        null;

      if (nextSelected) {
        await loadContainerIntoEditor(nextSelected);
      } else {
        resetEditor(filteredTypes, tierRows || []);
      }
    } catch (error) {
      console.error(`Failed to load ${mode} maker:`, error);
      setErrorMessage(error.message || `Failed to load ${mode} maker.`);
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
    setSelectedPackSlot("1");
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
    setCardCount(Number(container.cards_per_open || container.card_count || 5));
    setContentMode(
      String(container.content_mode || "curated").toLowerCase() === "filtered"
        ? "official"
        : container.content_mode || "curated"
    );
    setSelectionCount(
      container.selection_count == null ? "" : String(container.selection_count)
    );
    setDraftPickCount(
      container.draft_pick_count == null ? "" : String(container.draft_pick_count)
    );
    setRarityMode(container.rarity_mode || "normal");
    setIsEnabled(Boolean(container.is_enabled));
    setIsLocked(Boolean(container.is_locked));
    setSelectedPackSlot("1");
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

    const container = visibleContainers.find((row) => row.id === containerId);
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
        slot_index: isPackType ? Number(selectedPackSlot || 1) : null,
        weight: 1,
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
          slot_index: isPackType ? Number(selectedPackSlot || 1) : null,
          weight: 1,
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

  function handleChangeCardSlot(index, slotIndex) {
    setContainerCards((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        slot_index: slotIndex == null ? null : Number(slotIndex),
      };
      return next;
    });
  }

  function handleChangeCardWeight(index, weight) {
    setContainerCards((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        weight: Math.max(1, Number(weight || 1)),
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
    setCardCount(
      Number(selectedContainer.cards_per_open || selectedContainer.card_count || 5)
    );
    setContentMode(
      String(selectedContainer.content_mode || "curated").toLowerCase() ===
        "filtered"
        ? "official"
        : selectedContainer.content_mode || "curated"
    );
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
    setSelectedPackSlot("1");
    setMassCardNames("");

    setContainerCards((prev) =>
      prev.map((row, index) => ({
        ...row,
        id: `duplicate-${row.card_id}-${row.tier_id}-${Date.now()}-${index}`,
        container_id: null,
      }))
    );

    setStatusMessage(modeCopy.duplicateMessage);
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
            slot_index:
              isPackType && row.slot_index != null ? Number(row.slot_index) : null,
            weight: Math.max(1, Number(row.weight || 1)),
          })),
        }
      );

      if (saveCardsError) throw saveCardsError;

      setStatusMessage(modeCopy.saveSuccess);
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
      setStatusMessage(
        `${mode === "pack" ? "Pack" : "Box"} ${
          isLocked ? "unlocked" : "locked"
        } successfully.`
      );
      await loadPage();
    } catch (error) {
      console.error("Failed to lock/unlock container:", error);
      setErrorMessage(error.message || "Failed to change lock state.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteContainer() {
    if (!selectedContainerId || saving) return;
    if (!window.confirm(modeCopy.deleteConfirm)) {
      return;
    }

    setSaving(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const { error } = await supabase.rpc("delete_container_admin", {
        p_container_id: selectedContainerId,
      });

      if (error) throw error;

      setStatusMessage(modeCopy.deletedLabel);
      await loadPage();
      resetEditor();
    } catch (error) {
      console.error("Failed to delete container:", error);
      setErrorMessage(error.message || "Failed to delete container.");
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
            <h1 className="container-maker-title">{modeCopy.title}</h1>
            <p className="container-maker-subtitle">{modeCopy.subtitle}</p>
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
            {modeCopy.loadingLabel}
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
                  <h2>{modeCopy.collectionLabel}</h2>
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
                  {modeCopy.newLabel}
                </button>

                <div className="container-maker-container-list">
                  {visibleContainers.length === 0 ? (
                    <div className="container-maker-empty small">
                      {modeCopy.emptyLabel}
                    </div>
                  ) : (
                    visibleContainers.map((container) => (
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
                  <h2>{selectedContainerId ? modeCopy.editLabel : modeCopy.createLabel}</h2>
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
                    <label>{modeCopy.formTypeLabel}</label>
                    <select
                      className="container-maker-select"
                      value={containerTypeId}
                      onChange={(event) => setContainerTypeId(event.target.value)}
                      disabled={saving}
                    >
                      <option value="">Choose type...</option>
                      {visibleContainerTypeOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="container-maker-field">
                    <label>Container Image</label>
                    <div className="container-maker-image-controls">
                      <input
                        className="container-maker-input"
                        value={imageUrl}
                        onChange={(event) => setImageUrl(event.target.value)}
                        placeholder="https://..."
                        disabled={saving || uploadingImage}
                      />

                      <label className="container-maker-secondary-btn container-maker-upload-btn">
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={handleImageUpload}
                          disabled={saving || uploadingImage}
                          hidden
                        />
                        {uploadingImage ? "Uploading..." : "Upload"}
                      </label>
                    </div>
                  </div>

                  <div className="container-maker-field">
                    <label>Cards Per Open</label>
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
                    <select
                      className="container-maker-select"
                      value={contentMode}
                      onChange={(event) => setContentMode(event.target.value)}
                      disabled={saving}
                    >
                      {CONTENT_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
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

                {imageUrl ? (
                  <div className="container-maker-image-preview-shell">
                    <img
                      src={imageUrl}
                      alt={name || "Container preview"}
                      className="container-maker-image-preview"
                    />
                  </div>
                ) : null}

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
                    {saving ? modeCopy.savingLabel : modeCopy.saveLabel}
                  </button>

                  {selectedContainerId ? (
                    <>
                      <button
                        type="button"
                        className="container-maker-secondary-btn"
                        onClick={handleDuplicateContainer}
                        disabled={saving}
                      >
                        {modeCopy.duplicateLabel}
                      </button>

                      <button
                        type="button"
                        className="container-maker-secondary-btn"
                        onClick={handleToggleLock}
                        disabled={saving}
                      >
                        {isLocked ? modeCopy.unlockLabel : modeCopy.lockLabel}
                      </button>

                      <button
                        type="button"
                        className="container-maker-danger-btn"
                        onClick={handleDeleteContainer}
                        disabled={saving}
                      >
                        {modeCopy.deleteLabel}
                      </button>
                    </>
                  ) : null}
                </div>
              </section>
            </div>

            <div className="container-maker-card container-maker-cards-card">
                <div className="container-maker-section-header">
                <h2>{modeCopy.cardsHeader}</h2>
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

                {isPackType ? (
                  <select
                    className="container-maker-select"
                    value={selectedPackSlot}
                    onChange={(event) => setSelectedPackSlot(event.target.value)}
                    disabled={saving}
                  >
                    {packSlotNumbers.map((slotNumber) => (
                      <option key={slotNumber} value={slotNumber}>
                        Pack Slot {slotNumber}
                      </option>
                    ))}
                  </select>
                ) : null}
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
                ) : isPackType ? (
                  groupedContainerCards.map((slotGroup) => (
                    <div
                      key={`slot-${slotGroup.slotNumber}`}
                      className="container-maker-slot-group"
                    >
                      <div className="container-maker-slot-header">
                        <h3>Pack Slot {slotGroup.slotNumber}</h3>
                        <span>{slotGroup.rows.length} cards</span>
                      </div>

                      {slotGroup.rows.length === 0 ? (
                        <div className="container-maker-empty small">
                          No cards assigned to this slot yet.
                        </div>
                      ) : (
                        slotGroup.rows.map((row, index) => {
                          const rowIndex = containerCards.indexOf(row);
                          return (
                            <div
                              key={`${row.id || "temp"}-${slotGroup.slotNumber}-${index}`}
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
                                  value={row.slot_index || slotGroup.slotNumber}
                                  onChange={(event) =>
                                    handleChangeCardSlot(rowIndex, event.target.value)
                                  }
                                  disabled={saving}
                                >
                                  {packSlotNumbers.map((slotNumber) => (
                                    <option key={slotNumber} value={slotNumber}>
                                      Slot {slotNumber}
                                    </option>
                                  ))}
                                </select>

                                <select
                                  className="container-maker-select small"
                                  value={row.tier_id}
                                  onChange={(event) =>
                                    handleChangeCardTier(rowIndex, event.target.value)
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

                                <input
                                  type="number"
                                  min="1"
                                  className="container-maker-input container-maker-weight-input"
                                  value={row.weight || 1}
                                  title="Weight"
                                  placeholder="Weight"
                                  onChange={(event) =>
                                    handleChangeCardWeight(rowIndex, event.target.value)
                                  }
                                  disabled={saving}
                                />

                                <label className="container-maker-inline-checkbox">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(row.is_enabled)}
                                    onChange={() => handleToggleCardEnabled(rowIndex)}
                                    disabled={saving}
                                  />
                                  <span>Enabled</span>
                                </label>

                                <button
                                  type="button"
                                  className="container-maker-danger-btn small"
                                  onClick={() => handleRemoveCard(rowIndex)}
                                  disabled={saving}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  ))
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

                        <input
                          type="number"
                          min="1"
                          className="container-maker-input container-maker-weight-input"
                          value={row.weight || 1}
                          title="Weight"
                          placeholder="Weight"
                          onChange={(event) =>
                            handleChangeCardWeight(index, event.target.value)
                          }
                          disabled={saving}
                        />

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
