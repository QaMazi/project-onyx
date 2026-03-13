import { useState } from "react";
import PatchNotesModal from "./PatchNotesModal";
import LauncherHeader from "./LauncherHeader";
import SettingsModal from "./SettingsModal";
import ProfileModal from "./ProfileModal";
import { useTheme } from "../context/ThemeContext";

function LauncherLayout({ children }) {
  const [isPatchModalOpen, setIsPatchModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { currentTheme } = useTheme();

  return (
    <div className="launcher-root">
      <img
        src={currentTheme?.background}
        className="launcher-bg"
        alt="background"
      />

      <div className="launcher-overlay"></div>

      <div className="launcher-atmosphere">
        <div className="fog-layer fog-1"></div>
        <div className="fog-layer fog-2"></div>

        <div className="particles">
          {Array.from({ length: 90 }).map((_, i) => (
            <span key={i}></span>
          ))}
        </div>
      </div>

      <LauncherHeader
        openSettings={() => setSettingsOpen(true)}
        openProfile={() => setProfileOpen(true)}
      />

      <div className="launcher-center">{children}</div>

      <div
        className="launcher-footer"
        style={{
          borderTop: `1px solid var(--theme-accent)`,
        }}
      >
        <div className="launcher-footer-left">v0.0.5 Alpha</div>

        <div className="launcher-footer-center">
          © Gentlemen&apos;s Gaming 2026
        </div>

        <button
          className="launcher-footer-right"
          onClick={() => setIsPatchModalOpen(true)}
        >
          Patch Notes
        </button>
      </div>

      <PatchNotesModal
        isOpen={isPatchModalOpen}
        onClose={() => setIsPatchModalOpen(false)}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
      />
    </div>
  );
}

export default LauncherLayout;