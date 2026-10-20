const express = require("express");

const rolesService = require("../services/roles");
const communities = require("../services/communities");
const bus = require("../realtime/bus");
const notify = require("../realtime/notify");
const { requireAuth } = require("../middleware/auth");
const { requireCommunityRead } = require("../middleware/auth");
const {
  PERMISSIONS,
  ALL_PERMISSIONS,
  ROLE_RANK_BOUNDS,
  hasPermission,
  canGrantPermission,
} = require("../permissions");
const { requireString, optionalString, parseId, parseBoolean } = require("../utils/validate");
const { forbidden } = require("../utils/errors");

const router = express.Router({ mergeParams: true });

router.use(requireAuth);

/**
 * Vérifie `role:manage` et pose `req.communityRole`.
 *
 * On s'appuie sur le même chemin que les autres routes (service communities)
 * plutôt que sur un contrôle local : REST et temps réel doivent_appendiquer
 * exactement la même règle.
 */
/**
 * Un rôle créé ou déplacé ne doit jamais dépasser celui qui l'a fait : sinon un
 * administrateur (rang 75) se fabriquerait un rôle de rang 76 et pourrait
 * s'auto-attribuer des droits qu'il n'a pas.
 */
function assertRankBelow(rawRank, actorRole) {
  if (rawRank === undefined || rawRank === null || rawRank === "") {
    return undefined;
  }

  const rank = Number(rawRank);

  if (!Number.isInteger(rank)) {
    throw forbidden("Le rang doit être un entier.", "invalid_rank");
  }

  if (rank >= actorRole.rank) {
    throw forbidden(
      "Un rôle ne peut pas avoir un rang supérieur ou égal au vôtre.",
      "insufficient_rank"
    );
  }

  return rank;
}

async function requireRoleAdmin(req, res, next) {
  try {
    await communities.assertPermission(
      req.communityId,
      req.user.id,
      PERMISSIONS.MANAGE_ROLES
    );

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Catalogue des permissions, bornes de rang, et permissions accordables par
 * l'appelant.
 *
 * Publié sans permission particulière : l'interface doit pouvoir afficher les
 * cases à cocher d'un rôle même quand le membre n'est pas administrateur (il
 * l'est souvent en train de le devenir).
 */
router.get("/permissions", requireCommunityRead("communityId"), async (req, res, next) => {
  try {
    const membership = await communities.getMembership(req.communityId, req.user.id);
    const actorRole = membership ? membership.role : null;

    res.json({
      permissions: ALL_PERMISSIONS,
      rankBounds: ROLE_RANK_BOUNDS,
      // L'interface grise ces cases au lieu d'attendre une erreur à la
      // soumission : on ne propose pas ce que le serveur refuserait.
      grantable: ALL_PERMISSIONS.filter((permission) =>
        canGrantPermission(actorRole, permission)
      ),
      maxAssignableRank: actorRole ? actorRole.rank - 1 : null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Rôles de la communauté + ce que l'appelant peut en faire.
 *
 * Le membre voit la liste complète (il faut connaître les rôles pour comprendre
 * qui fait quoi), mais `assignableRoleIds` et `editableRoleIds` disent ce qu'il
 * peut réellement modifier. Calculé côté serveur : l'interface ne devine rien.
 */
router.get("/", requireCommunityRead("communityId"), async (req, res, next) => {
  try {
    const membership = await communities.getMembership(req.communityId, req.user.id);
    const actorRole = membership ? membership.role : null;
    const roles = await rolesService.listForCommunity(req.communityId);

    const assignable = rolesService.assignableTo(actorRole, roles);
    const canManage = hasPermission(actorRole, PERMISSIONS.MANAGE_ROLES);

    res.json({
      roles,
      canManage,
      assignableRoleIds: assignable.map((role) => role.id),
      // Les rôles système (dont le propriétaire) ne sont jamais modifiables.
      editableRoleIds: canManage
        ? roles.filter((role) => !role.key).map((role) => role.id)
        : [],
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Création d'un rôle personnalisé.
 *
 * Deux gardes, dans cet ordre :
 *   1. `role:manage` — sans ce droit, personne ne crée de rôle ;
 *   2. chaque permission cochée doit être accordable par l'acteur, et le rang
 *      doit rester sous le sien. Sans (2), un administrateur pourrait fabriquer
 *      un rôle supérieur à lui et s'auto-attribuer.
 */
router.post("/", requireCommunityRead("communityId"), requireRoleAdmin, async (req, res, next) => {
  try {
    const actorMembership = await communities.getMembership(req.communityId, req.user.id);
    const actorRole = actorMembership.role;

    const name = requireString(req.body?.name, "nom du rôle", { min: 2, max: 60 });
    const description = optionalString(req.body?.description, "description", { max: 300 });
    const color = optionalString(req.body?.color, "couleur", { max: 20 });

    const requestedPermissions = Array.isArray(req.body?.permissions)
      ? req.body.permissions
      : [];

    // Le rôle ne doit pas être plus puissant que celui qui le crée.
    const rank = assertRankBelow(req.body?.rank, actorRole);

    const role = await rolesService.create(
      req.communityId,
      { name, description, color, rank, permissions: requestedPermissions },
      { actorRole }
    );

    bus.toCommunity(req.communityId, "role:created", {
      communityId: req.communityId,
      role,
    });

    await notify.notifyCommunity(req.communityId, {
      exceptUserId: req.user.id,
      type: "role:created",
      title: `Nouveau rôle « ${role.name} »`,
      body: `Dans « ${req.community?.name || "la communauté"} ».`,
      payload: { communityId: req.communityId, roleId: role.id },
    });

    res.status(201).json({ message: "Rôle créé.", role });
  } catch (error) {
    next(error);
  }
});

/** Renommer / repositioner / modifier les permissions d'un rôle personnalisé. */
router.patch("/:roleId", requireCommunityRead("communityId"), requireRoleAdmin, async (req, res, next) => {
  try {
    const roleId = parseId(req.params.roleId, "roleId");
    const actorMembership = await communities.getMembership(req.communityId, req.user.id);
    const actorRole = actorMembership.role;

    const patch = {};

    if (req.body?.name !== undefined) {
      patch.name = requireString(req.body.name, "nom du rôle", { min: 2, max: 60 });
    }

    if (req.body?.description !== undefined) {
      patch.description = optionalString(req.body.description, "description", { max: 300 });
    }

    if (req.body?.color !== undefined) {
      patch.color = optionalString(req.body.color, "couleur", { max: 20 });
    }

    if (req.body?.isAssignable !== undefined) {
      patch.isAssignable = parseBoolean(req.body.isAssignable, true);
    }

    if (req.body?.rank !== undefined && req.body.rank !== null) {
      patch.rank = assertRankBelow(req.body.rank, actorRole);
    }

    if (req.body?.permissions !== undefined) {
      if (!Array.isArray(req.body.permissions)) {
        return res.status(400).json({
          message: "La liste des permissions doit être un tableau.",
          code: "invalid_permissions",
        });
      }

      patch.permissions = req.body.permissions;
    }

    const role = await rolesService.update(req.communityId, roleId, patch, {
      actorRole,
    });

    bus.toCommunity(req.communityId, "role:updated", {
      communityId: req.communityId,
      role,
    });

    // Les permissions d'un rôle changent ce que ses membres peuvent faire :
    // ils doivent le savoir même hors ligne.
    const affected = await communities.listMembers(req.communityId);
    const memberIds = affected
      .filter((member) => member.roleId === role.id)
      .map((member) => member.userId);

    if (memberIds.length > 0) {
      await notify.notifyUsers(memberIds, {
        type: "role:updated",
        title: `Vos droits ont changé dans « ${req.community?.name || "une communauté"} »`,
        body: `Rôle « ${role.name} » mis à jour.`,
        payload: { communityId: req.communityId, roleId: role.id },
      });
    }

    res.json({ message: "Rôle mis à jour.", role });
  } catch (error) {
    next(error);
  }
});

/** Suppression d'un rôle personnalisé non attribué. */
router.delete("/:roleId", requireCommunityRead("communityId"), requireRoleAdmin, async (req, res, next) => {
  try {
    const roleId = parseId(req.params.roleId, "roleId");
    const result = await rolesService.remove(req.communityId, roleId);

    bus.toCommunity(req.communityId, "role:deleted", {
      communityId: req.communityId,
      ...result,
    });

    res.json({ message: "Rôle supprimé.", ...result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;