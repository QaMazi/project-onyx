import { useEffect, useState } from "react";
import { useUser } from "../context/UserContext";
import { supabase } from "../lib/supabase";
import "./ProfileModal.css";

const MAX_FILE_SIZE_BYTES = 1024 * 1024;
const MAX_DIMENSION = 500;
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

function ProfileStatCard({ label, value }) {
  return (
    <div className="profile-stat-card">
      <span className="profile-stat-label">{label}</span>
      <span className="profile-stat-value">{value}</span>
    </div>
  );
}

function ProfileModal({ open, onClose }) {
  const { user, profile, updateOwnProfile, changeOwnPassword } = useUser();

  const [username, setUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [statusText, setStatusText] = useState("");
  const [statusType, setStatusType] = useState("info");
  const [avatarStatusText, setAvatarStatusText] = useState("");
  const [avatarStatusType, setAvatarStatusType] = useState("info");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    if (!open) return;

    setUsername(profile?.username || "");
    setNewPassword("");
    setStatusText("");
    setStatusType("info");
    setAvatarStatusText("");
    setAvatarStatusType("info");
  }, [open, profile]);

  if (!open || !user || !profile) return null;

  const avatar = profile.avatar_url || "";
  const displayUsername = profile.username || "Unknown";

  function setGeneralStatus(message, type = "info") {
    setStatusText(message);
    setStatusType(type);
  }

  function setAvatarStatus(message, type = "info") {
    setAvatarStatusText(message);
    setAvatarStatusType(type);
  }

  function loadImageDimensions(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        const width = image.width;
        const height = image.height;
        URL.revokeObjectURL(objectUrl);
        resolve({ width, height });
      };

      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not read image dimensions."));
      };

      image.src = objectUrl;
    });
  }

  async function handleAvatarUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setAvatarStatus("", "info");
    setGeneralStatus("", "info");
    setUploadingAvatar(true);

    try {
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        throw new Error("Avatar must be a PNG, JPG, or WEBP image.");
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        throw new Error("Avatar must be 1 MB or smaller.");
      }

      const { width, height } = await loadImageDimensions(file);

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        throw new Error("Avatar must be no larger than 500x500 pixels.");
      }

      const extension = file.name.includes(".")
        ? file.name.split(".").pop().toLowerCase()
        : file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
        ? "webp"
        : "jpg";

      const filePath = `${profile.id}/avatar.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("profile-avatars")
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type,
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from("profile-avatars")
        .getPublicUrl(filePath);

      const newAvatarUrl = publicUrlData?.publicUrl;

      if (!newAvatarUrl) {
        throw new Error("Failed to generate avatar URL.");
      }

      await updateOwnProfile({
        avatar_url: newAvatarUrl,
      });

      setAvatarStatus("Avatar updated successfully.", "success");
    } catch (error) {
      setAvatarStatus(error?.message || "Failed to upload avatar.", "error");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleRemoveAvatar() {
    setAvatarStatus("", "info");
    setGeneralStatus("", "info");
    setSavingProfile(true);

    try {
      await updateOwnProfile({
        avatar_url: "",
      });
      setAvatarStatus("Avatar removed.", "success");
    } catch (error) {
      setAvatarStatus(error?.message || "Failed to remove avatar.", "error");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleProfileSave(event) {
    event.preventDefault();
    setSavingProfile(true);
    setGeneralStatus("", "info");

    try {
      await updateOwnProfile({
        username,
      });
      setGeneralStatus("Profile updated.", "success");
    } catch (error) {
      setGeneralStatus(error?.message || "Failed to update profile.", "error");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordSave(event) {
    event.preventDefault();
    setSavingPassword(true);
    setGeneralStatus("", "info");

    try {
      await changeOwnPassword(newPassword);
      setNewPassword("");
      setGeneralStatus("Password updated.", "success");
    } catch (error) {
      setGeneralStatus(error?.message || "Failed to update password.", "error");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="profile-modal-overlay">
      <div className="profile-modal">
        <div className="profile-modal-header">
          <h2>Account Profile</h2>

          <button className="profile-close" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        <div className="profile-section">
          <h3>Account Identity</h3>

          <div className="profile-account profile-account-expanded">
            <div className="profile-avatar profile-avatar-large">
              {avatar ? (
                <img src={avatar} alt="avatar" />
              ) : (
                <div className="profile-avatar-placeholder">
                  {displayUsername.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            <div className="profile-account-info profile-account-info-expanded">
              <div>
                <span className="profile-label">Username</span>
                <span>{displayUsername}</span>
              </div>

              <div>
                <span className="profile-label">Role</span>
                <span>{user.effectiveRole}</span>
              </div>

              <div>
                <span className="profile-label">Global Role</span>
                <span>{profile.global_role}</span>
              </div>

              <div>
                <span className="profile-label">Login Email</span>
                <span>{profile.auth_email}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="profile-section">
          <h3>Profile Settings</h3>

          <form className="profile-form" onSubmit={handleProfileSave}>
            <label>Username</label>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Username"
            />

            <label>Avatar Upload</label>
            <div className="profile-avatar-upload-row">
              <label className="profile-upload-button" htmlFor="profile-avatar-upload">
                {uploadingAvatar ? "Uploading..." : "Upload Avatar"}
              </label>

              <input
                id="profile-avatar-upload"
                className="profile-upload-input"
                type="file"
                accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                onChange={handleAvatarUpload}
                disabled={uploadingAvatar}
              />

              <button
                type="button"
                className="profile-remove-avatar-button"
                onClick={handleRemoveAvatar}
                disabled={savingProfile || uploadingAvatar}
              >
                Remove Avatar
              </button>
            </div>

            <p className="profile-note">
              PNG, JPG, or WEBP only. Maximum 500×500 pixels and 1 MB.
            </p>

            {avatarStatusText ? (
              <p className={`profile-note profile-inline-status profile-inline-status-${avatarStatusType}`}>
                {avatarStatusText}
              </p>
            ) : null}

            <button type="submit" disabled={savingProfile || uploadingAvatar}>
              {savingProfile ? "Saving..." : "Save Profile"}
            </button>
          </form>
        </div>

        <div className="profile-section">
          <h3>Password</h3>

          <form className="profile-form" onSubmit={handlePasswordSave}>
            <label>New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="New password"
            />

            <button type="submit" disabled={savingPassword}>
              {savingPassword ? "Updating..." : "Update Password"}
            </button>
          </form>

          <p className="profile-note">
            Password changes update your account login directly.
          </p>
        </div>

        <div className="profile-section">
          <div className="profile-stats-section-header">
            <h3>Casual Stats</h3>
            <p className="profile-stats-subtext">
              Deck Game tracking placeholders for now.
            </p>
          </div>

          <div className="profile-stats-grid">
            <ProfileStatCard label="Decks Beaten" value="—" />
            <ProfileStatCard label="Win Rate" value="—" />
            <ProfileStatCard label="Decks Played" value="—" />
            <ProfileStatCard label="Last Played Date" value="—" />
          </div>
        </div>

        {user.isInActiveSeries ? (
          <div className="profile-section">
            <div className="profile-stats-section-header">
              <h3>Ranked Stats</h3>
              <p className="profile-stats-subtext">
                Progression-linked stats will update from the active series.
              </p>
            </div>

            <div className="profile-stats-grid">
              <ProfileStatCard label="Total 1st Place Wins" value="—" />
              <ProfileStatCard label="Current Scoreboard Points" value="—" />
              <ProfileStatCard label="Rounds Completed" value="—" />
              <ProfileStatCard label="Series Joined" value="—" />
            </div>
          </div>
        ) : null}

        {statusText ? (
          <p className={`profile-note profile-inline-status profile-inline-status-${statusType}`}>
            {statusText}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default ProfileModal;