import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "../context/UserContext";
import "./LauncherHeader.css";

function LauncherHeader({ openSettings }) {
  const navigate = useNavigate();
  const { user } = useUser();
  const [isOpen, setIsOpen] = useState(false);

  const roleClass = useMemo(() => {
    switch (user.role) {
      case "Admin+":
        return "launcher-header-role role-adminplus";
      case "Admin":
        return "launcher-header-role role-admin";
      case "Duelist":
        return "launcher-header-role role-duelist";
      case "Applicant":
      default:
        return "launcher-header-role role-applicant";
    }
  }, [user.role]);

  const handleLogout = () => {
    setIsOpen(false);
    navigate("/");
  };

  const handleOpenSettings = () => {
    setIsOpen(false);
    openSettings();
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
              {user.avatarInitial}
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
                onClick={() => setIsOpen(false)}
              >
                Profile
              </button>

              <button
                className="launcher-header-menu-item"
                onClick={handleOpenSettings}
              >
                Settings
              </button>

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