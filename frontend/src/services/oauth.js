/**
 * Connexion Google / GitHub (OAuth 2.0).
 *
 * Une seule chose à savoir pour l'appelant : `startOAuth("google")` renvoie le
 * navigateur vers le point d'entrée serveur, qui gère le consentement puis
 * ramène la session sur /oauth/callback. `consumeOAuthNotice` lit le code
 * d'erreur éventuel (fragment `#error=…`, historique `?oauth=…`) pour pouvoir
 * l'afficher dans le formulaire d'où l'utilisateur est parti.
 */
import { API_URL } from "./api";

const NOTICES = {
  oauth_unconfigured:
    "La connexion Google/GitHub n'est pas encore configurée sur le serveur. Ajoutez GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET dans backend/.env puis relancez-le.",
  oauth_denied:
    "L'accès au compte a été refusé chez le fournisseur. Vous pouvez réessayer.",
};

export function startOAuth(provider) {
  window.location.assign(`${API_URL}/api/auth/oauth/${provider}`);
}

/** Lit l'erreur d'OAuth renvoyée en fragment ou en paramètre d'URL, la retire
 *  de l'historique et transmet le message à l'écran appelant. */
export function consumeOAuthNotice(notify) {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const failure = hash.get("error") || query.get("oauth") || "";

  if (!failure) {
    return;
  }

  window.history.replaceState(null, "", window.location.pathname);
  notify(
    NOTICES[failure] ||
      "La connexion au fournisseur a échoué. Réessayez dans un instant."
  );
}
