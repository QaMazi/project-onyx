import { useState } from "react";
import PatchNotesModal from "./PatchNotesModal";
import LauncherHeader from "./LauncherHeader";
import SettingsModal from "./SettingsModal";

function LauncherLayout({ children }) {
  const [isPatchModalOpen, setIsPatchModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="launcher-root">
      <img
        src="/ui/login_background.png"
        className="launcher-bg"
        alt="background"
      />

      <div className="launcher-overlay"></div>

      <LauncherHeader openSettings={() => setSettingsOpen(true)} />

      <div className="launcher-center">{children}</div>

      <div className="launcher-footer">
        <div className="launcher-footer-left">v0.0.4 Alpha</div>

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
    </div>
  );
}

export default LauncherLayout;