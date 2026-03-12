document.addEventListener("DOMContentLoaded", () => {
  const FEATURE_TOKEN_COST = 20;
  const STEAL_CARD_COST = 20;

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

  const playerSelect = document.getElementById("storePlayerSelect");
  const creditDisplay = document.getElementById("storePlayerCredits");
  const messageBox = document.getElementById("storeMessage");
  const buyButtons = document.querySelectorAll(".store-buy-button");
  const specificKeyBoxSelect = document.getElementById("specificKeyBoxSelect");

  let creditAnimationFrame = null;

  function setMessage(message, isError = true) {
    if (!messageBox) return;
    messageBox.textContent = message;
    messageBox.style.color = isError ? "#ff7d7d" : "#79e18b";
  }

  function clearMessage() {
    if (!messageBox) return;
    messageBox.textContent = "";
  }

  function getSelectedPlayerId() {
    return playerSelect ? playerSelect.value : "1";
  }

  function getSelectedPlayer() {
    const players = getPlayers();
    return players.find((player) => player.id === getSelectedPlayerId());
  }

  function animateCreditDisplay(fromValue, toValue) {
    if (!creditDisplay) return;

    if (creditAnimationFrame) {
      cancelAnimationFrame(creditAnimationFrame);
      creditAnimationFrame = null;
    }

    const start = performance.now();
    const duration = 450;
    const difference = toValue - fromValue;

    function frame(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentValue = Math.round(fromValue + difference * eased);

      creditDisplay.textContent = currentValue;

      if (progress < 1) {
        creditAnimationFrame = requestAnimationFrame(frame);
      } else {
        creditDisplay.textContent = toValue;
        creditAnimationFrame = null;
      }
    }

    creditAnimationFrame = requestAnimationFrame(frame);
  }

  function updateCreditDisplay(animated = false, previousValue = null) {
    const selectedPlayer = getSelectedPlayer();
    if (!selectedPlayer || !creditDisplay) return;

    if (animated && typeof previousValue === "number") {
      animateCreditDisplay(previousValue, selectedPlayer.credits);
      return;
    }

    creditDisplay.textContent = selectedPlayer.credits;
  }

  function generateInventoryId() {
    return "item_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
  }

  function saveUpdatedPlayer(updatedPlayer, previousCredits = null, animateCredits = false) {
    const players = getPlayers().map((player) =>
      player.id === updatedPlayer.id ? updatedPlayer : player
    );
    savePlayers(players);
    updateCreditDisplay(animateCredits, previousCredits);
  }

  function canAfford(player, cost) {
    return player.credits >= cost;
  }

  function subtractCredits(player, amount) {
    player.credits = Math.max(0, player.credits - amount);
  }

  function addInventoryItem(player, item) {
    if (!Array.isArray(player.inventory)) {
      player.inventory = [];
    }

    player.inventory.push(item);
  }

  function getRandomAvailableBoxKey() {
    const randomIndex = Math.floor(Math.random() * LIVE_BOX_KEY_POOL.length);
    return LIVE_BOX_KEY_POOL[randomIndex];
  }

  function handleRandomKeyPurchase() {
    clearMessage();

    const player = getSelectedPlayer();
    if (!player) return;

    if (!canAfford(player, 20)) {
      setMessage("That player does not have enough credits for a Random Key.");
      return;
    }

    const previousCredits = player.credits;
    const grantedKey = getRandomAvailableBoxKey();

    subtractCredits(player, 20);

    addInventoryItem(player, {
      id: generateInventoryId(),
      type: "specific_key",
      label: grantedKey.label,
      boxId: grantedKey.boxId
    });

    saveUpdatedPlayer(player, previousCredits, true);
    setMessage(`${player.name} bought a Random Key and received ${grantedKey.label}.`, false);
  }

  function handleSpecificKeyPurchase() {
    clearMessage();

    const player = getSelectedPlayer();
    if (!player || !specificKeyBoxSelect) return;

    if (!canAfford(player, 40)) {
      setMessage("That player does not have enough credits for a Specific Key.");
      return;
    }

    const previousCredits = player.credits;
    const boxId = specificKeyBoxSelect.value;
    const keyLabel = specificKeyBoxMap[boxId] || "Specific Key";

    subtractCredits(player, 40);

    addInventoryItem(player, {
      id: generateInventoryId(),
      type: "specific_key",
      label: keyLabel,
      boxId
    });

    saveUpdatedPlayer(player, previousCredits, true);
    setMessage(`${player.name} bought ${keyLabel}.`, false);
  }

  function handleFeatureTokenPurchase() {
    clearMessage();

    const player = getSelectedPlayer();
    if (!player) return;

    if (!canAfford(player, FEATURE_TOKEN_COST)) {
      setMessage("That player does not have enough credits for a Feature Card Token.");
      return;
    }

    const previousCredits = player.credits;

    subtractCredits(player, FEATURE_TOKEN_COST);

    addInventoryItem(player, {
      id: generateInventoryId(),
      type: "feature_token",
      label: "Feature Card Token"
    });

    saveUpdatedPlayer(player, previousCredits, true);
    setMessage(`${player.name} bought a Feature Card Token.`, false);
  }

  function handleStealCardPurchase() {
    clearMessage();

    const player = getSelectedPlayer();
    if (!player) return;

    if (!canAfford(player, STEAL_CARD_COST)) {
      setMessage("That player does not have enough credits for Steal a Card.");
      return;
    }

    const previousCredits = player.credits;

    subtractCredits(player, STEAL_CARD_COST);
    saveUpdatedPlayer(player, previousCredits, true);
    setMessage(`${player.name} bought Steal a Card. No inventory item was added.`, false);
  }

  function handlePurchase(event) {
    const itemType = event.currentTarget.dataset.storeItem;

    switch (itemType) {
      case "random_key":
        handleRandomKeyPurchase();
        break;
      case "specific_key":
        handleSpecificKeyPurchase();
        break;
      case "feature_token":
        handleFeatureTokenPurchase();
        break;
      case "steal_card":
        handleStealCardPurchase();
        break;
      default:
        setMessage("Unknown store item.");
    }
  }

  if (playerSelect) {
    playerSelect.addEventListener("change", () => {
      clearMessage();
      updateCreditDisplay(false);
    });
  }

  buyButtons.forEach((button) => {
    button.addEventListener("click", handlePurchase);
  });

  updateCreditDisplay(false);
});