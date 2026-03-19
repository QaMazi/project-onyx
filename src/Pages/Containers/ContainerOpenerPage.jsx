import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";
import "./ContainerOpenerPage.css";

const TAB_ORDER = ["boxes", "packs"];
const PACK_MODE_OPTIONS = [
  { value: "normal", label: "Normal Mode" },
  { value: "draft", label: "Draft Mode" },
];

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function getContainerBucket(typeCode) {
  const code = normalizeText(typeCode);
  if (code === "promo_box" || code === "deck_box") return "boxes";
  if (code === "full_pack" || code === "draft_pack") return "packs";
  return "boxes";
}

function getBucketLabel(bucket) {
  return bucket === "packs" ? "Packs" : "Boxes";
}

function getRarityClass(rarityCode) {
  return `rarity-${String(rarityCode || "base")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")}`;
}

function getTierClass(tierCode) {
  return `tier-${String(tierCode || "tier1")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")}`;
}

function getContainerImageUrl(container) {
  return container?.artwork_url || container?.image_url || "";
}

function normalizePackDisplayName(name) {
  return String(name || "").replace(/\s+Draft$/i, "").trim();
}

function getPackVariant(container, containerTypeCode) {
  return normalizeText(container?.pack_variant || containerTypeCode) === "draft" ||
    normalizeText(containerTypeCode) === "draft_pack"
    ? "draft"
    : "normal";
}

function getNumberSortValue(value) {
  const normalized = String(value || "").trim();
  if (/^(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2})$/.test(normalized)) return Number(normalized);
  return Number.MAX_SAFE_INTEGER;
}

function buildRevealPlaceholders(count) {
  return Array.from({ length: Math.max(1, count) }).map((_, index) => ({
    id: `placeholder-${index}`,
    card_name: "Hidden Card",
    rarity_name: "Unknown",
    rarity_code: "base",
    tier_name: "Unknown",
    tier_code: "tier1",
    image_url: "",
    isPlaceholder: true,
  }));
}

function buildDisplayRevealCards(cards, revealCount, placeholderCount) {
  const total = Math.max(cards.length, placeholderCount, 1);
  const placeholders = buildRevealPlaceholders(total);

  return placeholders.map((placeholder, index) => {
    if (index < revealCount && cards[index]) {
      return {
        ...cards[index],
        revealKey: `revealed-${cards[index].card_id || cards[index].id || index}-${index}`,
        isRevealed: true,
      };
    }

    return {
      ...placeholder,
      revealKey: placeholder.id,
      isRevealed: false,
    };
  });
}

function sumOpeningPulls(openings) {
  return (openings || []).reduce(
    (sum, opening) => sum + ((opening?.pulls || []).length || 0),
    0
  );
}

function sortLibraryItems(left, right, numberField = "packNumberCode") {
  const numberDiff =
    getNumberSortValue(left?.[numberField]) - getNumberSortValue(right?.[numberField]);
  if (numberDiff !== 0) return numberDiff;

  const nameDiff = String(left?.name || "").localeCompare(String(right?.name || ""));
  if (nameDiff !== 0) return nameDiff;

  return String(left?.code || "").localeCompare(String(right?.code || ""));
}

function ContainerOpenerPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [activeTab, setActiveTab] = useState("boxes");
  const [packMode, setPackMode] = useState("normal");

  const [catalogContainers, setCatalogContainers] = useState([]);
  const [inventoryRows, setInventoryRows] = useState([]);
  const [openerDefinitions, setOpenerDefinitions] = useState([]);
  const [selectedLibraryItem, setSelectedLibraryItem] = useState(null);
  const [selectionModalOpen, setSelectionModalOpen] = useState(false);
  const [openCount, setOpenCount] = useState(1);

  const [sessionState, setSessionState] = useState(null);
  const [revealPhase, setRevealPhase] = useState("idle");
  const [revealCount, setRevealCount] = useState(0);

  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const revealTimersRef = useRef([]);

  function clearRevealTimers() {
    revealTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    revealTimersRef.current = [];
  }

  const inventoryByItemDefinitionId = useMemo(
    () => new Map(inventoryRows.map((row) => [row.item_definition_id, row])),
    [inventoryRows]
  );

  const openerDefinitionsByContainerId = useMemo(() => {
    const map = new Map();
    openerDefinitions.forEach((definition) => {
      if (!definition?.target_id) return;
      if (!map.has(definition.target_id)) {
        map.set(definition.target_id, []);
      }
      map.get(definition.target_id).push(definition);
    });
    return map;
  }, [openerDefinitions]);

  const packSections = useMemo(() => {
    const groupMap = new Map();

    catalogContainers
      .filter((container) => container.bucket === "packs")
      .forEach((container) => {
        const groupKey = container.pack_group_code || `pack:${container.id}`;
        const variant = getPackVariant(container, container.container_type?.code);
        const openerDefinition = (openerDefinitionsByContainerId.get(container.id) || [])[0] || null;
        const inventoryRow = openerDefinition
          ? inventoryByItemDefinitionId.get(openerDefinition.id) || null
          : null;

        if (!groupMap.has(groupKey)) {
          groupMap.set(groupKey, {
            key: groupKey,
            type: "pack",
            normalRow: null,
            draftRow: null,
            normalContainer: null,
            draftContainer: null,
            normalOpenerDefinition: null,
            draftOpenerDefinition: null,
          });
        }

        const entry = groupMap.get(groupKey);
        if (variant === "draft") {
          entry.draftRow = inventoryRow;
          entry.draftContainer = container;
          entry.draftOpenerDefinition = openerDefinition;
        } else {
          entry.normalRow = inventoryRow;
          entry.normalContainer = container;
          entry.normalOpenerDefinition = openerDefinition;
        }
      });

    const sectionMap = new Map();

    Array.from(groupMap.values()).forEach((entry) => {
      const displayContainer = entry.normalContainer || entry.draftContainer;
      if (!displayContainer) return;

      const product = {
        key: entry.key,
        type: "pack",
        name: normalizePackDisplayName(displayContainer.name),
        code: displayContainer.code,
        imageUrl: getContainerImageUrl(displayContainer),
        description: displayContainer.description || "",
        packNumberCode:
          entry.normalContainer?.pack_number_code ||
          entry.draftContainer?.pack_number_code ||
          "",
        isRewardPack: Boolean(
          entry.normalContainer?.is_reward_pack ?? entry.draftContainer?.is_reward_pack
        ),
        cardsPerOpen:
          entry.normalContainer?.cards_per_open ||
          entry.draftContainer?.cards_per_open ||
          9,
        normalRow: entry.normalRow,
        draftRow: entry.draftRow,
        normalQuantity: Number(entry.normalRow?.available_quantity || 0),
        draftQuantity: Number(entry.draftRow?.available_quantity || 0),
        normalRequiredItemName: entry.normalOpenerDefinition?.name || "",
        draftRequiredItemName: entry.draftOpenerDefinition?.name || "",
        normalRequiredItemCode: entry.normalOpenerDefinition?.code || "",
        draftRequiredItemCode: entry.draftOpenerDefinition?.code || "",
      };

      const sectionLabel = product.isRewardPack ? "Reward Packs" : "Normal Packs";
      if (!sectionMap.has(sectionLabel)) {
        sectionMap.set(sectionLabel, []);
      }
      sectionMap.get(sectionLabel).push(product);
    });

    return Array.from(sectionMap.entries())
      .sort(([left], [right]) => {
        const leftRank = left === "Normal Packs" ? 0 : 1;
        const rightRank = right === "Normal Packs" ? 0 : 1;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.localeCompare(right);
      })
      .map(([label, products]) => ({
        label,
        products: [...products].sort((left, right) => sortLibraryItems(left, right)),
      }));
  }, [catalogContainers, inventoryByItemDefinitionId, openerDefinitionsByContainerId]);

  const boxSections = useMemo(() => {
    const sectionMap = new Map();

    catalogContainers
      .filter((container) => container.bucket === "boxes")
      .forEach((container) => {
        const openerDefinition = (openerDefinitionsByContainerId.get(container.id) || [])[0] || null;
        const inventoryRow = openerDefinition
          ? inventoryByItemDefinitionId.get(openerDefinition.id) || null
          : null;
        const sectionLabel =
          normalizeText(container.container_type?.code) === "deck_box"
            ? "Deck Boxes"
            : "Promo Boxes";

        if (!sectionMap.has(sectionLabel)) {
          sectionMap.set(sectionLabel, []);
        }

        sectionMap.get(sectionLabel).push({
          key: `box:${container.id}`,
          type: "box",
          name: container.name,
          code: container.code,
          imageUrl: getContainerImageUrl(container),
          description: container.description || openerDefinition?.description || "",
          boxNumberCode: container.box_number_code || "",
          cardsPerOpen: container.cards_per_open || 1,
          inventoryRow,
          availableQuantity: Number(inventoryRow?.available_quantity || 0),
          categoryLabel: container.container_type?.name || "Box",
          requiredItemName: openerDefinition?.name || "",
          requiredItemCode: openerDefinition?.code || "",
        });
      });

    return Array.from(sectionMap.entries())
      .sort(([left], [right]) => {
        const leftRank = left === "Promo Boxes" ? 0 : 1;
        const rightRank = right === "Promo Boxes" ? 0 : 1;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.localeCompare(right);
      })
      .map(([label, products]) => ({
        label,
        products: [...products].sort((left, right) =>
          sortLibraryItems(left, right, "boxNumberCode")
        ),
      }));
  }, [catalogContainers, inventoryByItemDefinitionId, openerDefinitionsByContainerId]);

  const activeSections = activeTab === "packs" ? packSections : boxSections;

  const selectedInventoryRow = useMemo(() => {
    if (!selectedLibraryItem) return null;
    if (selectedLibraryItem.type === "pack") {
      return packMode === "draft"
        ? selectedLibraryItem.draftRow || null
        : selectedLibraryItem.normalRow || null;
    }
    return selectedLibraryItem.inventoryRow || null;
  }, [packMode, selectedLibraryItem]);

  const selectedAvailableQuantity = useMemo(() => {
    if (!selectedLibraryItem) return 0;
    if (selectedLibraryItem.type === "pack") {
      return packMode === "draft"
        ? Number(selectedLibraryItem.draftQuantity || 0)
        : Number(selectedLibraryItem.normalQuantity || 0);
    }
    return Number(selectedLibraryItem.availableQuantity || 0);
  }, [packMode, selectedLibraryItem]);

  const currentOpening = useMemo(
    () =>
      sessionState?.openings?.[
        Math.min(sessionState.activeIndex || 0, (sessionState?.openings?.length || 1) - 1)
      ] || null,
    [sessionState]
  );

  const displayRevealCards = useMemo(
    () =>
      buildDisplayRevealCards(
        currentOpening?.pulls || [],
        revealCount,
        currentOpening?.cards_per_open || (currentOpening?.pulls || []).length || 1
      ),
    [currentOpening, revealCount]
  );

  useEffect(() => {
    if (!authLoading && user) {
      loadPage();
    }

    return () => {
      clearRevealTimers();
    };
  }, [authLoading, user]);

  useEffect(() => {
    if (!selectionModalOpen) return;
    setOpenCount((previous) => {
      if (selectedAvailableQuantity <= 0) return 1;
      return Math.min(Math.max(previous, 1), selectedAvailableQuantity);
    });
  }, [selectedAvailableQuantity, selectionModalOpen]);

  async function loadPage() {
    setLoading(true);
    setErrorMessage("");

    try {
      const { data: currentSeries, error: currentSeriesError } = await supabase
        .from("game_series")
        .select("id")
        .eq("is_current", true)
        .maybeSingle();

      if (currentSeriesError) throw currentSeriesError;

      if (!currentSeries?.id) {
        setCatalogContainers([]);
        setInventoryRows([]);
        setOpenerDefinitions([]);
        return;
      }

      const [
        { data: inventoryData, error: inventoryError },
        { data: openerDefinitionData, error: openerDefinitionError },
        { data: containersData, error: containersError },
        { data: typeData, error: typeError },
      ] = await Promise.all([
        supabase
          .from("player_inventory_view")
          .select("*")
          .eq("user_id", user.id)
          .eq("series_id", currentSeries.id)
          .eq("behavior_code", "open_container")
          .eq("target_kind", "container"),
        supabase
          .from("item_definitions")
          .select("id, code, name, description, target_id, exact_item_family")
          .eq("behavior_code", "open_container")
          .eq("target_kind", "container")
          .eq("is_active", true),
        supabase.from("containers").select("*").eq("is_enabled", true),
        supabase.from("container_types").select("*"),
      ]);

      if (inventoryError) throw inventoryError;
      if (openerDefinitionError) throw openerDefinitionError;
      if (containersError) throw containersError;
      if (typeError) throw typeError;

      const typeMap = new Map((typeData || []).map((row) => [row.id, row]));
      const containerMap = new Map((containersData || []).map((row) => [row.id, row]));

      const hydratedCatalog = (containersData || [])
        .filter((container) => container.is_locked !== true)
        .map((container) => {
          const type = typeMap.get(container.container_type_id);
          return {
            ...container,
            bucket: getContainerBucket(type?.code),
            container_type: type || null,
          };
        })
        .filter((container) => container.container_type);

      const hydratedRows = (inventoryData || [])
        .map((row) => {
          const container = containerMap.get(row.target_id);
          const type = container ? typeMap.get(container.container_type_id) : null;

          return {
            ...row,
            bucket: getContainerBucket(type?.code),
            container,
            container_type: type,
          };
        })
        .filter((row) => row.container && row.container_type);

      setCatalogContainers(hydratedCatalog);
      setInventoryRows(hydratedRows);
      setOpenerDefinitions(openerDefinitionData || []);
    } catch (error) {
      console.error("Failed to load opener page:", error);
      setErrorMessage(error.message || "Failed to load opener page.");
      setCatalogContainers([]);
      setInventoryRows([]);
      setOpenerDefinitions([]);
    } finally {
      setLoading(false);
    }
  }

  function openSelectionModal(item) {
    setSelectedLibraryItem(item);
    setSelectionModalOpen(true);
    setOpenCount(1);
    setErrorMessage("");
  }

  function closeSelectionModal() {
    setSelectionModalOpen(false);
    setSelectedLibraryItem(null);
  }

  function startRevealSequence(openings, activeIndex) {
    const safeIndex = Math.min(Math.max(activeIndex, 0), Math.max(openings.length - 1, 0));
    const opening = openings[safeIndex];
    const revealTotal = Math.max(opening?.pulls?.length || 0, opening?.cards_per_open || 0, 1);

    clearRevealTimers();
    setRevealPhase("charging");
    setRevealCount(0);
    setSessionState((previous) =>
      previous
        ? {
            ...previous,
            activeIndex: safeIndex,
          }
        : previous
    );

    revealTimersRef.current = [
      setTimeout(() => {
        setRevealPhase("sealed");
      }, 140),
      setTimeout(() => {
        setRevealPhase("burst");
      }, 760),
      ...Array.from({ length: revealTotal }).map((_, index) =>
        setTimeout(() => {
          setRevealPhase("revealing");
          setRevealCount(index + 1);
        }, 1160 + index * 180)
      ),
      setTimeout(() => {
        setRevealPhase("revealed");
      }, 1160 + revealTotal * 180 + 220),
    ];
  }

  async function handleOpenSelection() {
    if (!selectedInventoryRow || opening) return;

    if (selectedAvailableQuantity <= 0) {
      setErrorMessage("You do not have the required opener for that mode.");
      return;
    }

    const requestedCount = Math.min(Math.max(openCount, 1), selectedAvailableQuantity);

    setOpening(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const { data, error } = await supabase.rpc("open_inventory_container_batch", {
        p_inventory_id: selectedInventoryRow.id,
        p_open_count: requestedCount,
      });

      if (error) throw error;

      const openings = data?.openings || [];
      if (!openings.length) {
        throw new Error("No openings were returned.");
      }

      closeSelectionModal();
      setSessionState({
        bucket: activeTab,
        packMode: activeTab === "packs" ? packMode : null,
        libraryItem: selectedLibraryItem,
        requestedCount,
        openings,
        activeIndex: 0,
      });
      startRevealSequence(openings, 0);
    } catch (error) {
      console.error("Failed to open container batch:", error);
      setErrorMessage(error.message || "Failed to open opener batch.");
    } finally {
      setOpening(false);
    }
  }

  async function handleAdvanceSession() {
    if (!sessionState) return;

    const nextIndex = (sessionState.activeIndex || 0) + 1;
    if (nextIndex < sessionState.openings.length) {
      startRevealSequence(sessionState.openings, nextIndex);
      return;
    }

    const totalCards = sumOpeningPulls(sessionState.openings);
    const noun = sessionState.bucket === "packs" ? "pack" : "box";
    setStatusMessage(
      `Opened ${sessionState.openings.length} ${noun}${
        sessionState.openings.length === 1 ? "" : "es"
      } and sent ${totalCards} card${totalCards === 1 ? "" : "s"} to your binder.`
    );

    clearRevealTimers();
    setSessionState(null);
    setRevealPhase("idle");
    setRevealCount(0);
    await loadPage();
  }

  function renderLibraryCard(item) {
    const currentQuantity =
      item.type === "pack"
        ? packMode === "draft"
          ? item.draftQuantity
          : item.normalQuantity
        : item.availableQuantity;
    const currentRequiredItemName =
      item.type === "pack"
        ? packMode === "draft"
          ? item.draftRequiredItemName
          : item.normalRequiredItemName
        : item.requiredItemName;

    return (
      <button
        key={item.key}
        type="button"
        className={`container-opener-library-card ${currentQuantity <= 0 ? "is-unavailable" : ""}`}
        onClick={() => openSelectionModal(item)}
      >
        <div className="container-opener-library-art-shell">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.name}
              className="container-opener-library-art"
            />
          ) : (
            <div className="container-opener-library-art-placeholder">
              <span>{item.type === "pack" ? "Pack" : "Box"}</span>
              <strong>Preview</strong>
            </div>
          )}
        </div>

        <div className="container-opener-library-body">
          <div className="container-opener-library-head">
            <strong>{item.name}</strong>
            <span>
              {item.type === "pack" ? item.packNumberCode || "---" : item.boxNumberCode || "---"}
            </span>
          </div>

          <div className="container-opener-library-meta">
            <span>{item.code}</span>
            <span>
              Owned: {currentQuantity}
              {item.type === "pack" ? ` (${packMode === "draft" ? "Draft" : "Normal"})` : ""}
            </span>
            <span>{currentRequiredItemName ? `Needs: ${currentRequiredItemName}` : "No opener assigned"}</span>
          </div>
        </div>
      </button>
    );
  }

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (user.role === "Blocked") return <Navigate to="/" replace />;

  return (
    <LauncherLayout>
      <div className="container-opener-page">
        <div className="container-opener-topbar">
          <div>
            <div className="container-opener-kicker">PROGRESSION</div>
            <h1 className="container-opener-title">Container Opener</h1>
            <p className="container-opener-subtitle">
              All unlocked boxes and packs stay visible here. Dimmed entries just mean you
              do not currently own the right key or seal breaker for that mode.
            </p>
          </div>

          <div className="container-opener-topbar-actions">
            <button
              type="button"
              className="container-opener-secondary-btn"
              onClick={() => navigate("/mode/progression")}
            >
              Back
            </button>
          </div>
        </div>

        <div className="container-opener-status-row">
          {statusMessage ? <div className="container-opener-success">{statusMessage}</div> : null}
          {errorMessage ? <div className="container-opener-error">{errorMessage}</div> : null}
        </div>

        {loading ? (
          <div className="container-opener-card container-opener-empty">Loading opener...</div>
        ) : (
          <div className="container-opener-card container-opener-library-shell">
            <div className="container-opener-library-header">
              <div>
                <h2>Choose Box or Pack</h2>
                <p>
                  Openers are grouped by type and sorted by their numbers where available.
                  Unavailable options stay visible so you can always browse the full unlocked catalog.
                </p>
              </div>

              <div className="container-opener-library-controls">
                <div className="container-opener-tabs container-opener-tabs--row">
                  {TAB_ORDER.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      className={`container-opener-tab-btn ${
                        activeTab === tab ? "is-active" : ""
                      }`}
                      onClick={() => {
                        setActiveTab(tab);
                        setSelectionModalOpen(false);
                        setSelectedLibraryItem(null);
                      }}
                    >
                      {getBucketLabel(tab)}
                    </button>
                  ))}
                </div>

                {activeTab === "packs" ? (
                  <div className="container-opener-tabs container-opener-tabs--row">
                    {PACK_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`container-opener-tab-btn ${
                          packMode === option.value ? "is-active" : ""
                        }`}
                        onClick={() => {
                          setPackMode(option.value);
                          setSelectionModalOpen(false);
                          setSelectedLibraryItem(null);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {activeSections.length === 0 ? (
              <div className="container-opener-empty">
                No {activeTab === "packs" ? "packs" : "boxes"} are currently unlocked.
              </div>
            ) : (
              <div className="container-opener-library-sections">
                {activeSections.map((section) => (
                  <section key={section.label} className="container-opener-library-section">
                    <div className="container-opener-library-section-header">
                      <h3>{section.label}</h3>
                      <span>{section.products.length} options</span>
                    </div>

                    <div className="container-opener-library-grid">
                      {section.products.map((item) => renderLibraryCard(item))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}

        {selectionModalOpen && selectedLibraryItem ? (
          <div className="container-opener-modal-backdrop" onClick={closeSelectionModal}>
            <div
              className="container-opener-modal container-opener-choice-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="container-opener-modal-kicker">
                {selectedLibraryItem.type === "pack"
                  ? packMode === "draft"
                    ? "DRAFT PACK"
                    : "NORMAL PACK"
                  : "BOX"}
              </div>
              <h2 className="container-opener-modal-title">{selectedLibraryItem.name}</h2>

              <div className="container-opener-choice-layout">
                <div className="container-opener-choice-art-shell">
                  {selectedLibraryItem.imageUrl ? (
                    <img
                      src={selectedLibraryItem.imageUrl}
                      alt={selectedLibraryItem.name}
                      className="container-opener-choice-art"
                    />
                  ) : (
                    <div className="container-opener-choice-art-placeholder">
                      No container art uploaded yet.
                    </div>
                  )}
                </div>

                <div className="container-opener-choice-main">
                  <div className="container-opener-choice-info-grid">
                    <div className="container-opener-info-row">
                      <span>Category</span>
                      <strong>
                        {selectedLibraryItem.type === "pack"
                          ? packMode === "draft"
                            ? "Draft Pack"
                            : "Normal Pack"
                          : selectedLibraryItem.categoryLabel}
                      </strong>
                    </div>
                    <div className="container-opener-info-row">
                      <span>Number</span>
                      <strong>
                        {selectedLibraryItem.type === "pack"
                          ? selectedLibraryItem.packNumberCode || "---"
                          : selectedLibraryItem.boxNumberCode || "---"}
                      </strong>
                    </div>
                    <div className="container-opener-info-row">
                      <span>Cards Per Open</span>
                      <strong>{selectedLibraryItem.cardsPerOpen}</strong>
                    </div>
                    <div className="container-opener-info-row">
                      <span>Owned Openers</span>
                      <strong>{selectedAvailableQuantity}</strong>
                    </div>
                    <div className="container-opener-info-row">
                      <span>Required Item</span>
                      <strong>
                        {selectedInventoryRow?.item_name ||
                          (selectedLibraryItem.type === "pack"
                            ? packMode === "draft"
                              ? selectedLibraryItem.draftRequiredItemName || "No opener assigned"
                              : selectedLibraryItem.normalRequiredItemName || "No opener assigned"
                            : selectedLibraryItem.requiredItemName || "No opener assigned")}
                      </strong>
                    </div>
                  </div>

                  <p className="container-opener-choice-copy">
                    {selectedLibraryItem.description ||
                      "Choose how many to open, then run through the reveal sequence one container at a time."}
                  </p>

                  {selectedAvailableQuantity > 0 ? (
                    <div className="container-opener-quantity-block">
                      <div className="container-opener-quantity-header">
                        <strong>How many do you want to open?</strong>
                        <span>
                          {openCount} / {selectedAvailableQuantity}
                        </span>
                      </div>

                      <input
                        type="range"
                        min="1"
                        max={selectedAvailableQuantity}
                        value={Math.min(openCount, selectedAvailableQuantity)}
                        className="container-opener-quantity-slider"
                        onChange={(event) => setOpenCount(Number(event.target.value))}
                      />
                    </div>
                  ) : (
                    <div className="container-opener-error">
                      You do not have the required opener for this selection.
                    </div>
                  )}
                </div>
              </div>

              <div className="container-opener-choice-actions">
                <button
                  type="button"
                  className="container-opener-secondary-btn"
                  onClick={closeSelectionModal}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="container-opener-primary-btn"
                  onClick={handleOpenSelection}
                  disabled={opening || selectedAvailableQuantity <= 0}
                >
                  {opening
                    ? "Opening..."
                    : `Open ${Math.min(openCount, Math.max(selectedAvailableQuantity, 1))}`}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {sessionState && currentOpening ? (
          <div className="container-opener-modal-backdrop">
            <div className="container-opener-modal container-opener-session-modal">
              <div className="container-opener-modal-kicker">
                {sessionState.bucket === "packs" ? "PACK OPENING" : "BOX OPENING"}{" "}
                {sessionState.activeIndex + 1} / {sessionState.openings.length}
              </div>
              <h2 className="container-opener-modal-title">{currentOpening.container_name}</h2>

              <div className={`container-opener-pack-cinematic phase-${revealPhase}`}>
                <div className="container-opener-pack-energy" />
                <div className="container-opener-pack-burst-ring" />
                <div className="container-opener-pack-sparks" />
                <div className="container-opener-cinematic-art-shell">
                  {currentOpening.container_image_url ? (
                    <img
                      src={currentOpening.container_image_url}
                      alt={currentOpening.container_name}
                      className="container-opener-cinematic-art"
                    />
                  ) : (
                    <div className="container-opener-cinematic-art-placeholder">
                      No art uploaded for this container yet.
                    </div>
                  )}
                  <div className="container-opener-cinematic-tear-line" />
                  <div className="container-opener-cinematic-label">
                    <span>{sessionState.bucket === "packs" ? "Seal Breaker" : "Key Open"}</span>
                    <strong>{currentOpening.container_name}</strong>
                  </div>
                </div>
              </div>

              <div className="container-opener-session-results">
                <div className="container-opener-session-results-header">
                  <h3>Card Reveals</h3>
                  <span>
                    {revealPhase === "revealed"
                      ? `${displayRevealCards.filter((card) => card.isRevealed).length} revealed`
                      : `${revealCount} revealed`}
                  </span>
                </div>

                <div className="container-opener-reveal-grid">
                  {displayRevealCards.map((card, index) => (
                    <div
                      key={card.revealKey || `${card.card_name}-${index}`}
                      className={`container-opener-reveal-card ${
                        card.isPlaceholder ? "is-placeholder" : ""
                      } ${card.isRevealed ? "is-revealed" : "is-hidden"} ${getRarityClass(
                        card.rarity_code
                      )} ${getTierClass(card.tier_code)}`}
                      style={{ "--reveal-index": index }}
                    >
                      <div className="container-opener-reveal-image-shell">
                        {card.isRevealed && card.image_url ? (
                          <img
                            src={card.image_url}
                            alt={card.card_name}
                            className="container-opener-reveal-image"
                          />
                        ) : (
                          <div className="container-opener-reveal-card-back">
                            <span>{card.isRevealed ? "No Art" : "Hidden"}</span>
                          </div>
                        )}
                      </div>

                      <div className="container-opener-reveal-meta">
                        <strong>{card.isRevealed ? card.card_name : "Hidden Card"}</strong>
                        <span>
                          {card.isRevealed
                            ? `${card.tier_name} | ${card.rarity_name}`
                            : "Awaiting reveal"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="container-opener-choice-actions">
                <button
                  type="button"
                  className="container-opener-primary-btn"
                  onClick={handleAdvanceSession}
                  disabled={revealPhase !== "revealed"}
                >
                  {(sessionState.activeIndex || 0) < sessionState.openings.length - 1
                    ? `Next ${sessionState.bucket === "packs" ? "Pack" : "Box"}`
                    : "Back to Selection"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </LauncherLayout>
  );
}

export default ContainerOpenerPage;
