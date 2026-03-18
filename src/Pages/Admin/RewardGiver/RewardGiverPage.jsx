import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../../components/LauncherLayout";
import { useUser } from "../../../context/UserContext";
import { supabase } from "../../../lib/supabase";
import "./RewardGiverPage.css";

const REWARD_TABS = [
  { value: "shards", label: "Shards" },
  { value: "feature_coins", label: "Feature Coins" },
  { value: "items", label: "Items" },
  { value: "cards", label: "Cards" },
];

function RewardGiverPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [activeSeries, setActiveSeries] = useState(null);
  const [players, setPlayers] = useState([]);
  const [itemDefinitions, setItemDefinitions] = useState([]);
  const [rarities, setRarities] = useState([]);

  const [selectedTab, setSelectedTab] = useState("shards");
  const [selectedUserId, setSelectedUserId] = useState("");

  const [shardAmount, setShardAmount] = useState(50);
  const [featureCoinAmount, setFeatureCoinAmount] = useState(5);

  const [selectedItemDefinitionId, setSelectedItemDefinitionId] = useState("");
  const [itemQuantity, setItemQuantity] = useState(1);

  const [cardSearch, setCardSearch] = useState("");
  const [cardSearchResults, setCardSearchResults] = useState([]);
  const [selectedCardId, setSelectedCardId] = useState("");
  const [selectedCardName, setSelectedCardName] = useState("");
  const [selectedRarityId, setSelectedRarityId] = useState("");
  const [cardQuantity, setCardQuantity] = useState(1);

  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const canUsePage = user?.role === "Admin+" || user?.role === "Admin";

  const selectedPlayer = useMemo(
    () => players.find((player) => player.user_id === selectedUserId) || null,
    [players, selectedUserId]
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

      if (selectedTab !== "cards" || query.length < 2) {
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
  }, [cardSearch, selectedTab]);

  async function loadPage() {
    setLoading(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const [
        { data: activeSeriesData, error: activeSeriesError },
        { data: itemDefinitionsData, error: itemDefinitionsError },
        { data: raritiesData, error: raritiesError },
      ] = await Promise.all([
        supabase
          .from("game_series")
          .select("id, name")
          .eq("is_current", true)
          .maybeSingle(),
        supabase
          .from("item_definitions")
          .select("id, name, description")
          .order("name", { ascending: true }),
        supabase
          .from("card_rarities")
          .select("id, name, code, sort_order")
          .order("sort_order", { ascending: true }),
      ]);

      if (activeSeriesError) throw activeSeriesError;
      if (itemDefinitionsError) throw itemDefinitionsError;
      if (raritiesError) throw raritiesError;

      setActiveSeries(activeSeriesData || null);
      setItemDefinitions(itemDefinitionsData || []);
      setRarities(raritiesData || []);

      if (raritiesData?.length && !selectedRarityId) {
        setSelectedRarityId(raritiesData[0].id);
      }

      if (itemDefinitionsData?.length && !selectedItemDefinitionId) {
        setSelectedItemDefinitionId(itemDefinitionsData[0].id);
      }

      if (!activeSeriesData?.id) {
        setPlayers([]);
        setSelectedUserId("");
        return;
      }

      const { data: playerData, error: playersError } = await supabase
        .from("series_players_view")
        .select("user_id, username, is_owner")
        .eq("series_id", activeSeriesData.id)
        .order("is_owner", { ascending: false })
        .order("username", { ascending: true });

      if (playersError) throw playersError;

      const nextPlayers = playerData || [];
      setPlayers(nextPlayers);

      if (!selectedUserId && nextPlayers.length > 0) {
        setSelectedUserId(nextPlayers[0].user_id);
      }
    } catch (error) {
      console.error("Failed to load reward giver:", error);
      setErrorMessage(error.message || "Failed to load reward giver.");
    } finally {
      setLoading(false);
    }
  }

  function resetMessages() {
    setStatusMessage("");
    setErrorMessage("");
  }

  async function handleGiveShards() {
    if (!activeSeries?.id || !selectedUserId) return;

    setSubmitting(true);
    resetMessages();

    try {
      const { error } = await supabase.rpc("give_series_player_shards", {
        p_series_id: activeSeries.id,
        p_target_user_id: selectedUserId,
        p_shards: Number(shardAmount || 0),
      });

      if (error) throw error;

      setStatusMessage(
        `Gave ${Number(shardAmount || 0)} shards to ${
          selectedPlayer?.username || "player"
        }.`
      );
    } catch (error) {
      console.error("Failed to give shards:", error);
      setErrorMessage(error.message || "Failed to give shards.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGiveFeatureCoins() {
    if (!activeSeries?.id || !selectedUserId) return;

    setSubmitting(true);
    resetMessages();

    try {
      const { error } = await supabase.rpc("give_series_player_feature_coins", {
        p_series_id: activeSeries.id,
        p_target_user_id: selectedUserId,
        p_feature_coins: Number(featureCoinAmount || 0),
      });

      if (error) throw error;

      setStatusMessage(
        `Gave ${Number(featureCoinAmount || 0)} Feature Coins to ${
          selectedPlayer?.username || "player"
        }.`
      );
    } catch (error) {
      console.error("Failed to give Feature Coins:", error);
      setErrorMessage(error.message || "Failed to give Feature Coins.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGiveItem() {
    if (!activeSeries?.id || !selectedUserId || !selectedItemDefinitionId) return;

    setSubmitting(true);
    resetMessages();

    try {
      const item = itemDefinitions.find((entry) => entry.id === selectedItemDefinitionId);

      const { error } = await supabase.rpc("give_series_player_item", {
        p_series_id: activeSeries.id,
        p_target_user_id: selectedUserId,
        p_item_definition_id: selectedItemDefinitionId,
        p_quantity: Number(itemQuantity || 0),
      });

      if (error) throw error;

      setStatusMessage(
        `Gave ${Number(itemQuantity || 0)} x ${item?.name || "item"} to ${
          selectedPlayer?.username || "player"
        }.`
      );
    } catch (error) {
      console.error("Failed to give item:", error);
      setErrorMessage(error.message || "Failed to give item.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGiveCard() {
    if (!activeSeries?.id || !selectedUserId || !selectedCardId || !selectedRarityId) {
      return;
    }

    setSubmitting(true);
    resetMessages();

    try {
      const rarity = rarities.find((entry) => entry.id === selectedRarityId);

      const { error } = await supabase.rpc("give_series_player_card", {
        p_series_id: activeSeries.id,
        p_target_user_id: selectedUserId,
        p_card_id: Number(selectedCardId),
        p_rarity_id: selectedRarityId,
        p_quantity: Number(cardQuantity || 0),
      });

      if (error) throw error;

      setStatusMessage(
        `Gave ${Number(cardQuantity || 0)} x ${selectedCardName || "card"} (${
          rarity?.name || "rarity"
        }) to ${selectedPlayer?.username || "player"}.`
      );
    } catch (error) {
      console.error("Failed to give card:", error);
      setErrorMessage(error.message || "Failed to give card.");
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (!canUsePage) return <Navigate to="/mode/progression" replace />;

  return (
    <LauncherLayout>
      <div className="reward-giver-page">
        <div className="reward-giver-topbar">
          <div>
            <div className="reward-giver-kicker">ADMIN</div>
            <h1 className="reward-giver-title">Reward Giver</h1>
            <p className="reward-giver-subtitle">
              Give shards, Feature Coins, store items, or specific cards with chosen
              rarity to players in the active series.
            </p>
          </div>

          <div className="reward-giver-topbar-actions">
            <button
              type="button"
              className="reward-giver-secondary-btn"
              onClick={() => navigate("/mode/progression")}
            >
              Back
            </button>
          </div>
        </div>

        {loading ? (
          <div className="reward-giver-card reward-giver-empty">Loading reward giver...</div>
        ) : (
          <>
            <div className="reward-giver-status-row">
              <div className="reward-giver-chip">
                Active Series: {activeSeries?.name || "None"}
              </div>

              {statusMessage ? (
                <div className="reward-giver-success">{statusMessage}</div>
              ) : null}

              {errorMessage ? (
                <div className="reward-giver-error">{errorMessage}</div>
              ) : null}
            </div>

            <div className="reward-giver-layout">
              <section className="reward-giver-card reward-giver-sidebar">
                <div className="reward-giver-section-header">
                  <h2>Target Player</h2>
                </div>

                <div className="reward-giver-field">
                  <label>Select Player</label>
                  <select
                    className="reward-giver-select"
                    value={selectedUserId}
                    onChange={(event) => setSelectedUserId(event.target.value)}
                    disabled={submitting}
                  >
                    <option value="">Choose a player...</option>
                    {players.map((player) => (
                      <option key={player.user_id} value={player.user_id}>
                        {player.username}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="reward-giver-target-card">
                  <div className="reward-giver-target-name">
                    {selectedPlayer?.username || "No player selected"}
                  </div>
                  <div className="reward-giver-target-meta">
                    {selectedPlayer?.is_owner ? "Owner" : "Duelist"}
                  </div>
                </div>

                <div className="reward-giver-tabs">
                  {REWARD_TABS.map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      className={`reward-giver-tab-btn ${
                        selectedTab === tab.value ? "is-active" : ""
                      }`}
                      onClick={() => {
                        setSelectedTab(tab.value);
                        resetMessages();
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="reward-giver-card reward-giver-main">
                {selectedTab === "shards" ? (
                  <>
                    <div className="reward-giver-section-header">
                      <h2>Give Shards</h2>
                    </div>

                    <div className="reward-giver-form-grid">
                      <div className="reward-giver-field">
                        <label>Shard Amount</label>
                        <input
                          type="number"
                          min="1"
                          className="reward-giver-input"
                          value={shardAmount}
                          onChange={(event) => setShardAmount(event.target.value)}
                          disabled={submitting}
                        />
                      </div>
                    </div>

                    <div className="reward-giver-actions">
                      <button
                        type="button"
                        className="reward-giver-primary-btn"
                        onClick={handleGiveShards}
                        disabled={submitting || !selectedUserId || !activeSeries?.id}
                      >
                        {submitting ? "Giving..." : "Give Shards"}
                      </button>
                    </div>
                  </>
                ) : null}

                {selectedTab === "feature_coins" ? (
                  <>
                    <div className="reward-giver-section-header">
                      <h2>Give Feature Coins</h2>
                    </div>

                    <div className="reward-giver-form-grid">
                      <div className="reward-giver-field">
                        <label>Feature Coin Amount</label>
                        <input
                          type="number"
                          min="1"
                          className="reward-giver-input"
                          value={featureCoinAmount}
                          onChange={(event) => setFeatureCoinAmount(event.target.value)}
                          disabled={submitting}
                        />
                      </div>
                    </div>

                    <div className="reward-giver-actions">
                      <button
                        type="button"
                        className="reward-giver-primary-btn"
                        onClick={handleGiveFeatureCoins}
                        disabled={submitting || !selectedUserId || !activeSeries?.id}
                      >
                        {submitting ? "Giving..." : "Give Feature Coins"}
                      </button>
                    </div>
                  </>
                ) : null}

                {selectedTab === "items" ? (
                  <>
                    <div className="reward-giver-section-header">
                      <h2>Give Store Item</h2>
                    </div>

                    <div className="reward-giver-form-grid">
                      <div className="reward-giver-field">
                        <label>Item</label>
                        <select
                          className="reward-giver-select"
                          value={selectedItemDefinitionId}
                          onChange={(event) => setSelectedItemDefinitionId(event.target.value)}
                          disabled={submitting}
                        >
                          {itemDefinitions.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="reward-giver-field">
                        <label>Quantity</label>
                        <input
                          type="number"
                          min="1"
                          className="reward-giver-input"
                          value={itemQuantity}
                          onChange={(event) => setItemQuantity(event.target.value)}
                          disabled={submitting}
                        />
                      </div>
                    </div>

                    <div className="reward-giver-actions">
                      <button
                        type="button"
                        className="reward-giver-primary-btn"
                        onClick={handleGiveItem}
                        disabled={
                          submitting ||
                          !selectedUserId ||
                          !activeSeries?.id ||
                          !selectedItemDefinitionId
                        }
                      >
                        {submitting ? "Giving..." : "Give Item"}
                      </button>
                    </div>
                  </>
                ) : null}

                {selectedTab === "cards" ? (
                  <>
                    <div className="reward-giver-section-header">
                      <h2>Give Card</h2>
                    </div>

                    <div className="reward-giver-field">
                      <label>Search Card</label>
                      <input
                        type="text"
                        className="reward-giver-input"
                        value={cardSearch}
                        onChange={(event) => setCardSearch(event.target.value)}
                        placeholder="Search card name..."
                        disabled={submitting}
                      />
                    </div>

                    <div className="reward-giver-search-results">
                      {cardSearch.trim().length < 2 ? (
                        <div className="reward-giver-empty small">
                          Type at least 2 characters to search cards.
                        </div>
                      ) : cardSearchResults.length === 0 ? (
                        <div className="reward-giver-empty small">
                          No matching cards found.
                        </div>
                      ) : (
                        cardSearchResults.map((card) => (
                          <button
                            key={card.id}
                            type="button"
                            className={`reward-giver-card-search-row ${
                              String(selectedCardId) === String(card.id) ? "is-selected" : ""
                            }`}
                            onClick={() => {
                              setSelectedCardId(String(card.id));
                              setSelectedCardName(card.name);
                              resetMessages();
                            }}
                          >
                            <span>{card.name}</span>
                            <span className="reward-giver-card-id">{card.id}</span>
                          </button>
                        ))
                      )}
                    </div>

                    <div className="reward-giver-form-grid">
                      <div className="reward-giver-field">
                        <label>Selected Card</label>
                        <input
                          type="text"
                          className="reward-giver-input"
                          value={selectedCardName}
                          readOnly
                        />
                      </div>

                      <div className="reward-giver-field">
                        <label>Rarity</label>
                        <select
                          className="reward-giver-select"
                          value={selectedRarityId}
                          onChange={(event) => setSelectedRarityId(event.target.value)}
                          disabled={submitting}
                        >
                          {rarities.map((rarity) => (
                            <option key={rarity.id} value={rarity.id}>
                              {rarity.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="reward-giver-field">
                        <label>Quantity</label>
                        <input
                          type="number"
                          min="1"
                          className="reward-giver-input"
                          value={cardQuantity}
                          onChange={(event) => setCardQuantity(event.target.value)}
                          disabled={submitting}
                        />
                      </div>
                    </div>

                    <div className="reward-giver-actions">
                      <button
                        type="button"
                        className="reward-giver-primary-btn"
                        onClick={handleGiveCard}
                        disabled={
                          submitting ||
                          !selectedUserId ||
                          !activeSeries?.id ||
                          !selectedCardId ||
                          !selectedRarityId
                        }
                      >
                        {submitting ? "Giving..." : "Give Card"}
                      </button>
                    </div>
                  </>
                ) : null}
              </section>
            </div>
          </>
        )}
      </div>
    </LauncherLayout>
  );
}

export default RewardGiverPage;
