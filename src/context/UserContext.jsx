import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";

const UserContext = createContext(null);

function normalizeGlobalRole(role) {
  const normalized = String(role || "").toLowerCase();

  if (normalized === "admin+") return "Admin+";
  if (normalized === "adminplus") return "Admin+";
  if (normalized === "admin") return "Admin";
  if (normalized === "blocked") return "Blocked";
  if (normalized === "duelist") return "Duelist";
  if (normalized === "applicant") return "Applicant";

  return "Applicant";
}

function buildBaseIdentity(sessionUser, profile) {
  const metadata = sessionUser?.user_metadata || {};

  return {
    id: sessionUser?.id || profile?.id || null,
    username:
      profile?.username ||
      metadata.full_name ||
      metadata.name ||
      "Unknown User",
    avatar:
      profile?.avatar ||
      metadata.avatar_url ||
      "",
  };
}

async function resolveUserFromSession(sessionUser) {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, username, avatar, role, active_series_id")
    .eq("id", sessionUser.id)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

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
        setAuthLoading(false);
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

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      safeLoad();
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
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