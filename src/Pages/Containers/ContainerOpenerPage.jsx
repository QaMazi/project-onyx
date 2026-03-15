import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";
import "./ContainerOpenerPage.css";

const TAB_ORDER = ["boxes", "packs", "feature-slots"];

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function getContainerBucket(typeCode) {
  const code = normalizeText(typeCode);

  if (code === "promo_box" || code === "deck_box") return "boxes";
  if (code === "full_pack" || code === "draft_pack") return "packs";
  if (code === "feature_box") return "feature-slots";

  return "boxes";
}

function getBucketLabel(bucket) {
  switch (bucket) {
    case "boxes":
      return "Boxes";
    case "packs":
      return "Packs";
    case "feature-slots":
      return "Feature Slots";
    default:
      return "Openers";
  }
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

function buildBoxReelCards(cards, winnerIndex) {
  if (!cards.length) return [];
  const reel = [];
  const total = 36;
  const safeWinner = Math.min(Math.max(winnerIndex, 0), cards.length - 1);

  for (let i = 0; i < total; i += 1) {
    if (i === total - 6) {
      reel.push({
        ...cards[safeWinner],
        reelKey: `winner-${i}-${safeWinner}`,
        isWinner: true,
      });
    } else {
      const randomIndex = Math.floor(Math.random() * cards.length);
      reel.push({
        ...cards[randomIndex],
        reelKey: `reel-${i}-${randomIndex}-${Math.random()}`,
        isWinner: false,
      });
    }
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
  const [featureResult, setFeatureResult] = useState(null);

  const [boxSpinPhase, setBoxSpinPhase] = useState("idle");
  const [packRevealPhase, setPackRevealPhase] = useState("idle");
  const [featureSpinPhase, setFeatureSpinPhase] = useState("idle");

  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [resultModalMode, setResultModalMode] = useState("box");

  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const boxSpinTimeoutRef = useRef(null);
  const revealTimeoutRef = useRef(null);

  const usableInventoryRows = useMemo(() => {
    return inventoryRows.filter((row) => row.bucket === activeTab);
  }, [inventoryRows, activeTab]);

  useEffect(() => {
    if (!authLoading && user) {
      loadPage();
    }

    return () => {
      if (boxSpinTimeoutRef.current) {
        clearTimeout(boxSpinTimeoutRef.current);
      }
      if (revealTimeoutRef.current) {
        clearTimeout(revealTimeoutRef.current);
      }
    };
  }, [authLoading, user]);

  useEffect(() => {
    if (!usableInventoryRows.length) {
      setSelectedInventoryId("");
      setSelectedInventoryRow(null);
      return;
    }

    const existing = usableInventoryRows.find((row) => row.id === selectedInventoryId);
    if (existing) {
      setSelectedInventoryRow(existing);
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

      const containerIds = [...new Set((inventoryData || []).map((row) => row.target_id).filter(Boolean))];

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
          supabase.from("container_cards").select("*").in("container_id", containerIds).eq("is_enabled", true),
        ]);

        if (containersError) throw containersError;
        if (typeError) throw typeError;
        if (containerCardsError) throw containerCardsError;

        containers = containersData || [];
        containerTypes = typeData || [];
        containerCards = containerCardsData || [];

        const cardIds = [...new Set(containerCards.map((row) => row.card_id).filter(Boolean))];
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

      const hydrated = (inventoryData || [])
        .map((row) => {
          const container = containerMap.get(row.target_id);
          const type = container ? typeMap.get(container.container_type_id) : null;
          const typeCode = type?.code || "";
          const bucket = getContainerBucket(typeCode);

          return {
            ...row,
            bucket,
            container,
            container_type: type,
            possible_cards: cardsByContainer.get(row.target_id) || [],
          };
        })
        .filter((row) => row.container);

      setInventoryRows(hydrated);

      if (!activeTab || !TAB_ORDER.includes(activeTab)) {
        setActiveTab("boxes");
      }
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
          (row) => normalizeText(row.card_name) === normalizeText(pulls[0]?.card_name)
        );

        setBoxReelCards(buildBoxReelCards(reelSource, winnerIndex >= 0 ? winnerIndex : 0));
        setBoxResult(pulls[0] || null);
        setBoxSpinPhase("spinning");
        setResultModalMode("box");

        boxSpinTimeoutRef.current = setTimeout(() => {
          setBoxSpinPhase("settled");
          setResultModalOpen(true);
        }, 3200);
      } else if (selectedInventoryRow.bucket === "packs") {
        setPackResults(buildPackRevealPlaceholders(pulls.length || selectedInventoryRow.container?.cards_per_open || 9));
        setPackRevealPhase("revealing");
        setResultModalMode("pack");

        revealTimeoutRef.current = setTimeout(() => {
          setPackResults(pulls);
          setPackRevealPhase("revealed");
          setResultModalOpen(true);
        }, 1200);
      } else {
        setFeatureResult(pulls[0] || null);
        setFeatureSpinPhase("spinning");
        setResultModalMode("feature");

        revealTimeoutRef.current = setTimeout(() => {
          setFeatureSpinPhase("revealed");
          setResultModalOpen(true);
        }, 2200);
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
            className={`container-opener-list-row ${selectedInventoryId === row.id ? "is-selected" : ""}`}
            onClick={() => {
              setSelectedInventoryId(row.id);
              setSelectedInventoryRow(row);
              setBoxSpinPhase("idle");
              setPackRevealPhase("idle");
              setFeatureSpinPhase("idle");
              setResultModalOpen(false);
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
            <p>{selectedInventoryRow?.container?.description || "Single-card cinematic reel opener."}</p>
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
            <div className={`container-opener-reel-track ${boxSpinPhase === "spinning" ? "is-spinning" : ""}`}>
              {boxReelCards.length ? (
                boxReelCards.map((card) => (
                  <div
                    key={card.reelKey}
                    className={`container-opener-reel-card ${getTierClass(card.tier_code)} ${
                      card.isWinner ? "is-winner" : ""
                    }`}
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
              <strong>{selectedInventoryRow?.item_name || "—"}</strong>
            </div>
            <div className="container-opener-info-row">
              <span>Container</span>
              <strong>{selectedInventoryRow?.container?.name || "—"}</strong>
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
    return (
      <div className="container-opener-stage">
        <div className="container-opener-stage-header">
          <div>
            <h2>{selectedInventoryRow?.container?.name || "Select a Pack"}</h2>
            <p>{selectedInventoryRow?.container?.description || "9-card reveal opener."}</p>
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

        <div className={`container-opener-pack-grid ${packRevealPhase === "revealed" ? "is-revealed" : ""}`}>
          {(packResults.length ? packResults : buildPackRevealPlaceholders(9)).map((card, index) => (
            <div
              key={card.id || `${card.card_name}-${index}`}
              className={`container-opener-pack-card ${
                card.isPlaceholder ? "is-placeholder" : ""
              } ${getRarityClass(card.rarity_code)} ${getTierClass(card.tier_code)}`}
            >
              <div className="container-opener-pack-card-inner">
                <div className="container-opener-pack-name">
                  {card.isPlaceholder ? "?" : card.card_name}
                </div>
                <div className="container-opener-pack-meta">
                  {card.isPlaceholder ? "Hidden" : `${card.tier_name} • ${card.rarity_name}`}
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

  function renderFeatureOpener() {
    return (
      <div className="container-opener-stage">
        <div className="container-opener-stage-header">
          <div>
            <h2>{selectedInventoryRow?.container?.name || "Select a Feature Slot"}</h2>
            <p>{selectedInventoryRow?.container?.description || "Feature slot machine opener."}</p>
          </div>
          <button
            type="button"
            className="container-opener-primary-btn"
            disabled={!selectedInventoryRow || opening}
            onClick={handleOpenSelected}
          >
            {opening ? "Spinning..." : "Spin Feature Slot"}
          </button>
        </div>

        <div className={`container-opener-feature-machine ${featureSpinPhase === "spinning" ? "is-spinning" : ""}`}>
          <div className="container-opener-feature-reels">
            <div className="container-opener-feature-reel">★</div>
            <div className="container-opener-feature-reel">✦</div>
            <div className="container-opener-feature-reel">◆</div>
          </div>
        </div>

        <div className="container-opener-info-grid">
          <div className="container-opener-info-card">
            <h3>Selected Feature Slot</h3>
            <div className="container-opener-info-row">
              <span>Item</span>
              <strong>{selectedInventoryRow?.item_name || "—"}</strong>
            </div>
            <div className="container-opener-info-row">
              <span>Container</span>
              <strong>{selectedInventoryRow?.container?.name || "—"}</strong>
            </div>
            <div className="container-opener-info-row">
              <span>Owned</span>
              <strong>{selectedInventoryRow?.available_quantity ?? 0}</strong>
            </div>
          </div>

          <div className="container-opener-info-card">
            <h3>Possible Pulls</h3>
            {renderPossibleCards()}
          </div>
        </div>
      </div>
    );
  }

  function renderActiveStage() {
    if (activeTab === "boxes") return renderBoxOpener();
    if (activeTab === "packs") return renderPackOpener();
    return renderFeatureOpener();
  }

  function getModalPayload() {
    if (resultModalMode === "box") return boxResult;
    if (resultModalMode === "pack") return null;
    return featureResult;
  }

  if (authLoading) return null;

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (user.role === "Blocked") {
    return <Navigate to="/" replace />;
  }

  return (
    <LauncherLayout>
      <div className="container-opener-page">
        <div className="container-opener-topbar">
          <div>
            <div className="container-opener-kicker">PROGRESSION</div>
            <h1 className="container-opener-title">Container Opener</h1>
            <p className="container-opener-subtitle">
              Open boxes, packs, and feature slots from your live series inventory.
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
                    className={`container-opener-tab-btn ${activeTab === tab ? "is-active" : ""}`}
                    onClick={() => {
                      setActiveTab(tab);
                      setResultModalOpen(false);
                      setBoxSpinPhase("idle");
                      setPackRevealPhase("idle");
                      setFeatureSpinPhase("idle");
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
          <div className="container-opener-modal-backdrop" onClick={() => setResultModalOpen(false)}>
            <div className="container-opener-modal" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="container-opener-modal-close"
                onClick={() => setResultModalOpen(false)}
              >
                ×
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
                          {card.tier_name} • {card.rarity_name}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                (() => {
                  const payload = getModalPayload();
                  if (!payload) {
                    return <div className="container-opener-empty">No result.</div>;
                  }

                  return (
                    <>
                      <div className="container-opener-modal-kicker">
                        {resultModalMode === "box" ? "BOX OPENED" : "FEATURE SPIN"}
                      </div>
                      <h2 className="container-opener-modal-title">{payload.card_name}</h2>
                      <div
                        className={`container-opener-result-card ${getRarityClass(
                          payload.rarity_code
                        )} ${getTierClass(payload.tier_code)}`}
                      >
                        <div className="container-opener-result-card-name">{payload.card_name}</div>
                        <div className="container-opener-result-card-meta">
                          {payload.tier_name} • {payload.rarity_name}
                        </div>
                      </div>
                    </>
                  );
                })()
              )}
            </div>
          </div>
        ) : null}
      </div>
    </LauncherLayout>
  );
}

export default ContainerOpenerPage;