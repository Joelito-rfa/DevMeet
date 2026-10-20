const express = require("express");

const categoriesService = require("../services/categories");
const channelsService = require("../services/channels");
const bus = require("../realtime/bus");
const { PERMISSIONS } = require("../permissions");
const { requireCommunityPermission, requireCommunityRead, requireAuth } = require("../middleware/auth");
const {
  requireString,
  optionalString,
  parseId,
  parseIdList,
} = require("../utils/validate");

// `mergeParams` permet de récupérer `:communityId` depuis la route parente.
const router = express.Router({ mergeParams: true });

router.use(requireAuth);

/** Lister les catégories d'une communauté. */
router.get("/", requireCommunityRead("communityId"), async (req, res, next) => {
    try {
      const categories = await categoriesService.list(req.communityId);
      res.json({ categories });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/",
  requireCommunityPermission(PERMISSIONS.MANAGE_CATEGORIES, { param: "communityId" }),
  async (req, res, next) => {
    try {
      const name = requireString(req.body?.name, "nom", { min: 1, max: 80 });
      const description = optionalString(req.body?.description, "description", {
        max: 300,
      });

      const category = await categoriesService.create({
        communityId: req.communityId,
        name,
        description,
        creatorId: req.user.id,
      });

      bus.toCommunity(req.communityId, "category:created", {
        communityId: req.communityId,
        category,
      });

      res.status(201).json({ message: "Catégorie créée.", category });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Réordonner les catégories. La liste doit contenir exactement toutes les
 * catégories de la communauté.
 */
router.patch(
  "/reorder",
  requireCommunityPermission(PERMISSIONS.MANAGE_CATEGORIES, { param: "communityId" }),
  async (req, res, next) => {
    try {
      const orderedIds = parseIdList(req.body?.order ?? req.body?.ids, "ordre");
      const categories = await categoriesService.reorder(req.communityId, orderedIds);

      bus.toCommunity(req.communityId, "category:reordered", {
        communityId: req.communityId,
        order: orderedIds,
        categories,
      });

      res.json({ message: "Catégories réordonnées.", categories });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Renommer / redécrire une catégorie.
 * Le rattachement à la communauté est vérifié ici même : on ne peut pas
 * modifier une catégorie en changeant l'identifiant de communauté dans l'URL.
 */
router.patch(
  "/:categoryId",
  requireCommunityPermission(PERMISSIONS.MANAGE_CATEGORIES, { param: "communityId" }),
  async (req, res, next) => {
    try {
      const categoryId = parseId(req.params.categoryId, "categoryId");
      const existing = await categoriesService.getById(categoryId);

      if (!existing || Number(existing.community_id) !== Number(req.communityId)) {
        return res.status(404).json({ message: "Catégorie introuvable." });
      }

      const patch = {};

      if (req.body?.name !== undefined) {
        patch.name = requireString(req.body.name, "nom", { min: 1, max: 80 });
      }

      if (req.body?.description !== undefined) {
        patch.description = optionalString(req.body.description, "description", {
          max: 300,
        });
      }

      const category = await categoriesService.update(categoryId, patch);

      bus.toCommunity(req.communityId, "category:updated", {
        communityId: req.communityId,
        category,
      });

      res.json({ message: "Catégorie mise à jour.", category });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Supprimer une catégorie.
 *
 * `strategy` est obligatoire :
 *   - "keep"   → les salons restent, sans catégorie ;
 *   - "delete" → les salons ET leur contenu sont supprimés.
 */
router.delete(
  "/:categoryId",
  requireCommunityPermission(PERMISSIONS.MANAGE_CATEGORIES, { param: "communityId" }),
  async (req, res, next) => {
    try {
      const categoryId = parseId(req.params.categoryId, "categoryId");
      const existing = await categoriesService.getById(categoryId);

      if (!existing || Number(existing.community_id) !== Number(req.communityId)) {
        return res.status(404).json({ message: "Catégorie introuvable." });
      }

      const strategy = req.query.strategy ?? req.body?.strategy;
      const result = await categoriesService.remove(categoryId, strategy);

      const channels = await channelsService.listRaw(req.communityId);

      bus.toCommunity(req.communityId, "category:deleted", {
        communityId: req.communityId,
        ...result,
      });
      bus.toCommunity(req.communityId, "channel:list", {
        communityId: req.communityId,
        channels: channels.map((row) => row.id),
      });

      res.json({ message: "Catégorie supprimée.", ...result });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
