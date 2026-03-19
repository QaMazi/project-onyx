import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import {
  PREMIUM_CATEGORY_LABELS,
  PREMIUM_CATEGORY_ORDER,
} from "../../data/premiumCatalog";
import { supabase } from "../../lib/supabase";
import "./StatisticsPage.css";

function formatDateTime(value) {
  if (!value) return "No active series";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function StatisticCard({ label, value, subtext }) {
  return (
    <article className="statistics-card">
      <span className="statistics-card-label">{label}</span>
      <strong className="statistics-card-value">{value}</strong>
      {subtext ? <p className="statistics-card-subtext">{subtext}</p> : null}
    </article>
  );
}

function StatisticsPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();
  const [statistics, setStatistics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadStatistics() {
      setLoading(true);
      setErrorText("");

      try {
        const { data, error } = await supabase.rpc("get_my_account_statistics");
        if (error) throw error;
        if (!isMounted) return;
        setStatistics(data || null);
      } catch (error) {
        console.error("Failed to load account statistics:", error);
        if (!isMounted) return;
        setStatistics(null);
        setErrorText(error?.message || "Failed to load account statistics.");
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    if (user && !user.isBlocked) {
      loadStatistics();
    } else {
      setStatistics(null);
      setLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [user]);

  const progression = statistics?.progression || {};
  const premium = statistics?.premium || {};
  const currentSeries = progression?.current_series || null;

  const premiumCategoryCards = useMemo(() => {
    const categories = premium?.categories || {};

    return PREMIUM_CATEGORY_ORDER.filter((categoryCode) => categories?.[categoryCode]).map(
      (categoryCode) => ({
        code: categoryCode,
        label: PREMIUM_CATEGORY_LABELS[categoryCode] || categoryCode,
        owned: Number(categories?.[categoryCode]?.owned || 0),
        total: Number(categories?.[categoryCode]?.total || 0),
      })
    );
  }, [premium]);

  if (authLoading || loading) return null;

  if (!user || user.isBlocked) {
    return <Navigate to="/" replace />;
  }

  return (
    <LauncherLayout>
      <div className="statistics-page">
        <div className="statistics-topbar">
          <div>
            <p className="statistics-kicker">ACCOUNT OVERVIEW</p>
            <h1 className="statistics-title">Your Statistics</h1>
            <p className="statistics-subtitle">
              Live progression and premium collection data, with honest placeholders
              where future systems do not track stats yet.
            </p>
          </div>

          <button
            type="button"
            className="statistics-back-button"
            onClick={() => navigate("/mode")}
          >
            Back
          </button>
        </div>

        {errorText ? <div className="statistics-inline-error">{errorText}</div> : null}

        <section className="statistics-hero">
          <div className="statistics-hero-main">
            <p className="statistics-section-kicker">Current Snapshot</p>
            <h2>{currentSeries?.series_name || "No Active Series Right Now"}</h2>
            <p>
              {currentSeries
                ? `Current phase: ${currentSeries.current_phase}. Joined ${formatDateTime(
                    currentSeries.joined_at
                  )}.`
                : "When you join the active progression series, the current-series snapshot will appear here automatically."}
            </p>
          </div>

          <div className="statistics-hero-grid">
            <StatisticCard
              label="Series Joined"
              value={progression.series_joined ?? 0}
            />
            <StatisticCard
              label="1st Place Finishes"
              value={progression.first_place_finishes ?? 0}
            />
            <StatisticCard
              label="Premium Unlocks"
              value={`${premium.owned_total ?? 0} / ${premium.available_total ?? 0}`}
            />
            <StatisticCard
              label="Onyx Tokens"
              value={premium.tokens ?? 0}
            />
          </div>
        </section>

        <div className="statistics-grid">
          <section className="statistics-section">
            <div className="statistics-section-header">
              <div>
                <p className="statistics-section-kicker">Ranked / Progression</p>
                <h2>Progression Stats</h2>
              </div>
            </div>

            <div className="statistics-card-grid">
              <StatisticCard
                label="Top 3 Finishes"
                value={progression.top_three_finishes ?? 0}
              />
              <StatisticCard
                label="Round Results Logged"
                value={progression.round_results_recorded ?? 0}
              />
              <StatisticCard
                label="Score Awarded"
                value={progression.total_score_awarded ?? 0}
              />
              <StatisticCard
                label="Shards Awarded"
                value={progression.total_shards_awarded ?? 0}
              />
              <StatisticCard
                label="Reward Grants Received"
                value={progression.reward_grants_received ?? 0}
              />
              <StatisticCard
                label="Starter Deck Claims"
                value={progression.starter_decks_claimed ?? 0}
              />
              <StatisticCard
                label="Decks Created"
                value={progression.decks_created ?? 0}
              />
              <StatisticCard
                label="Valid Decks"
                value={`${progression.valid_decks ?? 0} / ${progression.decks_created ?? 0}`}
                subtext={`${progression.active_decks ?? 0} active right now`}
              />
            </div>

            <div className="statistics-series-strip">
              <div>
                <span className="statistics-series-label">Current Series Binder</span>
                <strong>
                  {currentSeries
                    ? `${currentSeries.binder_unique_cards ?? 0} unique / ${
                        currentSeries.binder_total_cards ?? 0
                      } total cards`
                    : "No active series binder yet"}
                </strong>
              </div>

              <div>
                <span className="statistics-series-label">Current Series Deck State</span>
                <strong>
                  {currentSeries
                    ? `${currentSeries.active_deck_count ?? 0} active / ${
                        currentSeries.deck_count ?? 0
                      } total decks`
                    : "No current deck snapshot"}
                </strong>
              </div>
            </div>
          </section>

          <section className="statistics-section">
            <div className="statistics-section-header">
              <div>
                <p className="statistics-section-kicker">Premium Account</p>
                <h2>Premium Collection</h2>
                <p>
                  Real ownership totals from your account-wide premium catalog and
                  equipped loadout.
                </p>
              </div>
            </div>

            <div className="statistics-card-grid">
              <StatisticCard
                label="Total Owned"
                value={`${premium.owned_total ?? 0} / ${premium.available_total ?? 0}`}
              />
              <StatisticCard
                label="Equipped Premium Slots"
                value={premium.equipped_total ?? 0}
              />
            </div>

            <div className="statistics-premium-grid">
              {premiumCategoryCards.map((category) => (
                <StatisticCard
                  key={category.code}
                  label={category.label}
                  value={`${category.owned} / ${category.total}`}
                />
              ))}
            </div>
          </section>

          <section className="statistics-section statistics-section--placeholder">
            <div className="statistics-section-header">
              <div>
                <p className="statistics-section-kicker">Casual Mode</p>
                <h2>Deck Game Stats</h2>
              </div>
            </div>

            <div className="statistics-placeholder-card">
              <strong>Tracking Not Live Yet</strong>
              <p>
                Deck Game stat storage has not been built yet, so this section stays
                intentionally honest instead of showing fake numbers.
              </p>
            </div>
          </section>

          <section className="statistics-section statistics-section--placeholder">
            <div className="statistics-section-header">
              <div>
                <p className="statistics-section-kicker">Mini-Games</p>
                <h2>Mini-Game Stats</h2>
              </div>
            </div>

            <div className="statistics-placeholder-card">
              <strong>Tracking Not Live Yet</strong>
              <p>
                Mini-game stat tracking will appear here once those systems start
                recording wins, sessions, and milestones.
              </p>
            </div>
          </section>
        </div>
      </div>
    </LauncherLayout>
  );
}

export default StatisticsPage;
