import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "../lib/supabase";
import {
  relabelPremiumCatalogItem,
  relabelPremiumTokenText,
} from "../lib/premiumDisplay";
import { PREMIUM_DEFAULT_CODES } from "../data/premiumCatalog.js";
import { useUser } from "./UserContext";

const PremiumContext = createContext(null);

const EMPTY_STATE = {
  tokens: 0,
  catalog: [],
  equippedBySlot: {},
  showcase: {
    is_public: false,
  },
  isAdminPlus: false,
  autoMainRoundTokensEnabled: true,
};

function normalizePremiumState(data) {
  const defaultCodes = new Set(PREMIUM_DEFAULT_CODES);
  const equippedBySlot = Object.fromEntries(
    Object.entries(data?.equipped_by_slot || {}).map(([slotCode, item]) => [
      slotCode,
      item
        ? {
            ...item,
            name: relabelPremiumTokenText(item.name),
            description: relabelPremiumTokenText(item.description),
          }
        : item,
    ])
  );
  const catalog = Array.isArray(data?.catalog)
    ? data.catalog.map((item) => ({
        ...relabelPremiumCatalogItem(item),
        is_owned: Boolean(item?.is_owned) || defaultCodes.has(item?.code),
      }))
    : [];

  return {
    tokens: Number(data?.tokens || 0),
    catalog,
    equippedBySlot,
    showcase: data?.showcase || { is_public: false },
    isAdminPlus: Boolean(data?.is_admin_plus),
    autoMainRoundTokensEnabled:
      data?.auto_main_round_tokens_enabled !== false,
  };
}

export function PremiumProvider({ children }) {
  const { user, authLoading } = useUser();
  const [state, setState] = useState(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  const refreshPremiumState = useCallback(async () => {
    if (!user || user.isBlocked) {
      setState(EMPTY_STATE);
      setLoading(false);
      return EMPTY_STATE;
    }

    setLoading(true);
    setErrorText("");

    try {
      const { data, error } = await supabase.rpc("get_my_premium_state");
      if (error) throw error;

      const nextState = normalizePremiumState(data || {});
      setState(nextState);
      return nextState;
    } catch (error) {
      console.error("Failed to load premium state:", error);
      setState(EMPTY_STATE);
      setErrorText(error.message || "Failed to load premium state.");
      throw error;
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;

    if (!user || user.isBlocked) {
      setState(EMPTY_STATE);
      setLoading(false);
      return;
    }

    refreshPremiumState().catch(() => {});
  }, [authLoading, user, refreshPremiumState]);

  useEffect(() => {
    const body = document.body;
    const slotStyles = {
      premiumHeaderStyle:
        state.equippedBySlot?.header_line_style?.metadata?.styleId || "",
      premiumFooterStyle:
        state.equippedBySlot?.footer_line_style?.metadata?.styleId || "",
      premiumAccentMotion:
        state.equippedBySlot?.accent_motion_style?.metadata?.styleId || "",
      premiumParticles:
        state.equippedBySlot?.background_particle_style?.metadata?.styleId || "",
      premiumPanelBorder:
        state.equippedBySlot?.panel_border_style?.metadata?.styleId || "",
      premiumGlowStyle:
        state.equippedBySlot?.glow_style?.metadata?.styleId || "",
      premiumModalTransition:
        state.equippedBySlot?.modal_transition_style?.metadata?.styleId || "",
      premiumPageTransition:
        state.equippedBySlot?.page_transition_style?.metadata?.styleId || "",
      premiumCursorStyle:
        state.equippedBySlot?.cursor_effect_style?.metadata?.styleId || "",
      premiumAtmosphere:
        state.equippedBySlot?.atmosphere_pack?.metadata?.styleId || "",
      premiumNameplate:
        state.equippedBySlot?.nameplate_style?.metadata?.styleId || "",
      premiumTokenPill:
        state.equippedBySlot?.token_pill_style?.metadata?.styleId || "",
      premiumRolePill:
        state.equippedBySlot?.role_pill_style?.metadata?.styleId || "",
      premiumAvatarFrame:
        state.equippedBySlot?.avatar_frame?.metadata?.styleId || "",
      premiumProfileSkin:
        state.equippedBySlot?.profile_card_skin?.metadata?.styleId || "",
      premiumPrestigeBorder:
        state.equippedBySlot?.prestige_border?.metadata?.styleId || "",
      premiumBannerEffect:
        state.equippedBySlot?.profile_banner_effect?.metadata?.styleId || "",
      premiumTitleFlair:
        state.equippedBySlot?.title_flair?.metadata?.styleId || "",
      premiumEmblem:
        state.equippedBySlot?.account_emblem?.metadata?.styleId || "",
    };

    Object.entries(slotStyles).forEach(([key, value]) => {
      body.dataset[key] = value;
    });

    return () => {
      Object.keys(slotStyles).forEach((key) => {
        delete body.dataset[key];
      });
    };
  }, [state.equippedBySlot]);

  const purchaseItem = useCallback(
    async (itemId) => {
      const { error } = await supabase.rpc("purchase_premium_item", {
        p_item_id: itemId,
      });

      if (error) throw error;
      return refreshPremiumState();
    },
    [refreshPremiumState]
  );

  const equipItem = useCallback(
    async (itemId) => {
      const { error } = await supabase.rpc("equip_premium_item", {
        p_item_id: itemId,
      });

      if (error) throw error;
      return refreshPremiumState();
    },
    [refreshPremiumState]
  );

  const unequipSlot = useCallback(
    async (slotCode) => {
      const { error } = await supabase.rpc("unequip_premium_slot", {
        p_slot_code: slotCode,
      });

      if (error) throw error;
      return refreshPremiumState();
    },
    [refreshPremiumState]
  );

  const saveShowcase = useCallback(async (payload) => {
    const { data, error } = await supabase.rpc("save_my_profile_showcase", {
      p_is_public: Boolean(payload?.isPublic),
      p_headline: payload?.headline || null,
      p_subheadline: payload?.subheadline || null,
      p_deck_spotlight_title: payload?.deckSpotlightTitle || null,
      p_deck_spotlight_text: payload?.deckSpotlightText || null,
      p_featured_card_id: payload?.featuredCardId || null,
      p_featured_card_note: payload?.featuredCardNote || null,
      p_flex_title: payload?.flexTitle || null,
      p_flex_text: payload?.flexText || null,
      p_highlight_title: payload?.highlightTitle || null,
      p_highlight_text: payload?.highlightText || null,
    });

    if (error) throw error;

    const nextState = normalizePremiumState(data || {});
    setState(nextState);
    return nextState;
  }, []);

  const searchShowcaseCards = useCallback(async (query) => {
    const { data, error } = await supabase.rpc("search_showcase_cards", {
      p_query: query || null,
    });

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }, []);

  const fetchRandomPublicShowcase = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_random_public_showcase");
    if (error) throw error;
    return data?.showcase || null;
  }, []);

  const grantTokens = useCallback(
    async ({ targetUserId, amount, reason }) => {
      const { error } = await supabase.rpc("admin_grant_gentlemens_tokens", {
        p_target_user_id: targetUserId,
        p_amount: amount,
        p_reason: reason || null,
      });

      if (error) throw error;
      return refreshPremiumState();
    },
    [refreshPremiumState]
  );

  const setItemPrice = useCallback(async (itemId, price) => {
    const { error } = await supabase.rpc("admin_set_premium_item_price", {
      p_item_id: itemId,
      p_price: price,
    });

    if (error) throw error;
    return refreshPremiumState();
  }, [refreshPremiumState]);

  const setAutoMainRoundTokensEnabled = useCallback(
    async (enabled) => {
      const { error } = await supabase.rpc(
        "admin_set_premium_auto_round_tokens_enabled",
        {
          p_enabled: enabled,
        }
      );

      if (error) throw error;
      return refreshPremiumState();
    },
    [refreshPremiumState]
  );

  const catalogById = useMemo(() => {
    return new Map(state.catalog.map((item) => [item.id, item]));
  }, [state.catalog]);

  const catalogByCode = useMemo(() => {
    return new Map(state.catalog.map((item) => [item.code, item]));
  }, [state.catalog]);

  const ownedCodes = useMemo(() => {
    return new Set(
      state.catalog.filter((item) => item.is_owned).map((item) => item.code)
    );
  }, [state.catalog]);

  const value = useMemo(
    () => ({
      loading,
      errorText,
      tokens: state.tokens,
      catalog: state.catalog,
      catalogById,
      catalogByCode,
      ownedCodes,
      equippedBySlot: state.equippedBySlot,
      showcase: state.showcase,
      isAdminPlus: state.isAdminPlus,
      autoMainRoundTokensEnabled: state.autoMainRoundTokensEnabled,
      refreshPremiumState,
      purchaseItem,
      equipItem,
      unequipSlot,
      saveShowcase,
      searchShowcaseCards,
      fetchRandomPublicShowcase,
      grantTokens,
      setItemPrice,
      setAutoMainRoundTokensEnabled,
    }),
    [
      loading,
      errorText,
      state.tokens,
      state.catalog,
      state.equippedBySlot,
      state.showcase,
      state.isAdminPlus,
      state.autoMainRoundTokensEnabled,
      catalogById,
      catalogByCode,
      ownedCodes,
      refreshPremiumState,
      purchaseItem,
      equipItem,
      unequipSlot,
      saveShowcase,
      searchShowcaseCards,
      fetchRandomPublicShowcase,
      grantTokens,
      setItemPrice,
      setAutoMainRoundTokensEnabled,
    ]
  );

  return (
    <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>
  );
}

export function usePremium() {
  const context = useContext(PremiumContext);

  if (!context) {
    throw new Error("usePremium must be used within a PremiumProvider");
  }

  return context;
}
