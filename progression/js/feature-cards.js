document.addEventListener("DOMContentLoaded", () => {
  const playerSelect = document.getElementById("featurePlayerSelect");
  const modeSelect = document.getElementById("featureModeSelect");
  const rerollsInput = document.getElementById("featureRerollsInput");
  const tokenCountDisplay = document.getElementById("featureTokenCount");
  const rerollsLeftDisplay = document.getElementById("featureRerollsLeft");
  const messageBox = document.getElementById("featureMessage");
  const currentCardWrap = document.getElementById("featureCurrentCard");
  const recentPullsWrap = document.getElementById("featureRecentPulls");
  const categoryButtons = document.querySelectorAll(".feature-category-button");
  const rollAgainButton = document.getElementById("featureRollAgainButton");
  const keepCardButton = document.getElementById("featureKeepCardButton");

  const API_BASE = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
  const categoryTypeMap = {
    monster: [
      "Normal Monster",
      "Effect Monster",
      "Flip Effect Monster",
      "Gemini Monster",
      "Spirit Monster",
      "Toon Monster",
      "Tuner Monster",
      "Union Effect Monster",
      "Ritual Monster",
      "Ritual Effect Monster",
      "Pendulum Effect Monster",
      "Pendulum Normal Monster",
      "Pendulum Tuner Effect Monster",
      "Pendulum Flip Effect Monster",
      "Pendulum Effect Ritual Monster",
      "Pendulum Effect Fusion Monster",
      "Pendulum Effect Synchro Monster",
      "XYZ Monster",
      "XYZ Pendulum Effect Monster",
      "Synchro Monster",
      "Synchro Tuner Monster",
      "Fusion Monster",
      "Token"
    ],
    spell: ["Spell Card"],
    trap: ["Trap Card"],
    extra: ["Fusion Monster", "Synchro Monster", "Synchro Tuner Monster", "XYZ Monster", "XYZ Pendulum Effect Monster", "Link Monster", "Pendulum Effect Fusion Monster", "Pendulum Effect Synchro Monster"]
  };

  const state = {
    currentCategory: "",
    currentCard: null,
    rerollsLeft: 0,
    sessionStarted: false,
    tokenModeTokenReserved: false
  };

  function setMessage(message, isError = true) {
    if (!messageBox) return;
    messageBox.textContent = message;
    messageBox.style.color = isError ? "#ff7d7d" : "#79e18b";
  }

  function clearMessage() {
    setMessage("", true);
  }

  function getSelectedPlayer() {
    return getPlayerById(playerSelect.value);
  }

  function countFeatureTokens(player) {
    if (!player || !Array.isArray(player.inventory)) return 0;
    return player.inventory.filter((item) => item.type === "feature_token").length;
  }

  function updateStatusDisplay() {
    const player = getSelectedPlayer();
    tokenCountDisplay.textContent = player ? countFeatureTokens(player) : 0;
    rerollsLeftDisplay.textContent = state.rerollsLeft;
  }

  function resetSession() {
    state.currentCategory = "";
    state.currentCard = null;
    state.rerollsLeft = Number(rerollsInput.value) || 0;
    state.sessionStarted = false;
    state.tokenModeTokenReserved = false;
    renderCurrentCard();
    updateActionButtons();
    updateStatusDisplay();
    clearMessage();
  }

  function updateActionButtons() {
    const hasCard = Boolean(state.currentCard);
    rollAgainButton.disabled = !hasCard || state.rerollsLeft <= 0;
    keepCardButton.disabled = !hasCard;
  }

  function renderCurrentCard() {
    if (!currentCardWrap) return;

    if (!state.currentCard) {
      currentCardWrap.innerHTML = `
        <div class="feature-card-placeholder">
          Choose a category to begin rolling.
        </div>
      `;
      return;
    }

    const card = state.currentCard;
    currentCardWrap.innerHTML = `
      <div class="feature-card-display">
        <div class="feature-card-image-wrap">
          <img
            class="feature-card-image"
            src="${card.cardImage}"
            alt="${escapeHtml(card.cardName)}"
          />
        </div>

        <div class="feature-card-details">
          <h4>${escapeHtml(card.cardName)}</h4>
          <div class="feature-card-meta">
            ${escapeHtml(card.categoryLabel)} • ${escapeHtml(card.type || "Unknown Type")}
          </div>
          <div class="feature-card-desc">${escapeHtml(card.description || "No description available.")}</div>
        </div>
      </div>
    `;
  }

  function renderRecentPulls() {
    if (!recentPullsWrap) return;

    const pulls = getFeatureRecentPulls();

    if (!pulls.length) {
      recentPullsWrap.innerHTML = `<p class="feature-recent-empty">No recent feature pulls yet.</p>`;
      return;
    }

    recentPullsWrap.innerHTML = pulls
      .map(
        (pull) => `
          <article class="feature-recent-item">
            <img
              class="feature-recent-thumb"
              src="${pull.cardImage || ""}"
              alt="${escapeHtml(pull.cardName || "Feature Pull")}"
            />
            <div>
              <div class="feature-recent-name">${escapeHtml(pull.cardName || "Unknown Card")}</div>
              <div class="feature-recent-meta">
                ${escapeHtml(pull.category || "")}${pull.type ? ` • ${escapeHtml(pull.type)}` : ""}
              </div>
              <div class="feature-recent-player">${escapeHtml(pull.playerName || "Unknown Player")}</div>
            </div>
          </article>
        `
      )
      .join("");
  }

  async function fetchRandomCard(categoryKey) {
    const types = categoryTypeMap[categoryKey];
    if (!types) {
      throw new Error("Invalid category selected.");
    }

    const typeQuery = encodeURIComponent(types.join(","));

    // First request: get total rows for the chosen category.
    const countResponse = await fetch(`${API_BASE}?type=${typeQuery}&num=1&offset=0`);
    if (!countResponse.ok) {
      throw new Error("Failed to contact the card API.");
    }

    const countData = await countResponse.json();
    const totalRows = Number(countData?.meta?.total_rows || 0);

    if (!totalRows) {
      throw new Error("No cards were returned for that category.");
    }

    const randomOffset = Math.floor(Math.random() * totalRows);

    // Second request: get one random card at that offset.
    const cardResponse = await fetch(`${API_BASE}?type=${typeQuery}&num=1&offset=${randomOffset}`);
    if (!cardResponse.ok) {
      throw new Error("Failed to load a random card.");
    }

    const cardData = await cardResponse.json();
    const card = Array.isArray(cardData.data) ? cardData.data[0] : null;

    if (!card) {
      throw new Error("No card data was returned.");
    }

    const imageObject = Array.isArray(card.card_images) ? card.card_images[0] : null;

    return {
      cardName: card.name || "Unknown Card",
      cardImage: imageObject?.image_url_small || imageObject?.image_url || "",
      type: card.type || "",
      description: card.desc || "",
      category: categoryKey,
      categoryLabel: getCategoryLabel(categoryKey)
    };
  }

  async function startOrContinueRoll(categoryKey, isReroll = false) {
    clearMessage();

    const player = getSelectedPlayer();
    if (!player) {
      setMessage("Please choose a player.");
      return;
    }

    const mode = modeSelect.value;

    if (!state.sessionStarted) {
      state.currentCategory = categoryKey;
      state.rerollsLeft = Math.max(0, Number(rerollsInput.value) || 0);
      state.sessionStarted = true;
    } else if (categoryKey !== state.currentCategory) {
      setMessage("Finish or reset the current pull before changing categories.");
      return;
    }

    if (mode === "token" && countFeatureTokens(player) <= 0) {
      setMessage("That player does not have a Feature Card Token.");
      resetSession();
      return;
    }

    if (isReroll && state.rerollsLeft <= 0) {
      setMessage("No rerolls remain.");
      updateActionButtons();
      return;
    }

    try {
      setMessage("Rolling...", false);

      const pulledCard = await fetchRandomCard(categoryKey);
      state.currentCard = {
        ...pulledCard,
        playerId: player.id,
        playerName: player.name
      };

      if (isReroll) {
        state.rerollsLeft -= 1;
      }

      renderCurrentCard();
      updateStatusDisplay();
      updateActionButtons();

      if (state.rerollsLeft <= 0) {
        finalizeCurrentCard();
        return;
      }

      setMessage("Card rolled. Keep it or reroll.", false);
    } catch (error) {
      setMessage(error.message || "Something went wrong while rolling.");
    }
  }

  function consumeOneFeatureToken(playerId) {
    updatePlayer(playerId, (player) => {
      const inventory = Array.isArray(player.inventory) ? [...player.inventory] : [];
      const tokenIndex = inventory.findIndex((item) => item.type === "feature_token");

      if (tokenIndex >= 0) {
        inventory.splice(tokenIndex, 1);
      }

      player.inventory = inventory;
      return player;
    });
  }

  function finalizeCurrentCard() {
    if (!state.currentCard) return;

    const mode = modeSelect.value;

    if (mode === "token") {
      const player = getSelectedPlayer();
      if (!player || countFeatureTokens(player) <= 0) {
        setMessage("No Feature Card Token was available to consume.");
        return;
      }

      consumeOneFeatureToken(player.id);
    }

    addFeatureRecentPull({
      playerId: state.currentCard.playerId,
      playerName: state.currentCard.playerName,
      cardName: state.currentCard.cardName,
      cardImage: state.currentCard.cardImage,
      category: state.currentCard.categoryLabel,
      type: state.currentCard.type,
      description: state.currentCard.description
    });

    renderRecentPulls();
    setMessage(
      `${state.currentCard.playerName} kept ${state.currentCard.cardName}.`,
      false
    );

    state.rerollsLeft = 0;
    updateStatusDisplay();
    updateActionButtons();
  }

  function getCategoryLabel(categoryKey) {
    switch (categoryKey) {
      case "monster":
        return "Monster";
      case "spell":
        return "Spell";
      case "trap":
        return "Trap";
      case "extra":
        return "Extra Deck";
      default:
        return "Unknown";
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  categoryButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const selectedCategory = button.dataset.category;
      if (state.sessionStarted && state.currentCard) {
        setMessage("Use Keep Card or Roll Again for the current session, or change mode/player to reset.");
        return;
      }

      startOrContinueRoll(selectedCategory, false);
    });
  });

  rollAgainButton.addEventListener("click", () => {
    if (!state.currentCategory) {
      setMessage("Choose a category first.");
      return;
    }

    startOrContinueRoll(state.currentCategory, true);
  });

  keepCardButton.addEventListener("click", () => {
    finalizeCurrentCard();
  });

  playerSelect.addEventListener("change", resetSession);
  modeSelect.addEventListener("change", resetSession);
  rerollsInput.addEventListener("change", resetSession);

  renderRecentPulls();
  resetSession();
});