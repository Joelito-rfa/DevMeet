import { useCallback, useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Discover from "./pages/Discover";
import Community from "./pages/Community";
import Channel from "./pages/Channel";
import ProfilePage from "./pages/ProfilePage";
import SettingsLayout from "./pages/settings/SettingsLayout";
import AccountSettings from "./pages/settings/AccountSettings";
import ProfileSettings from "./pages/settings/ProfileSettings";
import AppearanceSettings from "./pages/settings/AppearanceSettings";
import ProfileCustomizationSettings from "./pages/settings/ProfileCustomizationSettings";
import PresenceSettings from "./pages/settings/PresenceSettings";
import NotificationSettings from "./pages/settings/NotificationSettings";
import PrivacySettings from "./pages/settings/PrivacySettings";
import AboutSettings from "./pages/settings/AboutSettings";
import Invite from "./pages/Invite";
import NotificationsPage from "./pages/NotificationsPage";
import DirectMessages from "./pages/DirectMessages";
import OAuthCallback from "./pages/OAuthCallback";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import AnimatedBackground from "./components/layout/Background";
import { ThemeProvider } from "./theme/ThemeProvider";
import { connectSocket, disconnectSocket } from "./services/socket";
import {
  apiFetch,
  clearSession,
  readStoredToken,
  readStoredUser,
  storeSession,
} from "./services/api";

function App() {
  const location = useLocation();
  const navigate = useNavigate();

  // « loading » le temps de vérifier le jeton stocké : cela évite de renvoyer
  // l'utilisateur vers l'écran de connexion à chaque rafraîchissement (F5).
  const [status, setStatus] = useState(() =>
    readStoredToken() ? "loading" : "anonymous"
  );
  const [token, setToken] = useState("");
  const [user, setUser] = useState(() => readStoredUser());

  useEffect(() => {
    const storedToken = readStoredToken();

    if (!storedToken) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const result = await apiFetch("/api/auth/me", { token: storedToken });

        if (!result.ok) {
          throw new Error("Session expirée.");
        }

        if (cancelled) {
          return;
        }

        const restoredUser = {
          ...(readStoredUser() || {}),
          ...result.data.user,
          role: result.data.role || null,
          permissions: result.data.permissions || [],
        };

        setToken(storedToken);
        setUser(restoredUser);
        storeSession(storedToken, restoredUser);
        connectSocket(storedToken);
        setStatus("authenticated");
      } catch {
        if (cancelled) {
          return;
        }

        clearSession();
        setStatus("anonymous");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLoginSuccess = useCallback(
    (receivedToken, receivedUser) => {
      const account = receivedUser || null;

      setToken(receivedToken);
      setUser(account);
      storeSession(receivedToken, account);
      connectSocket(receivedToken);
      setStatus("authenticated");
      navigate("/", { replace: true });
    },
    [navigate]
  );

  const handleUserUpdated = useCallback(
    (updatedUser) => {
      setUser((previous) => {
        const merged = { ...(previous || {}), ...updatedUser };
        storeSession(token, merged);
        return merged;
      });
    },
    [token]
  );

  const handleLogout = useCallback(async () => {
    if (token) {
      // Meilleur effort : si le serveur est injoignable, la déconnexion locale
      // doit quand même aboutir.
      await apiFetch("/api/auth/logout", { method: "POST", token }).catch(
        () => null
      );
    }

    disconnectSocket();
    clearSession();
    setToken("");
    setUser(null);
    setStatus("anonymous");
    navigate("/login", { replace: true });
  }, [navigate, token]);

  if (status === "loading") {
    return (
      <div style={{ position: "relative", minHeight: "100vh" }}>
        <AnimatedBackground variant="auth" />

        <div className="ws-loading">Restauration de la session…</div>
      </div>
    );
  }

  const isAuthRoute =
    location.pathname === "/login" ||
    location.pathname === "/register" ||
    location.pathname === "/oauth/callback" ||
    location.pathname === "/forgot-password" ||
    location.pathname === "/reset-password";

  const authenticated = status === "authenticated";

  return (
    <ThemeProvider
      key={user?.id ? `user-${user.id}` : "anonymous"}
      user={user}
      token={token}
      onUserChanged={handleUserUpdated}
    >
      <div style={{ position: "relative", minHeight: "100vh" }}>
        <AnimatedBackground variant={isAuthRoute ? "auth" : "default"} />

      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          className="dm-page"
          initial={{ opacity: 0, scale: 0.995 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.005 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <Routes location={location}>
            <Route
              path="/login"
              element={
                authenticated ? (
                  <Navigate to="/" replace />
                ) : (
                  <Login
                    onLoginSuccess={handleLoginSuccess}
                    onGoToRegister={() => navigate("/register")}
                    onForgotPassword={() => navigate("/forgot-password")}
                  />
                )
              }
            />

            {/* Pages publiques du flux « mot de passe oublié ». */}
            <Route
              path="/forgot-password"
              element={
                authenticated ? (
                  <Navigate to="/" replace />
                ) : (
                  <ForgotPassword onBack={() => navigate("/login")} />
                )
              }
            />

            <Route
              path="/reset-password"
              element={
                authenticated ? (
                  <Navigate to="/" replace />
                ) : (
                  <ResetPassword
                    token={new URLSearchParams(location.search).get("token") || ""}
                    onLoginSuccess={handleLoginSuccess}
                    onBack={() => navigate("/login")}
                  />
                )
              }
            />

            <Route
              path="/register"
              element={
                authenticated ? (
                  <Navigate to="/" replace />
                ) : (
                  <Register
                    onRegisterSuccess={() => navigate("/login")}
                    onGoToLogin={() => navigate("/login")}
                  />
                )
              }
            />

            {/* Retour du flux OAuth (Google / GitHub) : page publique qui
                finalise la session avant de rediriger vers le tableau de bord. */}
            <Route
              path="/oauth/callback"
              element={<OAuthCallback onLoginSuccess={handleLoginSuccess} />}
            />

            {/* L'aperçu d'une invitation est public ; l'adhésion exige un compte. */}
            <Route
              path="/invite/:code"
              element={
                <Invite
                  token={authenticated ? token : ""}
                  user={authenticated ? user : null}
                  onLogout={handleLogout}
                />
              }
            />

            {authenticated ? (
              <>
                <Route
                  path="/"
                  element={
                    <Dashboard
                      token={token}
                      user={user}
                      onLogout={handleLogout}
                    />
                  }
                />

                <Route
                  path="/decouvrir"
                  element={
                    <Discover
                      token={token}
                      user={user}
                      onLogout={handleLogout}
                    />
                  }
                />

                <Route
                  path="/notifications"
                  element={
                    <NotificationsPage
                      token={token}
                      user={user}
                      onLogout={handleLogout}
                    />
                  }
                />

                <Route
                  path="/profil/:id"
                  element={
                    <ProfilePage
                      token={token}
                      user={user}
                      onLogout={handleLogout}
                    />
                  }
                />

                <Route path="/parametres" element={<Navigate to="/parametres/profil" replace />} />

                <Route
                  path="/parametres/*"
                  element={
                    <SettingsLayout
                      token={token}
                      user={user}
                      onLogout={handleLogout}
                      onUserUpdated={handleUserUpdated}
                    />
                  }
                >
                  <Route path="compte" element={<AccountSettings />} />
                  <Route path="profil" element={<ProfileSettings key={user?.id} />} />
                  <Route path="apparence" element={<AppearanceSettings />} />
                  <Route
                    path="profil/personnalisation"
                    element={<ProfileCustomizationSettings />}
                  />
                  <Route path="presence" element={<PresenceSettings />} />
                  <Route path="notifications" element={<NotificationSettings />} />
                  <Route path="confidentialite" element={<PrivacySettings />} />
                  <Route path="a-propos" element={<AboutSettings />} />
                </Route>

                <Route
                  path="/messages"
                  element={
                    <DirectMessages
                      token={token}
                      user={user}
                      onLogout={handleLogout}
                    />
                  }
                />

                <Route
                  path="/messages/:conversationId"
                  element={
                    <DirectMessages
                      token={token}
                      user={user}
                      onLogout={handleLogout}
                    />
                  }
                />

                <Route
                  path="/c/:communityId"
                  element={
                    <Community
                      token={token}
                      user={user}
                      onLogout={handleLogout}
                    />
                  }
                />

                <Route
                  path="/c/:communityId/:channelId"
                  element={
                    <Channel
                      token={token}
                      user={user}
                      onLogout={handleLogout}
                    />
                  }
                />

                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            ) : (
              <Route path="*" element={<Navigate to="/login" replace />} />
            )}
          </Routes>
        </motion.div>
      </AnimatePresence>
      </div>
    </ThemeProvider>
  );
}

export default App;
