import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";

import BinderFilters from "./Components/BinderFilters";
import BinderGrid from "./Components/BinderGrid";
import BinderDetailPanel from "./Components/BinderDetailPanel";
import BinderPagination from "./Components/BinderPagination";

import "./BinderPage.css";

const PAGE_SIZE = 24;
const CARD_IMAGE_FALLBACK =
  "https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/fallback_image.jpg";

function buildCardImageUrl(card) {
  if (card?.image_url) return card.image_url;

  return `https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/${card?.id}.jpg`;
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
    .filter((pageNumber) => pageNumber >= 1 && pageNumber <= totalPages)
    .sort((a, b) => a - b);
}

function normalizeBinderRows(rows) {
  return (rows || []).map((row) => ({
    id: row.id,
    quantity: Number(row.quantity || 0),
    isTradeLocked: Boolean(row.is_trade_locked),
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
    rarity: {
      id: row.rarity_id,
      code: row.rarity_code,
      name: row.rarity_name,
      sort_order: row.rarity_sort_order,
      shard_value: row.rarity_shard_value,
    },
  }));
}

function groupBinderCards(rows) {
  const groupedMap = new Map();

  for (const row of rows) {
    if (!row.card) continue;

    const groupKey = String(row.cardId);

    if (!groupedMap.has(groupKey)) {
      groupedMap.set(groupKey, {
        groupKey,
        cardId: row.cardId,
        card: row.card,
        totalQuantity: 0,
        totalLockedQuantity: 0,
        copies: [],
        rarities: [],
      });
    }

    const group = groupedMap.get(groupKey);
    group.copies.push(row);
    group.totalQuantity += row.quantity;

    if (row.isTradeLocked) {
      group.totalLockedQuantity += row.quantity;
    }
  }

  const groupedCards = Array.from(groupedMap.values()).map((group) => {
    const rarityMap = new Map();

    for (const copy of group.copies) {
      const rarityKey = copy.rarityId || "unknown";

      if (!rarityMap.has(rarityKey)) {
        rarityMap.set(rarityKey, {
          rarityId: copy.rarityId,
          rarity: copy.rarity,
          quantity: 0,
          lockedQuantity: 0,
        });
      }

      const rarityEntry = rarityMap.get(rarityKey);
      rarityEntry.quantity += copy.quantity;

      if (copy.isTradeLocked) {
        rarityEntry.lockedQuantity += copy.quantity;
      }
    }

    const rarities = Array.from(rarityMap.values()).sort((a, b) => {
      const aOrder = Number(a.rarity?.sort_order ?? 9999);
      const bOrder = Number(b.rarity?.sort_order ?? 9999);

      if (aOrder !== bOrder) return aOrder - bOrder;

      const aName = String(a.rarity?.name || "");
      const bName = String(b.rarity?.name || "");
      return aName.localeCompare(bName);
    });

    return {
      ...group,
      rarities,
    };
  });

  groupedCards.sort((a, b) => {
    const aName = String(a.card?.name || "");
    const bName = String(b.card?.name || "");
    return aName.localeCompare(bName);
  });

  return groupedCards;
}

function BinderPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [loadingSeries, setLoadingSeries] = useState(true);

  const [binderGroups, setBinderGroups] = useState([]);
  const [loadingBinder, setLoadingBinder] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const [selectedGroupKey, setSelectedGroupKey] = useState(null);
  const [hoveredGroupKey, setHoveredGroupKey] = useState(null);

  const [page, setPage] = useState(1);
  const [pageJumpInput, setPageJumpInput] = useState("1");

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearchTerm(searchInput.trim().toLowerCase());
      setPage(1);
    }, 200);

    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    setPageJumpInput(String(page));
  }, [page]);

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
        console.error("Failed to resolve active binder series:", error);
        setActiveSeriesId(null);
      } finally {
        setLoadingSeries(false);
      }
    }

    if (!authLoading && user) {
      resolveActiveSeries();
    }
  }, [authLoading, user]);

  useEffect(() => {
    async function fetchBinder() {
      if (!user?.id) {
        setBinderGroups([]);
        setLoadingBinder(false);
        return;
      }

      if (!activeSeriesId) {
        setBinderGroups([]);
        setLoadingBinder(false);
        return;
      }

      setLoadingBinder(true);
      setLoadError("");

      try {
        const { data, error } = await supabase
          .from("binder_cards_view")
          .select("*")
          .eq("user_id", user.id)
          .eq("series_id", activeSeriesId)
          .order("card_name", { ascending: true })
          .order("rarity_sort_order", { ascending: true });

        if (error) throw error;

        const normalizedRows = normalizeBinderRows(data || []);
        const groupedCards = groupBinderCards(normalizedRows);

        setBinderGroups(groupedCards);
      } catch (error) {
        console.error("Failed to fetch binder:", error);
        setBinderGroups([]);
        setLoadError("Failed to load binder.");
      } finally {
        setLoadingBinder(false);
      }
    }

    if (!authLoading && user && !loadingSeries) {
      fetchBinder();
    }
  }, [authLoading, user, activeSeriesId, loadingSeries]);

  const filteredGroups = useMemo(() => {
    if (!searchTerm) return binderGroups;

    return binderGroups.filter((group) =>
      String(group.card?.name || "").toLowerCase().includes(searchTerm)
    );
  }, [binderGroups, searchTerm]);

  const totalCount = filteredGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = clampPage(page, totalPages);

  const visiblePages = useMemo(
    () => buildVisiblePages(safePage, totalPages),
    [safePage, totalPages]
  );

  useEffect(() => {
    if (safePage !== page) {
      setPage(safePage);
    }
  }, [page, safePage]);

  const paginatedGroups = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return filteredGroups.slice(start, end);
  }, [filteredGroups, safePage]);

  useEffect(() => {
    if (!filteredGroups.length) {
      setSelectedGroupKey(null);
      setHoveredGroupKey(null);
      return;
    }

    const selectedStillExists = filteredGroups.some(
      (group) => group.groupKey === selectedGroupKey
    );

    if (!selectedStillExists) {
      setSelectedGroupKey(filteredGroups[0].groupKey);
    }

    const hoveredStillExists = filteredGroups.some(
      (group) => group.groupKey === hoveredGroupKey
    );

    if (!hoveredStillExists) {
      setHoveredGroupKey(null);
    }
  }, [filteredGroups, selectedGroupKey, hoveredGroupKey]);

  const selectedGroup = useMemo(
    () =>
      filteredGroups.find((group) => group.groupKey === selectedGroupKey) || null,
    [filteredGroups, selectedGroupKey]
  );

  const hoveredGroup = useMemo(
    () =>
      filteredGroups.find((group) => group.groupKey === hoveredGroupKey) || null,
    [filteredGroups, hoveredGroupKey]
  );

  const previewGroup = hoveredGroup || selectedGroup || null;

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
      <div className="binder-page">
        <div className="binder-topbar">
          <button
            type="button"
            className="binder-back-btn"
            onClick={() => navigate("/mode/progression")}
          >
            Back
          </button>
        </div>

        <div className="binder-layout">
          <BinderFilters
            totalCount={totalCount}
            searchInput={searchInput}
            setSearchInput={setSearchInput}
          />

          <main className="binder-center-panel">
            <BinderGrid
              loadError={loadError}
              loadingBinder={loadingBinder || loadingSeries}
              hasActiveSeries={Boolean(activeSeriesId)}
              groups={paginatedGroups}
              selectedGroupKey={selectedGroupKey}
              hoveredGroupKey={hoveredGroupKey}
              setSelectedGroupKey={setSelectedGroupKey}
              setHoveredGroupKey={setHoveredGroupKey}
              buildCardImageUrl={buildCardImageUrl}
              CARD_IMAGE_FALLBACK={CARD_IMAGE_FALLBACK}
            />

            <BinderPagination
              page={safePage}
              setPage={setPage}
              totalPages={totalPages}
              visiblePages={visiblePages}
              pageJumpInput={pageJumpInput}
              setPageJumpInput={setPageJumpInput}
              clampPage={clampPage}
            />
          </main>

          <BinderDetailPanel
            previewGroup={previewGroup}
            buildCardImageUrl={buildCardImageUrl}
            CARD_IMAGE_FALLBACK={CARD_IMAGE_FALLBACK}
          />
        </div>
      </div>
    </LauncherLayout>
  );
}

export default BinderPage;