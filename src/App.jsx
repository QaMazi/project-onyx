import { Routes, Route, Navigate } from "react-router-dom";
import { supabase } from "./lib/supabase";

import LauncherLayout from "./components/LauncherLayout";
import ModeSelectPage from "./Pages/ModeSelect/ModeSelectPage";
import ProgressionPage from "./Pages/Progression/ProgressionPage";
import CardDatabasePage from "./Pages/CardDatabase/CardDatabasePage";
import DeckGamePage from "./Pages/DeckGame/DeckGamePage";
import AdminPanelPage from "./Pages/Admin/AdminPanelPage";
import BinderPage from "./Pages/Binder/BinderPage";
import DeckBuilderPage from "./Pages/DeckBuilder/DeckBuilderPage";
import StorePage from "./Pages/Store/StorePage";
import InventoryPage from "./Pages/Inventory/InventoryPage";
import TradePage from "./Pages/Trade/TradePage";
import BanlistPage from "./Pages/Banlist/BanlistPage";
import StarterDeckEditorPage from "./Pages/Admin/StarterDeck/StarterDeckEditorPage";
import RewardGiverPage from "./Pages/Admin/RewardGiver/RewardGiverPage";

import { useUser } from "./context/UserContext";

import "./App.css";

function LoadingScreen() {
  return (
    <LauncherLayout>
      <div style={{ color: "white" }}>Loading...</div>
    </LauncherLayout>
  );
}

function LoginSplash() {
  const { user, authLoading } = useUser();

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (user && user.role !== "Blocked") {
    return <Navigate to="/mode" replace />;
  }

  async function loginWithDiscord() {
    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: `${window.location.origin}/mode`,
      },
    });
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

function HomeRoute() {
  const { user, authLoading } = useUser();

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (user && user.role !== "Blocked") {
    return <Navigate to="/mode" replace />;
  }

  return <LoginSplash />;
}

function ProtectedRoute({ children }) {
  const { user, authLoading } = useUser();

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (!user || user.role === "Blocked") {
    return <Navigate to="/" replace />;
  }

  return children;
}

function ProgressionRoute({ children }) {
  const { user, authLoading } = useUser();

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (!user || user.role === "Blocked") {
    return <Navigate to="/" replace />;
  }

  const hasProgressionAccess =
    user.role === "Admin+" ||
    user.role === "Admin" ||
    user.role === "Duelist";

  if (!hasProgressionAccess) {
    return <Navigate to="/mode" replace />;
  }

  return children;
}

function AdminPlusProgressionRoute({ children }) {
  const { user, authLoading } = useUser();

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (!user || user.role === "Blocked") {
    return <Navigate to="/" replace />;
  }

  if (user.role !== "Admin+") {
    return <Navigate to="/mode/progression" replace />;
  }

  return children;
}

function AdminRoute({ children }) {
  const { user, authLoading } = useUser();

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (!user || user.role === "Blocked") {
    return <Navigate to="/" replace />;
  }

  if (user.globalRole !== "Admin+") {
    return <Navigate to="/mode" replace />;
  }

  return children;
}

function DeckGameBetaRoute() {
  const { user, authLoading } = useUser();

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (!user || user.role === "Blocked") {
    return <Navigate to="/mode" replace />;
  }

  return <Navigate to="/mode" replace />;
}

function App() {
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
          <ProgressionRoute>
            <ProgressionPage />
          </ProgressionRoute>
        }
      />

      <Route
        path="/mode/progression/cards"
        element={
          <ProgressionRoute>
            <CardDatabasePage />
          </ProgressionRoute>
        }
      />

      <Route
        path="/mode/progression/binder"
        element={
          <ProgressionRoute>
            <BinderPage />
          </ProgressionRoute>
        }
      />

      <Route
        path="/mode/progression/deck"
        element={
          <ProgressionRoute>
            <DeckBuilderPage />
          </ProgressionRoute>
        }
      />

      <Route
        path="/mode/progression/store"
        element={
          <ProgressionRoute>
            <StorePage />
          </ProgressionRoute>
        }
      />

      <Route
        path="/mode/progression/inventory"
        element={
          <ProgressionRoute>
            <InventoryPage />
          </ProgressionRoute>
        }
      />

      <Route
        path="/mode/progression/trade"
        element={
          <ProgressionRoute>
            <TradePage />
          </ProgressionRoute>
        }
      />

      <Route
        path="/mode/progression/banlist"
        element={
          <ProgressionRoute>
            <BanlistPage />
          </ProgressionRoute>
        }
      />

      <Route
        path="/mode/progression/admin/starter-decks"
        element={
          <AdminPlusProgressionRoute>
            <StarterDeckEditorPage />
          </AdminPlusProgressionRoute>
        }
      />

      <Route
        path="/mode/progression/admin/reward-giver"
        element={
          <AdminPlusProgressionRoute>
            <RewardGiverPage />
          </AdminPlusProgressionRoute>
        }
      />

      <Route path="/mode/deckgame" element={<DeckGameBetaRoute />} />

      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminPanelPage />
          </AdminRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
