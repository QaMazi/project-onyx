import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";
import useResponsiveGridPageSize from "../../hooks/useResponsiveGridPageSize";
import CardFilters from "./Components/CardFilters";
import CardGrid from "./Components/CardGrid";
import CardDetailPanel from "./Components/CardDetailPanel";
import Pagination from "./Components/Pagination";
import "./CardDatabasePage.css";

const CARD_IMAGE_FALLBACK =
  "https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/fallback_image.jpg";

const TYPE_FLAGS = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
  NORMAL: 0x10,
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
  SPECIAL_SUMMON: 0x2000000,
  LINK: 0x4000000,
  SKILL: 0x10000000,
};

const SEARCH_MODE_OPTIONS = [
  { label: "Name", value: "name" },
  { label: "Description", value: "desc" },
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

const OT_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Unknown / Unspecified", value: "0" },
  { label: "OCG", value: "1" },
  { label: "TCG", value: "2" },
  { label: "Shared Pool", value: "3" },
  { label: "Anime", value: "4" },
  { label: "Pre-Errata Pool", value: "8" },
];

const TRAIT_FLAG_MAP = {
  tuner: TYPE_FLAGS.TUNER,
  flip: TYPE_FLAGS.FLIP,
  gemini: TYPE_FLAGS.GEMINI,
  union: TYPE_FLAGS.UNION,
  spirit: TYPE_FLAGS.SPIRIT,
  toon: TYPE_FLAGS.TOON,
};

function buildCardImageUrl(card) {
  if (card?.image_url) return card.image_url;

  return `https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/${card.id}.jpg`;
}

function clampPage(page, totalPages) {
  if (totalPages <= 0) return 1;
  if (page < 1) return 1;
  if (page > totalPages) return totalPages;
  return page;
}

function buildVisiblePages(currentPage, totalPages) {
  if (totalPages <= 1) return [1];

  const pages = new Set([
    1,
    totalPages,
    currentPage - 2,
    currentPage - 1,
    currentPage,
    currentPage + 1,
    currentPage + 2,
  ]);

  return Array.from(pages)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
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

function decodeOt(value) {
  const normalized = String(value ?? "");
  return OT_OPTIONS.find((option) => option.value === normalized)?.label || `OT ${normalized || "Unknown"}`;
}

function isPreErrataCard(card) {
  const name = String(card?.name || "");
  return /\(pre-errata\)/i.test(name) || Number(card?.ot || 0) === 8;
}

function isTokenMonster(card) {
  const typeValue = Number(card?.type || 0);
  return (typeValue & TYPE_FLAGS.TOKEN) === TYPE_FLAGS.TOKEN;
}

function getCardKind(typeValue) {
  const normalized = Number(typeValue || 0);

  if ((normalized & TYPE_FLAGS.MONSTER) === TYPE_FLAGS.MONSTER) return "Monster";
  if ((normalized & TYPE_FLAGS.SPELL) === TYPE_FLAGS.SPELL) return "Spell";
  if ((normalized & TYPE_FLAGS.TRAP) === TYPE_FLAGS.TRAP) return "Trap";
  return "Unknown";
}

function getMonsterSubtype(typeValue) {
  const normalized = Number(typeValue || 0);
  const isMonster = (normalized & TYPE_FLAGS.MONSTER) === TYPE_FLAGS.MONSTER;

  if (!isMonster) return null;
  if ((normalized & TYPE_FLAGS.LINK) === TYPE_FLAGS.LINK) return "Link";
  if ((normalized & TYPE_FLAGS.XYZ) === TYPE_FLAGS.XYZ) return "Xyz";
  if ((normalized & TYPE_FLAGS.SYNCHRO) === TYPE_FLAGS.SYNCHRO) return "Synchro";
  if ((normalized & TYPE_FLAGS.FUSION) === TYPE_FLAGS.FUSION) return "Fusion";
  if ((normalized & TYPE_FLAGS.RITUAL) === TYPE_FLAGS.RITUAL) return "Ritual";
  if ((normalized & TYPE_FLAGS.TOKEN) === TYPE_FLAGS.TOKEN) return "Token";
  if ((normalized & TYPE_FLAGS.PENDULUM) === TYPE_FLAGS.PENDULUM) return "Pendulum";
  if ((normalized & TYPE_FLAGS.EFFECT) === TYPE_FLAGS.EFFECT) return "Effect";
  return "Normal";
}

function getSpellTrapSubtype(typeValue) {
  const normalized = Number(typeValue || 0);
  const isSpell = (normalized & TYPE_FLAGS.SPELL) === TYPE_FLAGS.SPELL;
  const isTrap = (normalized & TYPE_FLAGS.TRAP) === TYPE_FLAGS.TRAP;

  if (!isSpell && !isTrap) return null;
  if ((normalized & TYPE_FLAGS.COUNTER) === TYPE_FLAGS.COUNTER) return "Counter";
  if ((normalized & TYPE_FLAGS.FIELD) === TYPE_FLAGS.FIELD) return "Field";
  if ((normalized & TYPE_FLAGS.EQUIP) === TYPE_FLAGS.EQUIP) return "Equip";
  if ((normalized & TYPE_FLAGS.CONTINUOUS) === TYPE_FLAGS.CONTINUOUS) return "Continuous";
  if ((normalized & TYPE_FLAGS.QUICKPLAY) === TYPE_FLAGS.QUICKPLAY) return "Quick-Play";
  if ((normalized & TYPE_FLAGS.RITUAL) === TYPE_FLAGS.RITUAL && isSpell) return "Ritual";
  return "Normal";
}

function getMonsterTraits(typeValue) {
  const normalized = Number(typeValue || 0);
  const isMonster = (normalized & TYPE_FLAGS.MONSTER) === TYPE_FLAGS.MONSTER;

  if (!isMonster) return [];

  return MONSTER_TRAIT_OPTIONS.filter((trait) => {
    if (trait.value === "pre_errata" || trait.value === "token_exact") return false;
    return (normalized & TRAIT_FLAG_MAP[trait.value]) === TRAIT_FLAG_MAP[trait.value];
  }).map((trait) => trait.label);
}

function formatType(typeValue) {
  const normalized = Number(typeValue || 0);

  if (!normalized) return "Unknown";

  const parts = [];

  if (normalized & TYPE_FLAGS.MONSTER) parts.push("Monster");
  if (normalized & TYPE_FLAGS.SPELL) parts.push("Spell");
  if (normalized & TYPE_FLAGS.TRAP) parts.push("Trap");
  if (normalized & TYPE_FLAGS.NORMAL) parts.push("Normal");
  if (normalized & TYPE_FLAGS.EFFECT) parts.push("Effect");
  if (normalized & TYPE_FLAGS.FUSION) parts.push("Fusion");
  if (normalized & TYPE_FLAGS.RITUAL) parts.push("Ritual");
  if (normalized & TYPE_FLAGS.SPIRIT) parts.push("Spirit");
  if (normalized & TYPE_FLAGS.UNION) parts.push("Union");
  if (normalized & TYPE_FLAGS.GEMINI) parts.push("Gemini");
  if (normalized & TYPE_FLAGS.TUNER) parts.push("Tuner");
  if (normalized & TYPE_FLAGS.SYNCHRO) parts.push("Synchro");
  if (normalized & TYPE_FLAGS.TOKEN) parts.push("Token");
  if (normalized & TYPE_FLAGS.QUICKPLAY) parts.push("Quick-Play");
  if (normalized & TYPE_FLAGS.CONTINUOUS) parts.push("Continuous");
  if (normalized & TYPE_FLAGS.EQUIP) parts.push("Equip");
  if (normalized & TYPE_FLAGS.FIELD) parts.push("Field");
  if (normalized & TYPE_FLAGS.COUNTER) parts.push("Counter");
  if (normalized & TYPE_FLAGS.FLIP) parts.push("Flip");
  if (normalized & TYPE_FLAGS.TOON) parts.push("Toon");
  if (normalized & TYPE_FLAGS.XYZ) parts.push("Xyz");
  if (normalized & TYPE_FLAGS.PENDULUM) parts.push("Pendulum");
  if (normalized & TYPE_FLAGS.SPECIAL_SUMMON) parts.push("Special Summon");
  if (normalized & TYPE_FLAGS.LINK) parts.push("Link");
  if (normalized & TYPE_FLAGS.SKILL) parts.push("Skill");

  return parts.join(" / ") || "Unknown";
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
  const leftScale = (rawLevel >> 24) & 0xff;
  const rightScale = (rawLevel >> 16) & 0xff;

  return {
    left: leftScale,
    right: rightScale,
  };
}

function getDisplayLevelOrRank(typeValue, levelValue) {
  const normalizedType = Number(typeValue || 0);
  const rawLevel = Number(levelValue || 0);

  if ((normalizedType & TYPE_FLAGS.LINK) === TYPE_FLAGS.LINK) {
    return null;
  }

  return rawLevel & 0xff;
}

function createTypeIndexBuckets(typeRows) {
  const buckets = {
    monster: new Set(),
    spell: new Set(),
    trap: new Set(),

    monster_normal: new Set(),
    monster_effect: new Set(),
    monster_fusion: new Set(),
    monster_ritual: new Set(),
    monster_synchro: new Set(),
    monster_xyz: new Set(),
    monster_pendulum: new Set(),
    monster_link: new Set(),
    monster_token: new Set(),

    spell_normal: new Set(),
    spell_quickplay: new Set(),
    spell_continuous: new Set(),
    spell_equip: new Set(),
    spell_field: new Set(),
    spell_ritual: new Set(),

    trap_normal: new Set(),
    trap_continuous: new Set(),
    trap_counter: new Set(),

    trait_tuner: new Set(),
    trait_flip: new Set(),
    trait_gemini: new Set(),
    trait_union: new Set(),
    trait_spirit: new Set(),
    trait_toon: new Set(),
    trait_pre_errata: new Set(),
    trait_token_exact: new Set(),
  };

  for (const row of typeRows || []) {
    const typeValue = Number(row.type || 0);
    const id = row.id;

    if (isPreErrataCard(row)) {
      buckets.trait_pre_errata.add(id);
    }

    if (isTokenMonster(row)) {
      buckets.trait_token_exact.add(id);
    }

    if ((typeValue & TYPE_FLAGS.MONSTER) === TYPE_FLAGS.MONSTER) {
      buckets.monster.add(id);

      const monsterSubtype = getMonsterSubtype(typeValue)?.toLowerCase() || "normal";
      if (monsterSubtype === "normal") buckets.monster_normal.add(id);
      if (monsterSubtype === "effect") buckets.monster_effect.add(id);
      if (monsterSubtype === "fusion") buckets.monster_fusion.add(id);
      if (monsterSubtype === "ritual") buckets.monster_ritual.add(id);
      if (monsterSubtype === "synchro") buckets.monster_synchro.add(id);
      if (monsterSubtype === "xyz") buckets.monster_xyz.add(id);
      if (monsterSubtype === "pendulum") buckets.monster_pendulum.add(id);
      if (monsterSubtype === "link") buckets.monster_link.add(id);
      if (monsterSubtype === "token") buckets.monster_token.add(id);

      if ((typeValue & TYPE_FLAGS.TUNER) === TYPE_FLAGS.TUNER) buckets.trait_tuner.add(id);
      if ((typeValue & TYPE_FLAGS.FLIP) === TYPE_FLAGS.FLIP) buckets.trait_flip.add(id);
      if ((typeValue & TYPE_FLAGS.GEMINI) === TYPE_FLAGS.GEMINI) buckets.trait_gemini.add(id);
      if ((typeValue & TYPE_FLAGS.UNION) === TYPE_FLAGS.UNION) buckets.trait_union.add(id);
      if ((typeValue & TYPE_FLAGS.SPIRIT) === TYPE_FLAGS.SPIRIT) buckets.trait_spirit.add(id);
      if ((typeValue & TYPE_FLAGS.TOON) === TYPE_FLAGS.TOON) buckets.trait_toon.add(id);
    }

    if ((typeValue & TYPE_FLAGS.SPELL) === TYPE_FLAGS.SPELL) {
      buckets.spell.add(id);
      const subtype = getSpellTrapSubtype(typeValue)?.toLowerCase() || "normal";

      if (subtype === "normal") buckets.spell_normal.add(id);
      if (subtype === "quick-play") buckets.spell_quickplay.add(id);
      if (subtype === "continuous") buckets.spell_continuous.add(id);
      if (subtype === "equip") buckets.spell_equip.add(id);
      if (subtype === "field") buckets.spell_field.add(id);
      if (subtype === "ritual") buckets.spell_ritual.add(id);
    }

    if ((typeValue & TYPE_FLAGS.TRAP) === TYPE_FLAGS.TRAP) {
      buckets.trap.add(id);
      const subtype = getSpellTrapSubtype(typeValue)?.toLowerCase() || "normal";

      if (subtype === "normal") buckets.trap_normal.add(id);
      if (subtype === "continuous") buckets.trap_continuous.add(id);
      if (subtype === "counter") buckets.trap_counter.add(id);
    }
  }

  return buckets;
}

function intersectIdArrays(arrays) {
  const validArrays = arrays.filter(Array.isArray);

  if (validArrays.length === 0) {
    return null;
  }

  let current = new Set(validArrays[0]);

  for (let index = 1; index < validArrays.length; index += 1) {
    const nextSet = new Set(validArrays[index]);
    current = new Set([...current].filter((id) => nextSet.has(id)));
  }

  return Array.from(current);
}

function getMatchingIdsFromTypeIndex(
  typeIndex,
  cardKind,
  monsterSubtype,
  spellTrapSubtype,
  monsterTraits
) {
  if (!typeIndex) return null;

  const filters = [];
  const standardMonsterTraits = monsterTraits.filter(
    (trait) => trait !== "pre_errata" && trait !== "token_exact"
  );

  if (cardKind === "monster") filters.push(Array.from(typeIndex.monster));
  if (cardKind === "spell") filters.push(Array.from(typeIndex.spell));
  if (cardKind === "trap") filters.push(Array.from(typeIndex.trap));

  if (cardKind === "monster" || cardKind === "all") {
    if (monsterSubtype !== "all") {
      const map = {
        normal: typeIndex.monster_normal,
        effect: typeIndex.monster_effect,
        fusion: typeIndex.monster_fusion,
        ritual: typeIndex.monster_ritual,
        synchro: typeIndex.monster_synchro,
        xyz: typeIndex.monster_xyz,
        pendulum: typeIndex.monster_pendulum,
        link: typeIndex.monster_link,
        token: typeIndex.monster_token,
      };

      filters.push(Array.from(map[monsterSubtype] || []));
    }

    for (const trait of standardMonsterTraits) {
      const setKey = `trait_${trait}`;
      filters.push(Array.from(typeIndex[setKey] || []));
    }
  }

  if (monsterTraits.includes("pre_errata")) {
    filters.push(Array.from(typeIndex.trait_pre_errata || []));
  }

  if (monsterTraits.includes("token_exact")) {
    filters.push(Array.from(typeIndex.trait_token_exact || []));
  }

  if (cardKind === "spell") {
    const map = {
      normal: typeIndex.spell_normal,
      quickplay: typeIndex.spell_quickplay,
      continuous: typeIndex.spell_continuous,
      equip: typeIndex.spell_equip,
      field: typeIndex.spell_field,
      ritual: typeIndex.spell_ritual,
    };

    if (spellTrapSubtype !== "all") {
      filters.push(Array.from(map[spellTrapSubtype] || []));
    }
  }

  if (cardKind === "trap") {
    const map = {
      normal: typeIndex.trap_normal,
      continuous: typeIndex.trap_continuous,
      counter: typeIndex.trap_counter,
    };

    if (spellTrapSubtype !== "all") {
      filters.push(Array.from(map[spellTrapSubtype] || []));
    }
  }

  if (cardKind === "all" && spellTrapSubtype !== "all") {
    const merged = new Set();

    if (spellTrapSubtype === "normal") {
      typeIndex.spell_normal.forEach((id) => merged.add(id));
      typeIndex.trap_normal.forEach((id) => merged.add(id));
    }
    if (spellTrapSubtype === "continuous") {
      typeIndex.spell_continuous.forEach((id) => merged.add(id));
      typeIndex.trap_continuous.forEach((id) => merged.add(id));
    }
    if (spellTrapSubtype === "counter") {
      typeIndex.trap_counter.forEach((id) => merged.add(id));
    }
    if (spellTrapSubtype === "quickplay") {
      typeIndex.spell_quickplay.forEach((id) => merged.add(id));
    }
    if (spellTrapSubtype === "equip") {
      typeIndex.spell_equip.forEach((id) => merged.add(id));
    }
    if (spellTrapSubtype === "field") {
      typeIndex.spell_field.forEach((id) => merged.add(id));
    }
    if (spellTrapSubtype === "ritual") {
      typeIndex.spell_ritual.forEach((id) => merged.add(id));
    }

    filters.push(Array.from(merged));
  }

  return intersectIdArrays(filters);
}

function applyNumericRange(query, fieldName, minValue, maxValue) {
  let nextQuery = query;

  if (minValue !== "") {
    nextQuery = nextQuery.gte(fieldName, Number(minValue));
  }

  if (maxValue !== "") {
    nextQuery = nextQuery.lte(fieldName, Number(maxValue));
  }

  return nextQuery;
}

function applySharedFilters(
  query,
  searchMode,
  searchTerm,
  attribute,
  race,
  otValue,
  atkMin,
  atkMax,
  defMin,
  defMax
) {
  let nextQuery = query;

  if (searchTerm) {
    nextQuery = nextQuery.ilike(searchMode, `%${searchTerm}%`);
  }

  if (attribute !== "all") {
    nextQuery = nextQuery.eq("attribute", Number(attribute));
  }

  if (race !== "all") {
    nextQuery = nextQuery.eq("race", Number(race));
  }

  if (otValue !== "all") {
    nextQuery = nextQuery.eq("ot", Number(otValue));
  }

  nextQuery = applyNumericRange(nextQuery, "atk", atkMin, atkMax);
  nextQuery = applyNumericRange(nextQuery, "def", defMin, defMax);

  return nextQuery;
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

function matchesStrictFilters(
  card,
  cardKind,
  monsterSubtype,
  spellTrapSubtype,
  monsterTraits,
  levelMin,
  levelMax,
  linkMin,
  linkMax,
  pendulumMin,
  pendulumMax
) {
  const typeValue = Number(card.type || 0);
  const kind = getCardKind(typeValue);

  if (cardKind === "monster" && kind !== "Monster") return false;
  if (cardKind === "spell" && kind !== "Spell") return false;
  if (cardKind === "trap" && kind !== "Trap") return false;

  if (monsterSubtype !== "all") {
    if (kind !== "Monster") return false;
    if (getMonsterSubtype(typeValue)?.toLowerCase() !== monsterSubtype) return false;
  }

  if (spellTrapSubtype !== "all") {
    if (kind === "Spell" || kind === "Trap") {
      const subtype = (getSpellTrapSubtype(typeValue) || "Normal").toLowerCase();
      if (subtype !== spellTrapSubtype) return false;
    } else {
      return false;
    }
  }

  if (!matchesMonsterTraits(card, monsterTraits)) return false;
  if (!matchesLevelRange(card, levelMin, levelMax)) return false;
  if (!matchesLinkRange(card, linkMin, linkMax)) return false;
  if (!matchesPendulumScaleRange(card, pendulumMin, pendulumMax)) return false;

  return true;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCardTextToHtml(text) {
  if (!text) return "No description provided.";

  return escapeHtml(text)
    .replace(/\[b\](.*?)\[\/b\]/gis, "<strong>$1</strong>")
    .replace(/\[i\](.*?)\[\/i\]/gis, "<em>$1</em>")
    .replace(/\[u\](.*?)\[\/u\]/gis, "<u>$1</u>")
    .replace(/\[br\]/gi, "<br/>")
    .replace(/\r?\n/g, "<br/>");
}

function getPreviewRows(card) {
  if (!card) return [];

  const rows = [];
  const typeValue = Number(card.type || 0);
  const cardKind = getCardKind(typeValue);
  const monsterSubtype = getMonsterSubtype(typeValue);
  const spellTrapSubtype = getSpellTrapSubtype(typeValue);
  const monsterTraits = getMonsterTraits(typeValue);
  const isMonster = cardKind === "Monster";
  const isSpell = cardKind === "Spell";
  const isTrap = cardKind === "Trap";
  const isLink = (typeValue & TYPE_FLAGS.LINK) === TYPE_FLAGS.LINK;
  const displayLevelOrRank = getDisplayLevelOrRank(typeValue, card.level);
  const linkRating = getLinkRating(typeValue, card.level);
  const pendulumScales = getPendulumScales(typeValue, card.level);

  rows.push({ label: "Card Kind", value: cardKind });

  if (isMonster && monsterSubtype) {
    rows.push({ label: "Monster Type", value: monsterSubtype });
  }

  if (isMonster && monsterTraits.length > 0) {
    rows.push({ label: "Monster Traits", value: monsterTraits.join(", ") });
  }

  if (isPreErrataCard(card)) {
    rows.push({ label: "Version", value: "Pre-Errata" });
  }

  if (isTokenMonster(card)) {
    rows.push({ label: "Token", value: "Yes" });
  }

  if ((isSpell || isTrap) && spellTrapSubtype) {
    rows.push({ label: "Spell / Trap Type", value: spellTrapSubtype });
  }

  rows.push({ label: "Type", value: formatType(typeValue) });

  if (isMonster) {
    rows.push({ label: "Race", value: decodeRace(card.race) });

    if (Number(card.attribute || 0) > 0) {
      rows.push({ label: "Attribute", value: decodeAttribute(card.attribute) });
    }

    if (displayLevelOrRank != null) {
      rows.push({
        label: monsterSubtype === "Xyz" ? "Rank" : "Level",
        value: displayLevelOrRank,
      });
    }

    if (linkRating != null) {
      rows.push({ label: "Link Rating", value: linkRating });
    }

    if (pendulumScales) {
      rows.push({
        label: "Pendulum Scale",
        value: `${pendulumScales.left} / ${pendulumScales.right}`,
      });
    }

    if (card.atk != null) {
      rows.push({ label: "ATK", value: card.atk });
    }

    if (!isLink && card.def != null) {
      rows.push({ label: "DEF", value: card.def });
    }
  }

  rows.push({ label: "OT", value: decodeOt(card.ot) });

  if (card.setcode) {
    rows.push({ label: "Setcode", value: card.setcode });
  }

  return rows;
}

function CardDatabasePage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchMode, setSearchMode] = useState("name");

  const [cardKind, setCardKind] = useState("all");
  const [monsterSubtype, setMonsterSubtype] = useState("all");
  const [spellTrapSubtype, setSpellTrapSubtype] = useState("all");
  const [monsterTraits, setMonsterTraits] = useState([]);
  const [attribute, setAttribute] = useState("all");
  const [race, setRace] = useState("all");
  const [otValue, setOtValue] = useState("all");

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

  const [cards, setCards] = useState([]);
  const [lockedCard, setLockedCard] = useState(null);
  const [hoveredCard, setHoveredCard] = useState(null);
  const [page, setPage] = useState(1);
  const [pageJumpInput, setPageJumpInput] = useState("1");
  const [totalCount, setTotalCount] = useState(0);
  const [loadingCards, setLoadingCards] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [typeIndexLoading, setTypeIndexLoading] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);

  const typeIndexRef = useRef(null);
  const gridCardRef = useRef(null);

  const cardDatabasePageSizeOptions = useMemo(
    () => ({
      fallback: 50,
      minPageSize: 6,
      minColumnWidth: 138,
      columnGap: 14,
      rowGap: 16,
      paddingX: 32,
      paddingY: 32,
      textHeight: 34,
      extraHeight: 12,
    }),
    []
  );

  const pageSize = useResponsiveGridPageSize(gridCardRef, cardDatabasePageSizeOptions);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const visiblePages = useMemo(
    () => buildVisiblePages(page, totalPages),
    [page, totalPages]
  );

  const previewCard = hoveredCard || lockedCard || cards[0] || null;
  const previewRows = useMemo(() => getPreviewRows(previewCard), [previewCard]);

  const hasComputedFilters =
    levelMin !== "" ||
    levelMax !== "" ||
    linkMin !== "" ||
    linkMax !== "" ||
    pendulumMin !== "" ||
    pendulumMax !== "";

  const showMonsterSubtypeFilter = cardKind !== "spell" && cardKind !== "trap";
  const showSpellTrapSubtypeFilter = cardKind !== "monster";
  const showMonsterTraitsFilter = true;

  useEffect(() => {
    setPageJumpInput(String(page));
  }, [page]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearchTerm(searchInput.trim());
      setPage(1);
    }, 250);

    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [
    searchMode,
    cardKind,
    monsterSubtype,
    spellTrapSubtype,
    monsterTraits,
    attribute,
    race,
    otValue,
    levelMin,
    levelMax,
    linkMin,
    linkMax,
    pendulumMin,
    pendulumMax,
    atkMin,
    atkMax,
    defMin,
    defMax,
  ]);

  useEffect(() => {
    if (!showMonsterSubtypeFilter && monsterSubtype !== "all") {
      setMonsterSubtype("all");
    }
  }, [showMonsterSubtypeFilter, monsterSubtype]);

  useEffect(() => {
    if (!showSpellTrapSubtypeFilter && spellTrapSubtype !== "all") {
      setSpellTrapSubtype("all");
    }
  }, [showSpellTrapSubtypeFilter, spellTrapSubtype]);

  useEffect(() => {
    async function loadTypeIndex() {
      if (typeIndexRef.current) return;

      setTypeIndexLoading(true);

      try {
        const { data, error } = await supabase
          .from("cards")
          .select("id, type, name, ot")
          .not("type", "is", null);

        if (error) {
          throw error;
        }

        typeIndexRef.current = createTypeIndexBuckets(data || []);
      } catch (error) {
        console.error("Failed to build card type index:", error);
      } finally {
        setTypeIndexLoading(false);
      }
    }

    if (!authLoading && user) {
      loadTypeIndex();
    }
  }, [authLoading, user]);

  useEffect(() => {
    async function fetchCards() {
      setLoadingCards(true);
      setLoadError("");

      try {
        const matchingIds = getMatchingIdsFromTypeIndex(
          typeIndexRef.current,
          cardKind,
          showMonsterSubtypeFilter ? monsterSubtype : "all",
          showSpellTrapSubtypeFilter ? spellTrapSubtype : "all",
          monsterTraits
        );

        if (Array.isArray(matchingIds) && matchingIds.length === 0) {
          setCards([]);
          setLockedCard(null);
          setHoveredCard(null);
          setTotalCount(0);
          setLoadingCards(false);
          return;
        }

        let fetchedRows = [];
        let resolvedTotalCount = 0;

        if (!hasComputedFilters && !Array.isArray(matchingIds)) {
          let countQuery = supabase
            .from("cards")
            .select("id", { count: "exact", head: true });

          countQuery = applySharedFilters(
            countQuery,
            searchMode,
            searchTerm,
            attribute,
            race,
            otValue,
            atkMin,
            atkMax,
            defMin,
            defMax
          );

          const { count, error: countError } = await countQuery;
          if (countError) throw countError;

          resolvedTotalCount = count || 0;
          const resolvedTotalPages = Math.max(1, Math.ceil(resolvedTotalCount / pageSize));
          const resolvedPage = clampPage(page, resolvedTotalPages);

          if (resolvedPage !== page) {
            setPage(resolvedPage);
            setTotalCount(resolvedTotalCount);
            setLoadingCards(false);
            return;
          }

          const start = (resolvedPage - 1) * pageSize;
          const end = start + pageSize - 1;

          let query = supabase
            .from("cards")
            .select("id, ot, name, desc, type, race, attribute, level, atk, def, setcode, image_url");

          query = applySharedFilters(
            query,
            searchMode,
            searchTerm,
            attribute,
            race,
            otValue,
            atkMin,
            atkMax,
            defMin,
            defMax
          );

          const { data, error } = await query
            .order("name", { ascending: true })
            .range(start, end);

          if (error) throw error;

          fetchedRows = data || [];
          setTotalCount(resolvedTotalCount);
        } else {
          let baseCountQuery = supabase
            .from("cards")
            .select("id", { count: "exact", head: true });

          baseCountQuery = applySharedFilters(
            baseCountQuery,
            searchMode,
            searchTerm,
            attribute,
            race,
            otValue,
            atkMin,
            atkMax,
            defMin,
            defMax
          );

          if (Array.isArray(matchingIds)) {
            baseCountQuery = baseCountQuery.in("id", matchingIds);
          }

          const { count, error: countError } = await baseCountQuery;
          if (countError) throw countError;

          const roughCount = count || 0;
          const resolvedTotalPages = Math.max(1, Math.ceil(roughCount / pageSize));
          const resolvedPage = clampPage(page, resolvedTotalPages);

          if (resolvedPage !== page) {
            setPage(resolvedPage);
            setTotalCount(roughCount);
            setLoadingCards(false);
            return;
          }

          const start = (resolvedPage - 1) * pageSize;
          const end = start + pageSize - 1;

          if (Array.isArray(matchingIds) && matchingIds.length > 0) {
            const chunks = chunkArray(matchingIds, 500);
            const collectedRows = [];

            for (const chunk of chunks) {
              let chunkQuery = supabase
                .from("cards")
                .select("id, ot, name, desc, type, race, attribute, level, atk, def, setcode, image_url")
                .in("id", chunk);

              chunkQuery = applySharedFilters(
                chunkQuery,
                searchMode,
                searchTerm,
                attribute,
                race,
                otValue,
                atkMin,
                atkMax,
                defMin,
                defMax
              );

              const { data: chunkRows, error: chunkError } = await chunkQuery.order("name", {
                ascending: true,
              });

              if (chunkError) throw chunkError;

              collectedRows.push(...(chunkRows || []));
            }

            const filteredRows = collectedRows.filter((card) =>
              matchesStrictFilters(
                card,
                cardKind,
                monsterSubtype,
                spellTrapSubtype,
                monsterTraits,
                levelMin,
                levelMax,
                linkMin,
                linkMax,
                pendulumMin,
                pendulumMax
              )
            );

            filteredRows.sort((a, b) => a.name.localeCompare(b.name));
            resolvedTotalCount = filteredRows.length;
            fetchedRows = filteredRows.slice(start, end + 1);
            setTotalCount(resolvedTotalCount);
          } else {
            let query = supabase
              .from("cards")
              .select("id, ot, name, desc, type, race, attribute, level, atk, def, setcode, image_url");

            query = applySharedFilters(
              query,
              searchMode,
              searchTerm,
              attribute,
              race,
              otValue,
              atkMin,
              atkMax,
              defMin,
              defMax
            );

            const { data, error } = await query.order("name", { ascending: true });
            if (error) throw error;

            const filteredRows = (data || []).filter((card) =>
              matchesStrictFilters(
                card,
                cardKind,
                monsterSubtype,
                spellTrapSubtype,
                monsterTraits,
                levelMin,
                levelMax,
                linkMin,
                linkMax,
                pendulumMin,
                pendulumMax
              )
            );

            resolvedTotalCount = filteredRows.length;
            fetchedRows = filteredRows.slice(start, end + 1);
            setTotalCount(resolvedTotalCount);
          }
        }

        setCards(fetchedRows);
        setLockedCard((currentLockedCard) => {
          if (currentLockedCard) {
            const stillExists = fetchedRows.find((card) => card.id === currentLockedCard.id);
            if (stillExists) return stillExists;
          }

          return fetchedRows[0] || null;
        });
        setHoveredCard(null);
      } catch (error) {
        console.error("Failed to fetch cards:", error);
        setCards([]);
        setLockedCard(null);
        setHoveredCard(null);
        setTotalCount(0);
        setLoadError("Failed to load card database.");
      } finally {
        setLoadingCards(false);
      }
    }

    if (!authLoading && user) {
      fetchCards();
    }
  }, [
    authLoading,
    user,
    searchMode,
    searchTerm,
    cardKind,
    monsterSubtype,
    spellTrapSubtype,
    monsterTraits,
    attribute,
    race,
    otValue,
    levelMin,
    levelMax,
    linkMin,
    linkMax,
    pendulumMin,
    pendulumMax,
    atkMin,
    atkMax,
    defMin,
    defMax,
    page,
    pageSize,
    hasComputedFilters,
    showMonsterSubtypeFilter,
    showSpellTrapSubtypeFilter,
  ]);

  function handleMonsterTraitToggle(traitValue) {
    setMonsterTraits((currentTraits) => {
      if (currentTraits.includes(traitValue)) {
        return currentTraits.filter((value) => value !== traitValue);
      }

      return [...currentTraits, traitValue];
    });
  }

  function handleClearFilters() {
    setSearchInput("");
    setSearchTerm("");
    setSearchMode("name");
    setCardKind("all");
    setMonsterSubtype("all");
    setSpellTrapSubtype("all");
    setMonsterTraits([]);
    setAttribute("all");
    setRace("all");
    setOtValue("all");
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
    setPage(1);
  }

  if (authLoading) return null;

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (user.role === "Blocked") {
    return <Navigate to="/mode" replace />;
  }

  return (
    <LauncherLayout>
      <div className="card-database-root">
        <div className="card-database-topbar">
          <button
            type="button"
            className="card-database-back-btn"
            onClick={() => navigate("/mode/progression")}
          >
            Back
          </button>

          <input
            type="text"
            className="card-database-search-input"
            placeholder="Search cards..."
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />

          <select
            className="card-database-search-mode"
            value={searchMode}
            onChange={(event) => setSearchMode(event.target.value)}
          >
            {SEARCH_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card-database-layout">
          <CardFilters
            totalCount={totalCount}
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
            otValue={otValue}
            setOtValue={setOtValue}
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
            CARD_KIND_OPTIONS={CARD_KIND_OPTIONS}
            MONSTER_TYPE_OPTIONS={MONSTER_TYPE_OPTIONS}
            SPELL_TRAP_SUBTYPE_OPTIONS={SPELL_TRAP_SUBTYPE_OPTIONS}
            MONSTER_TRAIT_OPTIONS={MONSTER_TRAIT_OPTIONS}
            ATTRIBUTE_OPTIONS={ATTRIBUTE_OPTIONS}
            RACE_OPTIONS={RACE_OPTIONS}
            OT_OPTIONS={OT_OPTIONS}
          />

          <main className="card-database-center-panel">
            <CardGrid
              loadError={loadError}
              loadingCards={loadingCards}
              typeIndexLoading={typeIndexLoading}
              cards={cards}
              gridCardRef={gridCardRef}
              lockedCard={lockedCard}
              hoveredCard={hoveredCard}
              setHoveredCard={setHoveredCard}
              setLockedCard={setLockedCard}
              setImageModalOpen={setImageModalOpen}
              buildCardImageUrl={buildCardImageUrl}
              CARD_IMAGE_FALLBACK={CARD_IMAGE_FALLBACK}
            />

            <Pagination
              page={page}
              setPage={setPage}
              totalPages={totalPages}
              visiblePages={visiblePages}
              pageJumpInput={pageJumpInput}
              setPageJumpInput={setPageJumpInput}
              clampPage={clampPage}
            />
          </main>

          <CardDetailPanel
            previewCard={previewCard}
            previewRows={previewRows}
            buildCardImageUrl={buildCardImageUrl}
            CARD_IMAGE_FALLBACK={CARD_IMAGE_FALLBACK}
            setImageModalOpen={setImageModalOpen}
            formatCardTextToHtml={formatCardTextToHtml}
          />
        </div>
      </div>

      {imageModalOpen && previewCard && (
        <div
          className="card-image-modal"
          onClick={() => setImageModalOpen(false)}
        >
          <img
            src={buildCardImageUrl(previewCard)}
            alt={previewCard.name}
            className="card-image-modal-img"
          />
        </div>
      )}
    </LauncherLayout>
  );
}

export default CardDatabasePage;
