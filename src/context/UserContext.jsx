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
  return "Duelist";
}

function buildResolvedUser(profile, membership, activeSeriesId) {
  const globalRole = normalizeGlobalRole(profile?.global_role);
  const membershipRole = String(membership?.role || "").trim().toLowerCase();
  const isSeriesAdmin = Boolean(membership?.is_owner) || membershipRole === "admin";
  const isInActiveSeries = Boolean(membership?.series_id);
  const isBlocked = !profile;

  let effectiveRole = "Duelist";

  if (globalRole === "Admin+") {
    effectiveRole = "Admin+";
  } else if (globalRole === "Admin") {
    effectiveRole = "Admin";
  } else if (isInActiveSeries) {
    effectiveRole = "Duelist+";
  }

  return {
    id: profile?.id || null,
    username: profile?.username || "Unknown User",
    avatarUrl: profile?.avatar_url || "",
    authEmail: profile?.auth_email || "",
    globalRole,
    effectiveRole,
    activeSeriesId: activeSeriesId || null,
    isBlocked,
    isInActiveSeries,
    seriesMembershipRole: isInActiveSeries
      ? isSeriesAdmin
        ? "admin"
        : membershipRole || "duelist"
      : null,
    canAccessHeaderAdmin: globalRole === "Admin+",
    canAccessGameAdmin:
      globalRole === "Admin+" ||
      globalRole === "Admin" ||
      isSeriesAdmin,
    canAccessProgression:
      globalRole === "Admin+" ||
      globalRole === "Admin" ||
      isInActiveSeries,
    canAccessDeckGame: true,
  };
}

export function UserProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const fetchProfile = useCallback(async (userId) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, auth_email, global_role")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }, []);

  const fetchActiveSeriesMembership = useCallback(async (userId) => {
    const { data: activeSeries, error: activeSeriesError } = await supabase
      .from("game_series")
      .select("id")
      .eq("is_current", true)
      .maybeSingle();

    if (activeSeriesError) throw activeSeriesError;

    if (!activeSeries?.id) {
      return {
        activeSeriesId: null,
        membership: null,
      };
    }

    const { data: membership, error: membershipError } = await supabase
      .from("series_players")
      .select("series_id, role, is_owner")
      .eq("series_id", activeSeries.id)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError) throw membershipError;

    return {
      activeSeriesId: activeSeries.id,
      membership: membership || null,
    };
  }, []);

  const loadUser = useCallback(async () => {
    setAuthLoading(true);

    try {
      const {
        data: { session: currentSession },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      setSession(currentSession || null);

      if (!currentSession?.user?.id) {
        setProfile(null);
        setUser(null);
        return;
      }

      const loadedProfile = await fetchProfile(currentSession.user.id);

      if (!loadedProfile) {
        setProfile(null);
        setUser(null);
        return;
      }

      const { activeSeriesId, membership } = await fetchActiveSeriesMembership(
        currentSession.user.id
      );

      setProfile(loadedProfile);
      setUser(buildResolvedUser(loadedProfile, membership, activeSeriesId));
    } catch (error) {
      console.error("User load error:", error);
      setProfile(null);
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, [fetchProfile, fetchActiveSeriesMembership]);

  useEffect(() => {
    let mounted = true;

    const runLoad = async () => {
      if (!mounted) return;
      await loadUser();
    };

    runLoad();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      runLoad();
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [loadUser]);

  const signInWithUsername = useCallback(
    async (username, password) => {
      const trimmedUsername = String(username || "").trim();
      const trimmedPassword = String(password || "");

      if (!trimmedUsername || !trimmedPassword) {
        throw new Error("Username and password are required.");
      }

      const { data: resolvedEmail, error: rpcError } = await supabase.rpc(
        "get_login_email_for_username",
        { p_username: trimmedUsername }
      );

      if (rpcError) {
        console.error("Username lookup failed:", rpcError);
        throw new Error("Login lookup failed.");
      }

      if (!resolvedEmail) {
        throw new Error("Invalid username or password.");
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: resolvedEmail,
        password: trimmedPassword,
      });

      if (signInError) {
        console.error("Password sign-in failed:", signInError);
        throw new Error("Invalid username or password.");
      }

      await loadUser();
    },
    [loadUser]
  );

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    setSession(null);
    setProfile(null);
    setUser(null);
  }, []);

  const reloadUser = useCallback(async () => {
    await loadUser();
  }, [loadUser]);

  const updateOwnProfile = useCallback(
    async ({ username, avatar_url }) => {
      if (!session?.user?.id) {
        throw new Error("Not logged in.");
      }

      const payload = {};

      if (typeof username === "string") {
        const trimmed = username.trim();
        if (!trimmed) throw new Error("Username cannot be empty.");
        payload.username = trimmed;
      }

      if (typeof avatar_url === "string") {
        payload.avatar_url = avatar_url.trim() || null;
      }

      if (!Object.keys(payload).length) return;

      const { error } = await supabase
        .from("profiles")
        .update(payload)
        .eq("id", session.user.id);

      if (error) throw error;

      await loadUser();
    },
    [session, loadUser]
  );

  const changeOwnPassword = useCallback(async (newPassword) => {
    const trimmedPassword = String(newPassword || "").trim();

    if (!trimmedPassword) {
      throw new Error("Password cannot be empty.");
    }

    const { error } = await supabase.auth.updateUser({
      password: trimmedPassword,
    });

    if (error) throw error;
  }, []);

  const value = useMemo(
    () => ({
      session,
      profile,
      user,
      authLoading,
      signInWithUsername,
      signOut,
      reloadUser,
      updateOwnProfile,
      changeOwnPassword,
    }),
    [
      session,
      profile,
      user,
      authLoading,
      signInWithUsername,
      signOut,
      reloadUser,
      updateOwnProfile,
      changeOwnPassword,
    ]
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