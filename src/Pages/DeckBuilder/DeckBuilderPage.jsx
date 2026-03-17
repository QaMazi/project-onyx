import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";

import DeckHeader from "./Components/DeckHeader";
import DeckMainSection from "./Components/DeckMainSection";
import DeckExtraSection from "./Components/DeckExtraSection";
import DeckSideSection from "./Components/DeckSideSection";
import DeckBinderPanel from "./Components/DeckBinderPanel";
import DeckFilterModal from "./Components/DeckFilterModal";
import DeckCardHoverTooltip from "./Components/DeckCardHoverTooltip";
import DeckCardImageModal from "./Components/DeckCardImageModal";

import "./DeckBuilderPage.css";

const TYPE_FLAGS = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
  EFFECT: 0x20,
  FUSION: 0x40,
  RITUAL: 0x80,
  SPIRIT: 0x200,
  UNION: 0x400,
  GEMINI: 0x800,
  TUNER: 0x1000,
  SYNCHRO: 0x2000,
  TOKEN: 0x4000,
  QUICKPLAY: 0x10000,
  CONTINUOUS: 0x20000,
  EQUIP: 0x40000,
  FIELD: 0x80000,
  COUNTER: 0x100000,
  FLIP: 0x200000,
  TOON: 0x400000,
  XYZ: 0x800000,
  PENDULUM: 0x1000000,
  LINK: 0x4000000,
};

const SEARCH_MODE_OPTIONS = [
  { label: "Name", value: "name" },
  { label: "Description", value: "desc" },
];

const SORT_OPTIONS = [
  { label: "Name", value: "name" },
  { label: "ATK", value: "atk" },
  { label: "DEF", value: "def" },
  { label: "Level", value: "level" },
];

const QUICK_FILTER_OPTIONS = [
  { label: "All Owned", value: "all" },
  { label: "Only Available", value: "available" },
  { label: "Cursed Cards", value: "cursed" },
  { label: "Main Deck Legal", value: "main" },
  { label: "Extra Deck Legal", value: "extra" },
];

const CARD_KIND_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Monster", value: "monster" },
  { label: "Spell", value: "spell" },
  { label: "Trap", value: "trap" },
];

const MONSTER_TYPE_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Normal", value: "normal" },
  { label: "Effect", value: "effect" },
  { label: "Fusion", value: "fusion" },
  { label: "Ritual", value: "ritual" },
  { label: "Synchro", value: "synchro" },
  { label: "Xyz", value: "xyz" },
  { label: "Pendulum", value: "pendulum" },
  { label: "Link", value: "link" },
  { label: "Token", value: "token" },
];

const SPELL_TRAP_SUBTYPE_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Normal", value: "normal" },
  { label: "Quick-Play", value: "quickplay" },
  { label: "Continuous", value: "continuous" },
  { label: "Equip", value: "equip" },
  { label: "Field", value: "field" },
  { label: "Ritual", value: "ritual" },
  { label: "Counter", value: "counter" },
];

const MONSTER_TRAIT_OPTIONS = [
  { label: "Tuner", value: "tuner" },
  { label: "Flip", value: "flip" },
  { label: "Gemini", value: "gemini" },
  { label: "Union", value: "union" },
  { label: "Spirit", value: "spirit" },
  { label: "Toon", value: "toon" },
  { label: "Pre-Errata", value: "pre_errata" },
  { label: "Token", value: "token_exact" },
];

const ATTRIBUTE_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Earth", value: "1" },
  { label: "Water", value: "2" },
  { label: "Fire", value: "4" },
  { label: "Wind", value: "8" },
  { label: "Light", value: "16" },
  { label: "Dark", value: "32" },
  { label: "Divine", value: "64" },
];

const RACE_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Warrior", value: "1" },
  { label: "Spellcaster", value: "2" },
  { label: "Fairy", value: "4" },
  { label: "Fiend", value: "8" },
  { label: "Zombie", value: "16" },
  { label: "Machine", value: "32" },
  { label: "Aqua", value: "64" },
  { label: "Pyro", value: "128" },
  { label: "Rock", value: "256" },
  { label: "Winged Beast", value: "512" },
  { label: "Plant", value: "1024" },
  { label: "Insect", value: "2048" },
  { label: "Thunder", value: "4096" },
  { label: "Dragon", value: "8192" },
  { label: "Beast", value: "16384" },
  { label: "Beast-Warrior", value: "32768" },
  { label: "Dinosaur", value: "65536" },
  { label: "Fish", value: "131072" },
  { label: "Sea Serpent", value: "262144" },
  { label: "Reptile", value: "524288" },
  { label: "Psychic", value: "1048576" },
  { label: "Divine Beast", value: "2097152" },
  { label: "Creator God", value: "4194304" },
  { label: "Wyrm", value: "8388608" },
  { label: "Cyberse", value: "16777216" },
];

const TRAIT_FLAG_MAP = {
  tuner: TYPE_FLAGS.TUNER,
  flip: TYPE_FLAGS.FLIP,
  gemini: TYPE_FLAGS.GEMINI,
  union: TYPE_FLAGS.UNION,
  spirit: TYPE_FLAGS.SPIRIT,
  toon: TYPE_FLAGS.TOON,
};

const DEFAULT_COPY_LIMIT = 3;
const BASE_DECK_SLOTS = 1;
const MAIN_DECK_SLOT_COUNT = 60;
const EXTRA_DECK_SLOT_COUNT = 15;
const SIDE_DECK_SLOT_COUNT = 15;

function buildCardImageUrl(card) {
  if (card?.image_url) return card.image_url;
  return `https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/${card?.id}.jpg`;
}

function getBanlistLimit(status) {
  switch (status) {
    case "forbidden":
      return 0;
    case "limited":
      return 1;
    case "semi_limited":
      return 2;
    default:
      return DEFAULT_COPY_LIMIT;
  }
}

function isExtraDeckCard(card) {
  const type = Number(card?.type || 0);
  return (
    (type & TYPE_FLAGS.FUSION) === TYPE_FLAGS.FUSION ||
    (type & TYPE_FLAGS.SYNCHRO) === TYPE_FLAGS.SYNCHRO ||
    (type & TYPE_FLAGS.XYZ) === TYPE_FLAGS.XYZ ||
    (type & TYPE_FLAGS.LINK) === TYPE_FLAGS.LINK
  );
}

function getCardKind(card) {
  const type = Number(card?.type || 0);
  if ((type & TYPE_FLAGS.SPELL) === TYPE_FLAGS.SPELL) return "spell";
  if ((type & TYPE_FLAGS.TRAP) === TYPE_FLAGS.TRAP) return "trap";
  if ((type & TYPE_FLAGS.MONSTER) === TYPE_FLAGS.MONSTER) return "monster";
  return "unknown";
}

function getAllowedSections(card) {
  if (!card) return ["main", "side"];
  if (isExtraDeckCard(card)) return ["extra", "side"];
  return ["main", "side"];
}

function normalizeBinderRows(rows) {
  return (rows || []).map((row) => ({
    id: row.id,
    quantity: Number(row.quantity || 0),
    cardId: row.card_id,
    card: {
      id: row.card_id,
      name: row.card_name,
      image_url: row.image_url,
      desc: row.card_description,
      type: row.type,
      race: row.race,
      attribute: row.attribute,
      level: row.level,
      atk: row.atk,
      def: row.def,
      ot: row.ot ?? null,
      setcode: row.setcode ?? null,
    },
  }));
}

function buildOwnedCardMap(rows) {
  const ownedMap = new Map();

  for (const row of rows) {
    if (!row.card) continue;
    const key = String(row.cardId);

    if (!ownedMap.has(key)) {
      ownedMap.set(key, {
        cardId: row.cardId,
        card: row.card,
        ownedQuantity: 0,
      });
    }

    ownedMap.get(key).ownedQuantity += row.quantity;
  }

  return ownedMap;
}

function normalizeDeckRows(rows) {
  return (rows || []).map((row) => ({
    id: row.id,
    deckName: row.deck_name,
    isActive: Boolean(row.is_active),
    isValid: Boolean(row.is_valid),
    validationSummary: row.validation_summary || "",
  }));
}

function normalizeDeckCardRows(rows) {
  return (rows || []).map((row) => ({
    cardId: row.card_id,
    section: row.section,
    quantity: Number(row.quantity || 0),
  }));
}

function buildDeckState(rows) {
  const state = { main: new Map(), extra: new Map(), side: new Map() };

  for (const row of rows) {
    if (!state[row.section]) continue;
    state[row.section].set(String(row.cardId), Number(row.quantity || 0));
  }

  return state;
}

function buildBanlistMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    map.set(String(row.card_id), { status: row.status || "unlimited" });
  }
  return map;
}

function buildCurseMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!row.is_active) continue;
    map.set(String(row.card_id), true);
  }
  return map;
}

function getSectionCount(sectionMap) {
  let total = 0;
  for (const value of sectionMap.values()) total += Number(value || 0);
  return total;
}

function getAllUsedCount(deckState, cardId) {
  const key = String(cardId);
  return (
    Number(deckState.main.get(key) || 0) +
    Number(deckState.extra.get(key) || 0) +
    Number(deckState.side.get(key) || 0)
  );
}

function buildSectionSlots(sectionMap, ownedCardMap) {
  const slots = [];

  for (const [cardId, quantity] of sectionMap.entries()) {
    const owned = ownedCardMap.get(String(cardId));
    if (!owned?.card) continue;

    for (let copyIndex = 0; copyIndex < Number(quantity || 0); copyIndex += 1) {
      slots.push({
        cardId: owned.cardId,
        card: owned.card,
        instanceKey: `${owned.cardId}-${copyIndex}`,
      });
    }
  }

  return slots.sort((a, b) =>
    String(a.card?.name || "").localeCompare(String(b.card?.name || ""))
  );
}

function validateDeck({ deckState, ownedCardMap, banlistMap, curseMap }) {
  const errors = [];

  for (const section of ["main", "extra", "side"]) {
    for (const [cardId, quantity] of deckState[section].entries()) {
      const ownedEntry = ownedCardMap.get(String(cardId));
      const card = ownedEntry?.card || null;
      const totalUsed = getAllUsedCount(deckState, cardId);
      const ownedQuantity = Number(ownedEntry?.ownedQuantity || 0);
      const banlistStatus = banlistMap.get(String(cardId))?.status || "unlimited";
      const banlistLimit = getBanlistLimit(banlistStatus);

      if (!ownedEntry) {
        errors.push(`Invalid - card not owned: ${cardId}`);
        continue;
      }

      if (!getAllowedSections(card).includes(section)) {
        errors.push(`Invalid - illegal section for ${card?.name || cardId}`);
      }

      if (curseMap.has(String(cardId))) {
        errors.push(`Invalid - cursed card: ${card?.name || cardId}`);
      }

      if (totalUsed > ownedQuantity) {
        errors.push(`Invalid - card not owned in enough quantity: ${card?.name || cardId}`);
      }

      if (totalUsed > banlistLimit) {
        errors.push(`Invalid - too many copies: ${card?.name || cardId}`);
      }

      if (totalUsed > DEFAULT_COPY_LIMIT) {
        errors.push(`Invalid - exceeds default copy limit: ${card?.name || cardId}`);
      }

      if (quantity <= 0) {
        errors.push(`Invalid - zero quantity row: ${card?.name || cardId}`);
      }
    }
  }

  const mainCount = getSectionCount(deckState.main);
  const extraCount = getSectionCount(deckState.extra);
  const sideCount = getSectionCount(deckState.side);

  if (mainCount < 40) errors.push(`Invalid - main deck must have at least 40 cards (currently ${mainCount})`);
  if (mainCount > MAIN_DECK_SLOT_COUNT) errors.push(`Invalid - main deck exceeds maximum of ${MAIN_DECK_SLOT_COUNT} cards (currently ${mainCount})`);
  if (extraCount > EXTRA_DECK_SLOT_COUNT) errors.push(`Invalid - extra deck exceeds maximum of ${EXTRA_DECK_SLOT_COUNT} cards (currently ${extraCount})`);
  if (sideCount > SIDE_DECK_SLOT_COUNT) errors.push(`Invalid - side deck exceeds maximum of ${SIDE_DECK_SLOT_COUNT} cards (currently ${sideCount})`);

  return {
    isValid: errors.length === 0,
    summary: errors[0] || "Valid",
    mainCount,
    extraCount,
    sideCount,
  };
}

function decodeAttribute(value) {
  const normalized = Number(value || 0);
  return (
    ATTRIBUTE_OPTIONS.find((option) => Number(option.value) === normalized)?.label ||
    "Unknown"
  );
}

function decodeRace(value) {
  const normalized = Number(value || 0);
  return (
    RACE_OPTIONS.find((option) => Number(option.value) === normalized)?.label ||
    "Unknown"
  );
}

function isPreErrataCard(card) {
  return /\(pre-errata\)/i.test(String(card?.name || ""));
}

function isTokenMonster(card) {
  const typeValue = Number(card?.type || 0);
  return (typeValue & TYPE_FLAGS.TOKEN) === TYPE_FLAGS.TOKEN;
}

function getMonsterSubtype(typeValue) {
  const normalized = Number(typeValue || 0);
  if ((normalized & TYPE_FLAGS.MONSTER) !== TYPE_FLAGS.MONSTER) return null;
  if ((normalized & TYPE_FLAGS.LINK) === TYPE_FLAGS.LINK) return "link";
  if ((normalized & TYPE_FLAGS.XYZ) === TYPE_FLAGS.XYZ) return "xyz";
  if ((normalized & TYPE_FLAGS.SYNCHRO) === TYPE_FLAGS.SYNCHRO) return "synchro";
  if ((normalized & TYPE_FLAGS.FUSION) === TYPE_FLAGS.FUSION) return "fusion";
  if ((normalized & TYPE_FLAGS.RITUAL) === TYPE_FLAGS.RITUAL) return "ritual";
  if ((normalized & TYPE_FLAGS.TOKEN) === TYPE_FLAGS.TOKEN) return "token";
  if ((normalized & TYPE_FLAGS.PENDULUM) === TYPE_FLAGS.PENDULUM) return "pendulum";
  if ((normalized & TYPE_FLAGS.EFFECT) === TYPE_FLAGS.EFFECT) return "effect";
  return "normal";
}

function getSpellTrapSubtype(typeValue) {
  const normalized = Number(typeValue || 0);
  const isSpell = (normalized & TYPE_FLAGS.SPELL) === TYPE_FLAGS.SPELL;
  const isTrap = (normalized & TYPE_FLAGS.TRAP) === TYPE_FLAGS.TRAP;
  if (!isSpell && !isTrap) return null;
  if ((normalized & TYPE_FLAGS.COUNTER) === TYPE_FLAGS.COUNTER) return "counter";
  if ((normalized & TYPE_FLAGS.FIELD) === TYPE_FLAGS.FIELD) return "field";
  if ((normalized & TYPE_FLAGS.EQUIP) === TYPE_FLAGS.EQUIP) return "equip";
  if ((normalized & TYPE_FLAGS.CONTINUOUS) === TYPE_FLAGS.CONTINUOUS) return "continuous";
  if ((normalized & TYPE_FLAGS.QUICKPLAY) === TYPE_FLAGS.QUICKPLAY) return "quickplay";
  if ((normalized & TYPE_FLAGS.RITUAL) === TYPE_FLAGS.RITUAL && isSpell) return "ritual";
  return "normal";
}

function matchesMonsterTraits(card, selectedTraits) {
  if (!selectedTraits.length) return true;

  const typeValue = Number(card.type || 0);

  for (const trait of selectedTraits) {
    if (trait === "pre_errata") {
      if (!isPreErrataCard(card)) return false;
      continue;
    }

    if (trait === "token_exact") {
      if (!isTokenMonster(card)) return false;
      continue;
    }

    const traitFlag = TRAIT_FLAG_MAP[trait];
    if (!traitFlag) continue;
    if ((typeValue & TYPE_FLAGS.MONSTER) !== TYPE_FLAGS.MONSTER) return false;
    if ((typeValue & traitFlag) !== traitFlag) return false;
  }

  return true;
}

function getLinkRating(typeValue, levelValue) {
  const normalizedType = Number(typeValue || 0);
  if ((normalizedType & TYPE_FLAGS.LINK) !== TYPE_FLAGS.LINK) return null;
  return Number(levelValue || 0) & 0xff;
}

function getPendulumScales(typeValue, levelValue) {
  const normalizedType = Number(typeValue || 0);
  if ((normalizedType & TYPE_FLAGS.PENDULUM) !== TYPE_FLAGS.PENDULUM) return null;
  const rawLevel = Number(levelValue || 0);
  return { left: (rawLevel >> 24) & 0xff, right: (rawLevel >> 16) & 0xff };
}

function getDisplayLevelOrRank(typeValue, levelValue) {
  const normalizedType = Number(typeValue || 0);
  const rawLevel = Number(levelValue || 0);
  if ((normalizedType & TYPE_FLAGS.LINK) === TYPE_FLAGS.LINK) return null;
  return rawLevel & 0xff;
}

function matchesLevelRange(card, minValue, maxValue) {
  if (minValue === "" && maxValue === "") return true;
  const displayValue = getDisplayLevelOrRank(card.type, card.level);
  if (displayValue == null) return false;
  if (minValue !== "" && displayValue < Number(minValue)) return false;
  if (maxValue !== "" && displayValue > Number(maxValue)) return false;
  return true;
}

function matchesLinkRange(card, minValue, maxValue) {
  if (minValue === "" && maxValue === "") return true;
  const linkValue = getLinkRating(card.type, card.level);
  if (linkValue == null) return false;
  if (minValue !== "" && linkValue < Number(minValue)) return false;
  if (maxValue !== "" && linkValue > Number(maxValue)) return false;
  return true;
}

function matchesPendulumScaleRange(card, minValue, maxValue) {
  if (minValue === "" && maxValue === "") return true;
  const scales = getPendulumScales(card.type, card.level);
  if (!scales) return false;
  const leftMatches =
    (minValue === "" || scales.left >= Number(minValue)) &&
    (maxValue === "" || scales.left <= Number(maxValue));
  const rightMatches =
    (minValue === "" || scales.right >= Number(minValue)) &&
    (maxValue === "" || scales.right <= Number(maxValue));
  return leftMatches || rightMatches;
}

function compareValues(a, b, direction) {
  const safeA = a ?? 0;
  const safeB = b ?? 0;

  if (typeof safeA === "string" || typeof safeB === "string") {
    const result = String(safeA).localeCompare(String(safeB));
    return direction === "asc" ? result : -result;
  }

  const result = Number(safeA) - Number(safeB);
  return direction === "asc" ? result : -result;
}

function DeckBuilderPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loadingPage, setLoadingPage] = useState(true);
  const [loadingSeries, setLoadingSeries] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [ownedCardMap, setOwnedCardMap] = useState(new Map());
  const [banlistMap, setBanlistMap] = useState(new Map());
  const [curseMap, setCurseMap] = useState(new Map());
  const [decks, setDecks] = useState([]);
  const [selectedDeckId, setSelectedDeckId] = useState(null);
  const [deckName, setDeckName] = useState("");
  const [deckSlots, setDeckSlots] = useState(BASE_DECK_SLOTS);
  const [deckState, setDeckState] = useState({
    main: new Map(),
    extra: new Map(),
    side: new Map(),
  });
  const [hoverPreview, setHoverPreview] = useState(null);
  const [imageModalCard, setImageModalCard] = useState(null);
  const [dragPayload, setDragPayload] = useState(null);
  const [activeDropSection, setActiveDropSection] = useState(null);
  const [mainCollapsed, setMainCollapsed] = useState(false);
  const [extraCollapsed, setExtraCollapsed] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [rightColumnHeight, setRightColumnHeight] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchMode, setSearchMode] = useState("name");
  const [sortField, setSortField] = useState("name");
  const [sortDirection, setSortDirection] = useState("asc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [quickFilter, setQuickFilter] = useState("all");
  const [cardKind, setCardKind] = useState("all");
  const [monsterSubtype, setMonsterSubtype] = useState("all");
  const [spellTrapSubtype, setSpellTrapSubtype] = useState("all");
  const [monsterTraits, setMonsterTraits] = useState([]);
  const [attribute, setAttribute] = useState("all");
  const [race, setRace] = useState("all");
  const [levelMin, setLevelMin] = useState("");
  const [levelMax, setLevelMax] = useState("");
  const [linkMin, setLinkMin] = useState("");
  const [linkMax, setLinkMax] = useState("");
  const [pendulumMin, setPendulumMin] = useState("");
  const [pendulumMax, setPendulumMax] = useState("");
  const [atkMin, setAtkMin] = useState("");
  const [atkMax, setAtkMax] = useState("");
  const [defMin, setDefMin] = useState("");
  const [defMax, setDefMax] = useState("");
  const leftColumnRef = useRef(null);

  useEffect(() => {
    async function resolveActiveSeries() {
      if (!user?.id) {
        setActiveSeriesId(null);
        setLoadingSeries(false);
        return;
      }

      setLoadingSeries(true);

      try {
        const { data: currentSeries, error } = await supabase
          .from("game_series")
          .select("id")
          .eq("is_current", true)
          .maybeSingle();

        if (error) throw error;
        setActiveSeriesId(currentSeries?.id || null);
      } catch (error) {
        console.error("Failed to resolve active series:", error);
        setActiveSeriesId(null);
      } finally {
        setLoadingSeries(false);
      }
    }

    if (!authLoading && user) {
      resolveActiveSeries();
    }
  }, [authLoading, user]);

  async function loadDeckCardsForDeck(deckId) {
    if (!deckId) {
      setDeckState({ main: new Map(), extra: new Map(), side: new Map() });
      return;
    }

    const { data, error } = await supabase
      .from("player_deck_cards")
      .select("card_id, section, quantity")
      .eq("deck_id", deckId);

    if (error) throw error;
    setDeckState(buildDeckState(normalizeDeckCardRows(data || [])));
  }

  async function loadPageData() {
    if (!user?.id || !activeSeriesId) {
      setOwnedCardMap(new Map());
      setBanlistMap(new Map());
      setCurseMap(new Map());
      setDecks([]);
      setSelectedDeckId(null);
      setDeckName("");
      setDeckState({ main: new Map(), extra: new Map(), side: new Map() });
      setLoadingPage(false);
      return;
    }

    setLoadingPage(true);
    setLoadError("");

    try {
      const [binderResponse, decksResponse, banlistResponse, cursesResponse, inventoryResponse] =
        await Promise.all([
          supabase
            .from("binder_cards_view")
            .select("*")
            .eq("user_id", user.id)
            .eq("series_id", activeSeriesId)
            .order("card_name", { ascending: true }),
          supabase
            .from("player_decks")
            .select("id, deck_name, is_active, is_valid, validation_summary")
            .eq("user_id", user.id)
            .eq("series_id", activeSeriesId)
            .order("created_at", { ascending: true }),
          supabase
            .from("series_banlist_cards")
            .select("card_id, status")
            .eq("series_id", activeSeriesId),
          supabase
            .from("player_card_curses")
            .select("card_id, is_active")
            .eq("series_id", activeSeriesId)
            .eq("target_user_id", user.id)
            .eq("is_active", true),
          supabase
            .from("player_inventory_view")
            .select("quantity, item_code")
            .eq("user_id", user.id)
            .eq("series_id", activeSeriesId),
        ]);

      if (binderResponse.error) throw binderResponse.error;
      if (decksResponse.error) throw decksResponse.error;
      if (banlistResponse.error) throw banlistResponse.error;
      if (cursesResponse.error) throw cursesResponse.error;
      if (inventoryResponse.error) throw inventoryResponse.error;

      const ownedMap = buildOwnedCardMap(normalizeBinderRows(binderResponse.data || []));
      const normalizedDecks = normalizeDeckRows(decksResponse.data || []);
      const deckCaseQuantity = (inventoryResponse.data || []).reduce((total, row) => {
        if (row.item_code !== "deck_case") return total;
        return total + Number(row.quantity || 0);
      }, 0);

      setOwnedCardMap(ownedMap);
      setBanlistMap(buildBanlistMap(banlistResponse.data || []));
      setCurseMap(buildCurseMap(cursesResponse.data || []));
      setDeckSlots(BASE_DECK_SLOTS + deckCaseQuantity);
      setDecks(normalizedDecks);

      const nextSelectedDeck =
        normalizedDecks.find((deck) => deck.id === selectedDeckId) ||
        normalizedDecks.find((deck) => deck.isActive) ||
        normalizedDecks[0] ||
        null;

      setSelectedDeckId(nextSelectedDeck?.id || null);
      setDeckName(nextSelectedDeck?.deckName || "");
      await loadDeckCardsForDeck(nextSelectedDeck?.id || null);
    } catch (error) {
      console.error("Failed to load deck builder:", error);
      setLoadError("Failed to load deck builder.");
    } finally {
      setLoadingPage(false);
    }
  }

  useEffect(() => {
    if (!authLoading && user && !loadingSeries) {
      loadPageData();
    }
  }, [authLoading, user, activeSeriesId, loadingSeries]);

  const validation = useMemo(
    () => validateDeck({ deckState, ownedCardMap, banlistMap, curseMap }),
    [deckState, ownedCardMap, banlistMap, curseMap]
  );

  const allOwnedCards = useMemo(
    () =>
      Array.from(ownedCardMap.values()).sort((a, b) =>
        String(a.card?.name || "").localeCompare(String(b.card?.name || ""))
      ),
    [ownedCardMap]
  );

  const showMonsterSubtypeFilter = cardKind === "all" || cardKind === "monster";
  const showSpellTrapSubtypeFilter =
    cardKind === "all" || cardKind === "spell" || cardKind === "trap";
  const showMonsterTraitsFilter = cardKind === "all" || cardKind === "monster";

  const binderCards = useMemo(() => {
    const loweredSearch = searchTerm.trim().toLowerCase();

    return allOwnedCards
      .map((entry) => {
        const cardId = String(entry.cardId);
        const banlistStatus = banlistMap.get(cardId)?.status || "unlimited";
        const usedQuantity = getAllUsedCount(deckState, cardId);
        const maxAllowed = Math.min(entry.ownedQuantity, getBanlistLimit(banlistStatus));
        const availableQuantity = Math.max(0, maxAllowed - usedQuantity);

        return {
          ...entry,
          usedQuantity,
          availableQuantity,
          banlistStatus,
          allowedSections: getAllowedSections(entry.card),
          isCursed: curseMap.has(cardId),
          kind: getCardKind(entry.card),
          monsterSubtypeKey: getMonsterSubtype(entry.card?.type),
          spellTrapSubtypeKey: getSpellTrapSubtype(entry.card?.type),
        };
      })
      .filter((entry) => {
        if (loweredSearch) {
          const haystack =
            searchMode === "desc"
              ? String(entry.card?.desc || "").toLowerCase()
              : String(entry.card?.name || "").toLowerCase();
          if (!haystack.includes(loweredSearch)) return false;
        }

        if (quickFilter === "main" && !entry.allowedSections.includes("main")) return false;
        if (quickFilter === "extra" && !entry.allowedSections.includes("extra")) return false;
        if (quickFilter === "available" && entry.availableQuantity <= 0) return false;
        if (quickFilter === "cursed" && !entry.isCursed) return false;
        if (cardKind !== "all" && entry.kind !== cardKind) return false;
        if (monsterSubtype !== "all" && entry.monsterSubtypeKey !== monsterSubtype) return false;
        if (spellTrapSubtype !== "all" && entry.spellTrapSubtypeKey !== spellTrapSubtype) return false;
        if (!matchesMonsterTraits(entry.card, monsterTraits)) return false;
        if (attribute !== "all" && Number(entry.card?.attribute || 0) !== Number(attribute)) return false;
        if (race !== "all" && Number(entry.card?.race || 0) !== Number(race)) return false;
        if (atkMin !== "" && Number(entry.card?.atk ?? -999999) < Number(atkMin)) return false;
        if (atkMax !== "" && Number(entry.card?.atk ?? 999999) > Number(atkMax)) return false;
        if (defMin !== "" && Number(entry.card?.def ?? -999999) < Number(defMin)) return false;
        if (defMax !== "" && Number(entry.card?.def ?? 999999) > Number(defMax)) return false;
        if (!matchesLevelRange(entry.card, levelMin, levelMax)) return false;
        if (!matchesLinkRange(entry.card, linkMin, linkMax)) return false;
        if (!matchesPendulumScaleRange(entry.card, pendulumMin, pendulumMax)) return false;
        return true;
      })
      .sort((a, b) => {
        switch (sortField) {
          case "owned":
            return compareValues(a.ownedQuantity, b.ownedQuantity, sortDirection);
          case "available":
            return compareValues(a.availableQuantity, b.availableQuantity, sortDirection);
          case "atk":
            return compareValues(a.card?.atk ?? -1, b.card?.atk ?? -1, sortDirection);
          case "def":
            return compareValues(a.card?.def ?? -1, b.card?.def ?? -1, sortDirection);
          case "level":
            return compareValues(
              getDisplayLevelOrRank(a.card?.type, a.card?.level) ?? -1,
              getDisplayLevelOrRank(b.card?.type, b.card?.level) ?? -1,
              sortDirection
            );
          default:
            return compareValues(a.card?.name || "", b.card?.name || "", sortDirection);
        }
      });
  }, [
    allOwnedCards,
    atkMax,
    atkMin,
    attribute,
    banlistMap,
    cardKind,
    curseMap,
    deckState,
    defMax,
    defMin,
    levelMax,
    levelMin,
    linkMax,
    linkMin,
    monsterSubtype,
    monsterTraits,
    pendulumMax,
    pendulumMin,
    quickFilter,
    race,
    searchMode,
    searchTerm,
    sortDirection,
    sortField,
    spellTrapSubtype,
  ]);

  const mainCards = useMemo(() => buildSectionSlots(deckState.main, ownedCardMap), [deckState.main, ownedCardMap]);
  const extraCards = useMemo(() => buildSectionSlots(deckState.extra, ownedCardMap), [deckState.extra, ownedCardMap]);
  const sideCards = useMemo(() => buildSectionSlots(deckState.side, ownedCardMap), [deckState.side, ownedCardMap]);

  const monsterCount = useMemo(() => {
    let total = 0;
    for (const [cardId, quantity] of deckState.main.entries()) {
      if (getCardKind(ownedCardMap.get(String(cardId))?.card) === "monster") total += Number(quantity || 0);
    }
    return total;
  }, [deckState.main, ownedCardMap]);

  const spellCount = useMemo(() => {
    let total = 0;
    for (const [cardId, quantity] of deckState.main.entries()) {
      if (getCardKind(ownedCardMap.get(String(cardId))?.card) === "spell") total += Number(quantity || 0);
    }
    return total;
  }, [deckState.main, ownedCardMap]);

  const trapCount = useMemo(() => {
    let total = 0;
    for (const [cardId, quantity] of deckState.main.entries()) {
      if (getCardKind(ownedCardMap.get(String(cardId))?.card) === "trap") total += Number(quantity || 0);
    }
    return total;
  }, [deckState.main, ownedCardMap]);

  useEffect(() => {
    const target = leftColumnRef.current;
    if (!target) return undefined;

    const syncHeight = () => {
      setRightColumnHeight(target.scrollHeight);
    };

    syncHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncHeight);
      return () => window.removeEventListener("resize", syncHeight);
    }

    const observer = new ResizeObserver(() => {
      syncHeight();
    });

    observer.observe(target);
    window.addEventListener("resize", syncHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncHeight);
    };
  }, [
    mainCollapsed,
    extraCollapsed,
    sideCollapsed,
    selectedDeckId,
    deckName,
    validation.summary,
    validation.isValid,
    validation.mainCount,
    validation.extraCount,
    validation.sideCount,
    mainCards.length,
    extraCards.length,
    sideCards.length,
  ]);

  function canAddCardToSection(cardId, section) {
    const ownedEntry = ownedCardMap.get(String(cardId));
    if (!ownedEntry?.card) return false;
    if (!getAllowedSections(ownedEntry.card).includes(section)) return false;
    if (curseMap.has(String(cardId))) return false;
    const ownedQuantity = Number(ownedEntry.ownedQuantity || 0);
    const usedQuantity = getAllUsedCount(deckState, cardId);
    const banlistStatus = banlistMap.get(String(cardId))?.status || "unlimited";
    return usedQuantity < Math.min(ownedQuantity, getBanlistLimit(banlistStatus));
  }

  function addCardToSection(cardId, section) {
    if (!canAddCardToSection(cardId, section)) return;
    setDeckState((prev) => {
      const next = { main: new Map(prev.main), extra: new Map(prev.extra), side: new Map(prev.side) };
      next[section].set(String(cardId), Number(next[section].get(String(cardId)) || 0) + 1);
      return next;
    });
  }

  function removeCardFromSection(cardId, section) {
    setHoverPreview(null);
    setImageModalCard(null);

    setDeckState((prev) => {
      const next = { main: new Map(prev.main), extra: new Map(prev.extra), side: new Map(prev.side) };
      const currentQty = Number(next[section].get(String(cardId)) || 0);
      if (currentQty <= 1) next[section].delete(String(cardId));
      else next[section].set(String(cardId), currentQty - 1);
      return next;
    });
  }

  function moveCardBetweenSections(cardId, fromSection, toSection) {
    if (!fromSection || !toSection || fromSection === toSection || !canAddCardToSection(cardId, toSection)) return;

    setDeckState((prev) => {
      const next = { main: new Map(prev.main), extra: new Map(prev.extra), side: new Map(prev.side) };
      const fromQty = Number(next[fromSection].get(String(cardId)) || 0);
      if (fromQty <= 0) return prev;
      if (fromQty === 1) next[fromSection].delete(String(cardId));
      else next[fromSection].set(String(cardId), fromQty - 1);
      next[toSection].set(String(cardId), Number(next[toSection].get(String(cardId)) || 0) + 1);
      return next;
    });
  }

  function onDragStartBinderCard(cardId) {
    setHoverPreview(null);
    setDragPayload({ source: "binder", cardId: String(cardId), fromSection: null });
  }

  function onDragStartDeckCard(cardId, fromSection) {
    setHoverPreview(null);
    setDragPayload({ source: "deck", cardId: String(cardId), fromSection });
  }

  function onDragEndCard() {
    setActiveDropSection(null);
    setDragPayload(null);
  }

  function onDragActivateSection(section) {
    if (dragPayload) setActiveDropSection(section);
  }

  function onDropToSection(section) {
    if (!dragPayload) return;
    if (dragPayload.source === "binder") addCardToSection(dragPayload.cardId, section);
    if (dragPayload.source === "deck") moveCardBetweenSections(dragPayload.cardId, dragPayload.fromSection, section);
    setActiveDropSection(null);
    setDragPayload(null);
  }

  function openCardImageModal(cardId) {
    setImageModalCard(ownedCardMap.get(String(cardId))?.card || null);
  }

  function showHoverCard(cardId, target) {
    const ownedEntry = ownedCardMap.get(String(cardId));
    if (!ownedEntry?.card || !target) return;
    const rect = target.getBoundingClientRect();
    const tooltipWidth = 360;
    const tooltipHeight = 310;
    const showRight = rect.right + tooltipWidth + 24 < window.innerWidth;
    const x = showRight ? rect.right + 14 : Math.max(12, rect.left - tooltipWidth - 14);
    const y = Math.min(window.innerHeight - tooltipHeight - 12, Math.max(12, rect.top - 8));
    const card = ownedEntry.card;
    const owned = Number(ownedEntry.ownedQuantity || 0);
    const used = getAllUsedCount(deckState, cardId);
    const available = Math.max(0, Math.min(owned, getBanlistLimit(banlistMap.get(String(cardId))?.status || "unlimited")) - used);
    const levelOrRank = getDisplayLevelOrRank(card.type, card.level);
    const linkRating = getLinkRating(card.type, card.level);

    setHoverPreview({
      card,
      x,
      y,
      lines: [
        `Owned ${owned} | Used ${used} | Available ${available}`,
        `Rule ${banlistMap.get(String(cardId))?.status || "unlimited"}${curseMap.has(String(cardId)) ? " | Cursed" : ""}`,
        `Sections ${getAllowedSections(card).join(", ")}`,
        `${decodeAttribute(card.attribute)} | ${decodeRace(card.race)}`,
        levelOrRank != null ? `Level / Rank ${levelOrRank}` : null,
        linkRating != null ? `Link ${linkRating}` : null,
        card.atk != null || card.def != null ? `ATK ${card.atk ?? "-"} | DEF ${card.def ?? "-"}` : null,
      ].filter(Boolean),
    });
  }

  function hideHoverCard() {
    setHoverPreview(null);
  }

  function handleMonsterTraitToggle(traitValue) {
    setMonsterTraits((current) =>
      current.includes(traitValue)
        ? current.filter((value) => value !== traitValue)
        : [...current, traitValue]
    );
  }

  function handleClearFilters() {
    setSearchTerm("");
    setSearchMode("name");
    setSortField("name");
    setSortDirection("asc");
    setQuickFilter("all");
    setCardKind("all");
    setMonsterSubtype("all");
    setSpellTrapSubtype("all");
    setMonsterTraits([]);
    setAttribute("all");
    setRace("all");
    setLevelMin("");
    setLevelMax("");
    setLinkMin("");
    setLinkMax("");
    setPendulumMin("");
    setPendulumMax("");
    setAtkMin("");
    setAtkMax("");
    setDefMin("");
    setDefMax("");
  }

  async function saveDeck() {
    if (!user?.id || !activeSeriesId) return;

    const trimmedName = deckName.trim() || "Unnamed Deck";
    const validationSummary = validation.isValid ? "Valid" : validation.summary;
    let deckId = selectedDeckId;

    try {
      if (!deckId) {
        if (decks.length >= deckSlots) {
          window.alert("No deck slots available.");
          return;
        }

        const { data, error } = await supabase
          .from("player_decks")
          .insert({
            user_id: user.id,
            series_id: activeSeriesId,
            deck_name: trimmedName,
            is_active: false,
            is_valid: validation.isValid,
            validation_summary: validationSummary,
          })
          .select("id")
          .single();

        if (error) throw error;
        deckId = data.id;
        setSelectedDeckId(deckId);
      } else {
        const { error } = await supabase
          .from("player_decks")
          .update({
            deck_name: trimmedName,
            is_valid: validation.isValid,
            validation_summary: validationSummary,
          })
          .eq("id", deckId);

        if (error) throw error;

        const { error: deleteError } = await supabase
          .from("player_deck_cards")
          .delete()
          .eq("deck_id", deckId);

        if (deleteError) throw deleteError;
      }

      const inserts = [];
      for (const section of ["main", "extra", "side"]) {
        for (const [cardId, quantity] of deckState[section].entries()) {
          inserts.push({
            deck_id: deckId,
            card_id: Number(cardId),
            section,
            quantity: Number(quantity || 0),
          });
        }
      }

      if (inserts.length) {
        const { error } = await supabase.from("player_deck_cards").insert(inserts);
        if (error) throw error;
      }

      await loadPageData();
    } catch (error) {
      console.error("Failed to save deck:", error);
      window.alert("Failed to save deck.");
    }
  }

  async function deleteDeck() {
    if (!selectedDeckId) return;

    try {
      const { error } = await supabase.from("player_decks").delete().eq("id", selectedDeckId);
      if (error) throw error;
      setSelectedDeckId(null);
      setDeckName("");
      setDeckState({ main: new Map(), extra: new Map(), side: new Map() });
      await loadPageData();
    } catch (error) {
      console.error("Failed to delete deck:", error);
      window.alert("Failed to delete deck.");
    }
  }

  async function duplicateDeck() {
    if (decks.length >= deckSlots) {
      window.alert("No deck slots available.");
      return;
    }

    setSelectedDeckId(null);
    setDeckName(`${deckName || "Deck"} Copy`);
  }

  async function setActiveDeck() {
    if (!selectedDeckId || !user?.id || !activeSeriesId) return;

    try {
      const { error: clearError } = await supabase
        .from("player_decks")
        .update({ is_active: false })
        .eq("user_id", user.id)
        .eq("series_id", activeSeriesId);

      if (clearError) throw clearError;

      const { error: setError } = await supabase
        .from("player_decks")
        .update({ is_active: true })
        .eq("id", selectedDeckId);

      if (setError) throw setError;

      await loadPageData();
    } catch (error) {
      console.error("Failed to set active deck:", error);
      window.alert("Failed to set active deck.");
    }
  }

  function exportDeck() {
    if (!validation.isValid) {
      window.alert("Only valid decks can be exported.");
      return;
    }

    const lines = ["#main"];
    for (const [cardId, quantity] of deckState.main.entries()) {
      for (let i = 0; i < quantity; i += 1) lines.push(String(cardId));
    }

    lines.push("#extra");
    for (const [cardId, quantity] of deckState.extra.entries()) {
      for (let i = 0; i < quantity; i += 1) lines.push(String(cardId));
    }

    lines.push("!side");
    for (const [cardId, quantity] of deckState.side.entries()) {
      for (let i = 0; i < quantity; i += 1) lines.push(String(cardId));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(deckName || "onyx-deck").replace(/[^\w\-]+/g, "_")}.ydk`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (user.role === "Blocked") return <Navigate to="/" replace />;
  if (user.role !== "Admin+" && user.role !== "Admin" && user.role !== "Duelist") {
    return <Navigate to="/mode" replace />;
  }

  return (
    <LauncherLayout>
      <div className="deck-builder-page">
        <div className="deck-builder-topbar">
          <div className="deck-builder-topbar-info">
            <h1 className="deck-builder-title">Deck Builder</h1>
            <p className="deck-builder-subtitle">
              Build from your owned progression cards with compact deck lanes, fast hover info, and full-image zoom on click.
            </p>
          </div>
        </div>

        {loadingPage || loadingSeries ? (
          <div className="deck-builder-empty">Loading deck builder...</div>
        ) : loadError ? (
          <div className="deck-builder-empty">{loadError}</div>
        ) : !activeSeriesId ? (
          <div className="deck-builder-empty">No active series.</div>
        ) : (
          <div className="deck-builder-layout deck-builder-layout-browser">
            <div className="deck-builder-left" ref={leftColumnRef}>
              <DeckHeader
                deckName={deckName}
                setDeckName={setDeckName}
                monsterCount={monsterCount}
                spellCount={spellCount}
                trapCount={trapCount}
                deckSlotLabel={`${decks.length || 0}/${deckSlots}`}
                onBack={() => navigate("/mode/progression")}
                onSave={saveDeck}
                onDuplicate={duplicateDeck}
                onDelete={deleteDeck}
                onSetActive={setActiveDeck}
                saveDisabled={!activeSeriesId}
                setActiveDisabled={!selectedDeckId}
              />

              <DeckMainSection
                cards={mainCards}
                count={validation.mainCount}
                collapsed={mainCollapsed}
                onToggleCollapsed={() => setMainCollapsed((current) => !current)}
                activeDropSection={activeDropSection}
                onDragActivateSection={onDragActivateSection}
                onDropToSection={onDropToSection}
                onDragStartCard={onDragStartDeckCard}
                onDragEndCard={onDragEndCard}
                onRemoveCard={removeCardFromSection}
                onOpenCardModal={openCardImageModal}
                onShowHoverCard={showHoverCard}
                onHideHoverCard={hideHoverCard}
                buildCardImageUrl={buildCardImageUrl}
              />

              <DeckExtraSection
                cards={extraCards}
                count={validation.extraCount}
                collapsed={extraCollapsed}
                onToggleCollapsed={() => setExtraCollapsed((current) => !current)}
                activeDropSection={activeDropSection}
                onDragActivateSection={onDragActivateSection}
                onDropToSection={onDropToSection}
                onDragStartCard={onDragStartDeckCard}
                onDragEndCard={onDragEndCard}
                onRemoveCard={removeCardFromSection}
                onOpenCardModal={openCardImageModal}
                onShowHoverCard={showHoverCard}
                onHideHoverCard={hideHoverCard}
                buildCardImageUrl={buildCardImageUrl}
              />

              <DeckSideSection
                cards={sideCards}
                count={validation.sideCount}
                collapsed={sideCollapsed}
                onToggleCollapsed={() => setSideCollapsed((current) => !current)}
                activeDropSection={activeDropSection}
                onDragActivateSection={onDragActivateSection}
                onDropToSection={onDropToSection}
                onDragStartCard={onDragStartDeckCard}
                onDragEndCard={onDragEndCard}
                onRemoveCard={removeCardFromSection}
                onOpenCardModal={openCardImageModal}
                onShowHoverCard={showHoverCard}
                onHideHoverCard={hideHoverCard}
                buildCardImageUrl={buildCardImageUrl}
              />

              <div className="deck-panel deck-builder-validation-panel">
                <div className="deck-panel-header">
                  <h2 className="deck-panel-title">Validation</h2>
                  <div className="deck-panel-count">
                    {validation.isValid ? "Valid" : validation.summary}
                  </div>
                </div>

                <div className="deck-header-controls">
                  <button
                    type="button"
                    className="deck-builder-action-btn"
                    onClick={exportDeck}
                    disabled={!validation.isValid}
                  >
                    Export .ydk
                  </button>
                </div>
              </div>
            </div>

            <div
              className="deck-builder-right deck-builder-right-browser"
              style={rightColumnHeight ? { height: `${rightColumnHeight}px` } : undefined}
            >
              <DeckBinderPanel
                cards={binderCards}
                totalCount={binderCards.length}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                searchMode={searchMode}
                setSearchMode={setSearchMode}
                sortField={sortField}
                setSortField={setSortField}
                sortDirection={sortDirection}
                setSortDirection={setSortDirection}
                filtersOpen={filtersOpen}
                setFiltersOpen={setFiltersOpen}
                SEARCH_MODE_OPTIONS={SEARCH_MODE_OPTIONS}
                SORT_OPTIONS={SORT_OPTIONS}
                QUICK_FILTER_OPTIONS={QUICK_FILTER_OPTIONS}
                onAddToMain={(cardId) => addCardToSection(cardId, "main")}
                onAddToExtra={(cardId) => addCardToSection(cardId, "extra")}
                onAddToSide={(cardId) => addCardToSection(cardId, "side")}
                onHoverCard={showHoverCard}
                onLeaveCard={hideHoverCard}
                onOpenCardModal={openCardImageModal}
                onDragStartBinderCard={onDragStartBinderCard}
                onDragEndCard={onDragEndCard}
                buildCardImageUrl={buildCardImageUrl}
              />
            </div>
          </div>
        )}
      </div>

      <DeckCardHoverTooltip preview={hoverPreview} buildCardImageUrl={buildCardImageUrl} />
      <DeckFilterModal
        isOpen={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        quickFilter={quickFilter}
        setQuickFilter={setQuickFilter}
        cardKind={cardKind}
        setCardKind={setCardKind}
        monsterSubtype={monsterSubtype}
        setMonsterSubtype={setMonsterSubtype}
        spellTrapSubtype={spellTrapSubtype}
        setSpellTrapSubtype={setSpellTrapSubtype}
        monsterTraits={monsterTraits}
        handleMonsterTraitToggle={handleMonsterTraitToggle}
        attribute={attribute}
        setAttribute={setAttribute}
        race={race}
        setRace={setRace}
        levelMin={levelMin}
        levelMax={levelMax}
        setLevelMin={setLevelMin}
        setLevelMax={setLevelMax}
        linkMin={linkMin}
        linkMax={linkMax}
        setLinkMin={setLinkMin}
        setLinkMax={setLinkMax}
        pendulumMin={pendulumMin}
        pendulumMax={pendulumMax}
        setPendulumMin={setPendulumMin}
        setPendulumMax={setPendulumMax}
        atkMin={atkMin}
        atkMax={atkMax}
        setAtkMin={setAtkMin}
        setAtkMax={setAtkMax}
        defMin={defMin}
        defMax={defMax}
        setDefMin={setDefMin}
        setDefMax={setDefMax}
        handleClearFilters={handleClearFilters}
        showMonsterSubtypeFilter={showMonsterSubtypeFilter}
        showSpellTrapSubtypeFilter={showSpellTrapSubtypeFilter}
        showMonsterTraitsFilter={showMonsterTraitsFilter}
        QUICK_FILTER_OPTIONS={QUICK_FILTER_OPTIONS}
        CARD_KIND_OPTIONS={CARD_KIND_OPTIONS}
        MONSTER_TYPE_OPTIONS={MONSTER_TYPE_OPTIONS}
        SPELL_TRAP_SUBTYPE_OPTIONS={SPELL_TRAP_SUBTYPE_OPTIONS}
        MONSTER_TRAIT_OPTIONS={MONSTER_TRAIT_OPTIONS}
        ATTRIBUTE_OPTIONS={ATTRIBUTE_OPTIONS}
        RACE_OPTIONS={RACE_OPTIONS}
      />
      <DeckCardImageModal
        card={imageModalCard}
        buildCardImageUrl={buildCardImageUrl}
        onClose={() => setImageModalCard(null)}
      />
    </LauncherLayout>
  );
}

export default DeckBuilderPage;
