document.addEventListener("DOMContentLoaded", async () => {
  initializeMenuButtons();
  initializeBackgroundVideo();

  try {
    await initializeProgressionApp();
  } catch (error) {
    console.error("initializeProgressionApp failed:", error);
  }

  initializePageIntro();
  await loadPatchNotes();
});

function initializeMenuButtons() {
  const menuButtons = document.querySelectorAll(".menu-button");

  menuButtons.forEach((button) => {
    button.addEventListener("click", handleMenuNavigation);
  });
}

function handleMenuNavigation(event) {
  const tag = event.currentTarget.tagName.toLowerCase();
  const targetUrl = event.currentTarget.getAttribute("href");

  if (tag !== "a" || !targetUrl || targetUrl === "#") {
    return;
  }

  if (event.currentTarget.classList.contains("is-locked")) {
    event.preventDefault();
    return;
  }

  event.preventDefault();
  document.body.classList.add("page-fade-out");

  setTimeout(() => {
    window.location.href = targetUrl;
  }, 250);
}

function initializeBackgroundVideo() {
  const bgVideo = document.getElementById("bgVideo");
  if (!bgVideo) return;

  bgVideo.play().catch(() => {
    // autoplay may be blocked
  });
}

function initializePageIntro() {
  document.body.classList.add("page-loaded");
}

/* =========================
   PATCH NOTES / VERSION TAG
========================= */

async function loadPatchNotes() {
  const container = document.getElementById("updatesList");
  const versionTag = document.querySelector(".version-tag");

  try {
    const response = await fetch(getPatchNotesPath(), {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Patch notes request failed: ${response.status}`);
    }

    const data = await response.json();
    const patches = Array.isArray(data.patches) ? data.patches : [];

    if (versionTag && patches[0]?.version) {
      versionTag.textContent = patches[0].version;
    }

    if (!container) return;

    if (!patches.length) {
      container.innerHTML = `
        <div class="update-error">
          No patch notes available.
        </div>
      `;
      return;
    }

    renderPatchNotes(patches);
  } catch (err) {
    console.error("Patch notes failed to load:", err);

    if (container) {
      container.innerHTML = `
        <div class="update-error">
          Failed to load patch history.
        </div>
      `;
    }
  }
}

function getPatchNotesPath() {
  const path = window.location.pathname;
  return path.includes("/pages/") ? "../data/patch-notes.json" : "data/patch-notes.json";
}

function renderPatchNotes(patches) {
  const container = document.getElementById("updatesList");
  if (!container) return;

  container.innerHTML = patches
    .map((patch, index) => {
      const isCurrent = index === 0;
      const badgeText = isCurrent ? "Current" : (patch.badge || "Previous");
      const badgeClass = isCurrent
        ? "update-badge update-badge-live"
        : "update-badge";

      const safeVersion = patch.version || "Unknown Version";
      const safeTitle = patch.title || "Untitled Patch";
      const points = Array.isArray(patch.points) ? patch.points : [];

      const pointsHtml = points.map((point) => `<li>${escapeHtml(point)}</li>`).join("");

      return `
        <article class="update-card ${isCurrent ? "update-expanded update-card-current" : "update-collapsed"}">
          <div class="update-timeline-rail"></div>

          <div class="update-card-top update-toggle" role="button" tabindex="0" aria-expanded="${isCurrent ? "true" : "false"}">
            <div class="update-left-meta">
              <span class="update-version">${escapeHtml(safeVersion)}</span>
              <span class="update-dot"></span>
            </div>

            <div class="update-top-right">
              <span class="${badgeClass}">
                ${escapeHtml(badgeText)}
              </span>

              <span class="update-expand-indicator">
                ${isCurrent ? "–" : "+"}
              </span>
            </div>
          </div>

          <div class="update-body">
            <h3 class="update-title">${escapeHtml(safeTitle)}</h3>

            <ul class="update-points">
              ${pointsHtml}
            </ul>
          </div>
        </article>
      `;
    })
    .join("");

  initializePatchToggles();
}

function initializePatchToggles() {
  const cards = document.querySelectorAll(".update-card");

  cards.forEach((card) => {
    const toggle = card.querySelector(".update-toggle");
    const indicator = card.querySelector(".update-expand-indicator");

    if (!toggle) return;

    const flipCard = () => {
      const expanded = card.classList.contains("update-expanded");

      card.classList.toggle("update-expanded", !expanded);
      card.classList.toggle("update-collapsed", expanded);

      toggle.setAttribute("aria-expanded", expanded ? "false" : "true");

      if (indicator) {
        indicator.textContent = expanded ? "+" : "–";
      }
    };

    toggle.addEventListener("click", flipCard);

    toggle.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        flipCard();
      }
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================
   PROGRESSION APP
========================= */

async function initializeProgressionApp() {
  if (!window.ggAuth || !window.db) {
    return;
  }

  const authGate = document.getElementById("authGate");
  const loginButton = document.getElementById("discordLoginButton");
  const logoutButton = document.getElementById("logoutButton");

  loginButton?.addEventListener("click", async () => {
    await window.ggAuth.signInWithDiscord();
  });

  logoutButton?.addEventListener("click", async () => {
    await window.ggAuth.signOut();
  });

  const authSession = await window.ggAuth.getSession();

  window.progressionState = {
    user: null,
    session: null,
    playerState: null,
    sessionPlayers: [],
    activityFeed: [],
    contentState: {
      packs: [],
      promoBoxes: [],
      featureCards: [],
      unlockedPacks: [],
      unlockedPromoBoxes: [],
      unlockedFeatureCards: []
    },
    authSession,
    lobbyUnsubscribe: null,
    activityUnsubscribe: null
  };

  if (!authSession) {
    setAccountPanelGuest();
    return;
  }

  const user = await window.ggAuth.ensureUserRecord(authSession);
  if (!user) {
    console.warn("No user record could be created/loaded.");
    return;
  }

  window.progressionState.user = user;

  const activeSession = await window.db.getActiveSession();
  window.progressionState.session = activeSession;

  updateAccountPanel(user, authSession);
  authGate?.classList.add("auth-hidden");

  if (!activeSession) {
    return;
  }

  await refreshProgressionState();

  window.progressionState.lobbyUnsubscribe = window.db.subscribeToLobby(
    activeSession.id,
    async () => {
      try {
        window.progressionState.sessionPlayers =
          await window.db.loadSessionPlayers(activeSession.id);
      } catch (error) {
        console.error("Realtime lobby refresh failed:", error);
      }
    }
  );

  window.progressionState.activityUnsubscribe = window.db.subscribeToActivity(
    activeSession.id,
    async () => {
      try {
        window.progressionState.activityFeed =
          await window.db.getSessionActivity(activeSession.id, 20);
      } catch (error) {
        console.error("Realtime activity refresh failed:", error);
      }
    }
  );
}

async function refreshProgressionState() {
  const session = window.progressionState?.session;
  if (!session || !window.db) return;

  const [playerState, sessionPlayers, activityFeed, contentState] =
    await Promise.all([
      window.db.getMyPlayerState(session.id),
      window.db.loadSessionPlayers(session.id),
      window.db.getSessionActivity(session.id, 20),
      window.db.getSessionContentState(session.id)
    ]);

  window.progressionState.playerState = playerState;
  window.progressionState.sessionPlayers = sessionPlayers;
  window.progressionState.activityFeed = activityFeed;
  window.progressionState.contentState = contentState;

  applyLockStateToMenu(contentState);
}

function updateAccountPanel(userRecord, authSession) {
  const authUserInfo = document.getElementById("authUserInfo");
  const accountAvatar = document.getElementById("accountAvatar");
  const accountUsername = document.getElementById("accountUsername");
  const accountRole = document.getElementById("accountRole");
  const accountStatus = document.getElementById("accountStatus");
  const accountDiscordId = document.getElementById("accountDiscordId");

  const fallbackUser = authSession?.user;

  const username =
    userRecord?.username ||
    fallbackUser?.user_metadata?.preferred_username ||
    fallbackUser?.email ||
    "Unknown User";

  const avatar =
    userRecord?.avatar ||
    fallbackUser?.user_metadata?.avatar_url ||
    fallbackUser?.user_metadata?.picture ||
    "";

  const role = userRecord?.role || "player";
  const discordId = userRecord?.discord_id || "---";

  if (authUserInfo) {
    authUserInfo.textContent = `Logged in as ${username} (${role})`;
  }

  if (accountUsername) accountUsername.textContent = username;
  if (accountRole) accountRole.textContent = role;
  if (accountStatus) accountStatus.textContent = "Online";
  if (accountDiscordId) accountDiscordId.textContent = discordId;
  if (accountAvatar && avatar) accountAvatar.src = avatar;
}

function setAccountPanelGuest() {
  const accountUsername = document.getElementById("accountUsername");
  const accountRole = document.getElementById("accountRole");
  const accountStatus = document.getElementById("accountStatus");
  const accountDiscordId = document.getElementById("accountDiscordId");

  if (accountUsername) accountUsername.textContent = "Not Logged In";
  if (accountRole) accountRole.textContent = "Guest";
  if (accountStatus) accountStatus.textContent = "Offline";
  if (accountDiscordId) accountDiscordId.textContent = "---";
}

function setMenuButtonDisabled(anchor, disabled, labelSuffix = "") {
  if (!anchor) return;

  if (disabled) {
    anchor.dataset.locked = "true";
    anchor.setAttribute("aria-disabled", "true");
    anchor.classList.add("is-locked");
    anchor.title = labelSuffix || "Locked for this session";
  } else {
    anchor.dataset.locked = "false";
    anchor.removeAttribute("aria-disabled");
    anchor.classList.remove("is-locked");
    anchor.removeAttribute("title");
  }
}

function applyLockStateToMenu(contentState) {
  const promoLink = document.querySelector('a[href="pages/promo-boxes.html"]');
  const featureLink = document.querySelector('a[href="pages/feature-cards.html"]');
  const storeLink = document.querySelector('a[href="pages/store.html"]');

  const hasUnlockedPromo = (contentState?.unlockedPromoBoxes || []).length > 0;
  const hasUnlockedFeature = (contentState?.unlockedFeatureCards || []).length > 0;
  const hasUnlockedPacks = (contentState?.unlockedPacks || []).length > 0;

  setMenuButtonDisabled(promoLink, !hasUnlockedPromo, "No promo boxes unlocked in this session");
  setMenuButtonDisabled(featureLink, !hasUnlockedFeature, "No feature cards unlocked in this session");
  setMenuButtonDisabled(storeLink, !hasUnlockedPacks, "No packs unlocked in this session");
}

window.progressionApp = {
  async refresh() {
    if (!window.db) return window.progressionState;

    const session = await window.db.getActiveSession();
    window.progressionState.session = session;

    if (!session) {
      window.progressionState.playerState = null;
      window.progressionState.sessionPlayers = [];
      window.progressionState.activityFeed = [];
      return window.progressionState;
    }

    await refreshProgressionState();
    return window.progressionState;
  },

  async joinGame() {
    const session = window.progressionState?.session;
    if (!session) throw new Error("No active session found.");

    await window.db.joinSessionLobby(session.id);
    await refreshProgressionState();
    return window.progressionState;
  },

  async leaveGame() {
    const session = window.progressionState?.session;
    if (!session) throw new Error("No active session found.");

    await window.db.leaveSessionLobby(session.id);
    await refreshProgressionState();
    return window.progressionState;
  },

  async toggleReady(nextReady = null) {
    const session = window.progressionState?.session;
    if (!session) throw new Error("No active session found.");

    await window.db.toggleReady(session.id, nextReady);
    await refreshProgressionState();
    return window.progressionState;
  },

  async createSession(name, description = "", maxPlayers = 6) {
    const session = await window.db.createNewSession({
      name,
      description,
      maxPlayers
    });

    window.progressionState.session = session;
    await refreshProgressionState();
    return window.progressionState;
  },

  async switchSession(sessionId) {
    const session = await window.db.switchActiveSession(sessionId);
    window.progressionState.session = session;
    await refreshProgressionState();
    return window.progressionState;
  },

  async requireUnlocked(type, idOrCode) {
    const session = window.progressionState?.session;
    if (!session) throw new Error("No active session found.");

    return window.db.requireUnlocked(type, session.id, idOrCode);
  }
};
