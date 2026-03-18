import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";
import "./ContainerOpenerPage.css";

const TAB_ORDER = ["boxes", "packs"];

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

function buildPackRevealPlaceholders(count) {
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

function buildDisplayPackCards(cards, revealCount, placeholderCount) {
  const total = Math.max(cards.length, placeholderCount, 1);
  const placeholders = buildPackRevealPlaceholders(total);

  return placeholders.map((placeholder, index) => {
    if (index < revealCount && cards[index]) {
      return {
        ...cards[index],
        revealKey: `revealed-${cards[index].id || cards[index].card_id || index}-${index}`,
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

function buildBoxReelCards(cards, winnerIndex) {
  if (!cards.length) return [];

  const reel = [];
  const total = 36;
  const safeWinner = Math.min(Math.max(winnerIndex, 0), cards.length - 1);

  for (let index = 0; index < total; index += 1) {
    if (index === total - 6) {
      reel.push({
        ...cards[safeWinner],
        reelKey: `winner-${index}-${safeWinner}`,
        isWinner: true,
      });
      continue;
    }

    const randomIndex = Math.floor(Math.random() * cards.length);
    reel.push({
      ...cards[randomIndex],
      reelKey: `reel-${index}-${randomIndex}-${Math.random()}`,
      isWinner: false,
    });
  }

  return reel;
}

function ContainerOpenerPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [activeTab, setActiveTab] = useState("boxes");

  const [inventoryRows, setInventoryRows] = useState([]);
  const [selectedInventoryId, setSelectedInventoryId] = useState("");
  const [selectedInventoryRow, setSelectedInventoryRow] = useState(null);

  const [boxReelCards, setBoxReelCards] = useState([]);
  const [boxResult, setBoxResult] = useState(null);
  const [packResults, setPackResults] = useState([]);
  const [packRevealCount, setPackRevealCount] = useState(0);

  const [boxSpinPhase, setBoxSpinPhase] = useState("idle");
  const [packRevealPhase, setPackRevealPhase] = useState("idle");

  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [resultModalMode, setResultModalMode] = useState("box");

  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const boxSpinTimeoutRef = useRef(null);
  const packTimeoutsRef = useRef([]);

  function clearPackTimers() {
    packTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    packTimeoutsRef.current = [];
  }

  function resetStageState() {
    if (boxSpinTimeoutRef.current) {
      clearTimeout(boxSpinTimeoutRef.current);
      boxSpinTimeoutRef.current = null;
    }

    clearPackTimers();
    setBoxSpinPhase("idle");
    setPackRevealPhase("idle");
    setPackRevealCount(0);
    setResultModalOpen(false);
  }

  const usableInventoryRows = useMemo(
    () => inventoryRows.filter((row) => row.bucket === activeTab),
    [inventoryRows, activeTab]
  );

  useEffect(() => {
    if (!authLoading && user) {
      loadPage();
    }

    return () => {
      resetStageState();
    };
  }, [authLoading, user]);

  useEffect(() => {
    if (!usableInventoryRows.length) {
      setSelectedInventoryId("");
      setSelectedInventoryRow(null);
      return;
    }

    const existingRow = usableInventoryRows.find(
      (row) => row.id === selectedInventoryId
    );

    if (existingRow) {
      setSelectedInventoryRow(existingRow);
      return;
    }

    setSelectedInventoryId(usableInventoryRows[0].id);
    setSelectedInventoryRow(usableInventoryRows[0]);
  }, [usableInventoryRows, selectedInventoryId]);

  async function loadPage() {
    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const { data: currentSeries, error: currentSeriesError } = await supabase
        .from("game_series")
        .select("id")
        .eq("is_current", true)
        .maybeSingle();

      if (currentSeriesError) throw currentSeriesError;
      if (!currentSeries?.id) {
        setInventoryRows([]);
        setLoading(false);
        return;
      }

      const { data: inventoryData, error: inventoryError } = await supabase
        .from("player_inventory_view")
        .select("*")
        .eq("user_id", user.id)
        .eq("series_id", currentSeries.id)
        .gt("available_quantity", 0)
        .eq("behavior_code", "open_container")
        .eq("target_kind", "container");

      if (inventoryError) throw inventoryError;

      const containerIds = [
        ...new Set((inventoryData || []).map((row) => row.target_id).filter(Boolean)),
      ];

      let containers = [];
      let containerTypes = [];
      let containerCards = [];
      let cards = [];

      if (containerIds.length) {
        const [
          { data: containersData, error: containersError },
          { data: typeData, error: typeError },
          { data: containerCardsData, error: containerCardsError },
        ] = await Promise.all([
          supabase.from("containers").select("*").in("id", containerIds),
          supabase.from("container_types").select("*"),
          supabase
            .from("container_cards")
            .select("*")
            .in("container_id", containerIds)
            .eq("is_enabled", true),
        ]);

        if (containersError) throw containersError;
        if (typeError) throw typeError;
        if (containerCardsError) throw containerCardsError;

        containers = containersData || [];
        containerTypes = typeData || [];
        containerCards = containerCardsData || [];

        const cardIds = [
          ...new Set(containerCards.map((row) => row.card_id).filter(Boolean)),
        ];

        if (cardIds.length) {
          const { data: cardsData, error: cardsError } = await supabase
            .from("cards")
            .select("id, name, image_url")
            .in("id", cardIds);

          if (cardsError) throw cardsError;
          cards = cardsData || [];
        }
      }

      const typeMap = new Map(containerTypes.map((row) => [row.id, row]));
      const containerMap = new Map(containers.map((row) => [row.id, row]));
      const cardsByContainer = new Map();
      const cardMap = new Map(cards.map((row) => [Number(row.id), row]));

      containerCards.forEach((row) => {
        if (!cardsByContainer.has(row.container_id)) {
          cardsByContainer.set(row.container_id, []);
        }

        const cardMeta = cardMap.get(Number(row.card_id));
        cardsByContainer.get(row.container_id).push({
          ...row,
          card_name: cardMeta?.name || `Card ${row.card_id}`,
          image_url: cardMeta?.image_url || "",
        });
      });

      const hydratedRows = (inventoryData || [])
        .map((row) => {
          const container = containerMap.get(row.target_id);
          const type = container ? typeMap.get(container.container_type_id) : null;

          return {
            ...row,
            bucket: getContainerBucket(type?.code),
            container,
            container_type: type,
            possible_cards: cardsByContainer.get(row.target_id) || [],
          };
        })
        .filter((row) => row.container);

      setInventoryRows(hydratedRows);
    } catch (error) {
      console.error("Failed to load opener page:", error);
      setErrorMessage(error.message || "Failed to load opener page.");
      setInventoryRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenSelected() {
    if (!selectedInventoryRow || opening) return;

    resetStageState();

    setOpening(true);
    setErrorMessage("");
    setStatusMessage("");
    setResultModalOpen(false);

    try {
      const { data, error } = await supabase.rpc("open_inventory_container", {
        p_inventory_id: selectedInventoryRow.id,
      });

      if (error) throw error;

      const pulls = data?.pulls || [];

      if (selectedInventoryRow.bucket === "boxes") {
        const reelSource = selectedInventoryRow.possible_cards.length
          ? selectedInventoryRow.possible_cards
          : pulls;

        const winnerIndex = reelSource.findIndex(
          (row) =>
            normalizeText(row.card_name) === normalizeText(pulls[0]?.card_name)
        );

        setBoxReelCards(
          buildBoxReelCards(reelSource, winnerIndex >= 0 ? winnerIndex : 0)
        );
        setBoxResult(pulls[0] || null);
        setBoxSpinPhase("spinning");
        setResultModalMode("box");

        boxSpinTimeoutRef.current = setTimeout(() => {
          setBoxSpinPhase("settled");
          setResultModalOpen(true);
        }, 3200);
      } else {
        const resolvedPackResults = pulls.length
          ? pulls
          : buildPackRevealPlaceholders(
              pulls.length || selectedInventoryRow.container?.cards_per_open || 9
            );
        const revealTotal = resolvedPackResults.length;

        setPackResults(resolvedPackResults);
        setPackRevealCount(0);
        setPackRevealPhase("charging");
        setResultModalMode("pack");

        packTimeoutsRef.current = [
          setTimeout(() => {
            setPackRevealPhase("sealed");
          }, 140),
          setTimeout(() => {
            setPackRevealPhase("burst");
          }, 760),
          ...Array.from({ length: revealTotal }).map((_, index) =>
            setTimeout(() => {
              setPackRevealPhase("revealing");
              setPackRevealCount(index + 1);
            }, 1160 + index * 180)
          ),
          setTimeout(() => {
            setPackRevealPhase("revealed");
            setResultModalOpen(true);
          }, 1160 + revealTotal * 180 + 220),
        ];
      }

      setStatusMessage(`Opened ${data?.container_name || "container"} successfully.`);
      await loadPage();
    } catch (error) {
      console.error("Failed to open container:", error);
      setErrorMessage(error.message || "Failed to open container.");
    } finally {
      setOpening(false);
    }
  }

  function renderInventoryList() {
    if (!usableInventoryRows.length) {
      return <div className="container-opener-empty">No openers available in this tab.</div>;
    }

    return (
      <div className="container-opener-list">
        {usableInventoryRows.map((row) => (
          <button
            key={row.id}
            type="button"
            className={`container-opener-list-row ${
              selectedInventoryId === row.id ? "is-selected" : ""
            }`}
            onClick={() => {
              setSelectedInventoryId(row.id);
              setSelectedInventoryRow(row);
              resetStageState();
            }}
          >
            <div className="container-opener-list-row-main">
              <div className="container-opener-list-title">{row.item_name}</div>
              <div className="container-opener-list-subtitle">{row.container?.name}</div>
            </div>
            <div className="container-opener-list-row-meta">x{row.available_quantity}</div>
          </button>
        ))}
      </div>
    );
  }

  function renderPossibleCards() {
    if (!selectedInventoryRow?.possible_cards?.length) {
      return <div className="container-opener-empty small">No visible card pool found.</div>;
    }

    return (
      <div className="container-opener-possible-grid">
        {selectedInventoryRow.possible_cards.map((card, index) => (
          <div key={`${card.card_id}-${index}`} className="container-opener-possible-card">
            <div className="container-opener-possible-name">{card.card_name}</div>
            <div className="container-opener-possible-meta">
              {card.weight != null ? `Weight ${card.weight}` : "Weighted"}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderBoxOpener() {
    return (
      <div className="container-opener-stage">
        <div className="container-opener-stage-header">
          <div>
            <h2>{selectedInventoryRow?.container?.name || "Select a Box"}</h2>
            <p>
              {selectedInventoryRow?.container?.description ||
                "Single-card cinematic reel opener."}
            </p>
          </div>

          <button
            type="button"
            className="container-opener-primary-btn"
            disabled={!selectedInventoryRow || opening}
            onClick={handleOpenSelected}
          >
            {opening ? "Opening..." : "Open Box"}
          </button>
        </div>

        <div className="container-opener-box-shell">
          <div className="container-opener-reel-window">
            <div
              className={`container-opener-reel-track ${
                boxSpinPhase === "spinning" ? "is-spinning" : ""
              }`}
            >
              {boxReelCards.length ? (
                boxReelCards.map((card) => (
                  <div
                    key={card.reelKey}
                    className={`container-opener-reel-card ${getTierClass(
                      card.tier_code
                    )} ${card.isWinner ? "is-winner" : ""}`}
                  >
                    <div className="container-opener-reel-card-name">{card.card_name}</div>
                  </div>
                ))
              ) : (
                <div className="container-opener-empty">Open a box to spin the reel.</div>
              )}
            </div>
            <div className="container-opener-center-line" />
          </div>
        </div>

        <div className="container-opener-info-grid">
          <div className="container-opener-info-card">
            <h3>Selected Box</h3>
            <div className="container-opener-info-row">
              <span>Item</span>
              <strong>{selectedInventoryRow?.item_name || "-"}</strong>
            </div>
            <div className="container-opener-info-row">
              <span>Container</span>
              <strong>{selectedInventoryRow?.container?.name || "-"}</strong>
            </div>
            <div className="container-opener-info-row">
              <span>Owned</span>
              <strong>{selectedInventoryRow?.available_quantity ?? 0}</strong>
            </div>
          </div>

          <div className="container-opener-info-card">
            <h3>Possible Cards</h3>
            {renderPossibleCards()}
          </div>
        </div>
      </div>
    );
  }

  function renderPackOpener() {
    const displayPackCards = buildDisplayPackCards(
      packResults,
      packRevealCount,
      selectedInventoryRow?.container?.cards_per_open || 9
    );

    return (
      <div className="container-opener-stage">
        <div className="container-opener-stage-header">
          <div>
            <h2>{selectedInventoryRow?.container?.name || "Select a Pack"}</h2>
            <p>
              {selectedInventoryRow?.container?.description || "9-card reveal opener."}
            </p>
          </div>

          <button
            type="button"
            className="container-opener-primary-btn"
            disabled={!selectedInventoryRow || opening}
            onClick={handleOpenSelected}
          >
            {opening ? "Opening..." : "Open Pack"}
          </button>
        </div>

        <div className={`container-opener-pack-cinematic phase-${packRevealPhase}`}>
          <div className="container-opener-pack-energy" />
          <div className="container-opener-pack-burst-ring" />
          <div className="container-opener-pack-sparks" />
          <div className="container-opener-pack-foil">
            <div className="container-opener-pack-foil-kicker">SEALED PACK</div>
            <div className="container-opener-pack-foil-title">
              {selectedInventoryRow?.container?.name || "Select a Pack"}
            </div>
            <div className="container-opener-pack-foil-copy">
              {packRevealPhase === "idle"
                ? "Choose a pack and crack it open."
                : packRevealPhase === "revealed"
                  ? "Reveal complete."
                  : "Tearing the wrapper and revealing each card..."}
            </div>
            <div className="container-opener-pack-foil-progress">
              <span>{packRevealCount}</span>
              <small>
                of {selectedInventoryRow?.container?.cards_per_open || displayPackCards.length}
              </small>
            </div>
          </div>
        </div>

        <div
          className={`container-opener-pack-grid ${
            packRevealPhase === "revealed" ? "is-revealed" : ""
          }`}
        >
          {displayPackCards.map((card, index) => (
              <div
                key={card.revealKey || card.id || `${card.card_name}-${index}`}
                className={`container-opener-pack-card ${
                  card.isPlaceholder ? "is-placeholder" : ""
                } ${card.isRevealed ? "is-revealed" : ""}
                ${!card.isRevealed ? "is-hidden" : ""}
                ${packRevealPhase === "burst" ? "is-bursting" : ""}
                `}
                style={{ "--reveal-index": index }}
              >
                <div
                  className={`container-opener-pack-card-inner ${getRarityClass(
                    card.rarity_code
                  )} ${getTierClass(card.tier_code)}`}
                >
                  <div className="container-opener-pack-name">
                    {card.isPlaceholder ? "?" : card.card_name}
                  </div>
                  <div className="container-opener-pack-meta">
                    {card.isPlaceholder
                      ? "Hidden"
                      : `${card.tier_name} | ${card.rarity_name}`}
                  </div>
                </div>
              </div>
            ))}
        </div>

        <div className="container-opener-info-card">
          <h3>Pack Card Pool</h3>
          {renderPossibleCards()}
        </div>
      </div>
    );
  }

  function renderActiveStage() {
    return activeTab === "packs" ? renderPackOpener() : renderBoxOpener();
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
              Open boxes and packs from your live series inventory.
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
          <div className="container-opener-layout">
            <aside className="container-opener-card container-opener-sidebar">
              <div className="container-opener-section-header">
                <h2>Openers</h2>
              </div>

              <div className="container-opener-tabs">
                {TAB_ORDER.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`container-opener-tab-btn ${
                      activeTab === tab ? "is-active" : ""
                    }`}
                    onClick={() => {
                      setActiveTab(tab);
                      resetStageState();
                    }}
                  >
                    {getBucketLabel(tab)}
                  </button>
                ))}
              </div>

              {renderInventoryList()}
            </aside>

            <section className="container-opener-card container-opener-main">
              {renderActiveStage()}
            </section>
          </div>
        )}

        {resultModalOpen ? (
          <div
            className="container-opener-modal-backdrop"
            onClick={() => setResultModalOpen(false)}
          >
            <div
              className="container-opener-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="container-opener-modal-close"
                onClick={() => setResultModalOpen(false)}
              >
                x
              </button>

              {resultModalMode === "pack" ? (
                <>
                  <div className="container-opener-modal-kicker">PACK OPENED</div>
                  <h2 className="container-opener-modal-title">Pack Results</h2>
                  <div className="container-opener-modal-pack-grid">
                    {packResults.map((card, index) => (
                      <div
                        key={`${card.card_name}-${index}`}
                        className={`container-opener-modal-pack-card ${getRarityClass(
                          card.rarity_code
                        )} ${getTierClass(card.tier_code)}`}
                      >
                        <div className="container-opener-modal-pack-name">{card.card_name}</div>
                        <div className="container-opener-modal-pack-meta">
                          {card.tier_name} | {card.rarity_name}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : boxResult ? (
                <>
                  <div className="container-opener-modal-kicker">BOX OPENED</div>
                  <h2 className="container-opener-modal-title">{boxResult.card_name}</h2>
                  <div
                    className={`container-opener-result-card ${getRarityClass(
                      boxResult.rarity_code
                    )} ${getTierClass(boxResult.tier_code)}`}
                  >
                    <div className="container-opener-result-card-name">
                      {boxResult.card_name}
                    </div>
                    <div className="container-opener-result-card-meta">
                      {boxResult.tier_name} | {boxResult.rarity_name}
                    </div>
                  </div>
                </>
              ) : (
                <div className="container-opener-empty">No result.</div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </LauncherLayout>
  );
}

export default ContainerOpenerPage;
