import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import PatchNotesModal from "./PatchNotesModal";
import LauncherHeader from "./LauncherHeader";
import SettingsModal from "./SettingsModal";
import ProfileModal from "./ProfileModal";
import ShowcaseSettingsModal from "./ShowcaseSettingsModal";
import AdminPanelModal from "./AdminPanelModal";
import CursorTrailLayer from "./premium/CursorTrailLayer";
import PremiumSoundDirector from "./premium/PremiumSoundDirector";
import { usePremium } from "../context/PremiumContext";
import { useTheme } from "../context/ThemeContext";
import patchNotes from "../data/patchNotes.json";
import "./LauncherLayout.css";

function LauncherLayout({ children, showHeader = true, fullBleed = false }) {
  const location = useLocation();
  const routeMountRef = useRef(false);
  const [isPatchModalOpen, setIsPatchModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [showcaseSettingsOpen, setShowcaseSettingsOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [transitionTick, setTransitionTick] = useState(0);
  const { equippedBySlot } = usePremium();
  const { currentTheme } = useTheme();
  const latestPatch = patchNotes?.[0] || null;
  const footerVersionLabel = latestPatch
    ? `v${latestPatch.version} ${latestPatch.channel}`
    : "v0.1.0 Beta";

  useEffect(() => {
    if (!routeMountRef.current) {
      routeMountRef.current = true;
      return;
    }

    setTransitionTick((previous) => previous + 1);
  }, [location.pathname]);

  function openPatchNotes() {
    setIsPatchModalOpen(true);
  }

  function closePatchNotes() {
    setIsPatchModalOpen(false);
  }

  function openSettings() {
    setSettingsOpen(true);
  }

  function closeSettings() {
    setSettingsOpen(false);
  }

  function openProfile() {
    setProfileOpen(true);
  }

  function closeProfile() {
    setProfileOpen(false);
  }

  function openShowcaseSettings() {
    setShowcaseSettingsOpen(true);
  }

  function closeShowcaseSettings() {
    setShowcaseSettingsOpen(false);
  }

  function openAdminPanel() {
    setAdminPanelOpen(true);
  }

  function closeAdminPanel() {
    setAdminPanelOpen(false);
  }

  return (
    <div
      className={`launcher-shell ${fullBleed ? "launcher-shell--fullbleed" : ""}`}
    >
      <img
        src={currentTheme?.background}
        className="launcher-shell__background"
        alt="background"
      />

      <div className="launcher-shell__overlay" aria-hidden="true" />

      <div className="launcher-shell__atmosphere" aria-hidden="true">
        <div className="fog-layer fog-1" />
        <div className="fog-layer fog-2" />
        <div className="launcher-shell__energy-rings" />
        <div className="launcher-shell__ambient-runes" />
        <div className="launcher-shell__ambient-glow" />

        <div className="particles">
          {Array.from({ length: 90 }).map((_, i) => (
            <span key={i} />
          ))}
        </div>
      </div>

      <div className="launcher-shell__chrome">
        {showHeader ? (
          <LauncherHeader
            openSettings={openSettings}
            openProfile={openProfile}
            openShowcaseSettings={openShowcaseSettings}
            openAdminPanel={openAdminPanel}
          />
        ) : (
          <div className="launcher-shell__header-spacer" aria-hidden="true" />
        )}

        <main className="launcher-shell__main">
          <div
            className={`launcher-shell__viewport ${
              fullBleed ? "launcher-shell__viewport--fullbleed" : ""
            }`}
          >
            <div
              className={`launcher-shell__stage ${
                fullBleed ? "launcher-shell__stage--fullbleed" : ""
              }`}
            >
              <div
                className={`launcher-shell__content ${
                  fullBleed ? "launcher-shell__content--fullbleed" : ""
                }`}
              >
                {transitionTick > 0 ? (
                  <div
                    key={transitionTick}
                    className="launcher-shell__page-transition"
                    aria-hidden="true"
                  />
                ) : null}
                {children}
              </div>
            </div>
          </div>
        </main>

        <div
          className="launcher-shell__footer"
          style={{ borderTop: `1px solid var(--theme-accent)` }}
        >
          <div className="launcher-shell__footer-lines" aria-hidden="true" />
          <div className="launcher-shell__footer-left">{footerVersionLabel}</div>

          <div className="launcher-shell__footer-center">
            {"\u00A9"} Gentlemen&apos;s Gaming 2026
          </div>

          <button
            className="launcher-shell__footer-button"
            onClick={openPatchNotes}
            type="button"
          >
            Patch Notes
          </button>
        </div>
      </div>

      <PatchNotesModal isOpen={isPatchModalOpen} onClose={closePatchNotes} />
      <AdminPanelModal open={adminPanelOpen} onClose={closeAdminPanel} />
      {equippedBySlot?.cursor_effect_style ? <CursorTrailLayer /> : null}
      <PremiumSoundDirector />

      {showHeader ? (
        <>
          <SettingsModal open={settingsOpen} onClose={closeSettings} />
          <ProfileModal open={profileOpen} onClose={closeProfile} />
          <ShowcaseSettingsModal
            open={showcaseSettingsOpen}
            onClose={closeShowcaseSettings}
          />
        </>
      ) : null}
    </div>
  );
}

export default LauncherLayout;
