const jwt = require("jsonwebtoken");

const config = require("../config");
const usersService = require("../services/users");
const communities = require("../services/communities");
const { unauthorized, badRequest } = require("../utils/errors");
const { parseId } = require("../utils/validate");

/**
 * Le jeton ne contient qu'une référence de compte (`sub`) : le pseudo et
 * l'email sont relus en base à chaque requête, donc un changement de pseudo est
 * immédiatement pris en compte et un compte supprimé perd ses accès.
 */
function signToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      name: user.name,
      email: user.email,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw unauthorized("Session expirée, reconnectez-vous.", "token_expired");
    }
    throw unauthorized("Jeton invalide.", "token_invalid");
  }
}

function extractBearerToken(req) {
  const header = req.headers.authorization;

  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    return token || null;
  }

  return null;
}

/**
 * Valide un jeton puis recharge le compte en base.
 * Renvoie la ligne SQL complète (jamais exposée telle quelle).
 */
async function authenticateToken(token) {
  if (!token) {
    throw unauthorized("Jeton manquant.", "token_missing");
  }

  const decoded = verifyToken(token);
  const user = await usersService.findById(decoded.sub);

  if (!user) {
    throw unauthorized("Compte introuvable.", "user_not_found");
  }

  return user;
}

/** Middleware REST : exige un compte valide, pose `req.user`. */
async function requireAuth(req, res, next) {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      throw unauthorized("Jeton manquant.", "token_missing");
    }

    req.user = await authenticateToken(token);
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware de permission par communauté.
 *
 *   router.post("/", requireAuth, requireCommunityPermission(PERMISSIONS.MANAGE_CHANNELS), handler)
 *
 * La vérification est faite côté serveur : cacher un bouton dans React ne
 * protège rien.
 */
function requireCommunityPermission(permission, { param = "communityId" } = {}) {
  return async (req, res, next) => {
    try {
      const raw =
        req.params[param] ?? req.body[param] ?? req.query[param] ?? req.params.id;

      if (raw === undefined) {
        throw badRequest("Identifiant de communauté manquant.", "missing_community");
      }

      const communityId = parseId(raw, param);

      const { community, membership, role } = await communities.assertPermission(
        communityId,
        req.user.id,
        permission
      );

      req.communityId = communityId;
      req.community = community;
      req.membership = membership;
      req.communityRole = role;

      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Middleware de simple appartenance (lecture). */
function requireCommunityRead(param = "communityId") {
  return async (req, res, next) => {
    try {
      const raw = req.params[param] ?? req.query[param] ?? req.params.id;

      if (raw === undefined) {
        throw badRequest("Identifiant de communauté manquant.", "missing_community");
      }

      const communityId = parseId(raw, param);
      const { community, membership } = await communities.assertReadAccess(
        communityId,
        req.user.id
      );

      req.communityId = communityId;
      req.community = community;
      req.membership = membership;
      req.communityRole = membership ? membership.role : null;

      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  signToken,
  verifyToken,
  authenticateToken,
  extractBearerToken,
  requireAuth,
  requireCommunityPermission,
  requireCommunityRead,
};
