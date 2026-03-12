const CARD_PAGE_SIZE = 60;

const cardSearchState = {
  offset: 0,
  hasMore: true,
  loading: false
};

function getClient() {
  if (window.db?.supabase) return window.db.supabase;
  throw new Error("Database client is not ready.");
}

function el(id) {
  return document.getElementById(id);
}

function getFilters() {
  return {
    search: el("cardSearchInput")?.value?.trim() || "",
    type: el("typeFilter")?.value || "",
    attribute: el("attributeFilter")?.value || "",
    level: el("levelFilter")?.value || "",
    atkMin: el("atkMinFilter")?.value || "",
    atkMax: el("atkMaxFilter")?.value || "",
    defMin: el("defMinFilter")?.value || "",
    defMax: el("defMaxFilter")?.value || "",
    sortBy: el("sortBySelect")?.value || "name",
    sortOrder: el("sortOrderSelect")?.value || "asc",
    scope: el("scopeFilter")?.value || "all",
    playerId: el("playerFilter")?.value || ""
  };
}

function buildRowDetails(card) {
  const levelValue = card.level ?? card.rank ?? card.link_rating ?? null;

  const lineOneParts = [];
  if (levelValue !== null && levelValue !== undefined && levelValue !== "") {
    lineOneParts.push(`Level ${levelValue}`);
  }

  const normalizedType =
    card.type ||
    card.card_type ||
    card.race ||
    "";

  if (normalizedType) {
    lineOneParts.push(normalizedType);
  }

  const lineTwoParts = [];
  if (card.attribute) lineTwoParts.push(card.attribute);
  if (card.race) lineTwoParts.push(card.race);

  const statParts = [];
  if (card.atk !== null && card.atk !== undefined) statParts.push(`ATK ${card.atk}`);
  if (card.def !== null && card.def !== undefined) statParts.push(`DEF ${card.def}`);

  return {
    lineOne: lineOneParts.join(" / "),
    lineTwo: lineTwoParts.join(" / "),
    lineThree: statParts.join(" / ")
  };
}

function renderCards(cards, reset = false) {
  const list = el("cardList");
  if (!list) return;

  if (reset) {
    list.innerHTML = "";
  }

  if (reset && (!cards || !cards.length)) {
    list.innerHTML = '<div class="card-empty-state">No cards matched the current filters.</div>';
    return;
  }

  cards.forEach((card) => {
    const row = document.createElement("article");
    row.className = "card-row";

    const details = buildRowDetails(card);
    const imagePath = `/cards/${card.id}.jpg`;

    row.innerHTML = `
      <img class="card-thumb" src="${imagePath}" alt="${escapeHtml(card.name || "Card")}" onerror="this.style.opacity='0.35'; this.alt='No image found';" />
      <div class="card-row-body">
        <div class="card-row-name">${escapeHtml(card.name || "Unknown Card")}</div>
        <div class="card-row-line">${escapeHtml(details.lineOne || "Unknown Type")}</div>
        <div class="card-row-line">${escapeHtml(details.lineTwo || "Unknown Attribute")}</div>
        <div class="card-row-line is-dim">${escapeHtml(details.lineThree || "")}</div>
      </div>
    `;

    list.appendChild(row);
  });
}

function setMeta(text) {
  const meta = el("cardResultsMeta");
  if (meta) meta.textContent = text;
}

function updateLoadMoreVisibility() {
  const button = el("loadMoreButton");
  if (!button) return;
  button.style.display = cardSearchState.hasMore ? "inline-flex" : "none";
  button.disabled = cardSearchState.loading;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadBinderPlayers() {
  const playerSelect = el("playerFilter");
  if (!playerSelect) return;

  try {
    const session = await window.db?.getActiveSession?.();
    if (!session?.id) return;

    const players = await window.db?.loadSessionPlayers?.(session.id);
    if (!Array.isArray(players)) return;

    playerSelect.innerHTML = '<option value="">Select Player</option>' +
      players
        .map((row) => {
          const user = row.users || {};
          const name = user.username || `Player ${row.user_id}`;
          return `<option value="${row.user_id}">${escapeHtml(name)}</option>`;
        })
        .join("");
  } catch (error) {
    console.error("Failed loading binder players:", error);
  }
}

async function fetchCards(reset = false) {
  if (cardSearchState.loading) return;

  const scopeFilter = getFilters();

  if (scopeFilter.scope === "binder" && !scopeFilter.playerId) {
    renderCards([], true);
    setMeta("Select a player to view a binder.");
    cardSearchState.hasMore = false;
    updateLoadMoreVisibility();
    return;
  }

  cardSearchState.loading = true;
  updateLoadMoreVisibility();

  if (reset) {
    cardSearchState.offset = 0;
    cardSearchState.hasMore = true;
    setMeta("Loading cards...");
  }

  try {
    const client = getClient();
    let query;

    if (scopeFilter.scope === "binder") {
      query = client
        .from("player_cards")
        .select(`
          quantity,
          cards:card_id (
            id,
            name,
            type,
            card_type,
            attribute,
            race,
            level,
            rank,
            link_rating,
            atk,
            def
          )
        `)
        .eq("user_id", scopeFilter.playerId);
    } else {
      query = client.from("cards").select(`
        id,
        name,
        type,
        card_type,
        attribute,
        race,
        level,
        rank,
        link_rating,
        atk,
        def
      `);
    }

    if (scopeFilter.search) {
      if (scopeFilter.scope === "binder") {
        query = query.ilike("cards.name", `%${scopeFilter.search}%`);
      } else {
        query = query.ilike("name", `%${scopeFilter.search}%`);
      }
    }

    if (scopeFilter.type) {
      if (scopeFilter.scope === "binder") {
        query = query.or(`cards.type.ilike.%${scopeFilter.type}%,cards.card_type.ilike.%${scopeFilter.type}%`);
      } else {
        query = query.or(`type.ilike.%${scopeFilter.type}%,card_type.ilike.%${scopeFilter.type}%`);
      }
    }

    if (scopeFilter.attribute) {
      if (scopeFilter.scope === "binder") {
        query = query.eq("cards.attribute", scopeFilter.attribute);
      } else {
        query = query.eq("attribute", scopeFilter.attribute);
      }
    }

    if (scopeFilter.level) {
      const value = Number(scopeFilter.level);
      if (!Number.isNaN(value)) {
        if (scopeFilter.scope === "binder") {
          query = query.or(`cards.level.eq.${value},cards.rank.eq.${value},cards.link_rating.eq.${value}`);
        } else {
          query = query.or(`level.eq.${value},rank.eq.${value},link_rating.eq.${value}`);
        }
      }
    }

    const numericFilters = [
      ["atkMin", ">="],
      ["atkMax", "<="],
      ["defMin", ">="],
      ["defMax", "<="]
    ];

    for (const [key, operator] of numericFilters) {
      const raw = scopeFilter[key];
      if (!raw && raw !== 0) continue;
      const value = Number(raw);
      if (Number.isNaN(value)) continue;

      const column = key.startsWith("atk") ? "atk" : "def";
      if (scopeFilter.scope === "binder") {
        if (operator === ">=") query = query.gte(`cards.${column}`, value);
        if (operator === "<=") query = query.lte(`cards.${column}`, value);
      } else {
        if (operator === ">=") query = query.gte(column, value);
        if (operator === "<=") query = query.lte(column, value);
      }
    }

    const sortColumnMap = {
      name: "name",
      level: "level",
      atk: "atk",
      def: "def",
      attribute: "attribute",
      type: "type"
    };

    const sortColumn = sortColumnMap[scopeFilter.sortBy] || "name";
    const ascending = scopeFilter.sortOrder !== "desc";

    if (scopeFilter.scope === "binder") {
      query = query.order(`cards.${sortColumn}`, { ascending, nullsFirst: false });
    } else {
      query = query.order(sortColumn, { ascending, nullsFirst: false });
    }

    query = query.range(cardSearchState.offset, cardSearchState.offset + CARD_PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const cards = scopeFilter.scope === "binder"
      ? rows.map((row) => ({
          ...(row.cards || {}),
          quantity: row.quantity
        })).filter((card) => card.id)
      : rows;

    renderCards(cards, reset);

    cardSearchState.offset += cards.length;
    cardSearchState.hasMore = cards.length === CARD_PAGE_SIZE;

    const modeLabel = scopeFilter.scope === "binder" ? "binder cards" : "cards";
    setMeta(`${cards.length}${reset ? "" : "+"} ${modeLabel} loaded`);

    if (reset && cards.length === 0) {
      cardSearchState.hasMore = false;
    }
  } catch (error) {
    console.error("Card search failed:", error);
    renderCards([], true);
    setMeta(error.message || "Failed to load cards.");
    cardSearchState.hasMore = false;
  } finally {
    cardSearchState.loading = false;
    updateLoadMoreVisibility();
  }
}

function bindEvents() {
  const instantIds = [
    "cardSearchInput",
    "typeFilter",
    "attributeFilter",
    "levelFilter",
    "scopeFilter",
    "playerFilter",
    "sortBySelect",
    "sortOrderSelect"
  ];

  instantIds.forEach((id) => {
    const node = el(id);
    if (!node) return;
    node.addEventListener("change", () => {
      if (id === "scopeFilter") {
        const binderMode = el("scopeFilter").value === "binder";
        el("playerFilter").disabled = !binderMode;
      }
      fetchCards(true);
    });
  });

  el("cardSearchInput")?.addEventListener("input", () => fetchCards(true));
  el("applyFiltersButton")?.addEventListener("click", () => fetchCards(true));
  el("loadMoreButton")?.addEventListener("click", () => fetchCards(false));

  el("clearFiltersButton")?.addEventListener("click", () => {
    [
      "cardSearchInput",
      "typeFilter",
      "attributeFilter",
      "levelFilter",
      "atkMinFilter",
      "atkMaxFilter",
      "defMinFilter",
      "defMaxFilter",
      "sortBySelect",
      "sortOrderSelect",
      "scopeFilter",
      "playerFilter"
    ].forEach((id) => {
      const node = el(id);
      if (!node) return;
      if (node.tagName === "SELECT") {
        if (id === "sortBySelect") node.value = "name";
        else if (id === "sortOrderSelect") node.value = "asc";
        else if (id === "scopeFilter") node.value = "all";
        else node.selectedIndex = 0;
      } else {
        node.value = "";
      }
    });

    el("playerFilter").disabled = true;
    fetchCards(true);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadBinderPlayers();
  } catch (error) {
    console.error(error);
  }

  bindEvents();
  el("playerFilter").disabled = true;
  fetchCards(true);
});
