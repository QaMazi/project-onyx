const rarityTable = [
  { name: "Common", chance: 50 },
  { name: "Rare", chance: 25 },
  { name: "Super Rare", chance: 12 },
  { name: "Ultra Rare", chance: 7 },
  { name: "Secret Rare", chance: 4 },
  { name: "Gold Rare", chance: 1.5 },
  { name: "Prismatic Rare", chance: 0.4 },
  { name: "Ghost Rare", chance: 0.1 }
];

const secretSectionRarityTable = [
  { name: "Common", chance: 50 },
  { name: "Rare", chance: 25 },
  { name: "Super Rare", chance: 12 },
  { name: "Ultra Rare", chance: 7 },
  { name: "Secret Rare", chance: 4 },
  { name: "Gold Rare", chance: 1.5 },
  { name: "Prismatic Rare", chance: 0.4 },
  { name: "Ghost Rare", chance: 0.1 }
];

/* =========================
   SHARED PLAYER STATE
   ========================= */

const PLAYER_STORAGE_KEY = "ygoProgressionPlayers";

const userToPlayerNameMap = {
  qamazi: "QaMazi",
  skx: "SKX",
  silverwolf: "Silverwolf",
  blu: "Blu",
  nightmare: "Nightmare",
  na: "N/A"
};

function getSharedPlayers() {
  const stored = localStorage.getItem(PLAYER_STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

function saveSharedPlayers(players) {
  localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(players));
}

function getPlayerByName(name) {
  return getSharedPlayers().find((player) => player.name === name) || null;
}

function updatePlayerByName(name, updater) {
  const players = getSharedPlayers();

  const updatedPlayers = players.map((player) => {
    if (player.name !== name) return player;

    const safePlayer = {
      ...player,
      inventory: Array.isArray(player.inventory) ? [...player.inventory] : []
    };

    return updater(safePlayer);
  });

  saveSharedPlayers(updatedPlayers);
  return updatedPlayers.find((player) => player.name === name) || null;
}

/* =========================
   PATH HELPERS
   ========================= */

function normalizeImagePath(path) {
  if (!path) return "";
  if (path.startsWith("../assets/")) return path;
  if (path.startsWith("assets/")) return `../${path}`;
  if (path.startsWith("images/")) return `../assets/${path}`;
  return path;
}

function normalizeAudioPath(path) {
  if (!path) return "";
  if (path.startsWith("../assets/")) return path;
  if (path.startsWith("assets/")) return `../${path}`;
  if (path.startsWith("sounds/")) return `../assets/audio/${path.replace("sounds/", "")}`;
  return path;
}

function getCardBackPath() {
  return "../assets/images/card-back.png";
}

/* =========================
   BOX SELECTOR DATA
   ========================= */

const allBoxes = [
  {
    ...window.promoBox1,
    releaseDate: "03/07/2026",
    edition: "Limited Run",
    typeLabel: "Defined List"
  },
  {
    ...window.promoBox2,
    releaseDate: "03/07/2026",
    edition: "Limited Run",
    typeLabel: "Curated List"
  },
  {
    ...window.promoBox3,
    releaseDate: "03/07/2026",
    edition: "Limited Run",
    typeLabel: "Defined Run"
  },
  {
    id: "coming-soon-4",
    name: "Vault of Supremacy II",
    fullName: "Vault of Supremacy II",
    subtitle: "Promotional Card Box",
    description:
      "The next chapter of the Supremacy series. Another collection of powerful Super Rare and higher cards from across the Duel Monsters era.",
    releaseDate: "Coming Soon",
    edition: "Limited Run",
    typeLabel: "Defined List",
    cardCountLabel: "???",
    boxImage: "../assets/images/boxes/Coming Soon 4.png",
    imageBase: "",
    cards: [],
    comingSoon: true
  },
  {
    id: "coming-soon-5",
    name: "Perennial Destiny",
    fullName: "Perennial Destiny",
    subtitle: "Promotional Card Box",
    description:
      "A themed collection centered around the legendary Dragon of Roses archetype. Carefully curated by SKX, this box blends elegant dragons, spellcasters, and floral power into a uniquely styled release.",
    releaseDate: "Coming Soon",
    edition: "Limited Run",
    typeLabel: "Curated List",
    cardCountLabel: "???",
    boxImage: "../assets/images/boxes/Coming Soon 5.png",
    imageBase: "",
    cards: [],
    comingSoon: true
  },
  {
    id: "coming-soon-6",
    name: "Radiant Ascension",
    fullName: "Radiant Ascension",
    subtitle: "Promotional Card Box",
    description:
      "A collection devoted to LIGHT-attribute monsters, featuring angels, spellcasters, and legendary warriors that embody radiant power and divine strength.",
    releaseDate: "Coming Soon",
    edition: "Limited Run",
    typeLabel: "Curated List",
    cardCountLabel: "???",
    boxImage: "../assets/images/boxes/Coming Soon 6.png",
    imageBase: "",
    cards: [],
    comingSoon: true
  },
  {
    id: "coming-soon-7",
    name: "Abyssal Dominion",
    fullName: "Abyssal Dominion",
    subtitle: "Promotional Card Box",
    description:
      "A shadow-filled lineup of DARK-attribute monsters. Fiends, cursed warriors, and forbidden powers dominate this sinister collection.",
    releaseDate: "Coming Soon",
    edition: "Limited Run",
    typeLabel: "Curated List",
    cardCountLabel: "???",
    boxImage: "../assets/images/boxes/Coming Soon 7.png",
    imageBase: "",
    cards: [],
    comingSoon: true
  },
  {
    id: "coming-soon-8",
    name: "Inferno Arsenal",
    fullName: "Inferno Arsenal",
    subtitle: "Promotional Card Box",
    description:
      "Blazing monsters and destructive spells fueled by the FIRE attribute. Dragons, warriors, and volcanic forces burn through everything in their path.",
    releaseDate: "Coming Soon",
    edition: "Limited Run",
    typeLabel: "Curated List",
    cardCountLabel: "???",
    boxImage: "../assets/images/boxes/Coming Soon 8.png",
    imageBase: "",
    cards: [],
    comingSoon: true
  },
  {
    id: "coming-soon-9",
    name: "Leviathan’s Depths",
    fullName: "Leviathan’s Depths",
    subtitle: "Promotional Card Box",
    description:
      "A deep-sea arsenal of WATER monsters, sea serpents, and aquatic titans that command the oceans and crush their opponents like the tides.",
    releaseDate: "Coming Soon",
    edition: "Limited Run",
    typeLabel: "Curated List",
    cardCountLabel: "???",
    boxImage: "../assets/images/boxes/Coming Soon 9.png",
    imageBase: "",
    cards: [],
    comingSoon: true
  },
  {
    id: "coming-soon-10",
    name: "Titanforge Dominion",
    fullName: "Titanforge Dominion",
    subtitle: "Promotional Card Box",
    description:
      "Massive beasts, ancient guardians, and unstoppable warriors of the EARTH attribute form the backbone of this powerful collection.",
    releaseDate: "Coming Soon",
    edition: "Limited Run",
    typeLabel: "Curated List",
    cardCountLabel: "???",
    boxImage: "../assets/images/boxes/Coming Soon 10.png",
    imageBase: "",
    cards: [],
    comingSoon: true
  },
  {
    id: "coming-soon-11",
    name: "Tempest Skydancers",
    fullName: "Tempest Skydancers",
    subtitle: "Promotional Card Box",
    description:
      "Swift aerial monsters and storm-born warriors strike from the skies. Harpies, dragons, and wind spirits dominate this fast-paced box.",
    releaseDate: "Coming Soon",
    edition: "Limited Run",
    typeLabel: "Curated List",
    cardCountLabel: "???",
    boxImage: "../assets/images/boxes/Coming Soon 11.png",
    imageBase: "",
    cards: [],
    comingSoon: true
  },
  {
    id: "coming-soon-12",
    name: "Genesis of Chaos",
    fullName: "Genesis of Chaos",
    subtitle: "Promotional Card Box",
    description:
      "A chaotic convergence of powerful monsters from across every attribute. Expect legendary bosses, unpredictable pulls, and game-changing power.",
    releaseDate: "Coming Soon",
    edition: "Limited Run",
    typeLabel: "Curated List",
    cardCountLabel: "???",
    boxImage: "../assets/images/boxes/Coming Soon 12.png",
    imageBase: "",
    cards: [],
    comingSoon: true
  }
].filter(Boolean).map((box, index) => ({
  ...box,
  legacySlot: String(index + 1),
  boxImage: normalizeImagePath(box.boxImage),
  imageBase: normalizeImagePath(box.imageBase || "")
}));

/* =========================
   STATE
   ========================= */

let hoveredBox = allBoxes[0];
let currentBox = allBoxes[0];
let isOpening = false;
let selectedUserKey = "qamazi";

/* =========================
   DOM
   ========================= */

const selectionView = document.getElementById("selectionView");
const openingView = document.getElementById("openingView");

const boxRow = document.getElementById("boxRow");
const hubInfoImage = document.getElementById("hubInfoImage");
const hubInfoTitle = document.getElementById("hubInfoTitle");
const hubInfoSubtitle = document.getElementById("hubInfoSubtitle");
const hubInfoRelease = document.getElementById("hubInfoRelease");
const hubInfoEdition = document.getElementById("hubInfoEdition");
const hubInfoType = document.getElementById("hubInfoType");
const hubInfoTotal = document.getElementById("hubInfoTotal");
const enterBoxBtn = document.getElementById("enterBoxBtn");

const backBtn = document.getElementById("backBtn");
const currentBoxImage = document.getElementById("currentBoxImage");
const boxName = document.getElementById("boxName");
const boxSubtitle = document.getElementById("boxSubtitle");
const boxReleaseDate = document.getElementById("boxReleaseDate");
const boxEdition = document.getElementById("boxEdition");
const boxType = document.getElementById("boxType");
const boxCardCount = document.getElementById("boxCardCount");

const caseWindow = document.getElementById("caseWindow");
const spinner = document.getElementById("spinner");
const openBtn = document.getElementById("openBtn");
const possibleCardsSections = document.getElementById("possibleCardsSections");
const selectedPlayerKeyInfo = document.getElementById("selectedPlayerKeyInfo");

const resultModal = document.getElementById("resultModal");
const resultBackdrop = document.getElementById("resultBackdrop");
const closeModalBtn = document.getElementById("closeModalBtn");
const closeModalBtn2 = document.getElementById("closeModalBtn2");
const openAgainBtn = document.getElementById("openAgainBtn");
const resultModalCard = document.getElementById("resultModalCard");
const resultImage = document.getElementById("resultImage");
const pickedCard = document.getElementById("pickedCard");
const rarityBanner = document.getElementById("rarityBanner");
const pullOdds = document.getElementById("pullOdds");
const pullOddsSub = document.getElementById("pullOddsSub");
const flashOverlay = document.getElementById("flashOverlay");
const hitEffectOverlay = document.getElementById("hitEffectOverlay");

const userCards = Array.from(document.querySelectorAll(".user-card"));
const creditInputs = Array.from(document.querySelectorAll(".user-credit-input"));

/* =========================
   SOUND
   ========================= */

const reelSound = new Audio(normalizeAudioPath("sounds/Case Reel sound.mp3"));
const commonHitSound = new Audio(normalizeAudioPath("sounds/common-hit.mp3"));
const redHitSound = new Audio(normalizeAudioPath("sounds/red-hit.mp3"));
const jackpotHitSound = new Audio(normalizeAudioPath("sounds/jackpot-hit.mp3"));

/* =========================
   CONSTANTS
   ========================= */

const REEL_CARD_WIDTH = 208;
const SPIN_DURATION = 5000;
const REVEAL_DELAY = 200;

const sectionMeta = {
  1: { name: "Gold", color: "#f3ca58" },
  2: { name: "Red", color: "#ff4d4d" },
  3: { name: "Pink", color: "#ff74c9" },
  4: { name: "Purple", color: "#b06cff" },
  5: { name: "Blue", color: "#4ba3ff" },
  6: { name: "White", color: "#f3f3f3" },
  7: { name: "Secret", color: "#f0f0f0" }
};

/* =========================
   PLAYER HELPERS
   ========================= */

function getSelectedPlayerName() {
  return userToPlayerNameMap[selectedUserKey] || "QaMazi";
}

function getSelectedPlayer() {
  return getPlayerByName(getSelectedPlayerName());
}

function getMatchingKeysForCurrentBox(player) {
  if (!player || !Array.isArray(player.inventory)) return [];

  const slot = currentBox.legacySlot;

  return player.inventory.filter((item) => {
    return item.type === "specific_key" && String(item.boxId) === String(slot);
  });
}

function hasUsableKeyForCurrentBox(player) {
  return getMatchingKeysForCurrentBox(player).length > 0;
}

function consumeBestKeyForCurrentBox(playerName) {
  const slot = currentBox.legacySlot;

  return updatePlayerByName(playerName, (player) => {
    const inventory = Array.isArray(player.inventory) ? [...player.inventory] : [];

    const specificKeyIndex = inventory.findIndex((item) => {
      return item.type === "specific_key" && String(item.boxId) === String(slot);
    });

    if (specificKeyIndex >= 0) {
      inventory.splice(specificKeyIndex, 1);
    }

    return { ...player, inventory };
  });
}

function syncCreditsFromSharedState() {
  userCards.forEach((card) => {
    const userKey = card.dataset.user;
    const input = card.querySelector(".user-credit-input");
    const playerName = userToPlayerNameMap[userKey];
    const player = getPlayerByName(playerName);

    if (input && player) {
      input.value = player.credits;
    }
  });
}

function bindCreditInputsToSharedState() {
  userCards.forEach((card) => {
    const userKey = card.dataset.user;
    const input = card.querySelector(".user-credit-input");
    const playerName = userToPlayerNameMap[userKey];

    if (!input || !playerName) return;

    input.addEventListener("change", () => {
      const newValue = Math.max(0, Number(input.value) || 0);

      updatePlayerByName(playerName, (player) => {
        player.credits = newValue;
        return player;
      });

      input.value = newValue;
      updateSelectedPlayerKeyInfo();
    });
  });
}

function updateSelectedUserUI() {
  userCards.forEach((card) => {
    card.classList.toggle("selected-user", card.dataset.user === selectedUserKey);
  });
}

function bindUserSelection() {
  userCards.forEach((card) => {
    card.addEventListener("click", (event) => {
      const clickedInput = event.target.closest(".user-credit-input");
      if (clickedInput) return;

      selectedUserKey = card.dataset.user;
      updateSelectedUserUI();
      updateSelectedPlayerKeyInfo();
    });
  });
}

function updateSelectedPlayerKeyInfo() {
  if (!selectedPlayerKeyInfo) return;

  const player = getSelectedPlayer();

  if (!player) {
    selectedPlayerKeyInfo.textContent = "No linked player selected.";
    return;
  }

  if (!currentBox || currentBox.comingSoon) {
    selectedPlayerKeyInfo.textContent = `${player.name} selected.`;
    return;
  }

  const keys = getMatchingKeysForCurrentBox(player);
  const count = keys.length;
  const keyLabel = `${currentBox.fullName || currentBox.name} Key`;

  selectedPlayerKeyInfo.textContent =
    `${player.name}: ${count} ${keyLabel}${count === 1 ? "" : "s"}`;
}

/* =========================
   HELPERS
   ========================= */

function playSound(sound, volume = 1) {
  if (!sound) return;

  try {
    sound.pause();
    sound.currentTime = 0;
    sound.volume = volume;
    sound.play().catch(() => {});
  } catch (err) {
    console.warn("Sound failed:", err);
  }
}

function playSectionSound(section) {
  if (section === 7) {
    playSound(jackpotHitSound, 1);
  } else if (section === 1) {
    playSound(jackpotHitSound, 0.95);
  } else if (section === 2) {
    playSound(redHitSound, 0.9);
  } else {
    playSound(commonHitSound, 0.75);
  }
}

function formatFileName(name) {
  return name
    .replace(/'/g, "")
    .replace(/\./g, "");
}

function getCardCountLabel(box) {
  if (box.comingSoon) {
    return box.cardCountLabel || "???";
  }

  return `${box.cards.length}`;
}

function getPossibleCardsLabel(box) {
  if (box.comingSoon) {
    return box.cardCountLabel || "???";
  }

  return `${box.cards.length} Possible Cards`;
}

function getImagePath(card) {
  return currentBox.imageBase + formatFileName(card.name) + ".png";
}

function weightedRoll(items) {
  const total = items.reduce((sum, item) => sum + item.chance, 0);
  let roll = Math.random() * total;

  for (const item of items) {
    if (roll < item.chance) return item;
    roll -= item.chance;
  }

  return items[items.length - 1];
}

function weightedVisualCard(includeSection7 = false) {
  const pool = includeSection7
    ? currentBox.cards
    : currentBox.cards.filter((card) => card.section !== 7);

  const total = pool.reduce((sum, card) => sum + card.chance, 0);
  let roll = Math.random() * total;

  for (const card of pool) {
    if (roll < card.chance) return card;
    roll -= card.chance;
  }

  return pool[pool.length - 1];
}

function rarityClassName(rarity) {
  return "rarity-" + rarity.toLowerCase().replace(/\s+/g, "-");
}

function calculateExactPull(cardChance, rarityChance) {
  const finalPercent = cardChance * (rarityChance / 100);
  let oneIn = "—";

  if (finalPercent > 0) {
    oneIn = Math.round(100 / finalPercent).toLocaleString();
  }

  return {
    percent: finalPercent.toFixed(4),
    packs: oneIn
  };
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/* =========================
   VISUAL FX
   ========================= */

function playFlash() {
  flashOverlay.classList.remove("active");
  void flashOverlay.offsetWidth;
  flashOverlay.classList.add("active");
}

function playHitEffect(section) {
  hitEffectOverlay.classList.remove(
    "active",
    "hit-red",
    "hit-gold",
    "hit-platinum"
  );

  if (section === 2) {
    hitEffectOverlay.classList.add("hit-red");
  } else if (section === 1) {
    hitEffectOverlay.classList.add("hit-gold");
  } else if (section === 7) {
    hitEffectOverlay.classList.add("hit-platinum");
  } else {
    return;
  }

  void hitEffectOverlay.offsetWidth;
  hitEffectOverlay.classList.add("active");
}

function setModalSectionGlow(section) {
  resultModalCard.classList.remove(
    "section-1",
    "section-2",
    "section-3",
    "section-4",
    "section-5",
    "section-6",
    "section-7"
  );

  resultModalCard.classList.add(`section-${section}`);
}

/* =========================
   VIEW TOGGLES
   ========================= */

function showModal() {
  resultModal.classList.add("show");
  resultModal.setAttribute("aria-hidden", "false");
}

function hideModal() {
  resultModal.classList.remove("show");
  resultModal.setAttribute("aria-hidden", "true");
}

function showSelectionView() {
  selectionView.classList.add("view-active");
  openingView.classList.remove("view-active");
}

function showOpeningView() {
  selectionView.classList.remove("view-active");
  openingView.classList.add("view-active");
  updateSelectedPlayerKeyInfo();
}

/* =========================
   HUB RENDER
   ========================= */

function renderHubInfo(box) {
  hubInfoImage.src = box.boxImage;
  hubInfoImage.onerror = () => {
    hubInfoImage.src = getCardBackPath();
  };

  hubInfoTitle.textContent = box.fullName || box.name;
  hubInfoSubtitle.textContent = box.description || box.subtitle || "";
  hubInfoRelease.textContent = box.releaseDate || "Coming Soon";
  hubInfoEdition.textContent = box.edition || "Limited Run";
  hubInfoType.textContent = box.typeLabel || "Curated List";
  hubInfoTotal.textContent = getCardCountLabel(box);

  enterBoxBtn.disabled = !!box.comingSoon;
}

function renderBoxGrid() {
  boxRow.innerHTML = "";

  allBoxes.forEach((box, index) => {
    const card = document.createElement("div");
    const isActive = hoveredBox && hoveredBox.id === box.id;
    const isComingSoon = !!box.comingSoon;

    card.className = `box-card ${isComingSoon ? "coming-soon" : "selectable"} ${isActive ? "active" : ""}`;

    card.innerHTML = `
      <div class="box-card-image-wrap">
        <img src="${box.boxImage}" alt="${box.name}">
      </div>
      <div class="box-card-meta">
        <div class="box-card-title">Box ${index + 1}: ${box.name}</div>
        <div class="box-card-subtitle">${box.subtitle}</div>
      </div>
    `;

    const img = card.querySelector("img");
    img.onerror = () => {
      img.src = getCardBackPath();
    };

    card.addEventListener("click", () => {
      if (box.comingSoon) return;

      hoveredBox = box;
      renderHubInfo(box);
      renderBoxGrid();
    });

    boxRow.appendChild(card);
  });
}

/* =========================
   OPEN VIEW RENDER
   ========================= */

function syncOpeningView() {
  boxName.textContent = currentBox.fullName || currentBox.name;
  boxSubtitle.textContent = currentBox.description || currentBox.subtitle || "";
  boxReleaseDate.textContent = currentBox.releaseDate || "Coming Soon";
  boxEdition.textContent = currentBox.edition || "Limited Run";
  boxType.textContent = currentBox.typeLabel || "Curated List";
  boxCardCount.textContent = getPossibleCardsLabel(currentBox);

  currentBoxImage.src = currentBox.boxImage;
  currentBoxImage.onerror = () => {
    currentBoxImage.src = getCardBackPath();
  };

  spinner.innerHTML = "";
  spinner.style.transform = "translateX(0)";
  hideModal();
  updateSelectedPlayerKeyInfo();
}

function renderPossibleCards() {
  possibleCardsSections.innerHTML = "";

  if (currentBox.comingSoon) return;

  const visibleSections = [1, 2, 3, 4, 5, 6];

  visibleSections.forEach((sectionNumber) => {
    const cards = currentBox.cards
      .filter((card) => card.section === sectionNumber)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!cards.length) return;

    const meta = sectionMeta[sectionNumber];
    const totalChance = cards.reduce((sum, card) => sum + card.chance, 0).toFixed(1);

    const wrapper = document.createElement("div");
    wrapper.className = "section-group";

    wrapper.innerHTML = `
      <button class="section-toggle" type="button">
        <div class="section-toggle-left">
          <span class="section-color-dot" style="background:${meta.color}"></span>
          <span>${meta.name}</span>
        </div>
        <span class="section-toggle-count">${totalChance}% total</span>
      </button>
      <div class="section-content">
        <div class="card-odds-list"></div>
      </div>
    `;

    const content = wrapper.querySelector(".section-content");
    const list = wrapper.querySelector(".card-odds-list");
    const toggle = wrapper.querySelector(".section-toggle");

    cards.forEach((card) => {
      const row = document.createElement("div");
      row.className = "card-odds-row";
      row.innerHTML = `
        <span class="card-odds-name">${card.name}</span>
        <span class="card-odds-value">${card.chance}%</span>
      `;
      list.appendChild(row);
    });

    toggle.addEventListener("click", () => {
      content.classList.toggle("open");
    });

    possibleCardsSections.appendChild(wrapper);
  });
}

/* =========================
   REEL
   ========================= */

function createReelCard(card) {
  const el = document.createElement("div");
  el.className = `reel-card section-${card.section} spinning-card`;

  const imgPath = getImagePath(card);

  el.innerHTML = `
    <img src="${imgPath}" alt="${card.name}">
    <div class="overlay">
      <div class="card-name">${card.name}</div>
    </div>
  `;

  const img = el.querySelector("img");
  img.onerror = () => {
    img.src = getCardBackPath();
  };

  return el;
}

function buildSpinner(winningCard) {
  spinner.innerHTML = "";

  const totalVisualCards = 80;
  const winnerIndex = 60;
  const includeSection7 = winningCard.section === 7;

  for (let i = 0; i < totalVisualCards; i++) {
    const card =
      i === winnerIndex
        ? winningCard
        : weightedVisualCard(includeSection7);

    spinner.appendChild(createReelCard(card));
  }

  return winnerIndex;
}

function revealRarity(winningCard) {
  setTimeout(() => {
    const table = winningCard.section === 7
      ? secretSectionRarityTable
      : rarityTable;

    const rarityObj = weightedRoll(table);
    const rarity = rarityObj.name;

    resultImage.src = getImagePath(winningCard);
    resultImage.onerror = () => {
      resultImage.src = getCardBackPath();
    };

    pickedCard.textContent = winningCard.name;
    rarityBanner.textContent = `✦ ${rarity} ✦`;
    rarityBanner.className = "rarity-banner " + rarityClassName(rarity);

    const odds = calculateExactPull(winningCard.chance, rarityObj.chance);
    pullOdds.textContent = `Pull Chance: ${odds.percent}%`;
    pullOddsSub.textContent = `Approx. 1 in ${odds.packs} packs`;

    setModalSectionGlow(winningCard.section);

    showModal();
    playFlash();

    setTimeout(() => {
      playHitEffect(winningCard.section);
      playSectionSound(winningCard.section);
    }, 30);

    isOpening = false;
    openBtn.disabled = false;
    updateSelectedPlayerKeyInfo();
  }, 420);
}

function animateSpin(targetX, duration, winningCard) {
  const startTime = performance.now();

  function frame(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(progress);
    const currentX = targetX * eased;

    if (progress < 0.58) {
      spinner.classList.add("fast-blur");
      spinner.classList.remove("mid-blur");
    } else if (progress < 0.82) {
      spinner.classList.remove("fast-blur");
      spinner.classList.add("mid-blur");
    } else {
      spinner.classList.remove("fast-blur");
      spinner.classList.remove("mid-blur");
    }

    spinner.style.transform = `translateX(${currentX}px)`;

    if (progress < 1) {
      requestAnimationFrame(frame);
    } else {
      caseWindow.classList.remove("is-spinning");
      spinner.classList.remove("fast-blur");
      spinner.classList.remove("mid-blur");

      spinner.querySelectorAll(".reel-card").forEach((card) => {
        card.classList.remove("spinning-card");
      });

      setTimeout(() => {
        revealRarity(winningCard);
      }, REVEAL_DELAY);
    }
  }

  requestAnimationFrame(frame);
}

function openCase() {
  if (isOpening || currentBox.comingSoon) return;

  const selectedPlayer = getSelectedPlayer();

  if (!selectedPlayer) {
    alert("No linked player data was found for the selected user.");
    return;
  }

  if (!hasUsableKeyForCurrentBox(selectedPlayer)) {
    alert(`${selectedPlayer.name} does not have a ${currentBox.fullName || currentBox.name} Key.`);
    return;
  }

  consumeBestKeyForCurrentBox(selectedPlayer.name);

  hideModal();
  isOpening = true;
  openBtn.disabled = true;
  updateSelectedPlayerKeyInfo();

  playSound(reelSound, 0.85);

  caseWindow.classList.add("is-spinning");

  rarityBanner.textContent = "Revealing...";
  rarityBanner.className = "rarity-banner";
  pullOdds.textContent = "Pull Chance: --";
  pullOddsSub.textContent = "Approx. 1 in -- packs";

  const winningCard = weightedRoll(currentBox.cards);
  const winnerIndex = buildSpinner(winningCard);

  const windowCenter = caseWindow.offsetWidth / 2;
  const targetCardCenter = (winnerIndex * REEL_CARD_WIDTH) + (REEL_CARD_WIDTH / 2);
  const finalX = -(targetCardCenter - windowCenter);

  animateSpin(finalX, SPIN_DURATION, winningCard);
}

/* =========================
   EVENTS
   ========================= */

function initEvents() {
  enterBoxBtn.addEventListener("click", () => {
    if (!hoveredBox || hoveredBox.comingSoon) return;

    currentBox = hoveredBox;
    syncOpeningView();
    renderPossibleCards();
    showOpeningView();
  });

  backBtn.addEventListener("click", () => {
    reelSound.pause();
    reelSound.currentTime = 0;
    hideModal();
    showSelectionView();
    updateSelectedPlayerKeyInfo();
  });

  openBtn.addEventListener("click", openCase);

  resultBackdrop.addEventListener("click", () => {
    reelSound.pause();
    reelSound.currentTime = 0;
    hideModal();
  });

  closeModalBtn.addEventListener("click", () => {
    reelSound.pause();
    reelSound.currentTime = 0;
    hideModal();
  });

  closeModalBtn2.addEventListener("click", () => {
    reelSound.pause();
    reelSound.currentTime = 0;
    hideModal();
  });

  openAgainBtn.addEventListener("click", () => {
    hideModal();
    openCase();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideModal();
  });
}

/* =========================
   INIT
   ========================= */

function init() {
  if (!allBoxes.length) {
    console.error("No boxes loaded.");
    return;
  }

  hoveredBox = allBoxes[0];
  currentBox = allBoxes[0];

  syncCreditsFromSharedState();
  bindCreditInputsToSharedState();
  bindUserSelection();
  updateSelectedUserUI();

  renderHubInfo(hoveredBox);
  renderBoxGrid();
  syncOpeningView();
  renderPossibleCards();
  initEvents();
  updateSelectedPlayerKeyInfo();
}

init();