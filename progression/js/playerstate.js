const PLAYER_STORAGE_KEY = "ygoProgressionPlayers";
const HISTORY_STORAGE_KEY = "ygoProgressionPlacementHistory";
const FEATURE_PULLS_STORAGE_KEY = "ygoProgressionFeatureRecentPulls";
const PROMO_PULLS_STORAGE_KEY = "ygoProgressionPromoRecentPulls";

const DEFAULT_PLAYERS = [
  { id: "1", name: "QaMazi", wins: 0, points: 0, credits: 100, inventory: [] },
  { id: "2", name: "SKX", wins: 0, points: 0, credits: 100, inventory: [] },
  { id: "3", name: "Silverwolf", wins: 0, points: 0, credits: 100, inventory: [] },
  { id: "4", name: "Blu", wins: 0, points: 0, credits: 100, inventory: [] },
  { id: "5", name: "Nightmare", wins: 0, points: 0, credits: 100, inventory: [] },
  { id: "6", name: "N/A", wins: 0, points: 0, credits: 100, inventory: [] }
];

/* -------------------------
   Players
------------------------- */

function getPlayers() {
  const stored = localStorage.getItem(PLAYER_STORAGE_KEY);

  if (!stored) {
    localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(DEFAULT_PLAYERS));
    return structuredClone(DEFAULT_PLAYERS);
  }

  return JSON.parse(stored);
}

function savePlayers(players) {
  localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(players));
}

function getPlayerById(playerId) {
  return getPlayers().find((player) => player.id === String(playerId)) || null;
}

function updatePlayer(playerId, updater) {
  const players = getPlayers();
  const updatedPlayers = players.map((player) => {
    if (player.id !== String(playerId)) return player;

    const updatedPlayer = typeof updater === "function" ? updater({ ...player }) : player;
    return updatedPlayer;
  });

  savePlayers(updatedPlayers);
  return updatedPlayers.find((player) => player.id === String(playerId)) || null;
}

/* -------------------------
   Placement History
------------------------- */

function getPlacementHistory() {
  const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

function savePlacementHistory(history) {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
}

/* -------------------------
   Recent Feature Pulls
------------------------- */

function getFeatureRecentPulls() {
  const stored = localStorage.getItem(FEATURE_PULLS_STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

function saveFeatureRecentPulls(pulls) {
  localStorage.setItem(FEATURE_PULLS_STORAGE_KEY, JSON.stringify(pulls));
}

function addFeatureRecentPull(pullData) {
  const pulls = getFeatureRecentPulls();

  const entry = {
    id: createSavedEntryId("feature"),
    playerId: pullData.playerId || "",
    playerName: pullData.playerName || "Unknown Player",
    cardName: pullData.cardName || "Unknown Card",
    cardImage: pullData.cardImage || "",
    category: pullData.category || "",
    type: pullData.type || "",
    description: pullData.description || "",
    savedAt: pullData.savedAt || new Date().toISOString()
  };

  pulls.unshift(entry);
  const trimmedPulls = pulls.slice(0, 5);

  saveFeatureRecentPulls(trimmedPulls);
  return trimmedPulls;
}

function clearFeatureRecentPulls() {
  localStorage.removeItem(FEATURE_PULLS_STORAGE_KEY);
}

/* -------------------------
   Recent Promo Pulls
------------------------- */

function getPromoRecentPulls() {
  const stored = localStorage.getItem(PROMO_PULLS_STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

function savePromoRecentPulls(pulls) {
  localStorage.setItem(PROMO_PULLS_STORAGE_KEY, JSON.stringify(pulls));
}

function addPromoRecentPull(pullData) {
  const pulls = getPromoRecentPulls();

  const entry = {
    id: createSavedEntryId("promo"),
    playerId: pullData.playerId || "",
    playerName: pullData.playerName || "Unknown Player",
    cardName: pullData.cardName || "Unknown Card",
    cardImage: pullData.cardImage || "",
    rarity: pullData.rarity || "",
    boxId: pullData.boxId || "",
    boxName: pullData.boxName || "",
    savedAt: pullData.savedAt || new Date().toISOString()
  };

  pulls.unshift(entry);
  const trimmedPulls = pulls.slice(0, 5);

  savePromoRecentPulls(trimmedPulls);
  return trimmedPulls;
}

function clearPromoRecentPulls() {
  localStorage.removeItem(PROMO_PULLS_STORAGE_KEY);
}

/* -------------------------
   Full Save / Load
------------------------- */

function getFullSaveData() {
  return {
    players: getPlayers(),
    placementHistory: getPlacementHistory(),
    featureRecentPulls: getFeatureRecentPulls(),
    promoRecentPulls: getPromoRecentPulls()
  };
}

function loadFullSaveData(data) {
  if (
    !data ||
    !Array.isArray(data.players) ||
    !Array.isArray(data.placementHistory) ||
    !Array.isArray(data.featureRecentPulls || []) ||
    !Array.isArray(data.promoRecentPulls || [])
  ) {
    alert("Invalid save file.");
    return;
  }

  localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(data.players));
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(data.placementHistory));
  localStorage.setItem(
    FEATURE_PULLS_STORAGE_KEY,
    JSON.stringify(data.featureRecentPulls || [])
  );
  localStorage.setItem(
    PROMO_PULLS_STORAGE_KEY,
    JSON.stringify(data.promoRecentPulls || [])
  );

  alert("Save data imported successfully.");
  location.reload();
}

function resetAllData() {
  localStorage.removeItem(PLAYER_STORAGE_KEY);
  localStorage.removeItem(HISTORY_STORAGE_KEY);
  localStorage.removeItem(FEATURE_PULLS_STORAGE_KEY);
  localStorage.removeItem(PROMO_PULLS_STORAGE_KEY);
  location.reload();
}

/* -------------------------
   Export Save
------------------------- */

function exportSaveToFile() {
  const saveData = getFullSaveData();
  const now = new Date();

  const timestamp =
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0") +
    "_" +
    String(now.getHours()).padStart(2, "0") +
    "-" +
    String(now.getMinutes()).padStart(2, "0") +
    "-" +
    String(now.getSeconds()).padStart(2, "0");

  const fileName = `ygo-progression-save-${timestamp}.json`;
  const dataStr = JSON.stringify(saveData, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(link.href);
}

/* -------------------------
   Import Save
------------------------- */

function importSaveFromFile(file) {
  const reader = new FileReader();

  reader.onload = function (event) {
    try {
      const data = JSON.parse(event.target.result);
      loadFullSaveData(data);
    } catch (error) {
      alert("Invalid save file.");
    }
  };

  reader.readAsText(file);
}

/* -------------------------
   Helpers
------------------------- */

function createSavedEntryId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}