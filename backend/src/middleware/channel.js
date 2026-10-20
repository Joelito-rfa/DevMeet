const channels = require("../services/channels");
const { parseId } = require("../utils/validate");
const { badRequest, notFound } = require("../utils/errors");
const { requireAuth } = require("./auth");

/**
 * Résout le salon visé par `:channelId` (identifiant numérique OU identifiant
 * historique) et vérifie les droits d'accès.
 *
 * Les routes concernées reçoivent `req.channel` et `req.channelAccess`.
 */
function requireChannelAccess({ param = "channelId" } = {}) {
  return async (req, res, next) => {
    try {
      const raw = req.params[param];

      if (raw === undefined) {
        return next(badRequest("Identifiant de salon manquant."));
      }

      const channel = await channels.resolveByClientId(raw);

      if (!channel) {
        return next(notFound("Salon introuvable.", "channel_not_found"));
      }

      const access = await channels.assertChannelAccess(channel, req.user.id);

      req.channel = channel;
      req.channelAccess = access;

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Variante pour les routes dont le salon vient de la catégorie parente :
 * vérifie qu'un identifiant est bien présent, sans charger le salon.
 */
function requireIdParam(param) {
  return (req, res, next) => {
    try {
      req.params[param] = parseId(req.params[param], param);
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { requireChannelAccess, requireAuth, requireIdParam };
