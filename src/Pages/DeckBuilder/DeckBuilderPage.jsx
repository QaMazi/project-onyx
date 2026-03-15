import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";

import DeckHeader from "./Components/DeckHeader";
import DeckMainSection from "./Components/DeckMainSection";
import DeckExtraSection from "./Components/DeckExtraSection";
import DeckSideSection from "./Components/DeckSideSection";
import DeckBinderPanel from "./Components/DeckBinderPanel";
import DeckPagination from "./Components/DeckPagination";
import DeckHoverPreview from "./Components/DeckHoverPreview";

import "./DeckBuilderPage.css";

const TYPE_FLAGS = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
  FUSION: 0x40,
  RITUAL: 0x80,
  SYNCHRO: 0x2000,
  TOKEN: 0x4000,
  XYZ: 0x800000,
  PENDULUM: 0x1000000,
  LINK: 0x4000000,
};

const DEFAULT_COPY_LIMIT = 3;
const BASE_DECK_SLOTS = 1;
const BINDER_PAGE_SIZE = 12;
const MAIN_DECK_SLOT_COUNT = 60;
const EXTRA_DECK_SLOT_COUNT = 15;
const SIDE_DECK_SLOT_COUNT = 15;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

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
    case "unlimited":
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
    rarityId: row.rarity_id,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function normalizeDeckCardRows(rows) {
  return (rows || []).map((row) => ({
    id: row.id,
    deckId: row.deck_id,
    cardId: row.card_id,
    section: row.section,
    quantity: Number(row.quantity || 0),
  }));
}

function buildDeckState(deckCardRows) {
  const state = {
    main: new Map(),
    extra: new Map(),
    side: new Map(),
  };

  for (const row of deckCardRows) {
    if (!state[row.section]) continue;
    state[row.section].set(String(row.cardId), Number(row.quantity || 0));
  }

  return state;
}

function buildBanlistMap(rows) {
  const map = new Map();

  for (const row of rows || []) {
    map.set(String(row.card_id), {
      status: row.status || "unlimited",
      notes: row.notes || "",
    });
  }

  return map;
}

function buildCurseMap(rows) {
  const map = new Map();

  for (const row of rows || []) {
    if (!row.is_active) continue;
    map.set(String(row.card_id), {
      effectType: row.effect_type,
      notes: row.notes || "",
      roundNumber: row.round_number,
      expiresAt: row.expires_at,
    });
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

function buildSectionSlots(sectionMap, ownedCardMap, slotCount) {
  const slots = [];

  for (const [cardId, quantity] of sectionMap.entries()) {
    const owned = ownedCardMap.get(String(cardId));
    if (!owned?.card) continue;

    slots.push({
      cardId: owned.cardId,
      card: owned.card,
      quantity,
    });
  }

  slots.sort((a, b) =>
    String(a.card?.name || "").localeCompare(String(b.card?.name || ""))
  );

  while (slots.length < slotCount) {
    slots.push(null);
  }

  return slots.slice(0, slotCount);
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
      const isCursed = curseMap.has(String(cardId));
      const allowedSections = getAllowedSections(card);

      if (!ownedEntry) {
        errors.push(`Invalid — card not owned: ${cardId}`);
        continue;
      }

      if (!allowedSections.includes(section)) {
        errors.push(`Invalid — illegal section for ${card?.name || cardId}`);
      }

      if (isCursed) {
        errors.push(`Invalid — cursed card: ${card?.name || cardId}`);
      }

      if (totalUsed > ownedQuantity) {
        errors.push(`Invalid — card not owned in enough quantity: ${card?.name || cardId}`);
      }

      if (totalUsed > banlistLimit) {
        if (banlistStatus === "forbidden") {
          errors.push(`Invalid — forbidden card: ${card?.name || cardId}`);
        } else {
          errors.push(`Invalid — too many copies: ${card?.name || cardId}`);
        }
      }

      if (totalUsed > DEFAULT_COPY_LIMIT) {
        errors.push(`Invalid — exceeds default copy limit: ${card?.name || cardId}`);
      }

      if (quantity <= 0) {
        errors.push(`Invalid — zero quantity row: ${card?.name || cardId}`);
      }
    }
  }

  const mainCount = getSectionCount(deckState.main);
  const extraCount = getSectionCount(deckState.extra);
  const sideCount = getSectionCount(deckState.side);

  if (mainCount < 40) {
    errors.push(`Invalid — main deck must have at least 40 cards (currently ${mainCount})`);
  }
  if (mainCount > MAIN_DECK_SLOT_COUNT) {
    errors.push(`Invalid — main deck exceeds maximum of ${MAIN_DECK_SLOT_COUNT} cards (currently ${mainCount})`);
  }
  if (extraCount > EXTRA_DECK_SLOT_COUNT) {
    errors.push(`Invalid — extra deck exceeds maximum of ${EXTRA_DECK_SLOT_COUNT} cards (currently ${extraCount})`);
  }
  if (sideCount > SIDE_DECK_SLOT_COUNT) {
    errors.push(`Invalid — side deck exceeds maximum of ${SIDE_DECK_SLOT_COUNT} cards (currently ${sideCount})`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    summary: errors[0] || "Valid",
    mainCount,
    extraCount,
    sideCount,
  };
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

  const [hoveredCardId, setHoveredCardId] = useState(null);
  const [dragPayload, setDragPayload] = useState(null);
  const [activeDropSection, setActiveDropSection] = useState(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterValue, setFilterValue] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");

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
      .select(`
        id,
        deck_id,
        card_id,
        section,
        quantity,
        created_at
      `)
      .eq("deck_id", deckId);

    if (error) throw error;

    const normalizedDeckCards = normalizeDeckCardRows(data || []);
    setDeckState(buildDeckState(normalizedDeckCards));
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
      const [
        binderResponse,
        decksResponse,
        banlistResponse,
        cursesResponse,
        inventoryResponse,
      ] = await Promise.all([
        supabase
          .from("binder_cards_view")
          .select("*")
          .eq("user_id", user.id)
          .eq("series_id", activeSeriesId)
          .order("card_name", { ascending: true })
          .order("rarity_sort_order", { ascending: true }),

        supabase
          .from("player_decks")
          .select(`
            id,
            user_id,
            series_id,
            deck_name,
            is_active,
            is_valid,
            validation_summary,
            created_at,
            updated_at
          `)
          .eq("user_id", user.id)
          .eq("series_id", activeSeriesId)
          .order("created_at", { ascending: true }),

        supabase
          .from("series_banlist_cards")
          .select(`
            id,
            series_id,
            card_id,
            status,
            notes,
            created_at,
            updated_at
          `)
          .eq("series_id", activeSeriesId),

        supabase
          .from("player_card_curses")
          .select(`
            id,
            series_id,
            target_user_id,
            source_user_id,
            item_definition_id,
            card_id,
            effect_type,
            expires_at,
            round_number,
            is_active,
            notes,
            created_at,
            updated_at
          `)
          .eq("series_id", activeSeriesId)
          .eq("target_user_id", user.id)
          .eq("is_active", true),

        supabase
          .from("player_inventory_view")
          .select(`
            id,
            quantity,
            locked_quantity,
            available_quantity,
            item_code,
            item_name
          `)
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
      const builtBanlistMap = buildBanlistMap(banlistResponse.data || []);
      const builtCurseMap = buildCurseMap(cursesResponse.data || []);

      const deckCaseQuantity = (inventoryResponse.data || []).reduce((total, row) => {
        if (row.item_code !== "deck_case") return total;
        return total + Number(row.quantity || 0);
      }, 0);

      setOwnedCardMap(ownedMap);
      setBanlistMap(builtBanlistMap);
      setCurseMap(builtCurseMap);
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

  const validation = useMemo(() => {
    return validateDeck({
      deckState,
      ownedCardMap,
      banlistMap,
      curseMap,
    });
  }, [deckState, ownedCardMap, banlistMap, curseMap]);

  const allOwnedCards = useMemo(() => {
    return Array.from(ownedCardMap.values()).sort((a, b) =>
      String(a.card?.name || "").localeCompare(String(b.card?.name || ""))
    );
  }, [ownedCardMap]);

  const binderCards = useMemo(() => {
    const loweredSearch = searchTerm.trim().toLowerCase();

    return allOwnedCards
      .map((entry) => {
        const cardId = String(entry.cardId);
        const banlistStatus = banlistMap.get(cardId)?.status || "unlimited";
        const allowedSections = getAllowedSections(entry.card);
        const usedQuantity = getAllUsedCount(deckState, cardId);
        const maxAllowed = Math.min(
          entry.ownedQuantity,
          getBanlistLimit(banlistStatus)
        );
        const availableQuantity = Math.max(0, maxAllowed - usedQuantity);
        const isCursed = curseMap.has(cardId);
        const cardKind = getCardKind(entry.card);

        return {
          ...entry,
          usedQuantity,
          availableQuantity,
          banlistStatus,
          allowedSections,
          isCursed,
          cardKind,
        };
      })
      .filter((entry) => {
        if (loweredSearch) {
          const matchesSearch = String(entry.card?.name || "")
            .toLowerCase()
            .includes(loweredSearch);

          if (!matchesSearch) return false;
        }

        switch (filterValue) {
          case "main":
            return entry.allowedSections.includes("main");
          case "extra":
            return entry.allowedSections.includes("extra");
          case "spell":
            return entry.cardKind === "spell";
          case "trap":
            return entry.cardKind === "trap";
          case "monster":
            return entry.cardKind === "monster";
          case "available":
            return entry.availableQuantity > 0;
          case "cursed":
            return entry.isCursed;
          case "all":
          default:
            return true;
        }
      });
  }, [allOwnedCards, banlistMap, curseMap, deckState, filterValue, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(binderCards.length / BINDER_PAGE_SIZE));

  useEffect(() => {
    setCurrentPage((prev) => clamp(prev, 1, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  const pagedBinderCards = useMemo(() => {
    const start = (currentPage - 1) * BINDER_PAGE_SIZE;
    return binderCards.slice(start, start + BINDER_PAGE_SIZE);
  }, [binderCards, currentPage]);

  const mainSlots = useMemo(
    () => buildSectionSlots(deckState.main, ownedCardMap, MAIN_DECK_SLOT_COUNT),
    [deckState.main, ownedCardMap]
  );

  const extraSlots = useMemo(
    () => buildSectionSlots(deckState.extra, ownedCardMap, EXTRA_DECK_SLOT_COUNT),
    [deckState.extra, ownedCardMap]
  );

  const sideSlots = useMemo(
    () => buildSectionSlots(deckState.side, ownedCardMap, SIDE_DECK_SLOT_COUNT),
    [deckState.side, ownedCardMap]
  );

  const hoveredCard = useMemo(() => {
    if (!hoveredCardId) return null;
    return ownedCardMap.get(String(hoveredCardId))?.card || null;
  }, [hoveredCardId, ownedCardMap]);

  const hoveredUsage = useMemo(() => {
    if (!hoveredCardId) return null;

    const ownedEntry = ownedCardMap.get(String(hoveredCardId));
    const owned = Number(ownedEntry?.ownedQuantity || 0);
    const used = getAllUsedCount(deckState, hoveredCardId);
    const rule = getBanlistLimit(
      banlistMap.get(String(hoveredCardId))?.status || "unlimited"
    );

    return {
      owned,
      used,
      available: Math.max(0, Math.min(owned, rule) - used),
    };
  }, [hoveredCardId, ownedCardMap, deckState, banlistMap]);

  const hoveredBanlistStatus = hoveredCardId
    ? banlistMap.get(String(hoveredCardId))?.status || "unlimited"
    : "unlimited";

  const hoveredIsCursed = hoveredCardId
    ? curseMap.has(String(hoveredCardId))
    : false;

  const hoveredAllowedSections = hoveredCard ? getAllowedSections(hoveredCard) : [];

  const monsterCount = useMemo(() => {
    let total = 0;
    for (const [cardId, quantity] of deckState.main.entries()) {
      const card = ownedCardMap.get(String(cardId))?.card;
      if (getCardKind(card) === "monster") total += Number(quantity || 0);
    }
    return total;
  }, [deckState.main, ownedCardMap]);

  const spellCount = useMemo(() => {
    let total = 0;
    for (const [cardId, quantity] of deckState.main.entries()) {
      const card = ownedCardMap.get(String(cardId))?.card;
      if (getCardKind(card) === "spell") total += Number(quantity || 0);
    }
    return total;
  }, [deckState.main, ownedCardMap]);

  const trapCount = useMemo(() => {
    let total = 0;
    for (const [cardId, quantity] of deckState.main.entries()) {
      const card = ownedCardMap.get(String(cardId))?.card;
      if (getCardKind(card) === "trap") total += Number(quantity || 0);
    }
    return total;
  }, [deckState.main, ownedCardMap]);

  function canAddCardToSection(cardId, section) {
    const ownedEntry = ownedCardMap.get(String(cardId));
    if (!ownedEntry?.card) return false;

    const card = ownedEntry.card;
    const allowedSections = getAllowedSections(card);
    if (!allowedSections.includes(section)) return false;

    if (curseMap.has(String(cardId))) return false;

    const ownedQuantity = Number(ownedEntry.ownedQuantity || 0);
    const usedQuantity = getAllUsedCount(deckState, cardId);
    const banlistStatus = banlistMap.get(String(cardId))?.status || "unlimited";
    const maxAllowed = Math.min(ownedQuantity, getBanlistLimit(banlistStatus));

    return usedQuantity < maxAllowed;
  }

  function addCardToSection(cardId, section) {
    if (!canAddCardToSection(cardId, section)) return;

    setDeckState((prev) => {
      const next = {
        main: new Map(prev.main),
        extra: new Map(prev.extra),
        side: new Map(prev.side),
      };

      const currentQty = Number(next[section].get(String(cardId)) || 0);
      next[section].set(String(cardId), currentQty + 1);

      return next;
    });
  }

  function removeCardFromSection(cardId, section) {
    setDeckState((prev) => {
      const next = {
        main: new Map(prev.main),
        extra: new Map(prev.extra),
        side: new Map(prev.side),
      };

      const currentQty = Number(next[section].get(String(cardId)) || 0);

      if (currentQty <= 1) {
        next[section].delete(String(cardId));
      } else {
        next[section].set(String(cardId), currentQty - 1);
      }

      return next;
    });
  }

  function moveCardBetweenSections(cardId, fromSection, toSection) {
    if (!fromSection || !toSection || fromSection === toSection) return;
    if (!canAddCardToSection(cardId, toSection)) return;

    setDeckState((prev) => {
      const next = {
        main: new Map(prev.main),
        extra: new Map(prev.extra),
        side: new Map(prev.side),
      };

      const fromQty = Number(next[fromSection].get(String(cardId)) || 0);
      if (fromQty <= 0) return prev;

      if (fromQty === 1) {
        next[fromSection].delete(String(cardId));
      } else {
        next[fromSection].set(String(cardId), fromQty - 1);
      }

      const toQty = Number(next[toSection].get(String(cardId)) || 0);
      next[toSection].set(String(cardId), toQty + 1);

      return next;
    });
  }

  function onDragStartBinderCard(cardId) {
    setDragPayload({ source: "binder", cardId: String(cardId), fromSection: null });
  }

  function onDragStartDeckCard(cardId, fromSection) {
    setDragPayload({ source: "deck", cardId: String(cardId), fromSection });
  }

  function onDragEndCard() {
    setActiveDropSection(null);
    setDragPayload(null);
  }

  function onDropToSection(section) {
    setActiveDropSection(section);

    if (!dragPayload) return;

    if (dragPayload.source === "binder") {
      addCardToSection(dragPayload.cardId, section);
    }

    if (dragPayload.source === "deck") {
      moveCardBetweenSections(dragPayload.cardId, dragPayload.fromSection, section);
    }

    setActiveDropSection(null);
    setDragPayload(null);
  }

  async function saveDeck() {
    if (!user?.id || !activeSeriesId) return;

    const trimmedName = deckName.trim() || "Unnamed Deck";
    const validationSummary = validation.isValid ? "Valid" : validation.summary;

    let deckId = selectedDeckId;

    try {
      if (!deckId) {
        if (decks.length >= deckSlots) {
          alert("No deck slots available.");
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

      if (inserts.length > 0) {
        const { error } = await supabase
          .from("player_deck_cards")
          .insert(inserts);

        if (error) throw error;
      }

      await loadPageData();
    } catch (error) {
      console.error("Failed to save deck:", error);
      alert("Failed to save deck.");
    }
  }

  async function deleteDeck() {
    if (!selectedDeckId) return;

    try {
      const { error } = await supabase
        .from("player_decks")
        .delete()
        .eq("id", selectedDeckId);

      if (error) throw error;

      setSelectedDeckId(null);
      setDeckName("");
      setDeckState({ main: new Map(), extra: new Map(), side: new Map() });

      await loadPageData();
    } catch (error) {
      console.error("Failed to delete deck:", error);
      alert("Failed to delete deck.");
    }
  }

  async function duplicateDeck() {
    if (decks.length >= deckSlots) {
      alert("No deck slots available.");
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
      alert("Failed to set active deck.");
    }
  }

  function exportDeck() {
    if (!validation.isValid) {
      alert("Only valid decks can be exported.");
      return;
    }

    const lines = ["#main"];

    for (const [cardId, quantity] of deckState.main.entries()) {
      for (let i = 0; i < quantity; i += 1) {
        lines.push(String(cardId));
      }
    }

    lines.push("#extra");

    for (const [cardId, quantity] of deckState.extra.entries()) {
      for (let i = 0; i < quantity; i += 1) {
        lines.push(String(cardId));
      }
    }

    lines.push("!side");

    for (const [cardId, quantity] of deckState.side.entries()) {
      for (let i = 0; i < quantity; i += 1) {
        lines.push(String(cardId));
      }
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(deckName || "onyx-deck").replace(/[^\w\-]+/g, "_")}.ydk`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function goToPage() {
    const parsed = Number(pageInput || 1);
    setCurrentPage(clamp(Number.isFinite(parsed) ? parsed : 1, 1, totalPages));
  }

  if (authLoading) return null;

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (user.role === "Blocked") {
    return <Navigate to="/" replace />;
  }

  if (
    user.role !== "Admin+" &&
    user.role !== "Admin" &&
    user.role !== "Duelist"
  ) {
    return <Navigate to="/mode" replace />;
  }

  return (
    <LauncherLayout>
      <div className="deck-builder-page">
        <div className="deck-builder-topbar">
          <div className="deck-builder-topbar-info">
            <h1 className="deck-builder-title">Deck Builder</h1>
            <p className="deck-builder-subtitle">
              Use only cards you own in your binder for the active series.
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
          <div className="deck-builder-layout">
            <div className="deck-builder-left">
              <DeckHeader
                deckName={deckName}
                setDeckName={setDeckName}
                mainCount={validation.mainCount}
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
                slots={mainSlots}
                hoveredCardId={hoveredCardId}
                setHoveredCardId={setHoveredCardId}
                onRemoveCard={removeCardFromSection}
                onDropToSection={onDropToSection}
                onDragStartCard={onDragStartDeckCard}
                onDragEndCard={onDragEndCard}
                activeDropSection={activeDropSection}
                buildCardImageUrl={buildCardImageUrl}
              />

              <DeckExtraSection
                slots={extraSlots}
                setHoveredCardId={setHoveredCardId}
                onRemoveCard={removeCardFromSection}
                onDropToSection={onDropToSection}
                onDragStartCard={onDragStartDeckCard}
                onDragEndCard={onDragEndCard}
                activeDropSection={activeDropSection}
                buildCardImageUrl={buildCardImageUrl}
              />

              <DeckSideSection
                slots={sideSlots}
                setHoveredCardId={setHoveredCardId}
                onRemoveCard={removeCardFromSection}
                onDropToSection={onDropToSection}
                onDragStartCard={onDragStartDeckCard}
                onDragEndCard={onDragEndCard}
                activeDropSection={activeDropSection}
                buildCardImageUrl={buildCardImageUrl}
              />
            </div>

            <div className="deck-builder-right">
              <DeckHoverPreview
                hoveredCard={hoveredCard}
                hoveredUsage={hoveredUsage}
                hoveredBanlistStatus={hoveredBanlistStatus}
                hoveredIsCursed={hoveredIsCursed}
                hoveredAllowedSections={hoveredAllowedSections}
                buildCardImageUrl={buildCardImageUrl}
              />

              <DeckBinderPanel
                cards={pagedBinderCards}
                searchTerm={searchTerm}
                setSearchTerm={(value) => {
                  setSearchTerm(value);
                  setCurrentPage(1);
                }}
                filterValue={filterValue}
                setFilterValue={(value) => {
                  setFilterValue(value);
                  setCurrentPage(1);
                }}
                currentPage={currentPage}
                totalPages={totalPages}
                onAddToMain={(cardId) => addCardToSection(cardId, "main")}
                onAddToExtra={(cardId) => addCardToSection(cardId, "extra")}
                onAddToSide={(cardId) => addCardToSection(cardId, "side")}
                onHoverCard={setHoveredCardId}
                onLeaveCard={() => setHoveredCardId(null)}
                onDragStartBinderCard={onDragStartBinderCard}
                onDragEndCard={onDragEndCard}
                buildCardImageUrl={buildCardImageUrl}
              />

              <DeckPagination
                currentPage={currentPage}
                totalPages={totalPages}
                pageInput={pageInput}
                setPageInput={setPageInput}
                onPrevPage={() => setCurrentPage((prev) => clamp(prev - 1, 1, totalPages))}
                onNextPage={() => setCurrentPage((prev) => clamp(prev + 1, 1, totalPages))}
                onGoToPage={goToPage}
              />

              <div className="deck-panel">
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
          </div>
        )}
      </div>
    </LauncherLayout>
  );
}

export default DeckBuilderPage;
