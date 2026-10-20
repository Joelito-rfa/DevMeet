const express = require("express");
const QRCode = require("qrcode");

const invitationsService = require("../services/invitations");
const communities = require("../services/communities");
const bus = require("../realtime/bus");
const notify = require("../realtime/notify");
const { PERMISSIONS } = require("../permissions");
const { requireAuth, requireCommunityPermission } = require("../middleware/auth");
const { parseId, optionalString } = require("../utils/validate");
const { badRequest } = require("../utils/errors");
const config = require("../config");

/** Router imbriqué : /api/communities/:communityId/invitations */
const communityRouter = express.Router({ mergeParams: true });

communityRouter.use(requireAuth);

communityRouter.get(
  "/",
  requireCommunityPermission(PERMISSIONS.INVITE_MEMBERS, { param: "communityId" }),
  async (req, res, next) => {
    try {
      const invitations = await invitationsService.list(req.communityId);
      res.json({ invitations });
    } catch (error) {
      next(error);
    }
  }
);

communityRouter.post(
  "/",
  requireCommunityPermission(PERMISSIONS.INVITE_MEMBERS, { param: "communityId" }),
  async (req, res, next) => {
    try {
      let expiresAt = null;

      if (req.body?.expiresInHours !== undefined && req.body.expiresInHours !== null) {
        const hours = Number.parseInt(req.body.expiresInHours, 10);

        if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 90) {
          throw badRequest(
            "Durée d'expiration invalide (1 à 2160 heures).",
            "invalid_expiration"
          );
        }

        expiresAt = new Date(Date.now() + hours * 3600 * 1000);
      }

      let maxUses = null;

      if (req.body?.maxUses !== undefined && req.body.maxUses !== null) {
        const parsed = Number.parseInt(req.body.maxUses, 10);

        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10000) {
          throw badRequest(
            "Limite d'utilisations invalide (1 à 10000).",
            "invalid_max_uses"
          );
        }

        maxUses = parsed;
      }

      const invitation = await invitationsService.create({
        communityId: req.communityId,
        createdBy: req.user.id,
        expiresAt,
        maxUses,
      });

      const community = await communities.getById(req.communityId);
      const url = `${config.clientUrl}/invite/${invitation.code}`;

      bus.toCommunity(req.communityId, "invite:created", {
        communityId: req.communityId,
        invitation,
      });

      await notify.notifyCommunity(req.communityId, {
        exceptUserId: req.user.id,
        type: "invite:created",
        title: `Une invitation a été créée pour « ${community.name} »`,
        body: null,
        payload: { communityId: req.communityId, code: invitation.code },
      });

      res.status(201).json({
        message: "Invitation créée.",
        invitation,
        url,
        community: { id: Number(community.id), name: community.name },
      });
    } catch (error) {
      next(error);
    }
  }
);

communityRouter.delete(
  "/:invitationId",
  requireCommunityPermission(PERMISSIONS.INVITE_MEMBERS, { param: "communityId" }),
  async (req, res, next) => {
    try {
      const invitationId = parseId(req.params.invitationId, "invitationId");
      const invitation = await invitationsService.revoke(req.communityId, invitationId);

      bus.toCommunity(req.communityId, "invite:revoked", {
        communityId: req.communityId,
        invitationId,
      });

      res.json({ message: "Invitation révoquée.", invitation });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * QR code réel, généré à partir du lien d'invitation (data-URL PNG).
 * Aucun service externe n'est contacté.
 */
communityRouter.get(
  "/:invitationId/qrcode",
  requireCommunityPermission(PERMISSIONS.INVITE_MEMBERS, { param: "communityId" }),
  async (req, res, next) => {
    try {
      const invitationId = parseId(req.params.invitationId, "invitationId");
      const invitations = await invitationsService.list(req.communityId);
      const invitation = invitations.find((item) => item.id === invitationId);

      if (!invitation) {
        return res.status(404).json({ message: "Invitation introuvable." });
      }

      const url = `${config.clientUrl}/invite/${invitation.code}`;
      const dataUrl = await QRCode.toDataURL(url, {
        width: 320,
        margin: 1,
        color: { dark: "#0B0F19", light: "#FFFFFF" },
      });

      res.json({ url, qrcode: dataUrl, invitation });
    } catch (error) {
      next(error);
    }
  }
);

/** Router public : /api/invitations/:code */
const publicRouter = express.Router();

/** Aperçu public (page /invite/:code), accessible sans compte. */
publicRouter.get("/:code", async (req, res, next) => {
  try {
    const code = optionalString(req.params.code, "code", { max: 64 });

    if (!code) {
      return res.status(400).json({ message: "Code d'invitation manquant." });
    }

    const preview = await invitationsService.preview(code);
    res.json(preview);
  } catch (error) {
    next(error);
  }
});

/** Acceptation : nécessite un compte authentifié. */
publicRouter.post("/:code/accept", async (req, res, next) => {
  try {
    const token = require("../middleware/auth").extractBearerToken(req);

    if (!token) {
      return res.status(401).json({
        message: "Connectez-vous ou créez un compte pour rejoindre la communauté.",
        code: "auth_required",
      });
    }

    const user = await require("../middleware/auth").authenticateToken(token);
    const code = optionalString(req.params.code, "code", { max: 64 });

    if (!code) {
      return res.status(400).json({ message: "Code d'invitation manquant." });
    }

    const result = await invitationsService.accept(code, user.id);

    const { syncUserRooms } = require("../realtime/sync");
    await syncUserRooms(user.id);

    bus.toCommunity(result.community.id, "community:member:joined", {
      communityId: result.community.id,
      userId: Number(user.id),
      name: user.name,
      avatarUrl: user.avatar_url || null,
    });

    // Les membres existants sont prévenus de l'arrivée (sauf le nouveau venu).
    if (!result.alreadyMember) {
      await notify.notifyCommunity(result.community.id, {
        exceptUserId: user.id,
        type: "community:member:joined",
        title: `${user.name} a rejoint « ${result.community.name} »`,
        body: null,
        payload: { communityId: result.community.id, userId: Number(user.id) },
      });
    }

    res.json({
      message: result.alreadyMember
        ? "Vous êtes déjà membre de cette communauté."
        : "Invitation acceptée.",
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = { communityRouter, publicRouter };
