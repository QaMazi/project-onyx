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

function canonicalizeRole(role) {
  const r = String(role || "").toLowerCase();

  if (r === "admin+" || r === "adminplus") return "Admin+";
  if (r === "admin") return "Admin";
  if (r === "blocked") return "Blocked";
  if (r === "duelist") return "Duelist";
  if (r === "applicant") return "Applicant";

  return "Applicant";
}

function isAuthorityRole(role) {
  return role === "Admin" || role === "Admin+" || role === "Blocked";
}

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
    return <div className="loading-screen">Loading...</div>;
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
        <div style={{ color: "white" }}>Loading...</div>
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
        <div style={{ color: "white" }}>Loading...</div>
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
        <div style={{ color: "white" }}>Loading...</div>
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
    async function loadSession() {
      setAuthLoading(true);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          setUser(null);
          setAuthLoading(false);
          return;
        }

        const discordUser = session.user.user_metadata || {};

        const baseUser = {
          id: session.user.id,
          username:
            discordUser.full_name ||
            discordUser.name ||
            "Unknown User",
          avatar: discordUser.avatar_url || "",
        };

        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .maybeSingle();

        const normalizedRole = canonicalizeRole(profile?.role);

        let finalRole = normalizedRole;

        if (!isAuthorityRole(normalizedRole)) {
          const { data: activeSeries } = await supabase
            .from("game_series")
            .select("id")
            .eq("is_current", true)
            .maybeSingle();

          if (activeSeries) {
            const { data: membership } = await supabase
              .from("series_players")
              .select("id")
              .eq("series_id", activeSeries.id)
              .eq("user_id", session.user.id)
              .maybeSingle();

            finalRole = membership ? "Duelist" : "Applicant";
          }
        }

        setUser({
          ...baseUser,
          role: finalRole,
          progressionState: profile?.progression_state || "default",
          activeSeriesId: profile?.active_series_id || null,
        });
      } catch (err) {
        console.error("Session load error", err);
        setUser(null);
      }

      setAuthLoading(false);
    }

    loadSession();

    const { data } = supabase.auth.onAuthStateChange(() => {
      loadSession();
    });

    return () => data.subscription.unsubscribe();
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