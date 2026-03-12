document.addEventListener("DOMContentLoaded", () => {
  const placementScores = {
    1: 10,
    2: 8,
    3: 6,
    4: 4,
    5: 2,
    6: 0
  };

  const defaultPlayers = [
    { id: "1", name: "QaMazi", wins: 0, points: 0, credits: 100, inventory: [] },
    { id: "2", name: "SKX", wins: 0, points: 0, credits: 100, inventory: [] },
    { id: "3", name: "Silverwolf", wins: 0, points: 0, credits: 100, inventory: [] },
    { id: "4", name: "Blu", wins: 0, points: 0, credits: 100, inventory: [] },
    { id: "5", name: "Nightmare", wins: 0, points: 0, credits: 100, inventory: [] },
    { id: "6", name: "N/A", wins: 0, points: 0, credits: 100, inventory: [] }
  ];

  const scoreboardStorageKey = "ygoProgressionPlayers";
  const scoreboardHistoryKey = "ygoProgressionPlacementHistory";

  const selects = [
    document.getElementById("placement1"),
    document.getElementById("placement2"),
    document.getElementById("placement3"),
    document.getElementById("placement4"),
    document.getElementById("placement5"),
    document.getElementById("placement6")
  ];

  const applyButton = document.getElementById("applyPlacementsButton");
  const undoButton = document.getElementById("undoPlacementsButton");
  const resetButton = document.getElementById("resetScoreboardButton");
  const messageBox = document.getElementById("scoreboardMessage");
  const tableBody = document.getElementById("scoreboardTableBody");

  function getPlayers() {
    const savedPlayers = localStorage.getItem(scoreboardStorageKey);
    if (savedPlayers) {
      return JSON.parse(savedPlayers);
    }

    localStorage.setItem(scoreboardStorageKey, JSON.stringify(defaultPlayers));
    return [...defaultPlayers];
  }

  function savePlayers(players) {
    localStorage.setItem(scoreboardStorageKey, JSON.stringify(players));
  }

  function getHistory() {
    const savedHistory = localStorage.getItem(scoreboardHistoryKey);
    return savedHistory ? JSON.parse(savedHistory) : [];
  }

  function saveHistory(history) {
    localStorage.setItem(scoreboardHistoryKey, JSON.stringify(history));
  }

  function renderScoreboard() {
    const players = getPlayers();
    if (!tableBody) return;

    tableBody.innerHTML = "";

    players.forEach((player) => {
      const row = document.createElement("tr");
      row.dataset.playerId = player.id;

      row.innerHTML = `
        <td>${player.name}</td>
        <td class="scoreboard-wins">${player.wins}</td>
        <td class="scoreboard-points">${player.points}</td>
      `;

      tableBody.appendChild(row);
    });
  }

  function clearMessage() {
    if (messageBox) {
      messageBox.textContent = "";
    }
  }

  function setMessage(message) {
    if (messageBox) {
      messageBox.textContent = message;
    }
  }

  function clearSelections() {
    selects.forEach((select) => {
      if (select) select.value = "";
    });
  }

  function getSelectedPlacements() {
    const placements = {};

    for (let i = 0; i < selects.length; i += 1) {
      const select = selects[i];
      const placement = i + 1;

      if (!select || !select.value) {
        return null;
      }

      placements[placement] = select.value;
    }

    return placements;
  }

  function hasDuplicatePlayers(placements) {
    const selectedPlayers = Object.values(placements);
    const uniquePlayers = new Set(selectedPlayers);
    return uniquePlayers.size !== selectedPlayers.length;
  }

  function applyPlacements() {
    clearMessage();

    const placements = getSelectedPlacements();
    if (!placements) {
      setMessage("Please select a player for all 6 placements.");
      return;
    }

    if (hasDuplicatePlayers(placements)) {
      setMessage("Each placement must have a different player.");
      return;
    }

    const players = getPlayers();
    const history = getHistory();

    const historyEntry = {
      placements,
      deltas: []
    };

    Object.entries(placements).forEach(([placement, playerId]) => {
      const scoreValue = placementScores[placement];
      const player = players.find((entry) => entry.id === playerId);

      if (!player) return;

      const winGain = Number(placement) === 1 ? 1 : 0;

      player.points += scoreValue;
      player.credits += scoreValue;
      player.wins += winGain;

      historyEntry.deltas.push({
        playerId,
        pointsAdded: scoreValue,
        creditsAdded: scoreValue,
        winsAdded: winGain
      });
    });

    history.push(historyEntry);
    savePlayers(players);
    saveHistory(history);
    renderScoreboard();
    clearSelections();
    setMessage("Placements applied successfully.");
  }

  function undoLastPlacement() {
    clearMessage();

    const history = getHistory();
    if (!history.length) {
      setMessage("There is no placement submission to undo.");
      return;
    }

    const players = getPlayers();
    const lastEntry = history.pop();

    lastEntry.deltas.forEach((delta) => {
      const player = players.find((entry) => entry.id === delta.playerId);
      if (!player) return;

      player.points -= delta.pointsAdded;
      player.credits -= delta.creditsAdded;
      player.wins -= delta.winsAdded;
    });

    savePlayers(players);
    saveHistory(history);
    renderScoreboard();
    setMessage("Last placement submission was undone.");
  }

  function resetScoreboard() {
    clearMessage();

    const players = getPlayers().map((player) => ({
      ...player,
      wins: 0,
      points: 0
    }));

    savePlayers(players);
    saveHistory([]);
    renderScoreboard();
    clearSelections();
    setMessage("Scoreboard has been reset.");
  }

  if (applyButton) {
    applyButton.addEventListener("click", applyPlacements);
  }

  if (undoButton) {
    undoButton.addEventListener("click", undoLastPlacement);
  }

  if (resetButton) {
    resetButton.addEventListener("click", resetScoreboard);
  }

  renderScoreboard();
});