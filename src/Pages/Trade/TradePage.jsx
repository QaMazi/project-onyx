import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import LauncherLayout from "../../components/LauncherLayout";
import { useUser } from "../../context/UserContext";
import { supabase } from "../../lib/supabase";

import "./TradePage.css";

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function getInitial(name) {
  return (name || "?").charAt(0).toUpperCase();
}

function buildCardOptionLabel(row) {
  const rarityName = row.rarity_name || "Unknown Rarity";
  return `${row.card_name} • ${rarityName} • Qty ${row.quantity}`;
}

function buildItemOptionLabel(row) {
  return `${row.item_name} • Available ${row.available_quantity}`;
}

function getErrorMessage(error, fallback) {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  return error.message || error.details || fallback;
}

function normalizePositiveQuantity(value, maxValue = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value || 0);

  if (!Number.isFinite(numeric)) {
    return 1;
  }

  return Math.max(1, Math.min(maxValue, Math.floor(numeric)));
}

async function fetchVisibleBinderRows(seriesId, targetUserId) {
  const { data, error } = await supabase.rpc("get_series_player_visible_binder_cards", {
    p_series_id: seriesId,
    p_target_user_id: targetUserId,
  });

  if (error) throw error;
  return data || [];
}

function upsertLineItem(list, nextLine, identityKeys, maxQuantity = null) {
  const existingIndex = list.findIndex((line) =>
    identityKeys.every((key) => line[key] === nextLine[key])
  );

  const cappedNextQuantity =
    maxQuantity == null
      ? Number(nextLine.quantity || 0)
      : Math.min(maxQuantity, Number(nextLine.quantity || 0));

  if (cappedNextQuantity <= 0) {
    return list;
  }

  if (existingIndex === -1) {
    return [
      ...list,
      {
        ...nextLine,
        quantity: cappedNextQuantity,
      },
    ];
  }

  const next = [...list];
  const mergedQuantity =
    Number(next[existingIndex].quantity || 0) + Number(nextLine.quantity || 0);

  next[existingIndex] = {
    ...next[existingIndex],
    quantity:
      maxQuantity == null ? mergedQuantity : Math.min(maxQuantity, mergedQuantity),
  };

  return next;
}

function removeLineItem(list, indexToRemove) {
  return list.filter((_, index) => index !== indexToRemove);
}

function buildTradeHydration({
  trades,
  tradeCards,
  tradeItems,
  profileMap,
  cardMap,
  itemMap,
  currentUserId,
}) {
  const cardLinesByTradeId = new Map();
  const itemLinesByTradeId = new Map();

  for (const line of tradeCards) {
    if (!cardLinesByTradeId.has(line.trade_id)) {
      cardLinesByTradeId.set(line.trade_id, []);
    }

    cardLinesByTradeId.get(line.trade_id).push({
      ...line,
      card: cardMap.get(String(line.card_id)) || null,
    });
  }

  for (const line of tradeItems) {
    if (!itemLinesByTradeId.has(line.trade_id)) {
      itemLinesByTradeId.set(line.trade_id, []);
    }

    itemLinesByTradeId.get(line.trade_id).push({
      ...line,
      item: itemMap.get(String(line.item_definition_id)) || null,
    });
  }

  return trades.map((trade) => {
    const counterpartId =
      trade.offered_by_user_id === currentUserId
        ? trade.offered_to_user_id
        : trade.offered_by_user_id;

    const allCardLines = cardLinesByTradeId.get(trade.id) || [];
    const allItemLines = itemLinesByTradeId.get(trade.id) || [];

    return {
      ...trade,
      counterpart: profileMap.get(counterpartId) || null,
      offeredCards: allCardLines.filter((line) => line.direction === "offered"),
      requestedCards: allCardLines.filter((line) => line.direction === "requested"),
      offeredItems: allItemLines.filter((line) => line.direction === "offered"),
      requestedItems: allItemLines.filter((line) => line.direction === "requested"),
    };
  });
}

function buildGiftHydration({
  gifts,
  giftCards,
  giftItems,
  profileMap,
  cardMap,
  itemMap,
}) {
  const cardLinesByGiftId = new Map();
  const itemLinesByGiftId = new Map();

  for (const line of giftCards) {
    if (!cardLinesByGiftId.has(line.gift_id)) {
      cardLinesByGiftId.set(line.gift_id, []);
    }

    cardLinesByGiftId.get(line.gift_id).push({
      ...line,
      card: cardMap.get(String(line.card_id)) || null,
    });
  }

  for (const line of giftItems) {
    if (!itemLinesByGiftId.has(line.gift_id)) {
      itemLinesByGiftId.set(line.gift_id, []);
    }

    itemLinesByGiftId.get(line.gift_id).push({
      ...line,
      item: itemMap.get(String(line.item_definition_id)) || null,
    });
  }

  return gifts.map((gift) => ({
    ...gift,
    sender: profileMap.get(gift.sent_by_user_id) || null,
    cards: cardLinesByGiftId.get(gift.id) || [],
    items: itemLinesByGiftId.get(gift.id) || [],
  }));
}

function TradePage() {
  const navigate = useNavigate();
  const { user, authLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [shards, setShards] = useState(0);
  const [lockedShards, setLockedShards] = useState(0);

  const [players, setPlayers] = useState([]);
  const [recipientId, setRecipientId] = useState("");
  const [composerMode, setComposerMode] = useState("trade");

  const [myBinderRows, setMyBinderRows] = useState([]);
  const [myInventoryRows, setMyInventoryRows] = useState([]);
  const [recipientBinderRows, setRecipientBinderRows] = useState([]);
  const [recipientInventoryRows, setRecipientInventoryRows] = useState([]);

  const [tradeMessage, setTradeMessage] = useState("");
  const [giftMessage, setGiftMessage] = useState("");

  const [tradeOfferedShards, setTradeOfferedShards] = useState(0);
  const [tradeRequestedShards, setTradeRequestedShards] = useState(0);
  const [giftShards, setGiftShards] = useState(0);

  const [tradeOfferedCards, setTradeOfferedCards] = useState([]);
  const [tradeRequestedCards, setTradeRequestedCards] = useState([]);
  const [tradeOfferedItems, setTradeOfferedItems] = useState([]);
  const [tradeRequestedItems, setTradeRequestedItems] = useState([]);

  const [giftCards, setGiftCards] = useState([]);
  const [giftItems, setGiftItems] = useState([]);

  const [offerCardId, setOfferCardId] = useState("");
  const [offerCardQty, setOfferCardQty] = useState(1);
  const [offerItemId, setOfferItemId] = useState("");
  const [offerItemQty, setOfferItemQty] = useState(1);

  const [requestCardId, setRequestCardId] = useState("");
  const [requestCardQty, setRequestCardQty] = useState(1);
  const [requestItemId, setRequestItemId] = useState("");
  const [requestItemQty, setRequestItemQty] = useState(1);

  const [giftCardId, setGiftCardId] = useState("");
  const [giftCardQty, setGiftCardQty] = useState(1);
  const [giftItemId, setGiftItemId] = useState("");
  const [giftItemQty, setGiftItemQty] = useState(1);

  const [incomingTrades, setIncomingTrades] = useState([]);
  const [outgoingTrades, setOutgoingTrades] = useState([]);
  const [receivedGifts, setReceivedGifts] = useState([]);

  const tradeableMyBinderRows = useMemo(
    () =>
      myBinderRows.filter(
        (row) => !row.is_trade_locked && Number(row.quantity || 0) > 0
      ),
    [myBinderRows]
  );

  const tradeableRecipientBinderRows = useMemo(
    () =>
      recipientBinderRows.filter(
        (row) => !row.is_trade_locked && Number(row.quantity || 0) > 0
      ),
    [recipientBinderRows]
  );

  async function loadRecipientAssets(seriesId, nextRecipientId) {
    if (!seriesId || !nextRecipientId) {
      setRecipientBinderRows([]);
      setRecipientInventoryRows([]);
      return;
    }

    const [binderResponse, inventoryResponse] = await Promise.all([
      fetchVisibleBinderRows(seriesId, nextRecipientId).then((data) => ({
        data,
        error: null,
      })),

      supabase
        .from("player_inventory_view")
        .select("*")
        .eq("series_id", seriesId)
        .eq("user_id", nextRecipientId)
        .order("category_name", { ascending: true })
        .order("item_name", { ascending: true }),
    ]);

    if (binderResponse.error) throw binderResponse.error;
    if (inventoryResponse.error) throw inventoryResponse.error;

    setRecipientBinderRows(binderResponse.data || []);
    setRecipientInventoryRows(inventoryResponse.data || []);
  }

  async function loadTradePage(currentUser, nextRecipientId = recipientId) {
    if (!currentUser?.id) return;

    setLoading(true);
    setError("");

    try {
      const { data: currentSeries, error: currentSeriesError } = await supabase
        .from("game_series")
        .select("id")
        .eq("is_current", true)
        .maybeSingle();

      if (currentSeriesError) throw currentSeriesError;
      if (!currentSeries?.id) throw new Error("No active series found.");

      setActiveSeriesId(currentSeries.id);

      const [
        walletResponse,
        playersResponse,
        myBinderResponse,
        myInventoryResponse,
        incomingTradesResponse,
        outgoingTradesResponse,
        giftsResponse,
      ] = await Promise.all([
        supabase
          .from("player_wallets")
          .select("shards, locked_shards")
          .eq("user_id", currentUser.id)
          .eq("series_id", currentSeries.id)
          .maybeSingle(),

        supabase
          .from("series_players_view")
          .select("*")
          .eq("series_id", currentSeries.id)
          .neq("user_id", currentUser.id)
          .order("username", { ascending: true }),

        fetchVisibleBinderRows(currentSeries.id, currentUser.id).then((data) => ({
          data,
          error: null,
        })),

        supabase
          .from("player_inventory_view")
          .select("*")
          .eq("series_id", currentSeries.id)
          .eq("user_id", currentUser.id)
          .order("category_name", { ascending: true })
          .order("item_name", { ascending: true }),

        supabase
          .from("player_trades")
          .select("*")
          .eq("series_id", currentSeries.id)
          .eq("offered_to_user_id", currentUser.id)
          .order("created_at", { ascending: false }),

        supabase
          .from("player_trades")
          .select("*")
          .eq("series_id", currentSeries.id)
          .eq("offered_by_user_id", currentUser.id)
          .order("created_at", { ascending: false }),

        supabase
          .from("player_gifts")
          .select("*")
          .eq("series_id", currentSeries.id)
          .eq("sent_to_user_id", currentUser.id)
          .order("created_at", { ascending: false }),
      ]);

      if (walletResponse.error) throw walletResponse.error;
      if (playersResponse.error) throw playersResponse.error;
      if (myBinderResponse.error) throw myBinderResponse.error;
      if (myInventoryResponse.error) throw myInventoryResponse.error;
      if (incomingTradesResponse.error) throw incomingTradesResponse.error;
      if (outgoingTradesResponse.error) throw outgoingTradesResponse.error;
      if (giftsResponse.error) throw giftsResponse.error;

      const nextPlayers = playersResponse.data || [];
      const nextIncomingTrades = incomingTradesResponse.data || [];
      const nextOutgoingTrades = outgoingTradesResponse.data || [];
      const nextGifts = giftsResponse.data || [];

      setPlayers(nextPlayers);
      setMyBinderRows(myBinderResponse.data || []);
      setMyInventoryRows(myInventoryResponse.data || []);

      setShards(Number(walletResponse.data?.shards || 0));
      setLockedShards(Number(walletResponse.data?.locked_shards || 0));

      const allTrades = [...nextIncomingTrades, ...nextOutgoingTrades];
      const tradeIds = [...new Set(allTrades.map((trade) => trade.id))];
      const giftIds = [...new Set(nextGifts.map((gift) => gift.id))];

      const counterpartIds = [
        ...new Set(
          [
            ...allTrades.map((trade) => trade.offered_by_user_id),
            ...allTrades.map((trade) => trade.offered_to_user_id),
            ...nextGifts.map((gift) => gift.sent_by_user_id),
          ].filter(Boolean)
        ),
      ];

      const [
        tradeCardsResponse,
        tradeItemsResponse,
        giftCardsResponse,
        giftItemsResponse,
        profilesResponse,
      ] = await Promise.all([
        tradeIds.length
          ? supabase.from("player_trade_cards").select("*").in("trade_id", tradeIds)
          : Promise.resolve({ data: [], error: null }),

        tradeIds.length
          ? supabase.from("player_trade_items").select("*").in("trade_id", tradeIds)
          : Promise.resolve({ data: [], error: null }),

        giftIds.length
          ? supabase.from("player_gift_cards").select("*").in("gift_id", giftIds)
          : Promise.resolve({ data: [], error: null }),

        giftIds.length
          ? supabase.from("player_gift_items").select("*").in("gift_id", giftIds)
          : Promise.resolve({ data: [], error: null }),

        counterpartIds.length
          ? supabase
              .from("profiles")
              .select("id, username, avatar")
              .in("id", counterpartIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (tradeCardsResponse.error) throw tradeCardsResponse.error;
      if (tradeItemsResponse.error) throw tradeItemsResponse.error;
      if (giftCardsResponse.error) throw giftCardsResponse.error;
      if (giftItemsResponse.error) throw giftItemsResponse.error;
      if (profilesResponse.error) throw profilesResponse.error;

      const cardIds = [
        ...new Set(
          [
            ...(tradeCardsResponse.data || []).map((row) => row.card_id),
            ...(giftCardsResponse.data || []).map((row) => row.card_id),
          ].filter(Boolean)
        ),
      ];

      const itemIds = [
        ...new Set(
          [
            ...(tradeItemsResponse.data || []).map((row) => row.item_definition_id),
            ...(giftItemsResponse.data || []).map((row) => row.item_definition_id),
          ].filter(Boolean)
        ),
      ];

      const [cardsResponse, itemsResponse] = await Promise.all([
        cardIds.length
          ? supabase.from("cards").select("id, name, image_url").in("id", cardIds)
          : Promise.resolve({ data: [], error: null }),

        itemIds.length
          ? supabase
              .from("item_definitions")
              .select("id, name, description, image_url")
              .in("id", itemIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (cardsResponse.error) throw cardsResponse.error;
      if (itemsResponse.error) throw itemsResponse.error;

      const profileMap = new Map(
        (profilesResponse.data || []).map((profile) => [profile.id, profile])
      );

      const cardMap = new Map(
        (cardsResponse.data || []).map((card) => [String(card.id), card])
      );

      const itemMap = new Map(
        (itemsResponse.data || []).map((item) => [String(item.id), item])
      );

      const hydratedIncomingTrades = buildTradeHydration({
        trades: nextIncomingTrades,
        tradeCards: tradeCardsResponse.data || [],
        tradeItems: tradeItemsResponse.data || [],
        profileMap,
        cardMap,
        itemMap,
        currentUserId: currentUser.id,
      });

      const hydratedOutgoingTrades = buildTradeHydration({
        trades: nextOutgoingTrades,
        tradeCards: tradeCardsResponse.data || [],
        tradeItems: tradeItemsResponse.data || [],
        profileMap,
        cardMap,
        itemMap,
        currentUserId: currentUser.id,
      });

      const hydratedGifts = buildGiftHydration({
        gifts: nextGifts,
        giftCards: giftCardsResponse.data || [],
        giftItems: giftItemsResponse.data || [],
        profileMap,
        cardMap,
        itemMap,
      });

      setIncomingTrades(hydratedIncomingTrades);
      setOutgoingTrades(hydratedOutgoingTrades);
      setReceivedGifts(hydratedGifts);

      if (nextRecipientId) {
        await loadRecipientAssets(currentSeries.id, nextRecipientId);
      } else {
        setRecipientBinderRows([]);
        setRecipientInventoryRows([]);
      }
    } catch (err) {
      console.error("Trade page load failed:", err);
      setError(getErrorMessage(err, "Failed to load trade page."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && user) {
      loadTradePage(user);
    }
  }, [authLoading, user]);

  useEffect(() => {
    if (!activeSeriesId || !recipientId) {
      setRecipientBinderRows([]);
      setRecipientInventoryRows([]);
      setTradeRequestedCards([]);
      setTradeRequestedItems([]);
      return;
    }

    loadRecipientAssets(activeSeriesId, recipientId).catch((err) => {
      console.error("Recipient asset load failed:", err);
      setRecipientBinderRows([]);
      setRecipientInventoryRows([]);
    });
  }, [activeSeriesId, recipientId]);

  const availableShards = Math.max(0, shards - lockedShards);

  const recipient = useMemo(
    () => players.find((player) => player.user_id === recipientId) || null,
    [players, recipientId]
  );

  const isComposerDisabled = busy || !activeSeriesId;
  const canUseRecipientAssets = Boolean(recipientId) && !isComposerDisabled;

  function addTradeOfferedCard() {
    const row = tradeableMyBinderRows.find((entry) => entry.id === offerCardId);
    if (!row) return;

    setTradeOfferedCards((prev) =>
      upsertLineItem(
        prev,
        {
          binder_card_id: row.id,
          card_id: row.card_id,
          rarity_id: row.rarity_id,
          quantity: normalizePositiveQuantity(offerCardQty, Number(row.quantity || 1)),
          display_name: buildCardOptionLabel(row),
        },
        ["binder_card_id"],
        Number(row.quantity || 1)
      )
    );
  }

  function addTradeRequestedCard() {
    const row = tradeableRecipientBinderRows.find(
      (entry) => entry.id === requestCardId
    );
    if (!row) return;

    setTradeRequestedCards((prev) =>
      upsertLineItem(
        prev,
        {
          binder_card_id: row.id,
          card_id: row.card_id,
          rarity_id: row.rarity_id,
          quantity: normalizePositiveQuantity(requestCardQty, Number(row.quantity || 1)),
          display_name: buildCardOptionLabel(row),
        },
        ["binder_card_id"],
        Number(row.quantity || 1)
      )
    );
  }

  function addTradeOfferedItem() {
    const row = myInventoryRows.find((entry) => entry.id === offerItemId);
    if (!row) return;

    setTradeOfferedItems((prev) =>
      upsertLineItem(
        prev,
        {
          player_inventory_id: row.id,
          item_definition_id: row.item_definition_id,
          quantity: normalizePositiveQuantity(
            offerItemQty,
            Number(row.available_quantity || 1)
          ),
          display_name: buildItemOptionLabel(row),
        },
        ["player_inventory_id"],
        Number(row.available_quantity || 1)
      )
    );
  }

  function addTradeRequestedItem() {
    const row = recipientInventoryRows.find((entry) => entry.id === requestItemId);
    if (!row) return;

    setTradeRequestedItems((prev) =>
      upsertLineItem(
        prev,
        {
          player_inventory_id: row.id,
          item_definition_id: row.item_definition_id,
          quantity: normalizePositiveQuantity(
            requestItemQty,
            Number(row.available_quantity || 1)
          ),
          display_name: buildItemOptionLabel(row),
        },
        ["player_inventory_id"],
        Number(row.available_quantity || 1)
      )
    );
  }

  function addGiftCard() {
    const row = tradeableMyBinderRows.find((entry) => entry.id === giftCardId);
    if (!row) return;

    setGiftCards((prev) =>
      upsertLineItem(
        prev,
        {
          binder_card_id: row.id,
          card_id: row.card_id,
          rarity_id: row.rarity_id,
          quantity: normalizePositiveQuantity(giftCardQty, Number(row.quantity || 1)),
          display_name: buildCardOptionLabel(row),
        },
        ["binder_card_id"],
        Number(row.quantity || 1)
      )
    );
  }

  function addGiftItem() {
    const row = myInventoryRows.find((entry) => entry.id === giftItemId);
    if (!row) return;

    setGiftItems((prev) =>
      upsertLineItem(
        prev,
        {
          player_inventory_id: row.id,
          item_definition_id: row.item_definition_id,
          quantity: normalizePositiveQuantity(
            giftItemQty,
            Number(row.available_quantity || 1)
          ),
          display_name: buildItemOptionLabel(row),
        },
        ["player_inventory_id"],
        Number(row.available_quantity || 1)
      )
    );
  }

  function resetTradeComposer() {
    setTradeMessage("");
    setTradeOfferedShards(0);
    setTradeRequestedShards(0);
    setTradeOfferedCards([]);
    setTradeRequestedCards([]);
    setTradeOfferedItems([]);
    setTradeRequestedItems([]);
    setOfferCardId("");
    setOfferCardQty(1);
    setOfferItemId("");
    setOfferItemQty(1);
    setRequestCardId("");
    setRequestCardQty(1);
    setRequestItemId("");
    setRequestItemQty(1);
  }

  function resetGiftComposer() {
    setGiftMessage("");
    setGiftShards(0);
    setGiftCards([]);
    setGiftItems([]);
    setGiftCardId("");
    setGiftCardQty(1);
    setGiftItemId("");
    setGiftItemQty(1);
  }

  async function handleSendTrade() {
    if (!activeSeriesId) {
      window.alert("No active series found.");
      return;
    }

    if (!recipientId) {
      window.alert("Choose a player to send the trade to.");
      return;
    }

    if (
      tradeOfferedShards <= 0 &&
      tradeRequestedShards <= 0 &&
      tradeOfferedCards.length === 0 &&
      tradeRequestedCards.length === 0 &&
      tradeOfferedItems.length === 0 &&
      tradeRequestedItems.length === 0
    ) {
      window.alert("Add at least one offered or requested asset.");
      return;
    }

    try {
      setBusy(true);

      const { error: rpcError } = await supabase.rpc("send_trade", {
        p_series_id: activeSeriesId,
        p_offered_to_user_id: recipientId,
        p_offered_shards: Number(tradeOfferedShards || 0),
        p_requested_shards: Number(tradeRequestedShards || 0),
        p_message: tradeMessage.trim() || null,
        p_offered_cards: tradeOfferedCards.map((line) => ({
          binder_card_id: line.binder_card_id,
          quantity: Number(line.quantity || 0),
        })),
        p_requested_cards: tradeRequestedCards.map((line) => ({
          binder_card_id: line.binder_card_id,
          quantity: Number(line.quantity || 0),
        })),
        p_offered_items: tradeOfferedItems.map((line) => ({
          player_inventory_id: line.player_inventory_id,
          quantity: Number(line.quantity || 0),
        })),
        p_requested_items: tradeRequestedItems.map((line) => ({
          player_inventory_id: line.player_inventory_id,
          quantity: Number(line.quantity || 0),
        })),
      });

      if (rpcError) {
        throw rpcError;
      }

      resetTradeComposer();
      await loadTradePage(user, recipientId);
    } catch (err) {
      console.error("Failed to send trade:", err);
      window.alert(getErrorMessage(err, "Failed to send trade."));
    } finally {
      setBusy(false);
    }
  }

  async function handleSendGift() {
    if (!activeSeriesId) {
      window.alert("No active series found.");
      return;
    }

    if (!recipientId) {
      window.alert("Choose a player to gift.");
      return;
    }

    if (giftShards <= 0 && giftCards.length === 0 && giftItems.length === 0) {
      window.alert("Add at least one asset to gift.");
      return;
    }

    try {
      setBusy(true);

      const { error: rpcError } = await supabase.rpc("send_gift", {
        p_series_id: activeSeriesId,
        p_sent_to_user_id: recipientId,
        p_sent_shards: Number(giftShards || 0),
        p_message: giftMessage.trim() || null,
        p_gift_cards: giftCards.map((line) => ({
          binder_card_id: line.binder_card_id,
          quantity: Number(line.quantity || 0),
        })),
        p_gift_items: giftItems.map((line) => ({
          player_inventory_id: line.player_inventory_id,
          quantity: Number(line.quantity || 0),
        })),
      });

      if (rpcError) {
        throw rpcError;
      }

      resetGiftComposer();
      await loadTradePage(user, recipientId);
    } catch (err) {
      console.error("Failed to send gift:", err);
      window.alert(getErrorMessage(err, "Failed to send gift."));
    } finally {
      setBusy(false);
    }
  }

  async function handleIncomingTradeAction(tradeId, actionLabel) {
    const rpcName = actionLabel === "Accept" ? "accept_trade" : "decline_trade";

    try {
      setBusy(true);

      const { error: rpcError } = await supabase.rpc(rpcName, {
        p_trade_id: tradeId,
      });

      if (rpcError) {
        throw rpcError;
      }

      await loadTradePage(user, recipientId);
    } catch (err) {
      console.error(`${actionLabel} trade failed:`, err);
      window.alert(
        getErrorMessage(err, `Failed to ${actionLabel.toLowerCase()} trade.`)
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleOutgoingTradeCancel(tradeId) {
    try {
      setBusy(true);

      const { error: rpcError } = await supabase.rpc("cancel_trade", {
        p_trade_id: tradeId,
      });

      if (rpcError) {
        throw rpcError;
      }

      await loadTradePage(user, recipientId);
    } catch (err) {
      console.error("Cancel trade failed:", err);
      window.alert(getErrorMessage(err, "Failed to cancel trade."));
    } finally {
      setBusy(false);
    }
  }

  async function markGiftRead(giftId) {
    try {
      setBusy(true);

      const { error: rpcError } = await supabase.rpc("mark_gift_read", {
        p_gift_id: giftId,
      });

      if (rpcError) {
        throw rpcError;
      }

      await loadTradePage(user, recipientId);
    } catch (err) {
      console.error("Failed to mark gift read:", err);
      window.alert(getErrorMessage(err, "Failed to mark gift as read."));
    } finally {
      setBusy(false);
    }
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
      <div className="trade-page">
        <div className="trade-topbar trade-panel">
          <div>
            <div className="trade-kicker">PROGRESSION</div>
            <h1 className="trade-title">Trade & Gift</h1>
            <p className="trade-subtitle">
              Create trade offers, receive gifts, and manage active-series exchanges.
            </p>
          </div>

          <div className="trade-topbar-right">
            <div className="trade-shards-card">
              <span className="trade-shards-label">Available Shards</span>
              <span className="trade-shards-value">{availableShards}</span>
            </div>

            <button
              type="button"
              className="trade-back-btn"
              onClick={() => navigate("/mode/progression")}
            >
              Back
            </button>
          </div>
        </div>

        {loading ? (
          <div className="trade-panel trade-empty">Loading trade hub...</div>
        ) : error ? (
          <div className="trade-panel trade-empty">{error}</div>
        ) : (
          <div className="trade-layout">
            <section className="trade-left">
              <div className="trade-panel trade-composer-panel">
                <div className="trade-composer-header">
                  <div>
                    <div className="trade-panel-kicker">COMPOSER</div>
                    <h2 className="trade-panel-title">
                      {composerMode === "trade" ? "Create Trade" : "Send Gift"}
                    </h2>
                  </div>

                  <div className="trade-mode-toggle">
                    <button
                      type="button"
                      className={`trade-mode-btn ${
                        composerMode === "trade" ? "is-active" : ""
                      }`}
                      onClick={() => setComposerMode("trade")}
                      disabled={busy}
                    >
                      Trade
                    </button>

                    <button
                      type="button"
                      className={`trade-mode-btn ${
                        composerMode === "gift" ? "is-active" : ""
                      }`}
                      onClick={() => setComposerMode("gift")}
                      disabled={busy}
                    >
                      Gift
                    </button>
                  </div>
                </div>

                <div className="trade-composer-body">
                  <div className="trade-form-row">
                    <div className="trade-field">
                      <label className="trade-field-label" htmlFor="trade-recipient">
                        Target Player
                      </label>

                      <select
                        id="trade-recipient"
                        className="trade-select"
                        value={recipientId}
                        onChange={(e) => setRecipientId(e.target.value)}
                        disabled={isComposerDisabled}
                      >
                        <option value="">Choose a player...</option>

                        {players.map((player) => (
                          <option key={player.user_id} value={player.user_id}>
                            {player.username}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="trade-target-preview">
                      {recipient ? (
                        <>
                          <div className="trade-target-avatar">
                            {recipient.avatar ? (
                              <img src={recipient.avatar} alt={recipient.username} />
                            ) : (
                              <span>{getInitial(recipient.username)}</span>
                            )}
                          </div>

                          <div className="trade-target-copy">
                            <span className="trade-target-name">{recipient.username}</span>
                            <span className="trade-target-meta">
                              {composerMode === "trade" ? "Trade partner" : "Gift recipient"}
                            </span>
                          </div>
                        </>
                      ) : (
                        <span className="trade-target-placeholder">No player selected</span>
                      )}
                    </div>
                  </div>

                  {composerMode === "trade" ? (
                    <>
                      <div className="trade-field">
                        <label className="trade-field-label" htmlFor="trade-message">
                          Message
                        </label>

                        <textarea
                          id="trade-message"
                          className="trade-textarea"
                          rows={3}
                          value={tradeMessage}
                          onChange={(e) => setTradeMessage(e.target.value)}
                          placeholder="Optional note with your offer..."
                          disabled={isComposerDisabled}
                        />
                      </div>

                      <div className="trade-builder-grid">
                        <div className="trade-builder-column">
                          <div className="trade-builder-column-header">
                            <h3>You Offer</h3>
                          </div>

                          <div className="trade-shard-row">
                            <label className="trade-field-label" htmlFor="trade-offered-shards">
                              Offered Shards
                            </label>

                            <input
                              id="trade-offered-shards"
                              type="number"
                              min="0"
                              max={availableShards}
                              className="trade-input"
                              value={tradeOfferedShards}
                              onChange={(e) =>
                                setTradeOfferedShards(
                                  Math.max(
                                    0,
                                    Math.min(availableShards, Number(e.target.value || 0))
                                  )
                                )
                              }
                              disabled={isComposerDisabled}
                            />
                          </div>

                          <div className="trade-picker-block">
                            <span className="trade-picker-title">Offered Cards</span>

                            <div className="trade-picker-row">
                              <select
                                className="trade-select"
                                value={offerCardId}
                                onChange={(e) => setOfferCardId(e.target.value)}
                                disabled={isComposerDisabled}
                              >
                                <option value="">Choose binder card...</option>

                                {tradeableMyBinderRows.map((row) => (
                                  <option key={row.id} value={row.id}>
                                    {buildCardOptionLabel(row)}
                                  </option>
                                ))}
                              </select>

                              <input
                                type="number"
                                min="1"
                                className="trade-qty-input"
                                value={offerCardQty}
                                onChange={(e) =>
                                  setOfferCardQty(Math.max(1, Number(e.target.value || 1)))
                                }
                                disabled={isComposerDisabled}
                              />

                              <button
                                type="button"
                                className="trade-inline-btn"
                                onClick={addTradeOfferedCard}
                                disabled={isComposerDisabled}
                              >
                                Add
                              </button>
                            </div>

                            <div className="trade-line-list">
                              {tradeOfferedCards.length === 0 ? (
                                <div className="trade-line-empty">No offered cards.</div>
                              ) : (
                                tradeOfferedCards.map((line, index) => (
                                  <div className="trade-line-row" key={`${line.binder_card_id}-${index}`}>
                                    <div className="trade-line-copy">
                                      <div className="trade-line-name">{line.display_name}</div>
                                      <div className="trade-line-meta">Qty {line.quantity}</div>
                                    </div>

                                    <button
                                      type="button"
                                      className="trade-inline-btn trade-inline-btn-danger"
                                      onClick={() =>
                                        setTradeOfferedCards((prev) => removeLineItem(prev, index))
                                      }
                                      disabled={isComposerDisabled}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          <div className="trade-picker-block">
                            <span className="trade-picker-title">Offered Items</span>

                            <div className="trade-picker-row">
                              <select
                                className="trade-select"
                                value={offerItemId}
                                onChange={(e) => setOfferItemId(e.target.value)}
                                disabled={isComposerDisabled}
                              >
                                <option value="">Choose inventory item...</option>

                                {myInventoryRows
                                  .filter((row) => Number(row.available_quantity || 0) > 0)
                                  .map((row) => (
                                    <option key={row.id} value={row.id}>
                                      {buildItemOptionLabel(row)}
                                    </option>
                                  ))}
                              </select>

                              <input
                                type="number"
                                min="1"
                                className="trade-qty-input"
                                value={offerItemQty}
                                onChange={(e) =>
                                  setOfferItemQty(Math.max(1, Number(e.target.value || 1)))
                                }
                                disabled={isComposerDisabled}
                              />

                              <button
                                type="button"
                                className="trade-inline-btn"
                                onClick={addTradeOfferedItem}
                                disabled={isComposerDisabled}
                              >
                                Add
                              </button>
                            </div>

                            <div className="trade-line-list">
                              {tradeOfferedItems.length === 0 ? (
                                <div className="trade-line-empty">No offered items.</div>
                              ) : (
                                tradeOfferedItems.map((line, index) => (
                                  <div className="trade-line-row" key={`${line.player_inventory_id}-${index}`}>
                                    <div className="trade-line-copy">
                                      <div className="trade-line-name">{line.display_name}</div>
                                      <div className="trade-line-meta">Qty {line.quantity}</div>
                                    </div>

                                    <button
                                      type="button"
                                      className="trade-inline-btn trade-inline-btn-danger"
                                      onClick={() =>
                                        setTradeOfferedItems((prev) => removeLineItem(prev, index))
                                      }
                                      disabled={isComposerDisabled}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="trade-builder-column">
                          <div className="trade-builder-column-header">
                            <h3>You Request</h3>
                          </div>

                          <div className="trade-shard-row">
                            <label className="trade-field-label" htmlFor="trade-requested-shards">
                              Requested Shards
                            </label>

                            <input
                              id="trade-requested-shards"
                              type="number"
                              min="0"
                              className="trade-input"
                              value={tradeRequestedShards}
                              onChange={(e) =>
                                setTradeRequestedShards(Math.max(0, Number(e.target.value || 0)))
                              }
                              disabled={isComposerDisabled}
                            />
                          </div>

                          <div className="trade-picker-block">
                            <span className="trade-picker-title">Requested Cards</span>

                            <div className="trade-picker-row">
                              <select
                                className="trade-select"
                                value={requestCardId}
                                onChange={(e) => setRequestCardId(e.target.value)}
                                disabled={!canUseRecipientAssets}
                              >
                                <option value="">Choose player card...</option>

                                {tradeableRecipientBinderRows.map((row) => (
                                  <option key={row.id} value={row.id}>
                                    {buildCardOptionLabel(row)}
                                  </option>
                                ))}
                              </select>

                              <input
                                type="number"
                                min="1"
                                className="trade-qty-input"
                                value={requestCardQty}
                                onChange={(e) =>
                                  setRequestCardQty(Math.max(1, Number(e.target.value || 1)))
                                }
                                disabled={!canUseRecipientAssets}
                              />

                              <button
                                type="button"
                                className="trade-inline-btn"
                                onClick={addTradeRequestedCard}
                                disabled={!canUseRecipientAssets}
                              >
                                Add
                              </button>
                            </div>

                            <div className="trade-line-list">
                              {tradeRequestedCards.length === 0 ? (
                                <div className="trade-line-empty">No requested cards.</div>
                              ) : (
                                tradeRequestedCards.map((line, index) => (
                                  <div className="trade-line-row" key={`${line.binder_card_id}-${index}`}>
                                    <div className="trade-line-copy">
                                      <div className="trade-line-name">{line.display_name}</div>
                                      <div className="trade-line-meta">Qty {line.quantity}</div>
                                    </div>

                                    <button
                                      type="button"
                                      className="trade-inline-btn trade-inline-btn-danger"
                                      onClick={() =>
                                        setTradeRequestedCards((prev) => removeLineItem(prev, index))
                                      }
                                      disabled={isComposerDisabled}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          <div className="trade-picker-block">
                            <span className="trade-picker-title">Requested Items</span>

                            <div className="trade-picker-row">
                              <select
                                className="trade-select"
                                value={requestItemId}
                                onChange={(e) => setRequestItemId(e.target.value)}
                                disabled={!canUseRecipientAssets}
                              >
                                <option value="">Choose player item...</option>

                                {recipientInventoryRows
                                  .filter((row) => Number(row.available_quantity || 0) > 0)
                                  .map((row) => (
                                    <option key={row.id} value={row.id}>
                                      {buildItemOptionLabel(row)}
                                    </option>
                                  ))}
                              </select>

                              <input
                                type="number"
                                min="1"
                                className="trade-qty-input"
                                value={requestItemQty}
                                onChange={(e) =>
                                  setRequestItemQty(Math.max(1, Number(e.target.value || 1)))
                                }
                                disabled={!canUseRecipientAssets}
                              />

                              <button
                                type="button"
                                className="trade-inline-btn"
                                onClick={addTradeRequestedItem}
                                disabled={!canUseRecipientAssets}
                              >
                                Add
                              </button>
                            </div>

                            <div className="trade-line-list">
                              {tradeRequestedItems.length === 0 ? (
                                <div className="trade-line-empty">No requested items.</div>
                              ) : (
                                tradeRequestedItems.map((line, index) => (
                                  <div className="trade-line-row" key={`${line.player_inventory_id}-${index}`}>
                                    <div className="trade-line-copy">
                                      <div className="trade-line-name">{line.display_name}</div>
                                      <div className="trade-line-meta">Qty {line.quantity}</div>
                                    </div>

                                    <button
                                      type="button"
                                      className="trade-inline-btn trade-inline-btn-danger"
                                      onClick={() =>
                                        setTradeRequestedItems((prev) => removeLineItem(prev, index))
                                      }
                                      disabled={isComposerDisabled}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="trade-composer-actions">
                        <button
                          type="button"
                          className="trade-primary-btn"
                          onClick={handleSendTrade}
                          disabled={isComposerDisabled}
                        >
                          Send Trade Offer
                        </button>

                        <button
                          type="button"
                          className="trade-secondary-btn"
                          onClick={resetTradeComposer}
                          disabled={isComposerDisabled}
                        >
                          Reset Trade
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="trade-field">
                        <label className="trade-field-label" htmlFor="gift-message">
                          Message
                        </label>

                        <textarea
                          id="gift-message"
                          className="trade-textarea"
                          rows={3}
                          value={giftMessage}
                          onChange={(e) => setGiftMessage(e.target.value)}
                          placeholder="Optional gift message..."
                          disabled={isComposerDisabled}
                        />
                      </div>

                      <div className="trade-builder-column trade-builder-column-full">
                        <div className="trade-builder-column-header">
                          <h3>Gift Contents</h3>
                        </div>

                        <div className="trade-shard-row">
                          <label className="trade-field-label" htmlFor="gift-shards">
                            Gift Shards
                          </label>

                          <input
                            id="gift-shards"
                            type="number"
                            min="0"
                            max={availableShards}
                            className="trade-input"
                            value={giftShards}
                            onChange={(e) =>
                              setGiftShards(
                                Math.max(
                                  0,
                                  Math.min(availableShards, Number(e.target.value || 0))
                                )
                              )
                            }
                            disabled={isComposerDisabled}
                          />
                        </div>

                        <div className="trade-picker-block">
                          <span className="trade-picker-title">Gift Cards</span>

                          <div className="trade-picker-row">
                            <select
                              className="trade-select"
                              value={giftCardId}
                              onChange={(e) => setGiftCardId(e.target.value)}
                              disabled={isComposerDisabled}
                            >
                              <option value="">Choose binder card...</option>

                              {tradeableMyBinderRows.map((row) => (
                                <option key={row.id} value={row.id}>
                                  {buildCardOptionLabel(row)}
                                </option>
                              ))}
                            </select>

                            <input
                              type="number"
                              min="1"
                              className="trade-qty-input"
                              value={giftCardQty}
                              onChange={(e) =>
                                setGiftCardQty(Math.max(1, Number(e.target.value || 1)))
                              }
                              disabled={isComposerDisabled}
                            />

                            <button
                              type="button"
                              className="trade-inline-btn"
                              onClick={addGiftCard}
                              disabled={isComposerDisabled}
                            >
                              Add
                            </button>
                          </div>

                          <div className="trade-line-list">
                            {giftCards.length === 0 ? (
                              <div className="trade-line-empty">No gift cards.</div>
                            ) : (
                              giftCards.map((line, index) => (
                                <div className="trade-line-row" key={`${line.binder_card_id}-${index}`}>
                                  <div className="trade-line-copy">
                                    <div className="trade-line-name">{line.display_name}</div>
                                    <div className="trade-line-meta">Qty {line.quantity}</div>
                                  </div>

                                  <button
                                    type="button"
                                    className="trade-inline-btn trade-inline-btn-danger"
                                    onClick={() =>
                                      setGiftCards((prev) => removeLineItem(prev, index))
                                    }
                                    disabled={isComposerDisabled}
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="trade-picker-block">
                          <span className="trade-picker-title">Gift Items</span>

                          <div className="trade-picker-row">
                            <select
                              className="trade-select"
                              value={giftItemId}
                              onChange={(e) => setGiftItemId(e.target.value)}
                              disabled={isComposerDisabled}
                            >
                              <option value="">Choose inventory item...</option>

                              {myInventoryRows
                                .filter((row) => Number(row.available_quantity || 0) > 0)
                                .map((row) => (
                                  <option key={row.id} value={row.id}>
                                    {buildItemOptionLabel(row)}
                                  </option>
                                ))}
                            </select>

                            <input
                              type="number"
                              min="1"
                              className="trade-qty-input"
                              value={giftItemQty}
                              onChange={(e) =>
                                setGiftItemQty(Math.max(1, Number(e.target.value || 1)))
                              }
                              disabled={isComposerDisabled}
                            />

                            <button
                              type="button"
                              className="trade-inline-btn"
                              onClick={addGiftItem}
                              disabled={isComposerDisabled}
                            >
                              Add
                            </button>
                          </div>

                          <div className="trade-line-list">
                            {giftItems.length === 0 ? (
                              <div className="trade-line-empty">No gift items.</div>
                            ) : (
                              giftItems.map((line, index) => (
                                <div className="trade-line-row" key={`${line.player_inventory_id}-${index}`}>
                                  <div className="trade-line-copy">
                                    <div className="trade-line-name">{line.display_name}</div>
                                    <div className="trade-line-meta">Qty {line.quantity}</div>
                                  </div>

                                  <button
                                    type="button"
                                    className="trade-inline-btn trade-inline-btn-danger"
                                    onClick={() =>
                                      setGiftItems((prev) => removeLineItem(prev, index))
                                    }
                                    disabled={isComposerDisabled}
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="trade-composer-actions">
                          <button
                            type="button"
                            className="trade-primary-btn"
                            onClick={handleSendGift}
                            disabled={isComposerDisabled}
                          >
                            Send Gift
                          </button>

                          <button
                            type="button"
                            className="trade-secondary-btn"
                            onClick={resetGiftComposer}
                            disabled={isComposerDisabled}
                          >
                            Reset Gift
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </section>

            <aside className="trade-right">
              <div className="trade-panel trade-feed-panel">
                <div className="trade-panel-kicker">INCOMING</div>
                <h2 className="trade-panel-title">Incoming Trades</h2>

                <div className="trade-feed-list">
                  {incomingTrades.length === 0 ? (
                    <div className="trade-feed-empty">No incoming trades.</div>
                  ) : (
                    incomingTrades.map((trade) => (
                      <div className="trade-feed-card" key={trade.id}>
                        <div className="trade-feed-card-top">
                          <div className="trade-feed-user">
                            <div className="trade-feed-avatar">
                              {trade.counterpart?.avatar ? (
                                <img
                                  src={trade.counterpart.avatar}
                                  alt={trade.counterpart.username}
                                />
                              ) : (
                                <span>{getInitial(trade.counterpart?.username)}</span>
                              )}
                            </div>

                            <div>
                              <div className="trade-feed-name">
                                {trade.counterpart?.username || "Unknown User"}
                              </div>
                              <div className="trade-feed-date">
                                {formatDateTime(trade.created_at)}
                              </div>
                            </div>
                          </div>

                          <div className="trade-feed-status">{trade.status}</div>
                        </div>

                        {trade.message ? (
                          <p className="trade-feed-message">{trade.message}</p>
                        ) : null}

                        <div className="trade-feed-columns">
                          <div>
                            <div className="trade-feed-column-title">They Offer</div>

                            {trade.offered_shards > 0 && (
                              <div className="trade-mini-line">
                                Shards: {trade.offered_shards}
                              </div>
                            )}

                            {trade.offeredCards.map((line) => (
                              <div className="trade-mini-line" key={`oc-${line.id}`}>
                                {line.card?.name || "Card"} × {line.quantity}
                              </div>
                            ))}

                            {trade.offeredItems.map((line) => (
                              <div className="trade-mini-line" key={`oi-${line.id}`}>
                                {line.item?.name || "Item"} × {line.quantity}
                              </div>
                            ))}
                          </div>

                          <div>
                            <div className="trade-feed-column-title">They Want</div>

                            {trade.requested_shards > 0 && (
                              <div className="trade-mini-line">
                                Shards: {trade.requested_shards}
                              </div>
                            )}

                            {trade.requestedCards.map((line) => (
                              <div className="trade-mini-line" key={`rc-${line.id}`}>
                                {line.card?.name || "Card"} × {line.quantity}
                              </div>
                            ))}

                            {trade.requestedItems.map((line) => (
                              <div className="trade-mini-line" key={`ri-${line.id}`}>
                                {line.item?.name || "Item"} × {line.quantity}
                              </div>
                            ))}
                          </div>
                        </div>

                        {trade.status === "pending" && (
                          <div className="trade-feed-actions">
                            <button
                              type="button"
                              className="trade-primary-btn"
                              onClick={() => handleIncomingTradeAction(trade.id, "Accept")}
                              disabled={busy}
                            >
                              Accept
                            </button>

                            <button
                              type="button"
                              className="trade-secondary-btn"
                              onClick={() => handleIncomingTradeAction(trade.id, "Decline")}
                              disabled={busy}
                            >
                              Decline
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="trade-panel trade-feed-panel">
                <div className="trade-panel-kicker">OUTGOING</div>
                <h2 className="trade-panel-title">Outgoing Trades</h2>

                <div className="trade-feed-list">
                  {outgoingTrades.length === 0 ? (
                    <div className="trade-feed-empty">No outgoing trades.</div>
                  ) : (
                    outgoingTrades.map((trade) => (
                      <div className="trade-feed-card" key={trade.id}>
                        <div className="trade-feed-card-top">
                          <div className="trade-feed-user">
                            <div className="trade-feed-avatar">
                              {trade.counterpart?.avatar ? (
                                <img
                                  src={trade.counterpart.avatar}
                                  alt={trade.counterpart.username}
                                />
                              ) : (
                                <span>{getInitial(trade.counterpart?.username)}</span>
                              )}
                            </div>

                            <div>
                              <div className="trade-feed-name">
                                {trade.counterpart?.username || "Unknown User"}
                              </div>
                              <div className="trade-feed-date">
                                {formatDateTime(trade.created_at)}
                              </div>
                            </div>
                          </div>

                          <div className="trade-feed-status">{trade.status}</div>
                        </div>

                        {trade.message ? (
                          <p className="trade-feed-message">{trade.message}</p>
                        ) : null}

                        {trade.status === "pending" && (
                          <div className="trade-feed-actions">
                            <button
                              type="button"
                              className="trade-secondary-btn"
                              onClick={() => handleOutgoingTradeCancel(trade.id)}
                              disabled={busy}
                            >
                              Cancel Trade
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="trade-panel trade-feed-panel">
                <div className="trade-panel-kicker">GIFTS</div>
                <h2 className="trade-panel-title">Received Gifts</h2>

                <div className="trade-feed-list">
                  {receivedGifts.length === 0 ? (
                    <div className="trade-feed-empty">No gifts received.</div>
                  ) : (
                    receivedGifts.map((gift) => (
                      <div className="trade-feed-card" key={gift.id}>
                        <div className="trade-feed-card-top">
                          <div className="trade-feed-user">
                            <div className="trade-feed-avatar">
                              {gift.sender?.avatar ? (
                                <img src={gift.sender.avatar} alt={gift.sender.username} />
                              ) : (
                                <span>{getInitial(gift.sender?.username)}</span>
                              )}
                            </div>

                            <div>
                              <div className="trade-feed-name">
                                {gift.sender?.username || "Unknown User"}
                              </div>
                              <div className="trade-feed-date">
                                {formatDateTime(gift.created_at)}
                              </div>
                            </div>
                          </div>

                          <div className="trade-feed-status">
                            {gift.is_read ? "read" : "new"}
                          </div>
                        </div>

                        {gift.message ? (
                          <p className="trade-feed-message">{gift.message}</p>
                        ) : null}

                        <div className="trade-feed-columns trade-feed-columns-single">
                          <div>
                            {gift.sent_shards > 0 && (
                              <div className="trade-mini-line">
                                Shards: {gift.sent_shards}
                              </div>
                            )}

                            {gift.cards.map((line) => (
                              <div className="trade-mini-line" key={`gc-${line.id}`}>
                                {line.card?.name || "Card"} × {line.quantity}
                              </div>
                            ))}

                            {gift.items.map((line) => (
                              <div className="trade-mini-line" key={`gi-${line.id}`}>
                                {line.item?.name || "Item"} × {line.quantity}
                              </div>
                            ))}
                          </div>
                        </div>

                        {!gift.is_read && (
                          <div className="trade-feed-actions">
                            <button
                              type="button"
                              className="trade-secondary-btn"
                              disabled={busy}
                              onClick={() => markGiftRead(gift.id)}
                            >
                              Mark Read
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </LauncherLayout>
  );
}

export default TradePage;
