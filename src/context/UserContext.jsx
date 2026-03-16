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

  if (normalized === "admin+" || normalized === "adminplus") return "Admin+";
  if (normalized === "admin") return "Admin";
  if (normalized === "duelist" || normalized === "duelist+" || normalized === "duelistplus") {
    return "Duelist";
  }
  if (normalized === "blocked") return "Blocked";

  return "Player";
}

function buildResolvedUser(profile) {
  const globalRole = normalizeGlobalRole(profile?.global_role || profile?.role);
  const isBlocked = globalRole === "Blocked";
  const effectiveRole = isBlocked ? "Blocked" : globalRole;

  return {
    id: profile?.id || null,
    username: profile?.username || "Unknown User",
    avatarUrl: profile?.avatar_url || "",
    authEmail: profile?.auth_email || "",
    globalRole,
    effectiveRole,
    role: effectiveRole,
    activeSeriesId: null,
    isBlocked,
    isInActiveSeries: false,
    seriesMembershipRole: null,
    canAccessHeaderAdmin: !isBlocked && globalRole === "Admin+",
    canAccessGameAdmin: !isBlocked && (globalRole === "Admin+" || globalRole === "Admin"),
    canAccessProgression:
      !isBlocked &&
      (globalRole === "Admin+" || globalRole === "Admin" || globalRole === "Duelist"),
    canAccessDeckGame:
      !isBlocked &&
      (globalRole === "Admin+" || globalRole === "Admin" || globalRole === "Player"),
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
      .select("id, username, avatar_url, auth_email, global_role, role")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw error;
    return data;
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

      setProfile(loadedProfile);
      setUser(buildResolvedUser(loadedProfile));
    } catch (error) {
      console.error("User load error:", error);
      setProfile(null);
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, [fetchProfile]);

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
      setUser,
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
