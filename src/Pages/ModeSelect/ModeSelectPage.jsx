import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import CommunityShowcaseCard from "../../components/premium/CommunityShowcaseCard";
import { usePremium } from "../../context/PremiumContext";
import { useTheme } from "../../context/ThemeContext";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";
import "./ModeSelectPage.css";

function isBlockedUser(user) {
  return user?.isBlocked || user?.role === "Blocked" || user?.globalRole === "Blocked";
}

function ModePanel({
  title,
  description,
  ctaText,
  onClick,
  disabled = false,
  imageSrc = "",
  surface = false,
  backgroundStyle = null,
}) {
  const isInteractive = typeof onClick === "function";
  const panelClassName = [
    "mode-panel",
    surface ? "mode-panel-surface" : "mode-panel-image",
    disabled ? "mode-panel-disabled" : "mode-panel-clickable",
  ].join(" ");

  return (
    <div
      className={panelClassName}
      onClick={isInteractive ? onClick : undefined}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onKeyDown={
        !isInteractive
          ? undefined
          : (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
      }
      style={backgroundStyle || undefined}
    >
      {imageSrc ? <img src={imageSrc} className="mode-panel-bg" alt={title} /> : null}
      <div className="mode-panel-overlay"></div>

      <div className="mode-panel-content">
        <div className="mode-panel-bottom">
          <h2 className="mode-panel-title">{title}</h2>
          <p className="mode-panel-description">{description}</p>
          {ctaText ? <div className="mode-panel-cta">{ctaText}</div> : null}
        </div>
      </div>
    </div>
  );
}

function ModeSelectPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();
  const { currentTheme } = useTheme();
  const { fetchRandomPublicShowcase } = usePremium();

  const [activeSeries, setActiveSeries] = useState(null);
  const [infoModal, setInfoModal] = useState(null);
  const [publicShowcase, setPublicShowcase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showcaseLoading, setShowcaseLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadSeriesState() {
      try {
        const { data: series, error } = await supabase
          .from("game_series")
          .select("id, name, max_players")
          .eq("is_current", true)
          .maybeSingle();

        if (error) throw error;
        if (!isMounted) return;

        setActiveSeries(series || null);
      } catch (error) {
        console.error("Series state load error:", error);
        if (isMounted) {
          setActiveSeries(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    async function loadShowcase() {
      try {
        setShowcaseLoading(true);
        const showcase = await fetchRandomPublicShowcase();
        if (!isMounted) return;
        setPublicShowcase(showcase || null);
      } catch (error) {
        console.error("Public showcase load error:", error);
        if (isMounted) {
          setPublicShowcase(null);
        }
      } finally {
        if (isMounted) {
          setShowcaseLoading(false);
        }
      }
    }

    loadSeriesState();
    loadShowcase();

    return () => {
      isMounted = false;
    };
  }, [fetchRandomPublicShowcase]);

  if (authLoading || loading) return null;

  if (!user || isBlockedUser(user)) {
    return <Navigate to="/" replace />;
  }

  const canEnterProgression = Boolean(user?.canAccessProgression);
  const canEnterDeckGame = Boolean(user?.canAccessDeckGame);
  const currentSeriesName = activeSeries?.name || null;

  function openInfoModal(title, message) {
    setInfoModal({ title, message });
  }

  function handleRankedClick() {
    if (canEnterProgression) {
      navigate("/mode/progression");
      return;
    }

    openInfoModal(
      "Ranked Locked",
      "This account is set to Player. Only Duelist, Admin, or Admin+ can access Ranked / Progression Mode."
    );
  }

  function handleCasualClick() {
    if (canEnterDeckGame) {
      navigate("/mode/deckgame");
      return;
    }

    openInfoModal(
      "Casual Locked",
      "This role does not currently have Casual / Deck Game access."
    );
  }

  const rankedDescription = canEnterProgression
    ? currentSeriesName
      ? `Your role grants progression access. Active series: ${currentSeriesName}.`
      : "Your role grants progression access. No globally active series is set right now."
    : "This account must be Duelist, Admin, or Admin+ to enter progression.";

  const casualDescription = canEnterDeckGame
    ? "Deck Game systems, casual play, and future side systems live here."
    : "This role does not currently have Casual Mode access.";

  const themedSurfaceStyle = currentTheme?.background
    ? { backgroundImage: `url(${currentTheme.background})` }
    : undefined;

  return (
    <LauncherLayout>
      <div className="mode-select-page">
        <div className="launcher-logo-shell mode-logo-shell">
          <div className="launcher-logo-aura"></div>

          <img
            src="/ui/project_onyx_logo.png"
            className="launcher-logo mode-logo"
            alt="Project Onyx"
          />
        </div>

        <section className="mode-showcase-section">
          <div className="mode-showcase-header">
            <div>
              <p className="mode-showcase-kicker">Community Showcase</p>
              <h2>Public Player Spotlight</h2>
              <p>
                A random public showcase appears here. If no player showcase is live,
                the Project Onyx promo fallback stays in rotation.
              </p>
            </div>

            <button
              type="button"
              className="mode-showcase-refresh-btn"
              onClick={() => {
                setShowcaseLoading(true);
                fetchRandomPublicShowcase()
                  .then((showcase) => setPublicShowcase(showcase || null))
                  .catch((error) => {
                    console.error("Showcase refresh failed:", error);
                    setPublicShowcase(null);
                  })
                  .finally(() => setShowcaseLoading(false));
              }}
            >
              {showcaseLoading ? "Refreshing..." : "Refresh Spotlight"}
            </button>
          </div>

          <CommunityShowcaseCard
            showcase={showcaseLoading ? null : publicShowcase}
            className="mode-showcase-card"
            fallbackLabel="Project Onyx Release Showcase"
          />
        </section>

        <div className="mode-select-card">
          <div className="mode-select-header">
            <h1 className="mode-select-title">Mode Select</h1>
            <p className="mode-select-subtitle">Choose your Project Onyx experience</p>
          </div>

          <div className="mode-grid mode-grid--triple">
            <ModePanel
              title="CASUAL MODE"
              description={casualDescription}
              ctaText={canEnterDeckGame ? "Enter Casual Mode" : "Locked"}
              onClick={handleCasualClick}
              disabled={!canEnterDeckGame}
              imageSrc="/ui/deckgame_mode.png"
            />

            <ModePanel
              title="RANKED MODE"
              description={rankedDescription}
              ctaText={canEnterProgression ? "Enter Progression" : "Locked"}
              onClick={handleRankedClick}
              disabled={!canEnterProgression}
              imageSrc="/ui/progression_mode.png"
            />

            <ModePanel
              title="MINI-GAMES"
              description="Mini-games will land here as they come online."
              ctaText="Coming Soon"
              disabled
              imageSrc="/ui/mini_games_mode.png"
            />

            <ModePanel
              title="YOUR STATISTICS"
              description="See your progression totals, premium collection progress, and future stat lanes."
              ctaText="Open Statistics"
              onClick={() => navigate("/mode/statistics")}
              surface
              backgroundStyle={themedSurfaceStyle}
            />

            <ModePanel
              title="SUGGESTIONS"
              description="Send ideas, requests, and polish notes straight into the Admin+ review inbox."
              ctaText="Open Suggestions"
              onClick={() => navigate("/mode/suggestions")}
              surface
              backgroundStyle={themedSurfaceStyle}
            />

            <ModePanel
              title="PREMIUM STORE"
              description="Permanent account unlocks, cosmetics, showcase objects, and Onyx Token spending."
              ctaText="Enter Premium Store"
              onClick={() => navigate("/mode/premium-store")}
              imageSrc="/ui/premium_store_mode.png"
            />
          </div>
        </div>

        {infoModal ? (
          <div className="progression-modal" onClick={() => setInfoModal(null)}>
            <div
              className="progression-modal-content"
              onClick={(event) => event.stopPropagation()}
            >
              <h2>{infoModal.title}</h2>
              <p>{infoModal.message}</p>
              <div className="progression-modal-actions">
                <button onClick={() => setInfoModal(null)}>Close</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </LauncherLayout>
  );
}

export default ModeSelectPage;
