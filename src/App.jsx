import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

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
import ContainerMakerPage from "./Pages/Admin/ContainerMaker/ContainerMakerPage";
import ContainerDatabasePage from "./Pages/Containers/ContainerDatabasePage";
import ContainerOpenerPage from "./Pages/Containers/ContainerOpenerPage";

import { useUser } from "./context/UserContext";

import "./App.css";

function LoadingScreen() {
  return (
    <LauncherLayout showHeader={false}>
      <div className="loading-screen-page">
        <p className="loading-screen-text">Loading...</p>
      </div>
    </LauncherLayout>
  );
}

function LoginSplash() {
  const { signInWithUsername, authLoading } = useUser();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setErrorText("");

    try {
      await signInWithUsername(username, password);
    } catch (error) {
      setErrorText(error?.message || "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <LauncherLayout showHeader={false} fullBleed>
      <div className="login-splash-page">
        <section className="login-hero-section">
          <div className="login-stage">
            <div className="launcher-logo-shell login-logo-shell">
              <div className="launcher-logo-aura"></div>
              <img
                src="/ui/project_onyx_logo.png"
                className="launcher-logo login-logo-image"
                alt="Project Onyx"
              />
            </div>

            <a className="login-scroll-cue" href="#login-access">
              Scroll to Login
            </a>
          </div>
        </section>

        <section className="login-access-section" id="login-access">
          <div className="login-access-shell">
            <div className="login-panel">
              <h2 className="login-panel-title">Project Onyx Login</h2>

              <form className="login-form" onSubmit={handleSubmit}>
                <input
                  type="text"
                  className="login-input"
                  placeholder="Username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  disabled={authLoading || submitting}
                />

                <input
                  type="password"
                  className="login-input"
                  placeholder="Password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={authLoading || submitting}
                />

                <button
                  className="login-button"
                  type="submit"
                  disabled={authLoading || submitting}
                >
                  {submitting ? "Logging in..." : "Login"}
                </button>
              </form>

              {errorText ? <p className="login-error">{errorText}</p> : null}
            </div>
          </div>
        </section>
      </div>
    </LauncherLayout>
  );
}

function HomeRoute() {
  const { user, authLoading } = useUser();

  if (authLoading) return <LoadingScreen />;

  if (user && !user.isBlocked) {
    return <Navigate to="/mode" replace />;
  }

  return <LoginSplash />;
}

function ProtectedRoute({ children }) {
  const { user, authLoading } = useUser();

  if (authLoading) return <LoadingScreen />;

  if (!user || user.isBlocked) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function ProgressionRoute({ children }) {
  const { user, authLoading } = useUser();

  if (authLoading) return <LoadingScreen />;

  if (!user || user.isBlocked) {
    return <Navigate to="/" replace />;
  }

  if (!user.canAccessProgression) {
    return <Navigate to="/mode" replace />;
  }

  return children;
}

function ProgressionAdminRoute({ children }) {
  const { user, authLoading } = useUser();

  if (authLoading) return <LoadingScreen />;

  if (!user || user.isBlocked) {
    return <Navigate to="/" replace />;
  }

  if (!user.canAccessGameAdmin) {
    return <Navigate to="/mode/progression" replace />;
  }

  return children;
}

function AdminRoute({ children }) {
  const { user, authLoading } = useUser();

  if (authLoading) return <LoadingScreen />;

  if (!user || user.isBlocked) {
    return <Navigate to="/" replace />;
  }

  if (!user.canAccessHeaderAdmin) {
    return <Navigate to="/mode" replace />;
  }

  return children;
}

function DeckGameRoute({ children }) {
  const { user, authLoading } = useUser();

  if (authLoading) return <LoadingScreen />;

  if (!user || user.isBlocked) {
    return <Navigate to="/" replace />;
  }

  return children;
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
        path="/mode/progression/containers/:typeSlug"
        element={
          <ProgressionRoute>
            <ContainerDatabasePage />
          </ProgressionRoute>
        }
      />

      <Route
        path="/mode/progression/opener"
        element={
          <ProgressionRoute>
            <ContainerOpenerPage />
          </ProgressionRoute>
        }
      />

      <Route
        path="/mode/progression/admin/starter-decks"
        element={
          <ProgressionAdminRoute>
            <StarterDeckEditorPage />
          </ProgressionAdminRoute>
        }
      />

      <Route
        path="/mode/progression/admin/reward-giver"
        element={
          <ProgressionAdminRoute>
            <RewardGiverPage />
          </ProgressionAdminRoute>
        }
      />

      <Route
        path="/mode/progression/admin/container-maker"
        element={
          <ProgressionAdminRoute>
            <ContainerMakerPage />
          </ProgressionAdminRoute>
        }
      />

      <Route
        path="/mode/deckgame"
        element={
          <DeckGameRoute>
            <DeckGamePage />
          </DeckGameRoute>
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

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
