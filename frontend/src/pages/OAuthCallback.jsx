import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import { apiFetch } from "../services/api";

/**
 * Page de retour du flux OAuth (Google / GitHub).
 *
 * Le serveur redirige ici avec le jeton encodé dans le fragment (#payload) :
 * celui-ci ne transite jamais par les logs serveur (un fragment n'est pas
 * envoyé au serveur). La page décode, vérifie le jeton via /auth/me puis
 * délègue la création de la session à App.
 */

function decodePayload(raw) {
  try {
    return JSON.parse(atob(raw.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

const OAUTH_ERRORS = {
  oauth_unconfigured:
    "La connexion Google/GitHub n'est pas encore configurée sur le serveur. Ajoutez GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET dans backend/.env puis relancez-le.",
  oauth_state_mismatch:
    "La demande de connexion a expiré ou a été détectée deux fois. Relancez la connexion.",
  oauth_denied:
    "L'accès au compte a été refusé chez le fournisseur. Vous pouvez réessayer.",
  oauth_missing_code:
    "Le fournisseur n'a pas renvoyé de code d'autorisation. Relancez la connexion.",
  oauth_exchange:
    "L'échange du code d'autorisation a échoué. Réessayez dans un instant.",
  oauth_failed:
    "La connexion au fournisseur a échoué. Vérifiez votre connexion puis réessayez.",
  oauth_unknown_provider:
    "Fournisseur de connexion inconnu.",
};

function parseResult() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  // Le fragment est consumé immédiatement : un rafraîchissement ne rejoue
  // pas la session et l'URL ne traîne pas dans l'historique.
  window.history.replaceState(null, "", window.location.pathname);

  const failure = hash.get("error");
  const rawPayload = hash.get("payload");

  if (failure) {
    return {
      kind: "error",
      message: OAUTH_ERRORS[failure] || "Connexion au fournisseur impossible.",
    };
  }

  const payload = rawPayload ? decodePayload(rawPayload) : null;

  if (!payload || !payload.token) {
    return {
      kind: "error",
      message: "Réponse de connexion illisible. Relancez la connexion.",
    };
  }

  return { kind: "session", token: payload.token };
}

function OAuthCallback({ onLoginSuccess }) {
  // Lisible une seule fois au montage : le fragment ne changera plus ensuite.
  const [result] = useState(parseResult);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (result.kind !== "session") {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const session = await apiFetch("/api/auth/me", { token: result.token });

        if (cancelled) {
          return;
        }

        if (!session.ok) {
          throw new Error();
        }

        const account = {
          ...(session.data.user || {}),
          role: session.data.role || null,
          permissions: session.data.permissions || [],
        };

        onLoginSuccess(result.token, account);
      } catch {
        // La session App reste vierge : l'écran présente le chemin de secours
        // plutôt qu'un appel réussi partiel.
        if (!cancelled) {
          setError(
            "Impossible de finaliser la connexion. Relancez-la depuis l'écran d'accueil."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [result, onLoginSuccess]);

  if (error || result.kind === "error") {
    return (
      <div className="dm-oauth-page">
        <motion.div
          className="dm-oauth-card is-error"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="dm-oauth-icon">
            <AlertCircle size={22} />
          </span>
          <h2>Connexion interrompue</h2>
          <p>{error || result.message}</p>
          <button
            type="button"
            className="dm-oauth-back"
            onClick={() => {
              window.location.href = "/login";
            }}
          >
            <ArrowLeft size={14} />
            Retour à la connexion
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="dm-oauth-page">
      <motion.div
        className="dm-oauth-card"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className="dm-oauth-icon">
          <Loader2 size={22} className="dm-login-spin" />
        </span>
        <h2>Connexion en cours…</h2>
        <p>
          Nous finalisons votre connexion sécurisée. Cela ne prend qu'une
          seconde.
        </p>
      </motion.div>
    </div>
  );
}

export default OAuthCallback;
