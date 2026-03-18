import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../../components/LauncherLayout";
import { useUser } from "../../../context/UserContext";
import { supabase } from "../../../lib/supabase";
import "./RoundRewardsPage.css";

const PLACEMENTS = [1, 2, 3, 4, 5, 6];

function buildEmptyPlacement(placement) {
  return {
    placement,
    random_item_quantity: 0,
    extra_shard_min: 0,
    extra_shard_max: 0,
    extra_feature_coin_min: 0,
    extra_feature_coin_max: 0,
    specific_item_definition_id: "",
  };
}

function RoundRewardsPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [rewardConfigs, setRewardConfigs] = useState([]);
  const [itemOptions, setItemOptions] = useState([]);
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [formState, setFormState] = useState({
    round_number: 1,
    round_step: 1,
    shared_shard_min: 0,
    shared_shard_max: 0,
    shared_feature_coin_min: 0,
    shared_feature_coin_max: 0,
    shared_item_definition_id: "",
    shared_item_quantity: 0,
    placements: PLACEMENTS.map(buildEmptyPlacement),
  });

  const selectedConfig = useMemo(
    () => rewardConfigs.find((config) => config.id === selectedConfigId) || null,
    [rewardConfigs, selectedConfigId]
  );

  useEffect(() => {
    if (!authLoading && user) {
      loadPage();
    }
  }, [authLoading, user]);

  async function loadPage() {
    if (!user) return;

    setLoading(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const [
        activeSeriesResponse,
        configsResponse,
        placementsResponse,
        itemsResponse,
      ] = await Promise.all([
        supabase.from("game_series").select("id, name").eq("is_current", true).maybeSingle(),
        supabase
          .from("series_round_reward_configs")
          .select("*")
          .order("round_number", { ascending: true })
          .order("round_step", { ascending: true }),
        supabase
          .from("series_round_reward_config_placements")
          .select("*")
          .order("placement", { ascending: true }),
        supabase
          .from("item_definitions")
          .select("id, name, code")
          .eq("is_active", true)
          .order("name", { ascending: true }),
      ]);

      if (activeSeriesResponse.error) throw activeSeriesResponse.error;
      if (configsResponse.error) throw configsResponse.error;
      if (placementsResponse.error) throw placementsResponse.error;
      if (itemsResponse.error) throw itemsResponse.error;

      const nextSeriesId = activeSeriesResponse.data?.id || null;
      setActiveSeriesId(nextSeriesId);
      setItemOptions(itemsResponse.data || []);

      const placementsByConfigId = new Map();
      (placementsResponse.data || []).forEach((row) => {
        if (!placementsByConfigId.has(row.reward_config_id)) {
          placementsByConfigId.set(row.reward_config_id, []);
        }
        placementsByConfigId.get(row.reward_config_id).push(row);
      });

      const hydratedConfigs = (configsResponse.data || [])
        .filter((row) => row.series_id === nextSeriesId)
        .filter((row) => Number(row.round_number || 0) > 0)
        .map((row) => ({
          ...row,
          placements: placementsByConfigId.get(row.id) || [],
        }));

      setRewardConfigs(hydratedConfigs);

      const firstConfig = hydratedConfigs[0] || null;
      if (firstConfig) {
        hydrateForm(firstConfig);
      } else {
        handleNewConfig();
      }
    } catch (error) {
      console.error("Failed to load round rewards:", error);
      setErrorMessage(error.message || "Failed to load round rewards.");
    } finally {
      setLoading(false);
    }
  }

  function hydrateForm(config) {
    setSelectedConfigId(config.id || "");

    const placementMap = new Map(
      (config.placements || []).map((row) => [Number(row.placement), row])
    );

    setFormState({
      round_number: Number(config.round_number ?? 0),
      round_step: Number(config.round_step || 1),
      shared_shard_min: Number(config.shared_shard_min || 0),
      shared_shard_max: Number(config.shared_shard_max || 0),
      shared_feature_coin_min: Number(config.shared_feature_coin_min || 0),
      shared_feature_coin_max: Number(config.shared_feature_coin_max || 0),
      shared_item_definition_id: config.shared_item_definition_id || "",
      shared_item_quantity: Number(config.shared_item_quantity || 0),
      placements: PLACEMENTS.map((placement) => {
        const row = placementMap.get(placement);
        return {
          placement,
          random_item_quantity: Number(row?.random_item_quantity || 0),
          extra_shard_min: Number(row?.extra_shard_min || 0),
          extra_shard_max: Number(row?.extra_shard_max || 0),
          extra_feature_coin_min: Number(row?.extra_feature_coin_min || 0),
          extra_feature_coin_max: Number(row?.extra_feature_coin_max || 0),
          specific_item_definition_id: row?.specific_item_definition_id || "",
        };
      }),
    });
  }

  function handleNewConfig() {
    setSelectedConfigId("");
    setFormState({
      round_number: 1,
      round_step: 1,
      shared_shard_min: 0,
      shared_shard_max: 0,
      shared_feature_coin_min: 0,
      shared_feature_coin_max: 0,
      shared_item_definition_id: "",
      shared_item_quantity: 0,
      placements: PLACEMENTS.map(buildEmptyPlacement),
    });
  }

  function updatePlacement(placement, key, value) {
    setFormState((current) => ({
      ...current,
      placements: current.placements.map((row) =>
        row.placement === placement ? { ...row, [key]: value } : row
      ),
    }));
  }

  async function saveConfig() {
    if (!activeSeriesId) {
      setErrorMessage("No active series is available.");
      return;
    }

    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      if (Number(formState.round_number || 0) <= 0) {
        throw new Error("Round 0 rewards are hard-coded and should not be configured here.");
      }

      const payload = {
        series_id: activeSeriesId,
        round_number: Math.max(1, Number(formState.round_number ?? 1)),
        round_step: Number(formState.round_step || 1),
        shared_shard_min: Number(formState.shared_shard_min || 0),
        shared_shard_max: Number(formState.shared_shard_max || 0),
        shared_feature_coin_min: Number(formState.shared_feature_coin_min || 0),
        shared_feature_coin_max: Number(formState.shared_feature_coin_max || 0),
        shared_item_definition_id: formState.shared_item_definition_id || null,
        shared_item_quantity: Number(formState.shared_item_quantity || 0),
      };

      let configId = selectedConfigId;

      if (!configId) {
        const { data, error } = await supabase
          .from("series_round_reward_configs")
          .insert(payload)
          .select("id")
          .single();

        if (error) throw error;
        configId = data.id;
      } else {
        const { error } = await supabase
          .from("series_round_reward_configs")
          .update(payload)
          .eq("id", configId);

        if (error) throw error;

        const { error: deleteError } = await supabase
          .from("series_round_reward_config_placements")
          .delete()
          .eq("reward_config_id", configId);

        if (deleteError) throw deleteError;
      }

      const placementRows = formState.placements.map((row) => ({
        reward_config_id: configId,
        placement: row.placement,
        random_item_quantity: Number(row.random_item_quantity || 0),
        extra_shard_min: Number(row.extra_shard_min || 0),
        extra_shard_max: Number(row.extra_shard_max || 0),
        extra_feature_coin_min: Number(row.extra_feature_coin_min || 0),
        extra_feature_coin_max: Number(row.extra_feature_coin_max || 0),
        specific_item_definition_id: row.specific_item_definition_id || null,
      }));

      const { error: placementError } = await supabase
        .from("series_round_reward_config_placements")
        .insert(placementRows);

      if (placementError) throw placementError;

      setStatusMessage("Round reward config saved.");
      await loadPage();
    } catch (error) {
      console.error("Failed to save round reward config:", error);
      setErrorMessage(error.message || "Failed to save round reward config.");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) return null;

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (user.role !== "Admin+" && user.role !== "Admin") {
    return <Navigate to="/mode/progression" replace />;
  }

  return (
    <LauncherLayout>
      <div className="round-rewards-page">
        <div className="round-rewards-topbar">
          <div>
            <div className="round-rewards-kicker">ADMIN</div>
            <h1 className="round-rewards-title">Round Rewards</h1>
            <p className="round-rewards-subtitle">
              Configure exact round reward rules for the current series.
            </p>
            <p className="round-rewards-subtitle">
              Round 0 rewards are hard-coded and do not belong in this editor.
            </p>
          </div>

          <div className="round-rewards-topbar-actions">
            <button
              type="button"
              className="round-rewards-secondary-btn"
              onClick={() => navigate("/mode/progression")}
            >
              Back
            </button>
          </div>
        </div>

        {loading ? (
          <div className="round-rewards-card round-rewards-empty">
            Loading reward configs...
          </div>
        ) : (
          <div className="round-rewards-layout">
            <aside className="round-rewards-card round-rewards-sidebar">
              <div className="round-rewards-section-header">
                <h2>Configured Rounds</h2>
              </div>

              <button
                type="button"
                className="round-rewards-primary-btn"
                onClick={handleNewConfig}
              >
                New Config
              </button>

              <div className="round-rewards-config-list">
                {rewardConfigs.map((config) => (
                  <button
                    key={config.id}
                    type="button"
                    className={`round-rewards-config-row ${
                      selectedConfig?.id === config.id ? "is-selected" : ""
                    }`}
                    onClick={() => hydrateForm(config)}
                  >
                    Round {config.round_number}-{config.round_step}
                  </button>
                ))}
              </div>
            </aside>

            <main className="round-rewards-card round-rewards-main">
              <div className="round-rewards-form-grid">
                <label className="round-rewards-field">
                  <span>Round Number</span>
                  <input
                    type="number"
                    min="1"
                    value={formState.round_number}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        round_number: Math.max(1, Number(event.target.value || 1)),
                      }))
                    }
                  />
                </label>

                <label className="round-rewards-field">
                  <span>Round Step</span>
                  <select
                    value={formState.round_step}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        round_step: Number(event.target.value || 1),
                      }))
                    }
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                  </select>
                </label>

                <label className="round-rewards-field">
                  <span>Shared Shards Min</span>
                  <input
                    type="number"
                    min="0"
                    value={formState.shared_shard_min}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        shared_shard_min: Number(event.target.value || 0),
                      }))
                    }
                  />
                </label>

                <label className="round-rewards-field">
                  <span>Shared Shards Max</span>
                  <input
                    type="number"
                    min="0"
                    value={formState.shared_shard_max}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        shared_shard_max: Number(event.target.value || 0),
                      }))
                    }
                  />
                </label>

                <label className="round-rewards-field">
                  <span>Shared Feature Coins Min</span>
                  <input
                    type="number"
                    min="0"
                    value={formState.shared_feature_coin_min}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        shared_feature_coin_min: Number(event.target.value || 0),
                      }))
                    }
                  />
                </label>

                <label className="round-rewards-field">
                  <span>Shared Feature Coins Max</span>
                  <input
                    type="number"
                    min="0"
                    value={formState.shared_feature_coin_max}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        shared_feature_coin_max: Number(event.target.value || 0),
                      }))
                    }
                  />
                </label>

                <label className="round-rewards-field">
                  <span>Shared Reward Item</span>
                  <select
                    value={formState.shared_item_definition_id}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        shared_item_definition_id: event.target.value,
                      }))
                    }
                  >
                    <option value="">None</option>
                    {itemOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.code})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="round-rewards-field">
                  <span>Shared Item Quantity</span>
                  <input
                    type="number"
                    min="0"
                    value={formState.shared_item_quantity}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        shared_item_quantity: Number(event.target.value || 0),
                      }))
                    }
                  />
                </label>
              </div>

              <div className="round-rewards-placement-grid">
                {formState.placements.map((row) => (
                  <section className="round-rewards-placement-card" key={row.placement}>
                    <h3>Placement {row.placement}</h3>

                    <label className="round-rewards-field">
                      <span>Random Item Qty</span>
                      <input
                        type="number"
                        min="0"
                        value={row.random_item_quantity}
                        onChange={(event) =>
                          updatePlacement(
                            row.placement,
                            "random_item_quantity",
                            Number(event.target.value || 0)
                          )
                        }
                      />
                    </label>

                    <label className="round-rewards-field">
                      <span>Extra Shards Min</span>
                      <input
                        type="number"
                        min="0"
                        value={row.extra_shard_min}
                        onChange={(event) =>
                          updatePlacement(
                            row.placement,
                            "extra_shard_min",
                            Number(event.target.value || 0)
                          )
                        }
                      />
                    </label>

                    <label className="round-rewards-field">
                      <span>Extra Shards Max</span>
                      <input
                        type="number"
                        min="0"
                        value={row.extra_shard_max}
                        onChange={(event) =>
                          updatePlacement(
                            row.placement,
                            "extra_shard_max",
                            Number(event.target.value || 0)
                          )
                        }
                      />
                    </label>

                    <label className="round-rewards-field">
                      <span>Extra Feature Coins Min</span>
                      <input
                        type="number"
                        min="0"
                        value={row.extra_feature_coin_min}
                        onChange={(event) =>
                          updatePlacement(
                            row.placement,
                            "extra_feature_coin_min",
                            Number(event.target.value || 0)
                          )
                        }
                      />
                    </label>

                    <label className="round-rewards-field">
                      <span>Extra Feature Coins Max</span>
                      <input
                        type="number"
                        min="0"
                        value={row.extra_feature_coin_max}
                        onChange={(event) =>
                          updatePlacement(
                            row.placement,
                            "extra_feature_coin_max",
                            Number(event.target.value || 0)
                          )
                        }
                      />
                    </label>

                    <label className="round-rewards-field">
                      <span>Fixed Item Override</span>
                      <select
                        value={row.specific_item_definition_id}
                        onChange={(event) =>
                          updatePlacement(
                            row.placement,
                            "specific_item_definition_id",
                            event.target.value
                          )
                        }
                      >
                        <option value="">Random / None</option>
                        {itemOptions.map((item) => (
                          <option key={`${row.placement}-${item.id}`} value={item.id}>
                            {item.name} ({item.code})
                          </option>
                        ))}
                      </select>
                    </label>
                  </section>
                ))}
              </div>

              {statusMessage ? (
                <div className="round-rewards-success">{statusMessage}</div>
              ) : null}

              {errorMessage ? (
                <div className="round-rewards-error">{errorMessage}</div>
              ) : null}

              <div className="round-rewards-actions">
                <button
                  type="button"
                  className="round-rewards-primary-btn"
                  disabled={saving}
                  onClick={saveConfig}
                >
                  {saving ? "Saving..." : "Save Config"}
                </button>
              </div>
            </main>
          </div>
        )}
      </div>
    </LauncherLayout>
  );
}

export default RoundRewardsPage;
