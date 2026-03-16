import { useState } from "react";
import PatchNotesModal from "./PatchNotesModal";
import LauncherHeader from "./LauncherHeader";
import SettingsModal from "./SettingsModal";
import ProfileModal from "./ProfileModal";
import AdminPanelModal from "./AdminPanelModal";
import { useTheme } from "../context/ThemeContext";
import "./LauncherLayout.css";

function LauncherLayout({ children, showHeader = true, fullBleed = false }) {
  const [isPatchModalOpen, setIsPatchModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const { currentTheme } = useTheme();

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
                {children}
              </div>
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
            onClick={openPatchNotes}
            type="button"
          >
            Patch Notes
          </button>
        </div>
      </div>

      <PatchNotesModal isOpen={isPatchModalOpen} onClose={closePatchNotes} />
      <AdminPanelModal open={adminPanelOpen} onClose={closeAdminPanel} />

      {showHeader ? (
        <>
          <SettingsModal open={settingsOpen} onClose={closeSettings} />
          <ProfileModal open={profileOpen} onClose={closeProfile} />
        </>
      ) : null}
    </div>
  );
}

export default LauncherLayout;
