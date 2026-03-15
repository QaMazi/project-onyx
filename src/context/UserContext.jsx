import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { supabase } from "../lib/supabase";

const UserContext = createContext(null);

function normalizeGlobalRole(role) {
  const normalized = String(role || "").trim().toLowerCase();

  if (normalized === "admin+") return "Admin+";
  if (normalized === "adminplus") return "Admin+";
  if (normalized === "admin") return "Admin";
  if (normalized === "blocked") return "Blocked";
  if (normalized === "duelist") return "Duelist";
  if (normalized === "applicant") return "Applicant";

  return "Applicant";
}

function getBestUsername(sessionUser, profile) {
  const metadata = sessionUser?.user_metadata || {};

  return (
    profile?.username ||
    metadata.user_name ||
    metadata.preferred_username ||
    metadata.full_name ||
    metadata.name ||
    metadata.nickname ||
    "Unknown User"
  );
}

function getBestAvatar(sessionUser, profile) {
  const metadata = sessionUser?.user_metadata || {};

  return (
    profile?.avatar ||
    metadata.avatar_url ||
    metadata.picture ||
    metadata.image ||
    ""
  );
}

function getBestDiscordUserId(sessionUser, profile) {
  const metadata = sessionUser?.user_metadata || {};
  const identities = Array.isArray(sessionUser?.identities)
    ? sessionUser.identities
    : [];

  const discordIdentity = identities.find(
    (identity) => identity?.provider === "discord"
  );

  return (
    profile?.discord_user_id ||
    metadata.provider_id ||
    metadata.sub ||
    discordIdentity?.id ||
    discordIdentity?.user_id ||
    null
  );
}

function buildBaseIdentity(sessionUser, profile) {
  return {
    id: sessionUser?.id || profile?.id || null,
    username: getBestUsername(sessionUser, profile),
    avatar: getBestAvatar(sessionUser, profile),
    discordUserId: getBestDiscordUserId(sessionUser, profile),
  };
}

async function ensureProfileExists(sessionUser) {
  const { data: existingProfile, error: existingProfileError } = await supabase
    .from("profiles")
    .select(
      "id, discord_user_id, username, avatar, role, active_series_id"
    )
    .eq("id", sessionUser.id)
    .maybeSingle();

  if (existingProfileError) {
    throw existingProfileError;
  }

  if (existingProfile) {
    return existingProfile;
  }

  const insertPayload = {
    id: sessionUser.id,
    discord_user_id: getBestDiscordUserId(sessionUser, null),
    username: getBestUsername(sessionUser, null),
    avatar: getBestAvatar(sessionUser, null) || null,
  };

  const { error: insertProfileError } = await supabase
    .from("profiles")
    .insert(insertPayload);

  if (insertProfileError) {
    throw insertProfileError;
  }

  const { data: createdProfile, error: createdProfileError } = await supabase
    .from("profiles")
    .select(
      "id, discord_user_id, username, avatar, role, active_series_id"
    )
    .eq("id", sessionUser.id)
    .single();

  if (createdProfileError) {
    throw createdProfileError;
  }

  return createdProfile;
}

async function resolveUserFromSession(sessionUser) {
  const profile = await ensureProfileExists(sessionUser);
  const baseIdentity = buildBaseIdentity(sessionUser, profile);
  const globalRole = normalizeGlobalRole(profile?.role);

  if (globalRole === "Blocked") {
    return {
      ...baseIdentity,
      globalRole,
      role: "Blocked",
      activeSeriesId: profile?.active_series_id || null,
      seriesMembershipRole: null,
    };
  }

  if (globalRole === "Admin+") {
    return {
      ...baseIdentity,
      globalRole,
      role: "Admin+",
      activeSeriesId: profile?.active_series_id || null,
      seriesMembershipRole: "admin",
    };
  }

  const { data: activeSeries, error: activeSeriesError } = await supabase
    .from("game_series")
    .select("id")
    .eq("is_current", true)
    .maybeSingle();

  if (activeSeriesError) {
    throw activeSeriesError;
  }

  if (!activeSeries?.id) {
    return {
      ...baseIdentity,
      globalRole,
      role: "Applicant",
      activeSeriesId: null,
      seriesMembershipRole: null,
    };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("series_players")
    .select("series_id, is_owner, role")
    .eq("series_id", activeSeries.id)
    .eq("user_id", sessionUser.id)
    .maybeSingle();

  if (membershipError) {
    throw membershipError;
  }

  if (!membership) {
    return {
      ...baseIdentity,
      globalRole,
      role: "Applicant",
      activeSeriesId: activeSeries.id,
      seriesMembershipRole: null,
    };
  }

  const membershipRole = String(membership.role || "duelist").toLowerCase();
  const resolvedRole =
    membership.is_owner || membershipRole === "admin" ? "Admin" : "Duelist";

  return {
    ...baseIdentity,
    globalRole,
    role: resolvedRole,
    activeSeriesId: activeSeries.id,
    seriesMembershipRole: membership.is_owner ? "admin" : membershipRole,
  };
}

export function UserProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const loadUser = useCallback(async () => {
    setAuthLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        setUser(null);
        return;
      }

      const resolvedUser = await resolveUserFromSession(session.user);
      setUser(resolvedUser);
    } catch (error) {
      console.error("User load error:", error);
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function safeLoad() {
      if (!mounted) return;
      await loadUser();
    }

    safeLoad();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      safeLoad();
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [loadUser]);

  const value = useMemo(
    () => ({
      user,
      setUser,
      authLoading,
      setAuthLoading,
      reloadUser: loadUser,
    }),
    [user, authLoading, loadUser]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const context = useContext(UserContext);

  if (!context) {
    throw new Error("useUser must be used within a UserProvider");
  }

  return context;
}