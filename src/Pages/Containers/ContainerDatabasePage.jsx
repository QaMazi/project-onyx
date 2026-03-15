import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";
import "./ContainerDatabasePage.css";

function getTypeConfig(typeSlug) {
  switch (typeSlug) {
    case "packs":
      return {
        title: "Pack Database",
        matcher: ["pack"],
      };
    case "deck-boxes":
      return {
        title: "Deck Box Database",
        matcher: ["deck", "deckbox", "deck_box", "deck box"],
      };
    case "promo-boxes":
      return {
        title: "Promo Box Database",
        matcher: ["promo", "promobox", "promo_box", "promo box"],
      };
    default:
      return {
        title: "Container Database",
        matcher: [],
      };
  }
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveTypeLabel(typeRow) {
  if (!typeRow) return "";
  return (
    typeRow.name ||
    typeRow.label ||
    typeRow.code ||
    typeRow.slug ||
    typeRow.title ||
    ""
  );
}

function matchesType(typeRow, matcherList) {
  if (!matcherList.length) return true;

  const label = normalizeText(resolveTypeLabel(typeRow));
  if (!label) return false;

  return matcherList.some((needle) => label.includes(normalizeText(needle)));
}

function buildTierMap(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    map.set(row.id, row);
  });
  return map;
}

function buildCardNameMap(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    map.set(Number(row.id), row.name);
  });
  return map;
}

function buildTypeMap(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    map.set(row.id, row);
  });
  return map;
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `${num}%`;
}

function formatOneInX(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "—";
  return `1 in ${(100 / num).toFixed(num >= 10 ? 1 : 2)}`;
}

function ContainerDatabasePage() {
  const navigate = useNavigate();
  const { typeSlug } = useParams();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [containers, setContainers] = useState([]);
  const [selectedContainerId, setSelectedContainerId] = useState("");
  const [searchText, setSearchText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const typeConfig = useMemo(() => getTypeConfig(typeSlug), [typeSlug]);

  const filteredContainers = useMemo(() => {
    const query = normalizeText(searchText);

    return containers.filter((container) => {
      if (!query) return true;

      return (
        normalizeText(container.name).includes(query) ||
        normalizeText(container.code).includes(query) ||
        normalizeText(container.description).includes(query)
      );
    });
  }, [containers, searchText]);

  const selectedContainer = useMemo(
    () =>
      filteredContainers.find((container) => container.id === selectedContainerId) ||
      containers.find((container) => container.id === selectedContainerId) ||
      null,
    [filteredContainers, containers, selectedContainerId]
  );

  useEffect(() => {
    if (!authLoading && user) {
      loadPage();
    }
  }, [authLoading, user, typeSlug]);

  async function loadPage() {
    setLoading(true);
    setErrorMessage("");

    try {
      const [
        { data: containerRows, error: containersError },
        { data: typeRows, error: typesError },
        { data: containerCardRows, error: containerCardsError },
        { data: tierRows, error: tiersError },
      ] = await Promise.all([
        supabase
          .from("containers")
          .select("*")
          .eq("is_enabled", true)
          .order("name", { ascending: true }),

        supabase
          .from("container_types")
          .select("*"),

        supabase
          .from("container_cards")
          .select("*")
          .eq("is_enabled", true),

        supabase
          .from("card_tiers")
          .select("id, name, weight_percent, sort_order")
          .order("sort_order", { ascending: true }),
      ]);

      if (containersError) throw containersError;
      if (typesError) throw typesError;
      if (containerCardsError) throw containerCardsError;
      if (tiersError) throw tiersError;

      const typeMap = buildTypeMap(typeRows || []);
      const tierMap = buildTierMap(tierRows || []);

      const matchingContainers = (containerRows || []).filter((container) => {
        const typeRow = typeMap.get(container.container_type_id);
        return matchesType(typeRow, typeConfig.matcher);
      });

      const cardsForMatchingContainers = (containerCardRows || []).filter((row) =>
        matchingContainers.some((container) => container.id === row.container_id)
      );

      const uniqueCardIds = [
        ...new Set(cardsForMatchingContainers.map((row) => Number(row.card_id)).filter(Boolean)),
      ];

      let cardRows = [];
      if (uniqueCardIds.length) {
        const { data, error } = await supabase
          .from("cards")
          .select("id, name")
          .in("id", uniqueCardIds);

        if (error) throw error;
        cardRows = data || [];
      }

      const cardNameMap = buildCardNameMap(cardRows);

      const cardsByContainerId = new Map();

      cardsForMatchingContainers.forEach((row) => {
        if (!cardsByContainerId.has(row.container_id)) {
          cardsByContainerId.set(row.container_id, []);
        }

        const tier = tierMap.get(row.tier_id);

        cardsByContainerId.get(row.container_id).push({
          ...row,
          card_name: cardNameMap.get(Number(row.card_id)) || `Card ${row.card_id}`,
          tier_name: tier?.name || "Unknown Tier",
          weight_percent: tier?.weight_percent ?? null,
        });
      });

      const hydratedContainers = matchingContainers.map((container) => ({
        ...container,
        cards: (cardsByContainerId.get(container.id) || []).sort((a, b) =>
          String(a.card_name).localeCompare(String(b.card_name))
        ),
        type_label: resolveTypeLabel(typeMap.get(container.container_type_id)),
      }));

      setContainers(hydratedContainers);

      const firstContainer = hydratedContainers[0] || null;
      setSelectedContainerId((prev) => {
        if (hydratedContainers.some((container) => container.id === prev)) {
          return prev;
        }
        return firstContainer?.id || "";
      });
    } catch (error) {
      console.error("Failed to load container database:", error);
      setErrorMessage(error.message || "Failed to load container database.");
      setContainers([]);
      setSelectedContainerId("");
    } finally {
      setLoading(false);
    }
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
      <div className="container-database-page">
        <div className="container-database-topbar">
          <div>
            <div className="container-database-kicker">SERIES</div>
            <h1 className="container-database-title">{typeConfig.title}</h1>
            <p className="container-database-subtitle">
              View available containers, included cards, tier odds, and quick pull-rate references.
            </p>
          </div>

          <div className="container-database-topbar-actions">
            <button
              type="button"
              className="container-database-secondary-btn"
              onClick={() => navigate("/mode/progression")}
            >
              Back
            </button>
          </div>
        </div>

        {loading ? (
          <div className="container-database-card container-database-empty">
            Loading {typeConfig.title.toLowerCase()}...
          </div>
        ) : errorMessage ? (
          <div className="container-database-card container-database-error">
            {errorMessage}
          </div>
        ) : (
          <div className="container-database-layout">
            <section className="container-database-card container-database-sidebar">
              <div className="container-database-section-header">
                <h2>Containers</h2>
              </div>

              <div className="container-database-field">
                <label>Search</label>
                <input
                  className="container-database-input"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search name or code..."
                />
              </div>

              <div className="container-database-list">
                {filteredContainers.length === 0 ? (
                  <div className="container-database-empty small">
                    No containers found for this database.
                  </div>
                ) : (
                  filteredContainers.map((container) => (
                    <button
                      key={container.id}
                      type="button"
                      className={`container-database-list-row ${
                        selectedContainerId === container.id ? "is-selected" : ""
                      }`}
                      onClick={() => setSelectedContainerId(container.id)}
                    >
                      <div className="container-database-list-name">{container.name}</div>
                      <div className="container-database-list-meta">
                        {container.code}
                        {container.is_locked ? " • Locked" : ""}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className="container-database-card container-database-main">
              {!selectedContainer ? (
                <div className="container-database-empty">
                  Select a container to inspect its contents.
                </div>
              ) : (
                <>
                  <div className="container-database-detail-header">
                    <div>
                      <h2 className="container-database-detail-title">
                        {selectedContainer.name}
                      </h2>
                      <p className="container-database-detail-subtitle">
                        {selectedContainer.description || "No description provided."}
                      </p>
                    </div>

                    <div className="container-database-detail-badges">
                      <span className="container-database-chip">
                        Code: {selectedContainer.code || "—"}
                      </span>
                      <span className="container-database-chip">
                        Cards: {selectedContainer.card_count ?? "—"}
                      </span>
                      <span className="container-database-chip">
                        Type: {selectedContainer.type_label || "Unknown"}
                      </span>
                    </div>
                  </div>

                  {selectedContainer.image_url ? (
                    <div className="container-database-image-shell">
                      <img
                        src={selectedContainer.image_url}
                        alt={selectedContainer.name}
                        className="container-database-image"
                      />
                    </div>
                  ) : null}

                  <div className="container-database-card-pool">
                    <div className="container-database-section-header">
                      <h3>Card Pool</h3>
                    </div>

                    {selectedContainer.cards.length === 0 ? (
                      <div className="container-database-empty small">
                        No cards are currently assigned to this container.
                      </div>
                    ) : (
                      <div className="container-database-card-grid">
                        {selectedContainer.cards.map((row, index) => (
                          <div
                            key={`${row.id || row.card_id}-${index}`}
                            className="container-database-card-row"
                          >
                            <div>
                              <div className="container-database-card-name">
                                {row.card_name}
                              </div>
                              <div className="container-database-card-meta">
                                Card ID: {row.card_id}
                              </div>
                            </div>

                            <div className="container-database-card-odds">
                              <span className="container-database-tier-pill">
                                {row.tier_name}
                              </span>
                              <span className="container-database-odds-pill">
                                {formatPercent(row.weight_percent)}
                              </span>
                              <span className="container-database-odds-pill subtle">
                                {formatOneInX(row.weight_percent)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </LauncherLayout>
  );
}

export default ContainerDatabasePage;