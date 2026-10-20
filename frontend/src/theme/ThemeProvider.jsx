import { useCallback, useEffect, useMemo, useState } from "react";

import { apiFetch, storeSession } from "../services/api";
import {
  APP_THEMES,
  applyTheme,
  normalizeTheme,
  readStoredTheme,
  storeTheme,
} from "./theme";
import { ThemeContext } from "./ThemeContext";

/**
 * Applique le thème à toute l'application et persiste le choix.
 *
 * - application immédiate sur `<html data-theme>` (aucun rechargement) ;
 * - copie locale pour les visiteurs et l'affichage avant connexion ;
 * - écriture en base via `PATCH /api/auth/me` quand une session existe.
 *
 * Le fournisseur est remonté quand l'utilisateur change (`key` posée dans
 * App) : la valeur enregistrée en base est donc appliquée dès la connexion,
 * sans effet de synchronisation supplémentaire.
 */
export function ThemeProvider({ user, token, onUserChanged, children }) {
  const [theme, setThemeState] = useState(() =>
    normalizeTheme(user?.theme || readStoredTheme())
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Application immédiate + mémorisation locale (sans donnée sensible).
  useEffect(() => {
    applyTheme(theme);
    storeTheme(theme);
  }, [theme]);

  const setTheme = useCallback(
    async (value) => {
      const nextTheme = normalizeTheme(value);

      setThemeState(nextTheme);
      setError("");

      if (!token) {
        return nextTheme;
      }

      setSaving(true);

      try {
        const result = await apiFetch("/api/auth/me", {
          method: "PATCH",
          token,
          body: { theme: nextTheme },
        });

        if (!result.ok) {
          setError(
            result.data?.message ||
              "Le thème est appliqué, mais son enregistrement a échoué."
          );
          return nextTheme;
        }

        if (result.data?.user) {
          storeSession(token, {
            ...(user || {}),
            ...result.data.user,
          });

          if (onUserChanged) {
            onUserChanged(result.data.user);
          }
        }
      } catch {
        setError(
          "Impossible de contacter le serveur : le thème reste appliqué sur cet appareil."
        );
      } finally {
        setSaving(false);
      }

      return nextTheme;
    },
    [onUserChanged, token, user]
  );

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      themes: APP_THEMES,
      saving,
      error,
      clearError: () => setError(""),
    }),
    [theme, setTheme, saving, error]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
