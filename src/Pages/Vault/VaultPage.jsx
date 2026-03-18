import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";
import useResponsiveGridPageSize from "../../hooks/useResponsiveGridPageSize";

import BinderFilters from "../Binder/Components/BinderFilters";
import BinderGrid from "../Binder/Components/BinderGrid";
import BinderHoverTooltip from "../Binder/Components/BinderHoverTooltip";
import BinderCardModal from "../Binder/Components/BinderCardModal";
import BinderPagination from "../Binder/Components/BinderPagination";

import "../Binder/BinderPage.css";

const CARD_IMAGE_FALLBACK =
  "https://dgbgfhzcinlomghohxdq.supabase.co/storage/v1/object/public/card-images-upload/fallback_image.jpg";

const TYPE_FLAGS = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
};

const SORT_OPTIONS = [
  { label: "Name", value: "name" },
  { label: "Quantity", value: "quantity" },
  { label: "Locked Copies", value: "locked" },
  { label: "Rarity Count", value: "rarities" },
];

const CARD_KIND_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Monster", value: "monster" },
  { label: "Spell", value: "spell" },
  { label: "Trap", value: "trap" },
];

const TRADE_STATUS_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Tradeable", value: "tradeable" },
  { label: "Has Locked Copies", value: "locked" },
];

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

function getCardKindKey(card) {
  const normalized = Number(card?.type || 0);
  if ((normalized & TYPE_FLAGS.MONSTER) === TYPE_FLAGS.MONSTER) return "monster";
  if ((normalized & TYPE_FLAGS.SPELL) === TYPE_FLAGS.SPELL) return "spell";
  if ((normalized & TYPE_FLAGS.TRAP) === TYPE_FLAGS.TRAP) return "trap";
  return "unknown";
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

  return Array.from(groupedMap.values())
    .map((group) => {
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

      return {
        ...group,
        rarities: Array.from(rarityMap.values()).sort((a, b) => {
          const aOrder = Number(a.rarity?.sort_order ?? 9999);
          const bOrder = Number(b.rarity?.sort_order ?? 9999);
          if (aOrder !== bOrder) return aOrder - bOrder;
          return String(a.rarity?.name || "").localeCompare(String(b.rarity?.name || ""));
        }),
      };
    })
    .sort((a, b) =>
      String(a.card?.name || "").localeCompare(String(b.card?.name || ""))
    );
}

function VaultPage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [loadingSeries, setLoadingSeries] = useState(true);

  const [vaultGroups, setVaultGroups] = useState([]);
  const [vaultSummary, setVaultSummary] = useState(null);
  const [loadingVault, setLoadingVault] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("name");
  const [sortDirection, setSortDirection] = useState("asc");
  const [cardKindFilter, setCardKindFilter] = useState("all");
  const [rarityFilter, setRarityFilter] = useState("all");
  const [tradeStatusFilter, setTradeStatusFilter] = useState("all");

  const [hoveredGroupKey, setHoveredGroupKey] = useState(null);
  const [hoverPreview, setHoverPreview] = useState(null);
  const [modalGroupKey, setModalGroupKey] = useState(null);
  const binderGridCardRef = useRef(null);

  const [page, setPage] = useState(1);
  const [pageJumpInput, setPageJumpInput] = useState("1");

  const binderPageSizeOptions = useMemo(
    () => ({
      fallback: 24,
      minPageSize: 6,
      minColumnWidth: 172,
      columnGap: 14,
      rowGap: 16,
      paddingX: 32,
      paddingY: 32,
      textHeight: 34,
      extraHeight: 34,
    }),
    []
  );

  const pageSize = useResponsiveGridPageSize(binderGridCardRef, binderPageSizeOptions);

  async function loadVaultData(seriesIdOverride = activeSeriesId) {
    if (!user?.id || !seriesIdOverride) {
      setVaultGroups([]);
      setVaultSummary(null);
      setLoadingVault(false);
      return;
    }

    setLoadingVault(true);
    setLoadError("");

    try {
      const [
        { data: vaultData, error: vaultError },
        { data: summaryData, error: summaryError },
      ] = await Promise.all([
        supabase.rpc("get_my_vault_cards", {
          p_series_id: seriesIdOverride,
        }),
        supabase.rpc("get_my_vault_summary", {
          p_series_id: seriesIdOverride,
        }),
      ]);

      if (vaultError) throw vaultError;
      if (summaryError) throw summaryError;

      setVaultGroups(groupBinderCards(normalizeBinderRows(vaultData || [])));
      setVaultSummary(summaryData || null);
    } catch (error) {
      console.error("Failed to fetch vault:", error);
      setVaultGroups([]);
      setVaultSummary(null);
      setLoadError("Failed to load vault.");
    } finally {
      setLoadingVault(false);
    }
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearchTerm(searchInput.trim().toLowerCase());
    }, 200);

    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    setPageJumpInput(String(page));
  }, [page]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, sortField, sortDirection, cardKindFilter, rarityFilter, tradeStatusFilter]);

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
        console.error("Failed to resolve active vault series:", error);
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
    if (!authLoading && user && !loadingSeries) {
      loadVaultData();
    }
  }, [authLoading, user, activeSeriesId, loadingSeries]);

  const rarityOptions = useMemo(() => {
    const options = new Map();

    for (const group of vaultGroups) {
      for (const entry of group.rarities || []) {
        const value = String(entry.rarityId || entry.rarity?.name || "unknown");
        if (!options.has(value)) {
          options.set(value, {
            value,
            label: entry.rarity?.name || "Unknown",
            sortOrder: Number(entry.rarity?.sort_order ?? 9999),
          });
        }
      }
    }

    return [
      { label: "All", value: "all" },
      ...Array.from(options.values()).sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.label.localeCompare(b.label);
      }),
    ];
  }, [vaultGroups]);

  const filteredGroups = useMemo(() => {
    return vaultGroups
      .filter((group) => {
        if (
          searchTerm &&
          !String(group.card?.name || "").toLowerCase().includes(searchTerm)
        ) {
          return false;
        }

        if (cardKindFilter !== "all" && getCardKindKey(group.card) !== cardKindFilter) {
          return false;
        }

        if (
          rarityFilter !== "all" &&
          !(group.rarities || []).some(
            (entry) => String(entry.rarityId || entry.rarity?.name || "unknown") === rarityFilter
          )
        ) {
          return false;
        }

        if (tradeStatusFilter === "tradeable" && group.totalQuantity <= group.totalLockedQuantity) {
          return false;
        }

        if (tradeStatusFilter === "locked" && group.totalLockedQuantity <= 0) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortField === "quantity") {
          return sortDirection === "asc"
            ? a.totalQuantity - b.totalQuantity
            : b.totalQuantity - a.totalQuantity;
        }

        if (sortField === "locked") {
          return sortDirection === "asc"
            ? a.totalLockedQuantity - b.totalLockedQuantity
            : b.totalLockedQuantity - a.totalLockedQuantity;
        }

        if (sortField === "rarities") {
          return sortDirection === "asc"
            ? (a.rarities?.length || 0) - (b.rarities?.length || 0)
            : (b.rarities?.length || 0) - (a.rarities?.length || 0);
        }

        return sortDirection === "asc"
          ? String(a.card?.name || "").localeCompare(String(b.card?.name || ""))
          : String(b.card?.name || "").localeCompare(String(a.card?.name || ""));
      });
  }, [
    vaultGroups,
    cardKindFilter,
    rarityFilter,
    searchTerm,
    sortDirection,
    sortField,
    tradeStatusFilter,
  ]);

  const totalCount = filteredGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
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
    const start = (safePage - 1) * pageSize;
    return filteredGroups.slice(start, start + pageSize);
  }, [filteredGroups, safePage, pageSize]);

  useEffect(() => {
    const hoveredStillExists = filteredGroups.some(
      (group) => group.groupKey === hoveredGroupKey
    );

    if (!hoveredStillExists) {
      setHoveredGroupKey(null);
      setHoverPreview(null);
    }

    const modalStillExists =
      filteredGroups.some((group) => group.groupKey === modalGroupKey) ||
      vaultGroups.some((group) => group.groupKey === modalGroupKey);

    if (!modalStillExists) {
      setModalGroupKey(null);
    }
  }, [filteredGroups, vaultGroups, hoveredGroupKey, modalGroupKey]);

  const modalGroup = useMemo(
    () =>
      filteredGroups.find((group) => group.groupKey === modalGroupKey) ||
      vaultGroups.find((group) => group.groupKey === modalGroupKey) ||
      null,
    [filteredGroups, vaultGroups, modalGroupKey]
  );

  function handleHoverGroup(group, target) {
    if (!group || !target) return;

    const rect = target.getBoundingClientRect();
    const tooltipWidth = 340;
    const tooltipHeight = 260;
    const showRight = rect.right + tooltipWidth + 24 < window.innerWidth;
    const x = showRight ? rect.right + 14 : Math.max(12, rect.left - tooltipWidth - 14);
    const y = Math.min(window.innerHeight - tooltipHeight - 12, Math.max(12, rect.top - 8));

    setHoveredGroupKey(group.groupKey);
    setHoverPreview({ group, x, y });
  }

  function handleLeaveGroup() {
    setHoveredGroupKey(null);
    setHoverPreview(null);
  }

  function handleOpenModal(group) {
    setModalGroupKey(group?.groupKey || null);
    setHoveredGroupKey(null);
    setHoverPreview(null);
  }

  function handleClearFilters() {
    setSearchInput("");
    setSearchTerm("");
    setSortField("name");
    setSortDirection("asc");
    setCardKindFilter("all");
    setRarityFilter("all");
    setTradeStatusFilter("all");
  }

  async function handleUnvaultCards({ binderCardId }) {
    const { data, error } = await supabase.rpc("move_vault_card_family_to_binder", {
      p_binder_card_id: binderCardId,
    });

    if (error) throw error;

    await loadVaultData();
    return data;
  }

  if (authLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (user.role === "Blocked") return <Navigate to="/" replace />;
  if (user.role !== "Admin+" && user.role !== "Admin" && user.role !== "Duelist") {
    return <Navigate to="/mode" replace />;
  }

  const vaultSlotsUsed = Number(vaultSummary?.vault_slots_used || 0);
  const vaultSlotsTotal = Number(vaultSummary?.vault_slots_total || 0);
  const vaultSummaryLabel = vaultSummary?.vault_unlocked
    ? `Vault Slots: ${vaultSlotsUsed}/${vaultSlotsTotal}`
    : "Vault Locked";

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

          <div className="binder-page-btn" style={{ cursor: "default" }}>
            {vaultSummaryLabel}
          </div>
        </div>

        <div className="binder-layout">
          <BinderFilters
            panelTitle="Vault"
            countLabel="vaulted families"
            totalCount={totalCount}
            searchInput={searchInput}
            setSearchInput={setSearchInput}
            sortField={sortField}
            setSortField={setSortField}
            sortDirection={sortDirection}
            setSortDirection={setSortDirection}
            cardKindFilter={cardKindFilter}
            setCardKindFilter={setCardKindFilter}
            rarityFilter={rarityFilter}
            setRarityFilter={setRarityFilter}
            rarityOptions={rarityOptions}
            tradeStatusFilter={tradeStatusFilter}
            setTradeStatusFilter={setTradeStatusFilter}
            handleClearFilters={handleClearFilters}
            SORT_OPTIONS={SORT_OPTIONS}
            CARD_KIND_OPTIONS={CARD_KIND_OPTIONS}
            TRADE_STATUS_OPTIONS={TRADE_STATUS_OPTIONS}
          />

          <main className="binder-center-panel">
            <BinderGrid
              loadError={loadError}
              loadingBinder={loadingVault || loadingSeries}
              hasActiveSeries={Boolean(activeSeriesId)}
              groups={paginatedGroups}
              gridCardRef={binderGridCardRef}
              activeGroupKey={modalGroupKey}
              hoveredGroupKey={hoveredGroupKey}
              onHoverGroup={handleHoverGroup}
              onLeaveGroup={handleLeaveGroup}
              onOpenGroupModal={handleOpenModal}
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
        </div>
      </div>

      <BinderHoverTooltip
        preview={hoverPreview}
        buildCardImageUrl={buildCardImageUrl}
        CARD_IMAGE_FALLBACK={CARD_IMAGE_FALLBACK}
      />
      <BinderCardModal
        group={modalGroup}
        buildCardImageUrl={buildCardImageUrl}
        CARD_IMAGE_FALLBACK={CARD_IMAGE_FALLBACK}
        onUnvaultCards={handleUnvaultCards}
        collectionMode="vault"
        onClose={() => setModalGroupKey(null)}
      />
    </LauncherLayout>
  );
}

export default VaultPage;
