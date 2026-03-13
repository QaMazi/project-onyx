import { useUser } from "../context/UserContext";
import "./ProfileModal.css";

function ProfileModal({ open, onClose }) {
  const { user } = useUser();

  if (!open || !user) return null;

  const avatar = user.avatar || "";
  const username = user.username || "Unknown";
  const discordId = user.discordUserId || "Unknown";

  return (
    <div className="profile-modal-overlay">

      <div className="profile-modal">

        {/* HEADER */}
        <div className="profile-modal-header">
          <h2>Account Profile</h2>

          <button
            className="profile-close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* ACCOUNT SECTION */}
        <div className="profile-section">

          <h3>Discord Account</h3>

          <div className="profile-account">

            <div className="profile-avatar">

              {avatar ? (
                <img src={avatar} alt="avatar" />
              ) : (
                <div className="profile-avatar-placeholder">
                  {username.charAt(0).toUpperCase()}
                </div>
              )}

            </div>

            <div className="profile-account-info">

              <div>
                <span className="profile-label">Username</span>
                <span>{username}</span>
              </div>

              <div>
                <span className="profile-label">Discord ID</span>
                <span>{discordId}</span>
              </div>

              <div>
                <span className="profile-label">Role</span>
                <span>{user.role}</span>
              </div>

            </div>

          </div>

        </div>

        {/* CUSTOMIZATION */}
        <div className="profile-section">

          <h3>Launcher Customization</h3>

          <div className="profile-form">

            <label>Display Nickname</label>
            <input
              placeholder="Optional nickname"
            />

            <label>Avatar Override</label>
            <input
              placeholder="Image URL (optional)"
            />

          </div>

          <p className="profile-note">
            These changes only affect your launcher appearance and do not modify your Discord account.
          </p>

        </div>

        {/* STATS PLACEHOLDER */}
        <div className="profile-section">

          <h3>Player Stats</h3>

          <div className="profile-stats">

            <div>
              <span className="profile-label">Ranked Record</span>
              <span>—</span>
            </div>

            <div>
              <span className="profile-label">Series Joined</span>
              <span>—</span>
            </div>

            <div>
              <span className="profile-label">Decks Played</span>
              <span>—</span>
            </div>

            <div>
              <span className="profile-label">Win Rate</span>
              <span>—</span>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}

export default ProfileModal;