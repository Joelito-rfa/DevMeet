const express = require("express");
const crypto = require("crypto");

const config = require("../config");
const usersService = require("../services/users");
const communities = require("../services/communities");
const { signToken } = require("../middleware/auth");

const router = express.Router();

/**
 * Connexion Google / GitHub (OAuth 2.0, flux « authorization code »).
 *
 * Aucune dépendance externe : l'échange des jetons repasse par le fetch natif
 * de Node 18+. La session DevMeet continue de vivre sur un JWT classique, ce
 * qui laisse tout le reste du système (Socket.IO inclus) inchangé.
 *
 * Parcours : /api/auth/oauth/:provider -> consentement -> /callback (validation
 * de `state` en cookie httpOnly) -> compte créé ou relié -> redirection du
 * navigateur vers /oauth/callback#token=… côté client.
 */

const STATE_COOKIE = "dm_oauth_state";

const PROVIDERS = {
  google: {
    configured: () =>
      Boolean(config.oauth.google.clientId && config.oauth.google.clientSecret),
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    /**
     * Identité Google : `sub` est stable, contrairement à l'email d'un compte
     * Workspace qui peut être modifiée. La photo est servie par Google.
     */
    fetchProfile: async (accessToken) => {
      const profile = await requestJson(
        "https://openidconnect.googleapis.com/v1/userinfo",
        { Authorization: `Bearer ${accessToken}` }
      );

      if (!profile.sub || !profile.email) {
        fail("Profil Google incomplet.");
      }

      return {
        providerId: String(profile.sub),
        email: String(profile.email).toLowerCase(),
        name: profile.name || profile.email.split("@")[0],
        avatarUrl: profile.picture || null,
      };
    },
  },

  github: {
    configured: () =>
      Boolean(config.oauth.github.clientId && config.oauth.github.clientSecret),
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    /**
     * Identité GitHub : l'email public peut être absent (`null`) et l'API
     * /user ne renvoie alors que le login. L'endpoint /user/emails donne
     * l'adresse privée réelle, si le scope `user:email` l'autorise.
     */
    fetchProfile: async (accessToken) => {
      const profile = await requestJson("https://api.github.com/user", {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "DevMeet",
      });

      if (!profile.id) {
        fail("Profil GitHub incomplet.");
      }

      let email = profile.email || "";

      if (!email) {
        const emails = await requestJson("https://api.github.com/user/emails", {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "DevMeet",
        });

        const primary = Array.isArray(emails)
          ? emails.find((entry) => entry.primary) || emails[0]
          : null;

        email = primary ? primary.email : "";
      }

      if (!email) {
        fail("Adresse email GitHub indisponible.");
      }

      return {
        providerId: String(profile.id),
        email: String(email).toLowerCase(),
        name: profile.name || profile.login,
        avatarUrl: profile.avatar_url || null,
      };
    },
  },
};

function fail(message) {
  throw new Error(message);
}

/** Lecture directe d'un cookie : évite la dépendance à cookie-parser. */
function readCookie(req, name) {
  const header = String(req.headers.cookie || "");

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator > -1 && part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return null;
}

/** fetch + JSON : la moindre erreur réseau est convertie en avertissement clair. */
async function requestJson(url, headers = {}, body) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body: new URLSearchParams(body).toString() } : {}),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    console.error(
      `[oauth] ${url} a répondu ${response.status} :`,
      JSON.stringify(payload) || ""
    );
  }

  return payload;
}

function redirectUri(req, provider) {
  // `trust proxy` est actif : `req.protocol` reflète le scheme vu par le
  // client, même derrière un proxy de développement.
  return `${req.protocol}://${req.get("host")}/api/auth/oauth/${provider}/callback`;
}

function redirectToClient(res, route, hash = "") {
  return res.redirect(`${config.clientUrl}${route}${hash ? `#${hash}` : ""}`);
}

/* -------------------------------------------------------------------------- */
/*  Étape 1 — départ de la connexion                                          */
/* -------------------------------------------------------------------------- */

router.get("/:provider", (req, res) => {
  const provider = req.params.provider;
  const definition = PROVIDERS[provider];

  if (!definition) {
    return redirectToClient(res, "/login", "error=oauth_unknown_provider");
  }

  // Fournisseur sans clés : retour visuel explicite plutôt qu'une page blanche
  // d'erreur Google ou GitHub.
  if (!definition.configured()) {
    return redirectToClient(res, "/login", "error=oauth_unconfigured");
  }

  const state = crypto.randomBytes(16).toString("hex");

  res.cookie(STATE_COOKIE, `${provider}:${state}`, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: "/",
  });

  const authorizeUrl = new URL(definition.authorizeUrl);

  authorizeUrl.searchParams.set("client_id", config.oauth[provider].clientId);
  authorizeUrl.searchParams.set(
    "redirect_uri",
    redirectUri(req, provider)
  );
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", definition.scope);
  authorizeUrl.searchParams.set("state", state);

  if (provider === "google") {
    // Re-sélection du compte Google à chaque connexion (pas de session
    // fantôme héritée d'un autre navigateur).
    authorizeUrl.searchParams.set("prompt", "select_account");
  }

  return res.redirect(authorizeUrl.toString());
});

/* -------------------------------------------------------------------------- */
/*  Étape 2 — retour du fournisseur                                           */
/* -------------------------------------------------------------------------- */

router.get("/:provider/callback", async (req, res, next) => {
  const provider = req.params.provider;
  const definition = PROVIDERS[provider];

  try {
    if (!definition || !definition.configured()) {
      return redirectToClient(res, "/oauth/callback", "error=oauth_unconfigured");
    }

    // `state` : la valeur renvoyée doit exactement égaler celle posée en
    // cookie, et le flux doit rester celui du fournisseur appelé.
    const cookieValue = `${provider}:${readCookie(req, STATE_COOKIE) || ""}`;
    const [ cookieProvider, storedState ] = cookieValue.split(":");

    res.clearCookie(STATE_COOKIE, { path: "/" });

    if (
      cookieProvider !== provider ||
      !storedState ||
      String(req.query.state || "") !== storedState
    ) {
      return redirectToClient(res, "/oauth/callback", "error=oauth_state_mismatch");
    }

    if (req.query.error) {
      // Refus de consentement chez le fournisseur : un retour neutre suffit.
      return redirectToClient(res, "/oauth/callback", "error=oauth_denied");
    }

    const code = String(req.query.code || "");

    if (!code) {
      return redirectToClient(res, "/oauth/callback", "error=oauth_missing_code");
    }

    // Échange du code contre un access token (RFC 6749 §4.1.3).
    const token = await requestJson(
      definition.tokenUrl,
      {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      {
        client_id: config.oauth[provider].clientId,
        client_secret: config.oauth[provider].clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(req, provider),
      }
    );

    if (!token || !token.access_token) {
      console.error("[oauth] échange du code refusé :", token);
      return redirectToClient(res, "/oauth/callback", "error=oauth_exchange");
    }

    const profile = await definition.fetchProfile(token.access_token);

    const user =
      await usersService.connectWithOAuth({
        provider,
        providerId: profile.providerId,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
      });

    await usersService.touchLastSeen(user.id);
    const membership = await communities.ensureSystemMembership(user.id);

    const tokenJwt = signToken(user);
    const payload = Buffer.from(
      JSON.stringify({
        token: tokenJwt,
        user: {
          id: Number(user.id),
          name: user.name,
          email: user.email,
          avatarUrl: user.avatar_url || null,
        },
        role: membership ? membership.role : null,
      })
    ).toString("base64url");

    return redirectToClient(res, "/oauth/callback", `payload=${payload}`);
  } catch (error) {
    console.error("[oauth] échec de la connexion :", error.message);

    if (!res.headersSent) {
      return redirectToClient(res, "/oauth/callback", "error=oauth_failed");
    }

    return next(error);
  }
});

module.exports = router;
