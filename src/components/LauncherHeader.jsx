import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "../context/UserContext";
import { supabase } from "../lib/supabase";
import "./LauncherHeader.css";

function resolveDisplayedRole(user) {
  return user?.effectiveRole || user?.role || user?.globalRole || "Duelist";
}

function resolveAvatar(user) {
  return user?.avatarUrl || user?.avatar || "";
}

function resolveUsername(user) {
  return user?.username || "Unknown User";
}

function LauncherHeader({ openSettings, openProfile = () => {} }) {
  const navigate = useNavigate();
  const { user, reloadUser } = useUser();
  const [isOpen, setIsOpen] = useState(false);

  if (!user) return null;

  const displayedRole = resolveDisplayedRole(user);
  const displayedAvatar = resolveAvatar(user);
  const displayedUsername = resolveUsername(user);

  const hasGlobalAdminAccess =
    user?.canAccessHeaderAdmin ||
    user?.globalRole === "Admin+" ||
    displayedRole === "Admin+";

  const avatarInitial = displayedUsername.charAt(0).toUpperCase() || "G";

  const roleClass = useMemo(() => {
    switch (displayedRole) {
      case "Admin+":
        return "launcher-header-role role-adminplus";
      case "Admin":
        return "launcher-header-role role-admin";
      case "Duelist":
      case "Duelist+":
        return "launcher-header-role role-duelist";
      case "Blocked":
        return "launcher-header-role role-blocked";
      case "Applicant":
      default:
        return "launcher-header-role role-applicant";
    }
  }, [displayedRole]);

  async function handleLogout() {
    try {
      setIsOpen(false);
      await supabase.auth.signOut();
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

  function handleOpenAdminPanel() {
    setIsOpen(false);
    navigate("/admin", {
      state: {
        from: window.location.pathname,
      },
    });
  }

  return (
    <header className="launcher-header">
      <div className="launcher-header-left">
        <div className="launcher-header-brand-group">
          <img
            src="/ui/onyx_logo.png"
            className="launcher-header-logo"
            alt="Onyx"
          />
          <span className="launcher-header-brand">PROJECT ONYX</span>
        </div>
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

            <span className="launcher-header-caret">▾</span>
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

              {hasGlobalAdminAccess && (
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