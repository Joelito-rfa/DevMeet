const express = require("express");

const channelsService = require("../services/channels");
const bus = require("../realtime/bus");
const notify = require("../realtime/notify");
const { PERMISSIONS } = require("../permissions");
const {
  requireAuth,
  requireCommunityPermission,
  requireCommunityRead,
} = require("../middleware/auth");
const {
  requireString,
  optionalString,
  parseBoolean,
  parseId,
  parseIdList,
  normalizeChannelName,
} = require("../utils/validate");

const router = express.Router({ mergeParams: true });

router.use(requireAuth);

/**
 * Salons accessibles par l'utilisateur. Les salons privés auxquels il n'a pas
 * droit ne sont même pas listés.
 */
router.get("/", requireCommunityRead("communityId"), async (req, res, next) => {
  try {
    const channels = await channelsService.listForUser(
      req.communityId,
      req.user.id
    );

    res.json({ channels, communityId: req.communityId });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/",
  requireCommunityPermission(PERMISSIONS.MANAGE_CHANNELS, { param: "communityId" }),
  async (req, res, next) => {
    try {
      const rawName = requireString(req.body?.name, "nom du salon", {
        min: 1,
        max: 80,
      });
      const type = req.body?.type ?? "text";
      const categoryId =
        req.body?.categoryId === undefined || req.body?.categoryId === null
          ? null
          : parseId(req.body.categoryId, "categoryId");
      const description = optionalString(req.body?.description, "description", {
        max: 300,
      });
      const isPrivate = parseBoolean(req.body?.isPrivate, false);
      const accessCode = optionalString(req.body?.accessCode, "code d'accès", {
        max: 120,
      });

      // Les salons vocaux et d'annonces n'ont pas de nom-slug : on garde le nom
      // lisible. Les salons textuels adoptent la convention Discord.
      const name =
        type === "text" || type === "board"
          ? normalizeChannelName(rawName)
          : rawName;

      const channel = await channelsService.create({
        communityId: req.communityId,
        categoryId,
        name,
        description,
        type,
        isPrivate,
        accessCode,
        creatorId: req.user.id,
      });

      bus.toCommunity(req.communityId, "channel:created", {
        communityId: req.communityId,
        channel,
      });

      // Les membres apprennent l'ouverture du salon, même hors ligne.
      await notify.notifyCommunity(req.communityId, {
        exceptUserId: req.user.id,
        type: "channel:created",
        title: `Nouveau salon « ${channel.name} »`,
        body: req.community?.name ? `Dans « ${req.community.name} ».` : null,
        payload: {
          communityId: req.communityId,
          channelId: channel.id,
        },
      });

      res.status(201).json({ message: "Salon créé.", channel });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Réordonner les salons d'un groupe : une catégorie précise, ou les salons
 * sans catégorie (`categoryId` absent / null).
 */
router.patch(
  "/reorder",
  requireCommunityPermission(PERMISSIONS.MANAGE_CHANNELS, { param: "communityId" }),
  async (req, res, next) => {
    try {
      const orderedIds = parseIdList(req.body?.order ?? req.body?.ids, "ordre");
      const categoryId =
        req.body?.categoryId === undefined || req.body?.categoryId === null
          ? null
          : parseId(req.body.categoryId, "categoryId");

      await channelsService.reorder(req.communityId, categoryId, orderedIds);

      bus.toCommunity(req.communityId, "channel:reordered", {
        communityId: req.communityId,
        categoryId,
        order: orderedIds,
      });

      res.json({ message: "Salons réordonnés.", order: orderedIds, categoryId });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
