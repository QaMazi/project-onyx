import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../../components/LauncherLayout";
import { useUser } from "../../../context/UserContext";
import { supabase } from "../../../lib/supabase";
import "./PlayerItemsPage.css";

const VIEW_OPTIONS = [
  { value: "inventory", label: "Inventory" },
  { value: "binder", label: "Binder" },
  { value: "vault", label: "Vault" },
  { value: "decks", label: "Deck" },
];

const DECK_SECTION_LABELS = {
  main: "Main Deck",
  extra: "Extra Deck",
  side: "Side Deck",
};

function formatRoleLabel(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "admin+") return "Admin+";
  if (normalized === "admin") return "Admin";
  if (normalized === "duelist") return "Duelist";
  return role || "Player";
}

function formatValidationSummary(summary) {
  if (!summary) return "No validation summary.";
  if (typeof summary === "string") return summary;
  return JSON.stringify(summary);
}

function buildConfirmCopy(pendingRemoval) {
  if (!pendingRemoval) return "";

  switch (pendingRemoval.kind) {
    case "inventory":
      return `Remove ${pendingRemoval.label} from this player's inventory? This deletes the whole inventory row.`;
    case "binder":
      return `Remove ${pendingRemoval.label} from this player's binder? This deletes the selected binder rarity row.`;
    case "vault":
      return `Remove ${pendingRemoval.label} from this player's vault? This deletes the vaulted card family and its binder copies.`;
    case "deck":
      return `Remove deck "${pendingRemoval.label}"? Non-active decks can be deleted from this tool.`;
    case "deck_card":
      return `Remove ${pendingRemoval.label} from "${pendingRemoval.deckName}"?`;
    default:
      return `Remove ${pendingRemoval.label}?`;
  }
}

function PlayerItemsPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loadingSeries, setLoadingSeries] = useState(true);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [activeSeries, setActiveSeries] = useState(null);
  const [players, setPlayers] = useState([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [selectedView, setSelectedView] = useState("inventory");
  const [selectedDeckId, setSelectedDeckId] = useState("all");
  const [snapshot, setSnapshot] = useState({
    inventory: [],
    binder: [],
    vault: [],
    decks: [],
  });

  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState(null);

  const canUsePage = user?.role === "Admin+" || user?.role === "Admin";

  const selectedPlayer = useMemo(
    () => players.find((player) => player.user_id === selectedPlayerId) || null,
    [players, selectedPlayerId]
  );

  const selectedDeck = useMemo(() => {
    if (selectedDeckId === "all") return null;
    return (snapshot.decks || []).find((deck) => deck.id === selectedDeckId) || null;
  }, [snapshot.decks, selectedDeckId]);

  const visibleDecks = useMemo(() => {
    if (selectedDeckId === "all") return snapshot.decks || [];
    return selectedDeck ? [selectedDeck] : [];
  }, [snapshot.decks, selectedDeck, selectedDeckId]);

  useEffect(() => {
    async function loadActiveSeries() {
      if (!user?.id) {
        setActiveSeries(null);
        setLoadingSeries(false);
        return;
      }

      setLoadingSeries(true);
      setStatusMessage("");
      setErrorMessage("");

      try {
        const { data, error } = await supabase
          .from("game_series")
          .select("id, name, current_phase, round_number, round_step")
          .eq("is_current", true)
          .maybeSingle();

        if (error) throw error;
        setActiveSeries(data || null);
      } catch (error) {
        console.error("Failed to load active series:", error);
        setActiveSeries(null);
        setErrorMessage(error.message || "Failed to load the active series.");
      } finally {
        setLoadingSeries(false);
      }
    }

    if (!authLoading && user) {
      loadActiveSeries();
    }
  }, [authLoading, user]);

  useEffect(() => {
    async function loadPlayers() {
      if (!activeSeries?.id) {
        setPlayers([]);
        setSelectedPlayerId("");
        setLoadingPlayers(false);
        return;
      }

      setLoadingPlayers(true);

      try {
        const { data: seriesPlayers, error: seriesPlayersError } = await supabase
          .from("series_players")
          .select("user_id, role, is_owner")
          .eq("series_id", activeSeries.id)
          .order("created_at", { ascending: true });

        if (seriesPlayersError) throw seriesPlayersError;

        const userIds = [...new Set((seriesPlayers || []).map((row) => row.user_id).filter(Boolean))];

        let profiles = [];

        if (userIds.length) {
          const { data: profilesData, error: profilesError } = await supabase
            .from("profiles")
            .select("id, username, avatar_url, global_role")
            .in("id", userIds);

          if (profilesError) throw profilesError;
          profiles = profilesData || [];
        }

        const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
        const nextPlayers = (seriesPlayers || [])
          .map((row) => ({
            ...row,
            profile: profileMap.get(row.user_id) || null,
          }))
          .sort((left, right) =>
            String(left.profile?.username || "").localeCompare(
              String(right.profile?.username || "")
            )
          );

        setPlayers(nextPlayers);
        setSelectedPlayerId((current) => {
          if (current && nextPlayers.some((row) => row.user_id === current)) {
            return current;
          }
          return nextPlayers[0]?.user_id || "";
        });
      } catch (error) {
        console.error("Failed to load series players:", error);
        setPlayers([]);
        setSelectedPlayerId("");
        setErrorMessage(error.message || "Failed to load series players.");
      } finally {
        setLoadingPlayers(false);
      }
    }

    if (!loadingSeries) {
      loadPlayers();
    }
  }, [activeSeries, loadingSeries]);

  useEffect(() => {
    async function loadSnapshot() {
      if (!activeSeries?.id || !selectedPlayerId) {
        setSnapshot({
          inventory: [],
          binder: [],
          vault: [],
          decks: [],
        });
        setLoadingSnapshot(false);
        return;
      }

      setLoadingSnapshot(true);
      setErrorMessage("");

      try {
        const { data, error } = await supabase.rpc(
          "admin_get_series_player_item_snapshot",
          {
            p_series_id: activeSeries.id,
            p_target_user_id: selectedPlayerId,
          }
        );

        if (error) throw error;

        setSnapshot({
          inventory: data?.inventory || [],
          binder: data?.binder || [],
          vault: data?.vault || [],
          decks: data?.decks || [],
        });
      } catch (error) {
        console.error("Failed to load player item snapshot:", error);
        setSnapshot({
          inventory: [],
          binder: [],
          vault: [],
          decks: [],
        });
        setErrorMessage(error.message || "Failed to load player item snapshot.");
      } finally {
        setLoadingSnapshot(false);
      }
    }

    loadSnapshot();
  }, [activeSeries, selectedPlayerId]);

  useEffect(() => {
    setSelectedDeckId("all");
  }, [selectedPlayerId, selectedView]);

  const viewCount = useMemo(() => {
    if (selectedView === "inventory") return snapshot.inventory.length;
    if (selectedView === "binder") return snapshot.binder.length;
    if (selectedView === "vault") return snapshot.vault.length;
    if (selectedView === "decks") return snapshot.decks.length;
    return 0;
  }, [selectedView, snapshot]);

  async function refreshSnapshot() {
    if (!activeSeries?.id || !selectedPlayerId) return;

    const { data, error } = await supabase.rpc("admin_get_series_player_item_snapshot", {
      p_series_id: activeSeries.id,
      p_target_user_id: selectedPlayerId,
    });

    if (error) throw error;

    setSnapshot({
      inventory: data?.inventory || [],
      binder: data?.binder || [],
      vault: data?.vault || [],
      decks: data?.decks || [],
    });
  }

  async function handleConfirmRemoval() {
    if (!pendingRemoval || !activeSeries?.id) return;

    setRemoving(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      let rpcName = "";
      let payload = { p_series_id: activeSeries.id };

      if (pendingRemoval.kind === "inventory") {
        rpcName = "admin_remove_player_inventory_row";
        payload = { ...payload, p_inventory_id: pendingRemoval.id };
      } else if (pendingRemoval.kind === "binder") {
        rpcName = "admin_remove_player_binder_row";
        payload = { ...payload, p_binder_card_id: pendingRemoval.id };
      } else if (pendingRemoval.kind === "vault") {
        rpcName = "admin_remove_player_vault_entry";
        payload = { ...payload, p_vault_entry_id: pendingRemoval.id };
      } else if (pendingRemoval.kind === "deck") {
        rpcName = "admin_remove_player_deck";
        payload = { ...payload, p_deck_id: pendingRemoval.id };
      } else if (pendingRemoval.kind === "deck_card") {
        rpcName = "admin_remove_player_deck_card";
        payload = { ...payload, p_deck_card_id: pendingRemoval.id };
      }

      const { data, error } = await supabase.rpc(rpcName, payload);
      if (error) throw error;

      setStatusMessage(
        `${data?.label || pendingRemoval.label} removed successfully.`
      );
      setPendingRemoval(null);
      await refreshSnapshot();
    } catch (error) {
      console.error("Failed to remove player item:", error);
      setErrorMessage(error.message || "Failed to remove the selected record.");
    } finally {
      setRemoving(false);
    }
  }

  function renderInventoryView() {
    if (!snapshot.inventory.length) {
      return <div className="player-items-empty">This player has no inventory rows.</div>;
    }

    return (
      <div className="player-items-list">
        {snapshot.inventory.map((row) => (
          <article key={row.id} className="player-items-record">
            <div className="player-items-record-main">
              <div className="player-items-record-title">{row.item_name}</div>
              <div className="player-items-record-meta">
                <span>{row.category_name}</span>
                <span>{row.item_code}</span>
                <span>
                  Qty {row.quantity} | Locked {row.locked_quantity} | Available {row.available_quantity}
                </span>
              </div>
              <div className="player-items-record-copy">
                {row.description || "No description available."}
              </div>
            </div>

            <button
              type="button"
              className="player-items-remove-btn"
              onClick={() =>
                setPendingRemoval({
                  kind: "inventory",
                  id: row.id,
                  label: row.item_name,
                })
              }
            >
              Remove
            </button>
          </article>
        ))}
      </div>
    );
  }

  function renderBinderView() {
    if (!snapshot.binder.length) {
      return <div className="player-items-empty">This player has no binder rows.</div>;
    }

    return (
      <div className="player-items-list">
        {snapshot.binder.map((row) => (
          <article key={row.id} className="player-items-record">
            <div className="player-items-record-main">
              <div className="player-items-record-title">{row.card_name}</div>
              <div className="player-items-record-meta">
                <span>{row.rarity_name}</span>
                <span>Qty {row.quantity}</span>
                <span>{row.is_trade_locked ? "Trade Locked" : "Tradeable"}</span>
              </div>
            </div>

            <button
              type="button"
              className="player-items-remove-btn"
              onClick={() =>
                setPendingRemoval({
                  kind: "binder",
                  id: row.id,
                  label: `${row.card_name} (${row.rarity_name})`,
                })
              }
            >
              Remove
            </button>
          </article>
        ))}
      </div>
    );
  }

  function renderVaultView() {
    if (!snapshot.vault.length) {
      return <div className="player-items-empty">This player has no vaulted card families.</div>;
    }

    return (
      <div className="player-items-list">
        {snapshot.vault.map((row) => (
          <article key={row.id} className="player-items-record">
            <div className="player-items-record-main">
              <div className="player-items-record-title">{row.card_name}</div>
              <div className="player-items-record-meta">
                <span>Vault Family</span>
                <span>Card ID {row.card_id}</span>
              </div>
            </div>

            <button
              type="button"
              className="player-items-remove-btn"
              onClick={() =>
                setPendingRemoval({
                  kind: "vault",
                  id: row.id,
                  label: row.card_name,
                })
              }
            >
              Remove
            </button>
          </article>
        ))}
      </div>
    );
  }

  function renderDeckView() {
    if (!snapshot.decks.length) {
      return <div className="player-items-empty">This player has no decks.</div>;
    }

    return (
      <div className="player-items-decks">
        {visibleDecks.map((deck) => {
          const cardsBySection = (deck.cards || []).reduce((accumulator, card) => {
            const key = String(card.section || "main");
            if (!accumulator[key]) accumulator[key] = [];
            accumulator[key].push(card);
            return accumulator;
          }, {});

          return (
            <section key={deck.id} className="player-items-deck-card">
              <div className="player-items-deck-header">
                <div>
                  <div className="player-items-record-title">{deck.deck_name}</div>
                  <div className="player-items-record-meta">
                    <span>{deck.is_active ? "Active Deck" : "Inactive Deck"}</span>
                    <span>{deck.is_valid ? "Valid" : "Invalid"}</span>
                    <span>
                      {deck.main_count}/{deck.extra_count}/{deck.side_count}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  className="player-items-remove-btn"
                  onClick={() =>
                    setPendingRemoval({
                      kind: "deck",
                      id: deck.id,
                      label: deck.deck_name,
                    })
                  }
                >
                  Remove Deck
                </button>
              </div>

              <div className="player-items-record-copy">
                {formatValidationSummary(deck.validation_summary)}
              </div>

              <div className="player-items-deck-sections">
                {["main", "extra", "side"].map((sectionKey) => {
                  const cards = cardsBySection[sectionKey] || [];

                  return (
                    <div key={sectionKey} className="player-items-deck-section">
                      <div className="player-items-deck-section-title">
                        {DECK_SECTION_LABELS[sectionKey]} ({cards.length})
                      </div>

                      {cards.length === 0 ? (
                        <div className="player-items-deck-empty">No cards in this section.</div>
                      ) : (
                        <div className="player-items-deck-card-list">
                          {cards.map((card) => (
                            <div key={card.id} className="player-items-deck-card-row">
                              <div>
                                <div className="player-items-deck-card-name">
                                  {card.card_name}
                                </div>
                                <div className="player-items-record-meta">
                                  <span>{sectionKey}</span>
                                  <span>Qty {card.quantity}</span>
                                </div>
                              </div>

                              <button
                                type="button"
                                className="player-items-remove-btn small"
                                onClick={() =>
                                  setPendingRemoval({
                                    kind: "deck_card",
                                    id: card.id,
                                    label: card.card_name,
                                    deckName: deck.deck_name,
                                  })
                                }
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  function renderActiveView() {
    if (selectedView === "inventory") return renderInventoryView();
    if (selectedView === "binder") return renderBinderView();
    if (selectedView === "vault") return renderVaultView();
    return renderDeckView();
  }

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (!canUsePage) return <Navigate to="/mode/progression" replace />;

  return (
    <LauncherLayout>
      <div className="player-items-page">
        <div className="player-items-topbar">
          <div>
            <div className="player-items-kicker">ADMIN</div>
            <h1 className="player-items-title">Player Items</h1>
            <p className="player-items-subtitle">
              Inspect the current series inventory, binder, vault, and deck data
              for any player and remove broken rows when needed.
            </p>
          </div>

          <button
            type="button"
            className="player-items-secondary-btn"
            onClick={() => navigate("/mode/progression")}
          >
            Back
          </button>
        </div>

        <div className="player-items-toolbar">
          <div className="player-items-toolbar-card">
            <label htmlFor="player-items-player">Player</label>
            <select
              id="player-items-player"
              className="player-items-select"
              value={selectedPlayerId}
              onChange={(event) => setSelectedPlayerId(event.target.value)}
              disabled={loadingPlayers || !players.length}
            >
              {players.length === 0 ? (
                <option value="">No players found</option>
              ) : (
                players.map((player) => (
                  <option key={player.user_id} value={player.user_id}>
                    {player.profile?.username || "Unknown User"} | {formatRoleLabel(player.role)}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="player-items-toolbar-card">
            <label htmlFor="player-items-view">View</label>
            <select
              id="player-items-view"
              className="player-items-select"
              value={selectedView}
              onChange={(event) => setSelectedView(event.target.value)}
            >
              {VIEW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {selectedView === "decks" ? (
            <div className="player-items-toolbar-card">
              <label htmlFor="player-items-deck">Deck</label>
              <select
                id="player-items-deck"
                className="player-items-select"
                value={selectedDeckId}
                onChange={(event) => setSelectedDeckId(event.target.value)}
              >
                <option value="all">All Decks</option>
                {(snapshot.decks || []).map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.deck_name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="player-items-toolbar-card is-summary">
            <div className="player-items-summary-label">Current Series</div>
            <div className="player-items-summary-value">
              {activeSeries?.name || "No active series"}
            </div>
            <div className="player-items-summary-copy">
              {viewCount} visible {selectedView === "decks" ? "records" : selectedView}
            </div>
          </div>
        </div>

        {statusMessage ? <div className="player-items-success">{statusMessage}</div> : null}
        {errorMessage ? <div className="player-items-error">{errorMessage}</div> : null}

        <div className="player-items-content">
          <aside className="player-items-sidebar">
            <div className="player-items-sidecard">
              <div className="player-items-sidecard-kicker">Selected Player</div>
              {selectedPlayer ? (
                <>
                  <div className="player-items-player-row">
                    <div className="player-items-avatar">
                      {selectedPlayer.profile?.avatar_url ? (
                        <img
                          src={selectedPlayer.profile.avatar_url}
                          alt={selectedPlayer.profile?.username || "Player"}
                        />
                      ) : (
                        <span>
                          {String(selectedPlayer.profile?.username || "?")
                            .slice(0, 1)
                            .toUpperCase()}
                        </span>
                      )}
                    </div>

                    <div>
                      <div className="player-items-player-name">
                        {selectedPlayer.profile?.username || "Unknown User"}
                      </div>
                      <div className="player-items-record-meta">
                        <span>Series Role: {formatRoleLabel(selectedPlayer.role)}</span>
                        <span>
                          Global Role:{" "}
                          {formatRoleLabel(selectedPlayer.profile?.global_role)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="player-items-sidecard-grid">
                    <div>
                      <span>Inventory</span>
                      <strong>{snapshot.inventory.length}</strong>
                    </div>
                    <div>
                      <span>Binder</span>
                      <strong>{snapshot.binder.length}</strong>
                    </div>
                    <div>
                      <span>Vault</span>
                      <strong>{snapshot.vault.length}</strong>
                    </div>
                    <div>
                      <span>Decks</span>
                      <strong>{snapshot.decks.length}</strong>
                    </div>
                  </div>
                </>
              ) : (
                <div className="player-items-empty">Choose a player to inspect.</div>
              )}
            </div>
          </aside>

          <section className="player-items-main">
            <div className="player-items-view-header">
              <div>
                <div className="player-items-sidecard-kicker">Current View</div>
                <h2>{VIEW_OPTIONS.find((option) => option.value === selectedView)?.label}</h2>
              </div>
            </div>

            <div className="player-items-panel">
              {loadingSeries || loadingPlayers || loadingSnapshot ? (
                <div className="player-items-empty">Loading player items...</div>
              ) : !activeSeries?.id ? (
                <div className="player-items-empty">No active series was found.</div>
              ) : !selectedPlayerId ? (
                <div className="player-items-empty">Choose a player to inspect.</div>
              ) : (
                renderActiveView()
              )}
            </div>
          </section>
        </div>

        {pendingRemoval ? (
          <div
            className="player-items-modal-backdrop"
            onClick={() => {
              if (!removing) {
                setPendingRemoval(null);
              }
            }}
          >
            <div
              className="player-items-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="player-items-sidecard-kicker">Confirm Removal</div>
              <h2 className="player-items-modal-title">{pendingRemoval.label}</h2>
              <p className="player-items-modal-copy">
                {buildConfirmCopy(pendingRemoval)}
              </p>

              <div className="player-items-modal-actions">
                <button
                  type="button"
                  className="player-items-secondary-btn"
                  onClick={() => setPendingRemoval(null)}
                  disabled={removing}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="player-items-remove-btn"
                  onClick={handleConfirmRemoval}
                  disabled={removing}
                >
                  {removing ? "Removing..." : "Yes, Remove"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </LauncherLayout>
  );
}

export default PlayerItemsPage;
