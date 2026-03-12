document.addEventListener("DOMContentLoaded", () => {
  const playerSelect = document.getElementById("adminPlayerSelect");
  const currentCredits = document.getElementById("adminCurrentCredits");
  const creditAmountInput = document.getElementById("adminCreditAmount");
  const inventorySelect = document.getElementById("adminInventorySelect");
  const importInput = document.getElementById("adminImportSaveInput");
  const messageBox = document.getElementById("adminMessage");

  const addCreditsBtn = document.getElementById("adminAddCreditsButton");
  const removeCreditsBtn = document.getElementById("adminRemoveCreditsButton");
  const setCreditsBtn = document.getElementById("adminSetCreditsButton");

  const giveRandomKeyBtn = document.getElementById("adminGiveRandomKeyButton");
  const giveSpecificKeyBtn = document.getElementById("adminGiveSpecificKeyButton");
  const specificKeySelect = document.getElementById("adminSpecificKeyBoxSelect");
  const giveFeatureTokenBtn = document.getElementById("adminGiveFeatureTokenButton");

  const removeInventoryItemBtn = document.getElementById("adminRemoveInventoryItemButton");
  const exportSaveBtn = document.getElementById("adminExportSaveButton");
  const importSaveBtn = document.getElementById("adminImportSaveButton");
  const resetAllDataBtn = document.getElementById("adminResetAllDataButton");

  const LIVE_BOX_KEY_POOL = [
    { boxId: "1", label: "Arcade Relics Key" },
    { boxId: "2", label: "Chaos Gamble Key" },
    { boxId: "3", label: "Vault of Supremacy Key" }
  ];

  const specificKeyBoxMap = {
    "1": "Arcade Relics Key",
    "2": "Chaos Gamble Key",
    "3": "Vault of Supremacy Key"
  };

  function setMessage(message, isError = true) {
    if (!messageBox) return;
    messageBox.textContent = message;
    messageBox.style.color = isError ? "#ff7d7d" : "#79e18b";
  }

  function clearMessage() {
    setMessage("");
  }

  function getSelectedPlayer() {
    if (!playerSelect) return null;
    return getPlayerById(playerSelect.value);
  }

  function refreshCredits() {
    const player = getSelectedPlayer();
    if (!currentCredits) return;
    currentCredits.textContent = player ? player.credits : "0";
  }

  function refreshInventorySelect() {
    if (!inventorySelect) return;

    const player = getSelectedPlayer();
    const inventory = Array.isArray(player?.inventory) ? player.inventory : [];

    if (!inventory.length) {
      inventorySelect.innerHTML = '<option value="">No items available</option>';
      return;
    }

    inventorySelect.innerHTML = inventory
      .map((item) => {
        const label = item.label || "Unnamed Item";
        const type = item.type || "item";
        return `<option value="${item.id}">${label} (${type})</option>`;
      })
      .join("");
  }

  function refreshAll() {
    refreshCredits();
    refreshInventorySelect();
  }

  function generateInventoryId() {
    return `item_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  }

  function mutateSelectedPlayer(mutator) {
    const player = getSelectedPlayer();
    if (!player) {
      setMessage("Select a player first.");
      return null;
    }

    const updated = updatePlayer(player.id, (draft) => {
      const clone = { ...draft, inventory: Array.isArray(draft.inventory) ? [...draft.inventory] : [] };
      return mutator(clone) || clone;
    });

    refreshAll();
    return updated;
  }

  function parseAmount() {
    const amount = Number(creditAmountInput?.value);
    if (!Number.isFinite(amount) || amount < 0) {
      setMessage("Enter a valid credit amount.");
      return null;
    }
    return amount;
  }

  function giveRandomKey() {
    clearMessage();
    const key = LIVE_BOX_KEY_POOL[Math.floor(Math.random() * LIVE_BOX_KEY_POOL.length)];

    const player = mutateSelectedPlayer((draft) => {
      draft.inventory.push({
        id: generateInventoryId(),
        type: "specific_key",
        label: key.label,
        boxId: key.boxId
      });
      return draft;
    });

    if (player) setMessage(`${player.name} received ${key.label}.`, false);
  }

  function giveSpecificKey() {
    clearMessage();
    const boxId = specificKeySelect?.value || "1";
    const label = specificKeyBoxMap[boxId] || "Box Key";

    const player = mutateSelectedPlayer((draft) => {
      draft.inventory.push({
        id: generateInventoryId(),
        type: "specific_key",
        label,
        boxId
      });
      return draft;
    });

    if (player) setMessage(`${player.name} received ${label}.`, false);
  }

  function giveFeatureToken() {
    clearMessage();
    const player = mutateSelectedPlayer((draft) => {
      draft.inventory.push({
        id: generateInventoryId(),
        type: "feature_token",
        label: "Feature Card Token"
      });
      return draft;
    });

    if (player) setMessage(`${player.name} received a Feature Card Token.`, false);
  }

  function addCredits() {
    clearMessage();
    const amount = parseAmount();
    if (amount === null) return;

    const player = mutateSelectedPlayer((draft) => {
      draft.credits = Math.min(1000, draft.credits + amount);
      return draft;
    });

    if (player) setMessage(`${player.name} received ${amount} credits.`, false);
  }

  function removeCredits() {
    clearMessage();
    const amount = parseAmount();
    if (amount === null) return;

    const player = mutateSelectedPlayer((draft) => {
      draft.credits = Math.max(0, draft.credits - amount);
      return draft;
    });

    if (player) setMessage(`${amount} credits removed from ${player.name}.`, false);
  }

  function setCredits() {
    clearMessage();
    const amount = parseAmount();
    if (amount === null) return;

    const player = mutateSelectedPlayer((draft) => {
      draft.credits = Math.min(1000, amount);
      return draft;
    });

    if (player) setMessage(`${player.name}'s credits were set to ${Math.min(1000, amount)}.`, false);
  }

  function removeInventoryItem() {
    clearMessage();
    const itemId = inventorySelect?.value;
    if (!itemId) {
      setMessage("No inventory item selected.");
      return;
    }

    const player = mutateSelectedPlayer((draft) => {
      draft.inventory = draft.inventory.filter((item) => item.id !== itemId);
      return draft;
    });

    if (player) setMessage(`Removed selected inventory item from ${player.name}.`, false);
  }

  function importSave() {
    clearMessage();
    const file = importInput?.files?.[0];
    if (!file) {
      setMessage("Choose a save file first.");
      return;
    }
    importSaveFromFile(file);
  }

  function resetData() {
    clearMessage();
    if (!window.confirm("Reset all local progression data? This cannot be undone.")) {
      return;
    }
    resetAllData();
  }

  playerSelect?.addEventListener("change", () => {
    clearMessage();
    refreshAll();
  });

  addCreditsBtn?.addEventListener("click", addCredits);
  removeCreditsBtn?.addEventListener("click", removeCredits);
  setCreditsBtn?.addEventListener("click", setCredits);
  giveRandomKeyBtn?.addEventListener("click", giveRandomKey);
  giveSpecificKeyBtn?.addEventListener("click", giveSpecificKey);
  giveFeatureTokenBtn?.addEventListener("click", giveFeatureToken);
  removeInventoryItemBtn?.addEventListener("click", removeInventoryItem);
  exportSaveBtn?.addEventListener("click", exportSaveToFile);
  importSaveBtn?.addEventListener("click", importSave);
  resetAllDataBtn?.addEventListener("click", resetData);

  refreshAll();
});
