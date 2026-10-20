const express = require("express");

const communities = require("../services/communities");
const usersService = require("../services/users");
const channelsService = require("../services/channels");
const messagesService = require("../services/messages");
const bus = require("../realtime/bus");
const { syncUserRooms } = require("../realtime/sync");
const notify = require("../realtime/notify");
const registry = require("../realtime/registry");
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
} = require("../utils/validate");
const { forbidden } = require("../utils/errors");
const { hasPermission } = require("../permissions");
const categoriesRouter = require("./categories");
const channelsRouter = require("./channels");
const { communityRouter: invitationsRouter } = require("./invitations");
const rolesRouter = require("./roles");

const router = express.Router();

router.use(requireAuth);

/**
 * Communautés de l'utilisateur (dont il est membre) ou visibles (publiques).
 */
router.get("/", async (req, res, next) => {
  try {
    const list = await communities.listForUser(req.user.id);
    res.json({ communities: list });
  } catch (error) {
    next(error);
  }
});

/** Découverte : communautés publiques dont l'utilisateur n'est pas membre. */
router.get("/discover", async (req, res, next) => {
  try {
    // Les espaces superflus sont ignorés : une recherche vide (ou «   ») ne
    // filtre rien au lieu de chercher des noms contenant des espaces.
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : null;

    const list = await communities.discover(req.user.id, search || null);
    res.json({ communities: list });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const name = requireString(req.body?.name, "nom", { min: 2, max: 80 });
    const description = optionalString(req.body?.description, "description", {
      max: 300,
    });
    const iconUrl = optionalString(req.body?.iconUrl, "icône", { max: 500 });
    const isPublic = parseBoolean(req.body?.isPublic, true);

    const community = await communities.create({
      name,
      description,
      isPublic,
      iconUrl,
      ownerId: req.user.id,
    });

    await syncUserRooms(req.user.id);

    bus.toUser(req.user.id, "community:created", { community });
    bus.toCommunity(community.id, "community:updated", { community });

    res.status(201).json({ message: "Communauté créée.", community });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", requireCommunityRead("id"), async (req, res, next) => {
  try {
    const community = await communities.getForUser(req.communityId, req.user.id);
    res.json({ community });
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/:id",
  requireCommunityPermission(PERMISSIONS.UPDATE_COMMUNITY, { param: "id" }),
  async (req, res, next) => {
    try {
      const patch = { actorId: req.user.id };

      if (req.body?.name !== undefined) {
        patch.name = requireString(req.body.name, "nom", { min: 2, max: 80 });
      }

      if (req.body?.description !== undefined) {
        patch.description = optionalString(req.body.description, "description", {
          max: 300,
        });
      }

      if (req.body?.iconUrl !== undefined) {
        patch.iconUrl = optionalString(req.body.iconUrl, "icône", { max: 500 });
      }

      if (req.body?.isPublic !== undefined) {
        patch.isPublic = parseBoolean(req.body.isPublic, true);
      }

      const community = await communities.update(req.communityId, patch);

      bus.toCommunity(community.id, "community:updated", { community });

      res.json({ message: "Communauté mise à jour.", community });
    } catch (error) {
      next(error);
    }
  }
);

router.delete("/:id", async (req, res, next) => {
  try {
    const communityId = parseId(req.params.id);

    await communities.remove(communityId, req.user.id);

    bus.toCommunity(communityId, "community:deleted", { communityId });
    await syncUserRooms(req.user.id);

    res.json({ message: "Communauté supprimée.", communityId });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/join", async (req, res, next) => {
  try {
    const communityId = parseId(req.params.id);
    const community = await communities.join(communityId, req.user.id);

    await syncUserRooms(req.user.id);

    bus.toCommunity(communityId, "community:member:joined", {
      communityId,
      userId: Number(req.user.id),
      name: req.user.name,
      avatarUrl: req.user.avatar_url || null,
    });

    res.json({ message: "Communauté rejointe.", community });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/leave", async (req, res, next) => {
  try {
    const communityId = parseId(req.params.id);

    await communities.leave(communityId, req.user.id);

    bus.toCommunity(communityId, "community:member:left", {
      communityId,
      userId: Number(req.user.id),
      name: req.user.name,
    });

    await syncUserRooms(req.user.id);

    res.json({ message: "Vous avez quitté la communauté.", communityId });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/members", requireCommunityRead("id"), async (req, res, next) => {
  try {
    const members = await communities.listMembers(req.communityId);
    res.json({ members, memberCount: members.length });
  } catch (error) {
    next(error);
  }
});

/**
 * Ajouter un membre existant (ou changer son rôle s'il est déjà membre).
 * Nécessite `member:manage` et le respect de la hiérarchie des rôles.
 */
router.post(
  "/:id/members",
  requireCommunityPermission(PERMISSIONS.MANAGE_MEMBERS, { param: "id" }),
  async (req, res, next) => {
    try {
      const targetUserId = parseId(req.body?.userId, "userId");

      // `roleId` (rôle personnalisé) et `role` (clé système) sont acceptés :
      // le client historique envoie une chaîne, le nouveau envoie un id.
      const requestedRole =
        req.body?.roleId !== undefined && req.body.roleId !== null
          ? parseId(req.body.roleId, "roleId")
          : (req.body?.role ?? "member");

      const member = await communities.addMemberByActor(
        req.communityId,
        req.user.id,
        targetUserId,
        requestedRole
      );

      // Le socket n'embarque que l'identifiant et le libellé : les permissions
      // complète sont relues par le client si besoin, pas envoyées en aveugle.
      bus.toCommunity(req.communityId, "community:member:added", {
        communityId: req.communityId,
        userId: member.userId,
        name: member.name,
        created: member.created,
        roleId: member.role.id,
        role: member.role.key,
        roleName: member.role.name,
        rank: member.role.rank,
      });
      bus.toUser(targetUserId, "community:invited", {
        communityId: req.communityId,
        communityName: req.community ? req.community.name : null,
        roleId: member.role.id,
        role: member.role.key,
        roleName: member.role.name,
      });

      // Notification écrite en base : le membre ajouté la retrouvera même
      // s'il n'était pas connecté à cet instant.
      await notify.notifyUsers([targetUserId], {
        type: member.created ? "community:member:added" : "community:role:changed",
        title: member.created
          ? `Vous avez rejoint « ${req.community?.name || "une communauté"} »`
          : `Votre rôle a changé dans « ${req.community?.name || "une communauté"} »`,
        body: `Rôle : ${member.role.name}`,
        payload: {
          communityId: req.communityId,
          roleId: member.role.id,
          role: member.role.key,
          roleName: member.role.name,
        },
      });

      await syncUserRooms(targetUserId);

      res.status(member.created ? 201 : 200).json({
        message: member.created ? "Membre ajouté." : "Rôle mis à jour.",
        member,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/:id/members/:userId",
  requireCommunityPermission(PERMISSIONS.MANAGE_MEMBERS, { param: "id" }),
  async (req, res, next) => {
    try {
      const targetUserId = parseId(req.params.userId, "userId");

      const requestedRole =
        req.body?.roleId !== undefined && req.body.roleId !== null
          ? parseId(req.body.roleId, "roleId")
          : req.body?.role;

      const updated = await communities.updateMemberRole(
        req.communityId,
        req.user.id,
        targetUserId,
        requestedRole
      );

      // Le payload garde le même contrat qu'avant (`role` = la clé du rôle,
      // stable et utilisable pour filtrer), avec l'identifiant et le libellé
      // en plus pour l'affichage.
      const rolePayload = {
        communityId: req.communityId,
        roleId: updated.role.id,
        role: updated.role.key,
        roleName: updated.role.name,
      };

      bus.toCommunity(req.communityId, "community:member:updated", {
        communityId: req.communityId,
        ...updated,
      });

      await notify.notifyUsers([targetUserId], {
        type: "community:role:changed",
        title: `Votre rôle a changé dans « ${req.community?.name || "une communauté"} »`,
        body: `Nouveau rôle : ${updated.role.name}`,
        payload: rolePayload,
      });

      res.json({ message: "Rôle mis à jour.", member: updated });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/:id/members/:userId",
  async (req, res, next) => {
    try {
      const communityId = parseId(req.params.id);
      const targetUserId = parseId(req.params.userId, "userId");

      const result = await communities.removeMember(
        communityId,
        req.user.id,
        targetUserId
      );

      bus.toCommunity(communityId, "community:member:removed", {
        communityId,
        userId: targetUserId,
      });

      await syncUserRooms(targetUserId);

      res.json({ message: "Membre retiré.", ...result });
    } catch (error) {
      next(error);
    }
  }
);

// -----------------------------------------------------------------------------
// Recherche dans toute la communauté
// -----------------------------------------------------------------------------

/**
 * Recherche dans les salons de la communauté que l'appelant a le droit de lire.
 *
 * Le filtrage des salons réutilise `channelsService.listForUser` : un salle
 * privé ou protégé par un code n'est jamais fouillé pour quelqu'un qui n'y a pas
 * accès — la recherche ne doit pas devenir une fuite de contenu.
 */
router.get("/:id/messages/search", requireCommunityRead("id"), async (req, res, next) => {
  try {
    const term = requireString(req.query.q ?? req.query.search, "recherche", {
      min: 2,
      max: 120,
    });

    const channels = await channelsService.listForUser(
      req.communityId,
      req.user.id
    );

    const result = await messagesService.search({
      channelIds: channels.map((channel) => channel.id),
      term,
      limit: req.query.limit,
      before: req.query.before ?? null,
    });

    res.json({
      ...result,
      communityId: Number(req.communityId),
      // Permet à l'interface de nommer le salon de chaque résultat.
      channels: channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/** Routes imbriquées : les mêmes règles s'appliquent (permissions vérifiées). */
router.use("/:communityId/categories", categoriesRouter);
router.use("/:communityId/channels", channelsRouter);
router.use("/:communityId/invitations", invitationsRouter);
router.use("/:communityId/roles", rolesRouter);

/**
 * Annuaire minimal pour les invitations et les messages privés (jalon 7).
 * Ne renvoie que des informations publiques.
 */
router.get("/:id/member-candidates", async (req, res, next) => {
  try {
    const search = optionalString(req.query.search, "recherche", { max: 60 });

    if (!search || search.length < 2) {
      return res.json({ users: [] });
    }

    const rows = await usersService.searchByName(search, 20);

    res.json({
      users: rows
        .map(usersService.publicUser)
        .filter((user) => user.id !== Number(req.user.id)),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
