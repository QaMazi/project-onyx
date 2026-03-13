import { useEffect } from "react";
import { Routes, Route, useNavigate, Navigate } from "react-router-dom";

import LauncherLayout from "./components/LauncherLayout";
import ModeSelectPage from "./Pages/ModeSelect/ModeSelectPage";
import ProgressionPage from "./Pages/Progression/ProgressionPage";
import DeckGamePage from "./Pages/DeckGame/DeckGamePage";
import AdminPanelPage from "./Pages/Admin/AdminPanelPage";

import { supabase } from "./lib/supabase";
import { useUser } from "./context/UserContext";

import "./App.css";

function LoginSplash() {
  const { user, authLoading } = useUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && user) {
      navigate("/mode", { replace: true });
    }
  }, [user, authLoading, navigate]);

  async function loginWithDiscord() {
    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: `${window.location.origin}/mode`,
      },
    });
  }

  if (authLoading) {
    return (
      <LauncherLayout>
        <div style={{ color: "white", fontSize: "18px" }}>Loading...</div>
      </LauncherLayout>
    );
  }

  return (
    <LauncherLayout>
      <div className="launcher-logo-shell">
        <div className="launcher-logo-aura"></div>
        <img
          src="/ui/project_onyx_logo.png"
          className="launcher-logo"
          alt="Project Onyx"
        />
      </div>

      <button className="discord-button" onClick={loginWithDiscord}>
        <img
          src="/ui/discord_icon.svg"
          className="discord-icon"
          alt="Discord"
        />
        Login with Discord
      </button>
    </LauncherLayout>
  );
}

function ProtectedRoute({ children }) {
  const { user, authLoading } = useUser();

  if (authLoading) {
    return (
      <LauncherLayout>
        <div style={{ color: "white", fontSize: "18px" }}>Loading...</div>
      </LauncherLayout>
    );
  }

  if (!user || user.role === "Blocked") {
    return <Navigate to="/" replace />;
  }

  return children;
}

function AdminRoute({ children }) {
  const { user, authLoading } = useUser();

  if (authLoading) {
    return (
      <LauncherLayout>
        <div style={{ color: "white", fontSize: "18px" }}>Loading...</div>
      </LauncherLayout>
    );
  }

  if (!user || user.role === "Blocked") {
    return <Navigate to="/" replace />;
  }

  if (user.role !== "Admin" && user.role !== "Admin+") {
    return <Navigate to="/mode" replace />;
  }

  return children;
}

function HomeRoute() {
  const { user, authLoading } = useUser();

  if (authLoading) {
    return (
      <LauncherLayout>
        <div style={{ color: "white", fontSize: "18px" }}>Loading...</div>
      </LauncherLayout>
    );
  }

  if (user && user.role !== "Blocked") {
    return <Navigate to="/mode" replace />;
  }

  return <LoginSplash />;
}

function App() {
  const { setUser, setAuthLoading } = useUser();

  useEffect(() => {
    async function syncProfileInBackground(session, baseUser) {
      try {
        const discordUser = session.user.user_metadata || {};
        const discordUserId =
          discordUser.provider_id ||
          discordUser.sub ||
          session.user.user_metadata?.sub ||
          null;

        const profilePayload = {
          id: session.user.id,
          discord_user_id: discordUserId,
          username: baseUser.username,
          avatar: baseUser.avatar,
        };

        const { error: upsertError } = await supabase
          .from("profiles")
          .upsert(profilePayload, { onConflict: "id" });

        if (upsertError) {
          console.error("Profile upsert failed:", upsertError);
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select(
            "id, discord_user_id, username, avatar, role, progression_state, active_series_id"
          )
          .eq("id", session.user.id)
          .maybeSingle();

        if (profileError || !profile) {
          console.error("Profile fetch failed:", profileError);
          return;
        }

        setUser({
          username: profile.username || baseUser.username,
          avatar: profile.avatar || baseUser.avatar,
          id: profile.id,
          discordUserId: profile.discord_user_id || discordUserId,
          role: profile.role || "Applicant",
          progressionState: profile.progression_state || "default",
          activeSeriesId: profile.active_series_id || null,
        });
      } catch (error) {
        console.error("Background profile sync crashed:", error);
      }
    }

    async function loadSession() {
      setAuthLoading(true);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          setUser(null);
          return;
        }

        const discordUser = session.user.user_metadata || {};

        const baseUser = {
          username:
            discordUser.full_name ||
            discordUser.name ||
            discordUser.preferred_username ||
            "Unknown User",
          avatar: discordUser.avatar_url || "",
          id: session.user.id,
          discordUserId:
            discordUser.provider_id ||
            discordUser.sub ||
            session.user.user_metadata?.sub ||
            null,
          role: "Applicant",
          progressionState: "default",
          activeSeriesId: null,
        };

        setUser(baseUser);
        syncProfileInBackground(session, baseUser);
      } catch (error) {
        console.error("Session load failed:", error);
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!session) {
        setUser(null);
        setAuthLoading(false);
        return;
      }

      const discordUser = session.user.user_metadata || {};

      const baseUser = {
        username:
          discordUser.full_name ||
          discordUser.name ||
          discordUser.preferred_username ||
          "Unknown User",
        avatar: discordUser.avatar_url || "",
        id: session.user.id,
        discordUserId:
          discordUser.provider_id ||
          discordUser.sub ||
          session.user.user_metadata?.sub ||
          null,
        role: "Applicant",
        progressionState: "default",
        activeSeriesId: null,
      };

      setUser(baseUser);
      setAuthLoading(false);
      syncProfileInBackground(session, baseUser);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setUser, setAuthLoading]);

  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route
        path="/mode"
        element={
          <ProtectedRoute>
            <ModeSelectPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/mode/progression"
        element={
          <ProtectedRoute>
            <ProgressionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/mode/deckgame"
        element={
          <ProtectedRoute>
            <DeckGamePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminPanelPage />
          </AdminRoute>
        }
      />
    </Routes>
  );
}

export default App;