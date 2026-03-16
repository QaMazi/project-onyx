import { useState } from "react";
import PatchNotesModal from "./PatchNotesModal";
import LauncherHeader from "./LauncherHeader";
import SettingsModal from "./SettingsModal";
import ProfileModal from "./ProfileModal";
import { useTheme } from "../context/ThemeContext";
import "./LauncherLayout.css";

function LauncherLayout({ children, showHeader = true }) {
  const [isPatchModalOpen, setIsPatchModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { currentTheme } = useTheme();

  return (
    <div className="launcher-shell">
      <img
        src={currentTheme?.background}
        className="launcher-shell__background"
        alt="background"
      />

      <div className="launcher-shell__overlay" aria-hidden="true" />

      <div className="launcher-shell__atmosphere" aria-hidden="true">
        <div className="fog-layer fog-1" />
        <div className="fog-layer fog-2" />

        <div className="particles">
          {Array.from({ length: 90 }).map((_, i) => (
            <span key={i} />
          ))}
        </div>
      </div>

      <div className="launcher-shell__chrome">
        {showHeader ? (
          <LauncherHeader
            openSettings={() => setSettingsOpen(true)}
            openProfile={() => setProfileOpen(true)}
          />
        ) : (
          <div className="launcher-shell__header-spacer" aria-hidden="true" />
        )}

        <main className="launcher-shell__main">
          <div className="launcher-shell__viewport">
            <div className="launcher-shell__stage">
              <div className="launcher-shell__content">{children}</div>
            </div>
          </div>
        </main>

        <div
          className="launcher-shell__footer"
          style={{ borderTop: `1px solid var(--theme-accent)` }}
        >
          <div className="launcher-shell__footer-left">v0.0.7 Alpha</div>

          <div className="launcher-shell__footer-center">
            © Gentlemen&apos;s Gaming 2026
          </div>

          <button
            className="launcher-shell__footer-button"
            onClick={() => setIsPatchModalOpen(true)}
            type="button"
          >
            Patch Notes
          </button>
        </div>
      </div>

      <PatchNotesModal
        isOpen={isPatchModalOpen}
        onClose={() => setIsPatchModalOpen(false)}
      />

      {showHeader ? (
        <>
          <SettingsModal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
          />

          <ProfileModal
            open={profileOpen}
            onClose={() => setProfileOpen(false)}
          />
        </>
      ) : null}
    </div>
  );
}

export default LauncherLayout;
