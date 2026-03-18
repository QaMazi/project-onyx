import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePremium } from "../context/PremiumContext";
import { useUser } from "../context/UserContext";
import "./LauncherHeader.css";

function normalizeDisplayedRole(user) {
  const rawRole = String(
    user?.globalRole || user?.effectiveRole || user?.role || "Player"
  )
    .trim()
    .toLowerCase();

  if (rawRole === "admin+" || rawRole === "adminplus") return "Admin+";
  if (rawRole === "admin") return "Admin";
  if (rawRole === "duelist" || rawRole === "duelist+" || rawRole === "duelistplus") {
    return "Duelist";
  }
  if (rawRole === "blocked") return "Blocked";
  return "Player";
}

function resolveAvatar(user) {
  return user?.avatarUrl || user?.avatar || "";
}

function resolveUsername(user) {
  return user?.username || "Unknown User";
}

function LauncherHeader({
  openSettings,
  openProfile = () => {},
  openShowcaseSettings = () => {},
  openAdminPanel = () => {},
}) {
  const { user, reloadUser, signOut } = useUser();
  const { tokens } = usePremium();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);

  if (!user) return null;

  const displayedRole = normalizeDisplayedRole(user);
  const displayedAvatar = resolveAvatar(user);
  const displayedUsername = resolveUsername(user);
  const avatarInitial = displayedUsername.charAt(0).toUpperCase() || "P";
  const hasHeaderAdminAccess = Boolean(user?.canAccessHeaderAdmin);

  const roleClass = useMemo(() => {
    switch (displayedRole) {
      case "Admin+":
        return "launcher-header-role role-adminplus";
      case "Admin":
        return "launcher-header-role role-admin";
      case "Duelist":
        return "launcher-header-role role-duelist";
      case "Blocked":
        return "launcher-header-role role-blocked";
      case "Player":
      default:
        return "launcher-header-role role-applicant";
    }
  }, [displayedRole]);

  async function handleLogout() {
    try {
      setIsOpen(false);

      if (typeof signOut === "function") {
        await signOut();
      }

      if (typeof reloadUser === "function") {
        await reloadUser();
      }

      window.location.href = "/";
    } catch (error) {
      console.error("Logout crashed:", error);
      window.location.href = "/";
    }
  }

  function handleOpenSettings() {
    setIsOpen(false);
    openSettings();
  }

  function handleOpenProfile() {
    setIsOpen(false);
    openProfile();
  }

  function handleOpenShowcaseSettings() {
    setIsOpen(false);
    openShowcaseSettings();
  }

  function handleOpenAdminPanel() {
    setIsOpen(false);
    openAdminPanel();
  }

  function handleReturnToModeSelect() {
    setIsOpen(false);
    navigate("/mode");
  }

  return (
    <header className="launcher-header">
      <div className="launcher-header-left">
        <button
          className="launcher-header-brand-group"
          type="button"
          onClick={handleReturnToModeSelect}
          aria-label="Return to Mode Select"
        >
          <img
            src="/ui/onyx_logo.png"
            className="launcher-header-logo"
            alt="Onyx"
          />
          <span className="launcher-header-brand">PROJECT ONYX</span>
        </button>
      </div>

      <div className="launcher-header-right">
        <div className="launcher-header-profile-wrap">
          <button
            className="launcher-header-profile"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            type="button"
          >
            <div className="launcher-header-avatar">
              {displayedAvatar ? (
                <img
                  src={displayedAvatar}
                  alt={displayedUsername}
                  className="launcher-header-avatar-image"
                />
              ) : (
                avatarInitial
              )}
            </div>

            <div className="launcher-header-usertext">
              <span className="launcher-header-username">{displayedUsername}</span>
            </div>

            <div className={roleClass}>{displayedRole}</div>

            <div className="launcher-header-token-pill">
              <img
                src="/ui/gentlemens_token.png"
                className="launcher-header-token-icon"
                alt=""
                aria-hidden="true"
              />
              <span>{tokens}</span>
            </div>

            <span className="launcher-header-caret">v</span>
          </button>

          {isOpen && (
            <div className="launcher-header-menu" role="menu">
              <button
                className="launcher-header-menu-item"
                onClick={handleOpenProfile}
                type="button"
              >
                Profile
              </button>

              <button
                className="launcher-header-menu-item"
                onClick={handleOpenSettings}
                type="button"
              >
                Settings
              </button>

              <button
                className="launcher-header-menu-item"
                onClick={handleOpenShowcaseSettings}
                type="button"
              >
                Showcase Settings
              </button>

              {hasHeaderAdminAccess && (
                <button
                  className="launcher-header-menu-item"
                  onClick={handleOpenAdminPanel}
                  type="button"
                >
                  Admin Panel
                </button>
              )}

              <button
                className="launcher-header-menu-item"
                onClick={handleLogout}
                type="button"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default LauncherHeader;
