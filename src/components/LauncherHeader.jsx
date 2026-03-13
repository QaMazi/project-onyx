import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "../context/UserContext";
import { supabase } from "../lib/supabase";
import "./LauncherHeader.css";

function LauncherHeader({ openSettings, openProfile = () => {} }) {
  const navigate = useNavigate();
  const { user, setUser } = useUser();
  const [isOpen, setIsOpen] = useState(false);

  if (!user) return null;

  const isAdmin = user.role === "Admin" || user.role === "Admin+";
  const avatarInitial = user.username?.charAt(0)?.toUpperCase() || "G";

  const roleClass = useMemo(() => {
    switch (user.role) {
      case "Admin+":
        return "launcher-header-role role-adminplus";
      case "Admin":
        return "launcher-header-role role-admin";
      case "Duelist":
        return "launcher-header-role role-duelist";
      case "Blocked":
        return "launcher-header-role role-blocked";
      case "Applicant":
      default:
        return "launcher-header-role role-applicant";
    }
  }, [user.role]);

  const handleLogout = async () => {
    try {
      setIsOpen(false);
      setUser(null);
      await supabase.auth.signOut();
      window.location.href = "/";
    } catch (error) {
      console.error("Logout crashed:", error);
      window.location.href = "/";
    }
  };

  const handleOpenSettings = () => {
    setIsOpen(false);
    openSettings();
  };

  const handleOpenProfile = () => {
    setIsOpen(false);
    openProfile();
  };

  return (
    <div className="launcher-header">
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
          >
            <div className="launcher-header-avatar">
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.username}
                  className="launcher-header-avatar-image"
                />
              ) : (
                avatarInitial
              )}
            </div>

            <div className="launcher-header-usertext">
              <span className="launcher-header-username">{user.username}</span>
            </div>

            <div className={roleClass}>{user.role}</div>

            <span className="launcher-header-caret">▾</span>
          </button>

          {isOpen && (
            <div className="launcher-header-menu" role="menu">
              <button
                className="launcher-header-menu-item"
                onClick={handleOpenProfile}
              >
                Profile
              </button>

              <button
                className="launcher-header-menu-item"
                onClick={handleOpenSettings}
              >
                Settings
              </button>

              {isAdmin && (
                <button
                  className="launcher-header-menu-item"
                  onClick={() => {
  setIsOpen(false);
  navigate("/admin", {
    state: {
      from: window.location.pathname,
    },
  });
}}
                >
                  Admin Panel
                </button>
              )}

              <button
                className="launcher-header-menu-item"
                onClick={handleLogout}
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default LauncherHeader;