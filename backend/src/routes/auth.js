const express = require("express");
const rateLimit = require("express-rate-limit");

const usersService = require("../services/users");
const communities = require("../services/communities");
const config = require("../config");
const { signToken, requireAuth } = require("../middleware/auth");
const { requireEmail, requirePassword, requireString, optionalString } = require("../utils/validate");
const passwordResets = require("../services/passwordResets");
const { badRequest } = require("../utils/errors");
const { effectivePermissions } = require("../permissions");

const router = express.Router();

/**
 * Valeurs acceptées pour les champs à liste fermée du profil. Elles sont
 * validées côté serveur : un statut affiché aux autres membres ne peut pas être
 * n'importe quelle chaîne.
 */
const ALLOWED_STATUSES = ["online", "away", "busy", "invisible", "offline"];
const ALLOWED_THEMES = ["dark", "light", "system"];

/**
 * Limitation de débit sur les points d'entrée sensibles : freine le bourrage
 * d'identifiants et la création massive de comptes. Désactivable via
 * NODE_ENV=test (le paramétrage reste dans .env : AUTH_RATE_LIMIT_MAX).
 */
const authLimiter = rateLimit({
  windowMs: config.rateLimit.authWindowMs,
  limit: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !config.rateLimit.enabled,
  message: {
    message: "Trop de tentatives. Réessayez dans quelques minutes.",
  },
});

function sessionPayload(user, extra = {}) {
  return {
    user: {
      id: Number(user.id),
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url || null,
      bio: user.bio || null,
      status: user.status || "online",
      theme: user.theme || "dark",
    },
    ...extra,
  };
}

router.post("/register", authLimiter, async (req, res, next) => {
  try {
    const name = requireString(req.body?.name ?? req.body?.username, "nom", {
      min: 2,
      max: 60,
    });
    const email = requireEmail(req.body?.email);
    const password = requirePassword(req.body?.password);

    const existing = await usersService.findByEmail(email);

    if (existing) {
      return res.status(409).json({
        message: "Cette adresse email est déjà utilisée.",
        code: "email_taken",
      });
    }

    const user = await usersService.createUser({ name, email, password });

    // L'ancien DevMeet donnait accès à la liste des salons à tout compte :
    // on reproduit ce comportement via une adhésion à la communauté historique.
    const membership = await communities.ensureSystemMembership(user.id);

    res.status(201).json({
      message: "Inscription réussie.",
      ...sessionPayload(user, {
        role: membership ? membership.role : null,
      }),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/login", authLimiter, async (req, res, next) => {
  try {
    const email = requireEmail(req.body?.email);
    const password = requirePassword(req.body?.password);

    const user = await usersService.verifyCredentials(email, password);

    await usersService.touchLastSeen(user.id);
    const membership = await communities.ensureSystemMembership(user.id);

    const token = signToken(user);

    res.json({
      message: "Connexion réussie.",
      token,
      ...sessionPayload(user, {
        role: membership ? membership.role : null,
        expiresIn: config.jwt.expiresIn,
      }),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Renvoie le compte réellement présent en base (et non le contenu du jeton) :
 * un compte supprimé ou modifié est immédiatement reflété.
 */
/**
 * Mot de passe oublié — étape 1 : demande + envoi du lien.
 *
 * Vraie réponse quel que soit le cas (anti-énumération des comptes) :
 *   - email inconnu                              -> lien absent, texte neutre ;
 *   - compte email/mot de passe                  -> lien de réinitialisation ;
 *   - compte lié à Google/GitHub (sans mot de passe) -> aucun lien ne part,
 *     `providers` indique le bouton à utiliser pour retrouver l'accès.
 *
 * Le lien n'est inséré dans la réponse QUE hors production : ici, sans SMTP,
 * c'est ce qui permet d'utiliser le flux en local. En production il part par
 * email (à brancher) et la réponse reste muette sur le jeton.
 */
router.post("/forgot-password", authLimiter, async (req, res, next) => {
  try {
    const email = requireEmail(req.body?.email);
    const request = await passwordResets.requestFor(email);

    const payload = {
      message:
        "Si un compte existe avec cette adresse, un lien de réinitialisation a été envoyé.",
    };

    if (request && request.providers.length > 0) {
      // Compte OAuth : plutôt qu'un email, la porte d'entrée reste celui du
      // fournisseur — qui authentifie déjà sans mot de passe.
      return res.json({
        ...payload,
        providers: request.providers,
      });
    }

    if (request && config.env !== "production") {
      res.json({
        ...payload,
        resetLink: `${config.clientUrl}/reset-password?token=${request.token}`,
      });
      return;
    }

    res.json(payload);
  } catch (error) {
    next(error);
  }
});

/**
 * Mot de passe oublié — étape 2 : nouveau mot de passe à partir du jeton.
 * Usage unique : consommer deux fois le même jeton renvoie une erreur neutre.
 */
router.post("/reset-password", authLimiter, async (req, res, next) => {
  try {
    const password = requirePassword(req.body?.password);
    const token = requireString(req.body?.token, "jeton", { min: 16, max: 128 });

    const userId = await passwordResets.completeReset(token, password);

    if (!userId) {
      return res.status(400).json({
        message:
          "Ce lien de réinitialisation est invalide ou expiré. Demandez-en un nouveau.",
        code: "invalid_reset_token",
      });
    }

    const membership = await communities.ensureSystemMembership(userId);

    const user = await usersService.findById(userId);
    const tokenJwt = signToken(user);

    res.json({
      message: "Mot de passe mis à jour. Bienvenue à nouveau !",
      token: tokenJwt,
      ...sessionPayload(user, {
        role: membership ? membership.role : null,
      }),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const membership = await communities.ensureSystemMembership(req.user.id);

    res.json({
      message: "Session valide.",
      ...sessionPayload(req.user, {
        role: membership ? membership.role : null,
        permissions: effectivePermissions(membership ? membership.role : null),
      }),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Le jeton étant porté par le client (localStorage), la déconnexion est
 * locale : ce point d'entrée existe pour tracer l'état côté serveur et
 * permettre une future révocation de session.
 */
router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await usersService.touchLastSeen(req.user.id);
    res.json({ message: "Déconnexion réussie." });
  } catch (error) {
    next(error);
  }
});

router.patch("/me", requireAuth, async (req, res, next) => {
  try {
    const patch = {};

    if (req.body?.name !== undefined) {
      patch.name = requireString(req.body.name, "nom", { min: 2, max: 60 });
    }

    if (req.body?.bio !== undefined) {
      patch.bio = optionalString(req.body.bio, "bio", { max: 500 });
    }

    if (req.body?.avatarUrl !== undefined) {
      patch.avatarUrl = optionalString(req.body.avatarUrl, "avatarUrl", { max: 500 });
    }

    if (req.body?.theme !== undefined) {
      const theme = requireString(req.body.theme, "theme", { min: 2, max: 16 });

      if (!ALLOWED_THEMES.includes(theme)) {
        throw badRequest(
          `Thème inconnu. Valeurs acceptées : ${ALLOWED_THEMES.join(", ")}.`,
          "invalid_theme"
        );
      }

      patch.theme = theme;
    }

    if (req.body?.status !== undefined) {
      const status = requireString(req.body.status, "statut", { min: 2, max: 16 });

      // Le statut est affiché aux autres membres : on n'accepte pas n'importe
      // quelle chaîne, sinon il deviendrait un champ de texte libre.
      if (!ALLOWED_STATUSES.includes(status)) {
        throw badRequest(
          `Statut inconnu. Valeurs acceptées : ${ALLOWED_STATUSES.join(", ")}.`,
          "invalid_status"
        );
      }

      patch.status = status;
    }

    const updated = await usersService.updateProfile(req.user.id, patch);

    res.json({
      message: "Profil mis à jour.",
      ...sessionPayload(updated),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
