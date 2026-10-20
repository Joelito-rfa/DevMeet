const { query, queryOne, withTransaction } = require("../db/pool");
const { forbidden, notFound, conflict, badRequest } = require("../utils/errors");
const { communityDto, memberDto } = require("../utils/serialize");
const {
  ROLES,
  PERMISSIONS,
  hasPermission,
  canManageRole,
  canAssignRole,
  isOwnerRole,
} = require("../permissions");
const rolesService = require("./roles");
const config = require("../config");

/**
 * La communauté avec, le cas échéant, l'adhésion de l'utilisateur ET son rôle
 * résolu. Le rôle est dénormalisé (`r_*`) pour éviter une requête par membre
 * dans les listes.
 */
const COMMUNITY_SELECT = `
  SELECT c.*,
         cm.id AS membership_id,
         cm.role_id AS membership_role_id,
         cm.joined_at AS membership_joined_at,
         r.\`key\` AS membership_role_key,
         r.name AS membership_role_name,
         r.\`rank\` AS membership_role_rank,
         r.color AS membership_role_color,
         r.is_system AS membership_role_is_system,
         owner.name AS owner_name
  FROM communities c
  LEFT JOIN community_members cm
    ON cm.community_id = c.id AND cm.user_id = ?
  LEFT JOIN roles r ON r.id = cm.role_id
  LEFT JOIN users owner ON owner.id = c.owner_id
`;

/**
 * Rôle.Null → l'utilisateur n'est pas membre.
 *
 * La clé de rôle système est conservée pour le confort de l'interface, mais
 * c'est `permissions` qui fait foi côté autorisation.
 */
function roleFromRow(row) {
  if (row.membership_id === null || row.membership_id === undefined) {
    return null;
  }

  if (row.membership_role_key === ROLES.OWNER) {
    return rolesService.ownerRole(row.id);
  }

  return {
    id: row.membership_role_id === null ? null : Number(row.membership_role_id),
    communityId: Number(row.id),
    key: row.membership_role_key || null,
    name: row.membership_role_name || "Membre",
    description: null,
    color: row.membership_role_color || null,
    rank: Number(row.membership_role_rank ?? 10),
    isSystem: Boolean(row.membership_role_is_system),
    isOwner: false,
    isAssignable: true,
    position: 0,
    // Permissions non chargées par le SELECT : `resolveRole()` les complète.
    permissions: null,
  };
}

async function getById(communityId) {
  return queryOne("SELECT * FROM communities WHERE id = ?", [communityId]);
}

async function countMembers(communityId) {
  const row = await queryOne(
    "SELECT COUNT(*) AS total FROM community_members WHERE community_id = ?",
    [communityId]
  );
  return row ? Number(row.total) : 0;
}

async function countChannels(communityId) {
  const row = await queryOne(
    "SELECT COUNT(*) AS total FROM channels WHERE community_id = ? AND archived_at IS NULL",
    [communityId]
  );
  return row ? Number(row.total) : 0;
}

/**
 * Adhésion + rôle RÉSOLU (permissions lues en base).
 *
 * Toutes les entrées du code qui font `membership.role` reçoivent un objet rôle
 * complet : `hasPermission()` accepte directement `membership.role`.
 */
async function getMembership(communityId, userId) {
  if (!userId) {
    return null;
  }

  const row = await queryOne(
    `SELECT cm.*, r.\`key\` AS role_key, r.name AS role_name, r.\`rank\` AS role_rank,
            r.color AS role_color, r.is_system AS role_is_system, r.is_assignable AS role_is_assignable
     FROM community_members cm
     LEFT JOIN roles r ON r.id = cm.role_id
     WHERE cm.community_id = ? AND cm.user_id = ?`,
    [communityId, userId]
  );

  if (!row) {
    return null;
  }

  const role = await rolesService.resolveForMember(row);

  if (!role) {
    // Incohérence en base (rôle supprimé manuellement) : l'adhésion ne vaut rien.
    return null;
  }

  return { ...row, role };
}

/**
 * Communautés visibles par l'utilisateur : celles dont il est membre, plus les
 * communautés publiques (prévisualisation / découverte).
 */
async function listForUser(userId) {
  const rows = await query(
    `${COMMUNITY_SELECT}
     WHERE cm.user_id IS NOT NULL OR c.is_public = 1
     ORDER BY c.is_system DESC, c.name ASC`,
    [userId]
  );

  if (rows.length === 0) {
    return [];
  }

  const roleByCommunity = await resolveRolesFor(rows, userId);

  const counts = await query(
    `SELECT community_id, COUNT(*) AS total
     FROM community_members
     WHERE community_id IN (${rows.map(() => "?").join(",")})
     GROUP BY community_id`,
    rows.map((row) => row.id)
  );

  const countMap = new Map(
    counts.map((row) => [Number(row.community_id), Number(row.total)])
  );

  const channelCounts = await query(
    `SELECT community_id, COUNT(*) AS total
     FROM channels
     WHERE archived_at IS NULL AND community_id IN (${rows.map(() => "?").join(",")})
     GROUP BY community_id`,
    rows.map((row) => row.id)
  );

  const channelMap = new Map(
    channelCounts.map((row) => [Number(row.community_id), Number(row.total)])
  );

  return rows.map((row) =>
    communityDto(row, {
      role: roleByCommunity.get(Number(row.id)) || null,
      memberCount: countMap.get(Number(row.id)) || 0,
      channelCount: channelMap.get(Number(row.id)) || 0,
    })
  );
}

/**
 * Charge les rôles de l'utilisateur pour plusieurs communautés en deux requêtes,
 * plutôt qu'une par ligne. La liste des communautés est le point d'entrée le
 * plus sollicité : le N+1 serait visible immédiatement.
 */
async function resolveRolesFor(rows, userId) {
  const resolved = new Map();
  const communityIds = rows
    .filter((row) => row.membership_id !== null && row.membership_id !== undefined)
    .map((row) => Number(row.id));

  if (communityIds.length === 0) {
    return resolved;
  }

  const placeholders = communityIds.map(() => "?").join(",");

  const memberships = await query(
    `SELECT cm.community_id, cm.role_id
     FROM community_members cm
     WHERE cm.user_id = ? AND cm.community_id IN (${placeholders})`,
    [userId, ...communityIds]
  );

  if (memberships.length === 0) {
    return resolved;
  }

  const roleIds = [...new Set(memberships.map((row) => Number(row.role_id)))];

  const roleRows = await query(
    `SELECT * FROM roles WHERE id IN (${roleIds.map(() => "?").join(",")})`,
    roleIds
  );

  const permissionRows = await query(
    `SELECT role_id, permission FROM role_permissions
     WHERE role_id IN (${roleIds.map(() => "?").join(",")})`,
    roleIds
  );

  const permissionsByRole = new Map();

  for (const row of permissionRows) {
    const id = Number(row.role_id);

    if (!permissionsByRole.has(id)) {
      permissionsByRole.set(id, []);
    }

    permissionsByRole.get(id).push(row.permission);
  }

  const byId = new Map(
    roleRows.map((row) => [
      Number(row.id),
      rolesService.hydrate(row, {
        permissions: permissionsByRole.get(Number(row.id)) || [],
      }),
    ])
  );

  for (const row of memberships) {
    const role = byId.get(Number(row.role_id));

    if (role) {
      resolved.set(Number(row.community_id), role);
    }
  }

  return resolved;
}

async function listPublic(search) {
  const params = [];
  let where = "WHERE c.is_public = 1";

  if (search) {
    where += " AND (c.name LIKE ? OR c.description LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  const rows = await query(
    `SELECT c.*, NULL AS membership_id, NULL AS membership_role_id
     FROM communities c
     ${where}
     ORDER BY c.is_system DESC, c.name ASC
     LIMIT 50`,
    params
  );

  return rows.map((row) => communityDto(row));
}

/**
 * Crée une communauté et, dans la même transaction, l'adhésion du créateur en
 * tant que propriétaire puis un premier salon textuel utilisable.
 */
async function create({ name, description, isPublic, iconUrl, ownerId }) {
  const communityId = await withTransaction(async (connection) => {
    const [communityResult] = await connection.execute(
      `INSERT INTO communities (name, description, icon_url, is_public, is_system, owner_id)
       VALUES (?, ?, ?, ?, 0, ?)`,
      [name, description, iconUrl, isPublic ? 1 : 0, ownerId]
    );

    const newId = communityResult.insertId;

    // Les rôles système naissent avec la communauté : sans eux, aucune
    // adhésion ne pourrait être créée.
    await rolesService.seedDefaultRoles(newId, connection);

    await connection.execute(
      "INSERT INTO community_members (community_id, user_id, role_id) VALUES (?, ?, ?)",
      [newId, ownerId, await rolesService.systemRoleId(newId, ROLES.OWNER, connection)]
    );

    // Catégorie par défaut : c'est ce que l'interface annonce à la création.
    // Sans elle, une communauté neuve s'ouvrirait sur une arborescence vide
    // alors que le message de succès promet une catégorie.
    const [categoryResult] = await connection.execute(
      `INSERT INTO categories (community_id, name, description, \`position\`, creator_id)
       VALUES (?, 'GÉNÉRAL', 'Catégorie par défaut de la communauté.', 0, ?)`,
      [newId, ownerId]
    );

    await connection.execute(
      `INSERT INTO channels (community_id, category_id, name, description, type, is_private, \`position\`, creator_id)
       VALUES (?, ?, 'general', 'Salon principal de la communauté.', 'text', 0, 0, ?)`,
      [newId, categoryResult.insertId, ownerId]
    );

    return newId;
  });

  return getForUser(communityId, ownerId);
}

async function getForUser(communityId, userId) {
  const row = await queryOne(`${COMMUNITY_SELECT} WHERE c.id = ?`, [userId, communityId]);

  if (!row) {
    throw notFound("Communauté introuvable.");
  }

  const roleByCommunity = await resolveRolesFor([row], userId);

  return communityDto(row, {
    role: roleByCommunity.get(Number(communityId)) || null,
    memberCount: await countMembers(communityId),
    channelCount: await countChannels(communityId),
  });
}

/**
 * Vérifie que l'utilisateur peut consulter la communauté.
 * Une communauté publique est consultable par tout utilisateur authentifié.
 */
async function assertReadAccess(communityId, userId) {
  const community = await getById(communityId);

  if (!community) {
    throw notFound("Communauté introuvable.");
  }

  const membership = await getMembership(communityId, userId);

  if (membership || community.is_public === 1) {
    return { community, membership };
  }

  throw forbidden("Vous n'êtes pas membre de cette communauté.", "not_a_member");
}

/**
 * Vérifie une permission précise pour l'utilisateur courant.
 */
async function assertPermission(communityId, userId, permission) {
  const { community, membership } = await assertReadAccess(communityId, userId);

  const role = membership ? membership.role : null;
  const isSystem = community.is_system === 1;

  // La communauté technique n'appartient à personne : un administrateur
  // d'instance (premier compte créé) conserve les droits d'administration.
  if (isSystem && !membership) {
    throw forbidden(
      "Cette action est réservée aux membres de la communauté.",
      "not_a_member"
    );
  }

  if (!hasPermission(role, permission)) {
    throw forbidden("Votre rôle ne permet pas cette action.", "missing_permission");
  }

  return { community, membership, role };
}

async function update(communityId, patch) {
  const community = await getById(communityId);

  if (!community) {
    throw notFound("Communauté introuvable.");
  }

  const fields = [];
  const values = [];

  if (patch.name !== undefined) {
    fields.push("name = ?");
    values.push(patch.name);
  }

  if (patch.description !== undefined) {
    fields.push("description = ?");
    values.push(patch.description);
  }

  if (patch.iconUrl !== undefined) {
    fields.push("icon_url = ?");
    values.push(patch.iconUrl);
  }

  if (patch.isPublic !== undefined) {
    fields.push("is_public = ?");
    values.push(patch.isPublic ? 1 : 0);
  }

  if (fields.length === 0) {
    return getForUser(communityId, patch.actorId);
  }

  values.push(communityId);
  await query(`UPDATE communities SET ${fields.join(", ")} WHERE id = ?`, values);

  return getForUser(communityId, patch.actorId);
}

async function remove(communityId, userId) {
  const community = await getById(communityId);

  if (!community) {
    throw notFound("Communauté introuvable.");
  }

  if (community.is_system === 1) {
    throw forbidden(
      "La communauté historique DevMeet ne peut pas être supprimée.",
      "system_community"
    );
  }

  if (Number(community.owner_id) !== Number(userId)) {
    throw forbidden("Seul le propriétaire peut supprimer la communauté.", "not_owner");
  }

  // Suppression en cascade explicite et contrôlée.
  await withTransaction(async (connection) => {
    await connection.execute("DELETE FROM communities WHERE id = ?", [communityId]);
  });
}

/**
 * Adhésion libre aux communautés publiques. Une communauté privée exige une
 * invitation (voir services/invitations.js).
 */
async function join(communityId, userId) {
  const community = await getById(communityId);

  if (!community) {
    throw notFound("Communauté introuvable.");
  }

  const existing = await getMembership(communityId, userId);

  if (existing) {
    return getForUser(communityId, userId);
  }

  if (community.is_public !== 1) {
    throw forbidden(
      "Cette communauté est privée : une invitation est nécessaire.",
      "invitation_required"
    );
  }

  await addMember(communityId, userId, ROLES.MEMBER);

  return getForUser(communityId, userId);
}

/**
 * Adhésion brute, sans contrôle de hiérarchie : réservée aux chemins système
 * (rejointure publique, invitation, bootstrap de la communauté technique).
 *
 * `role` accepte une clé système (« member ») ou un identifiant de rôle
 * personnalisé.
 */
async function addMember(communityId, userId, role = ROLES.MEMBER) {
  const roleId =
    typeof role === "number"
      ? role
      : await rolesService.systemRoleId(communityId, role || ROLES.MEMBER);

  if (!roleId) {
    throw badRequest("Rôle inconnu.", "invalid_role");
  }

  await query(
    `INSERT INTO community_members (community_id, user_id, role_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE role_id = role_id`,
    [communityId, userId, roleId]
  );
}

async function leave(communityId, userId) {
  const community = await getById(communityId);

  if (!community) {
    throw notFound("Communauté introuvable.");
  }

  const membership = await getMembership(communityId, userId);

  if (!membership) {
    throw notFound("Vous n'êtes pas membre de cette communauté.");
  }

  if (isOwnerRole(membership.role)) {
    throw forbidden(
      "Le propriétaire ne peut pas quitter sa communauté : transférez la propriété ou supprimez-la.",
      "owner_cannot_leave"
    );
  }

  await withTransaction(async (connection) => {
    await connection.execute(
      "DELETE FROM community_members WHERE community_id = ? AND user_id = ?",
      [communityId, userId]
    );

    // Les accès explicites aux salons privés de cette communauté sont révoqués.
    await connection.execute(
      `DELETE channel_members FROM channel_members
       INNER JOIN channels ON channels.id = channel_members.channel_id
       WHERE channels.community_id = ? AND channel_members.user_id = ?`,
      [communityId, userId]
    );
  });

  return { left: true, communityId };
}

/**
 * Membres d'une communauté avec leur rôle résolu.
 *
 * Les permissions de chaque rôle sont résolues en deux requêtes au total : la
 * liste des membres est affichée en entier et ne doit pas coûter une requête
 * par membre.
 */
async function listMembers(communityId) {
  const rows = await query(
    `SELECT cm.user_id, cm.role_id, cm.joined_at,
            u.name, u.email, u.avatar_url, u.status,
            r.\`key\` AS role_key, r.name AS role_name, r.\`rank\` AS role_rank,
            r.color AS role_color, r.is_system AS role_is_system,
            r.is_assignable AS role_is_assignable
     FROM community_members cm
     INNER JOIN roles r ON r.id = cm.role_id
     INNER JOIN users u ON u.id = cm.user_id
     WHERE cm.community_id = ?
     ORDER BY r.\`rank\` DESC, u.name ASC`,
    [communityId]
  );

  if (rows.length === 0) {
    return [];
  }

  const roleIds = [...new Set(rows.map((row) => Number(row.role_id)))];

  const permissionRows = await query(
    `SELECT role_id, permission FROM role_permissions
     WHERE role_id IN (${roleIds.map(() => "?").join(",")})`,
    roleIds
  );

  const permissionsByRole = new Map();

  for (const row of permissionRows) {
    const id = Number(row.role_id);

    if (!permissionsByRole.has(id)) {
      permissionsByRole.set(id, []);
    }

    permissionsByRole.get(id).push(row.permission);
  }

  return rows.map((row) => {
    const isOwner = row.role_key === ROLES.OWNER;

    return memberDto(row, {
      role: isOwner
        ? rolesService.ownerRole(communityId)
        : rolesService.hydrate(
            {
              id: row.role_id,
              community_id: communityId,
              key: row.role_key,
              name: row.role_name,
              rank: row.role_rank,
              color: row.role_color,
              is_system: row.role_is_system,
              is_assignable: row.role_is_assignable,
            },
            { permissions: permissionsByRole.get(Number(row.role_id)) || [] }
          ),
    });
  });
}

/**
 * Ajoute un membre existant à la communauté (ou met à jour son rôle s'il en est
 * déjà membre).
 *
 * Contrôles appliqués : permission `member:manage` de l'acteur, et respect de la
 * hiérarchie (impossible d'ajouter au-dessus de son propre rang, impossible de
 * créer un second propriétaire).
 *
 * `requestedRole` accepte un identifiant de rôle de la communauté, une clé
 * système, ou le nom d'un rôle personnalisé.
 */
async function addMemberByActor(communityId, actorId, targetUserId, requestedRole) {
  const actorMembership = await getMembership(communityId, actorId);

  if (!actorMembership) {
    throw forbidden("Vous n'êtes pas membre de cette communauté.", "not_a_member");
  }

  if (!hasPermission(actorMembership.role, PERMISSIONS.MANAGE_MEMBERS)) {
    throw forbidden("Votre rôle ne permet pas de gérer les membres.", "missing_permission");
  }

  const role = await rolesService.resolveTargetRole(communityId, requestedRole);

  if (!role || isOwnerRole(role)) {
    throw forbidden(
      "On ne peut pas créer un second propriétaire : utilisez le transfert de propriété.",
      "invalid_role"
    );
  }

  if (!canAssignRole(actorMembership.role, role)) {
    throw forbidden(
      "Vous ne pouvez pas attribuer un rôle égal ou supérieur au vôtre.",
      "insufficient_rank"
    );
  }

  const target = await queryOne("SELECT id, name, email FROM users WHERE id = ?", [
    targetUserId,
  ]);

  if (!target) {
    throw notFound("Utilisateur introuvable.");
  }

  const existing = await getMembership(communityId, targetUserId);

  if (existing) {
    if (!canManageRole(actorMembership.role, existing.role)) {
      throw forbidden(
        "Vous ne pouvez pas modifier un membre de rang égal ou supérieur au vôtre.",
        "insufficient_rank"
      );
    }

    await query(
      "UPDATE community_members SET role_id = ? WHERE community_id = ? AND user_id = ?",
      [role.id, communityId, targetUserId]
    );

    return {
      userId: Number(targetUserId),
      name: target.name,
      role,
      // Mêmes champs que `memberDto` : le client reçoit un membre cohérent,
      // que l'adhésion soit créée ou le rôle modifié.
      roleKey: role.key,
      created: false,
    };
  }

  await addMember(communityId, targetUserId, role.id);

  return {
    userId: Number(targetUserId),
    name: target.name,
    role,
    roleKey: role.key,
    created: true,
  };
}

async function updateMemberRole(communityId, actorId, targetUserId, requestedRole) {
  const actorMembership = await getMembership(communityId, actorId);

  if (!actorMembership) {
    throw forbidden("Vous n'êtes pas membre de cette communauté.", "not_a_member");
  }

  if (!hasPermission(actorMembership.role, PERMISSIONS.MANAGE_MEMBERS)) {
    throw forbidden("Votre rôle ne permet pas de gérer les membres.", "missing_permission");
  }

  const targetMembership = await getMembership(communityId, targetUserId);

  if (!targetMembership) {
    throw notFound("Ce membre n'appartient pas à la communauté.");
  }

  if (!canManageRole(actorMembership.role, targetMembership.role)) {
    throw forbidden(
      "Vous ne pouvez pas modifier un membre de rang égal ou supérieur au vôtre.",
      "insufficient_rank"
    );
  }

  const role = await rolesService.resolveTargetRole(communityId, requestedRole);

  if (!role || isOwnerRole(role)) {
    throw forbidden(
      "Le rôle de propriétaire ne s'attribue pas : utilisez le transfert de propriété.",
      "invalid_role"
    );
  }

  if (!canAssignRole(actorMembership.role, role)) {
    throw forbidden(
      "Vous ne pouvez pas attribuer un rôle égal ou supérieur au vôtre.",
      "insufficient_rank"
    );
  }

  await query(
    "UPDATE community_members SET role_id = ? WHERE community_id = ? AND user_id = ?",
    [role.id, communityId, targetUserId]
  );

  return { userId: Number(targetUserId), role, roleKey: role.key };
}

async function removeMember(communityId, actorId, targetUserId) {
  const actorMembership = await getMembership(communityId, actorId);

  if (!actorMembership) {
    throw forbidden("Vous n'êtes pas membre de cette communauté.", "not_a_member");
  }

  const targetMembership = await getMembership(communityId, targetUserId);

  if (!targetMembership) {
    throw notFound("Ce membre n'appartient pas à la communauté.");
  }

  const isSelf = Number(actorId) === Number(targetUserId);

  if (isSelf) {
    return leave(communityId, actorId);
  }

  if (!hasPermission(actorMembership.role, PERMISSIONS.MANAGE_MEMBERS)) {
    throw forbidden("Votre rôle ne permet pas de gérer les membres.", "missing_permission");
  }

  if (!canManageRole(actorMembership.role, targetMembership.role)) {
    throw forbidden(
      "Vous ne pouvez pas exclure un membre de rang égal ou supérieur au vôtre.",
      "insufficient_rank"
    );
  }

  await withTransaction(async (connection) => {
    await connection.execute(
      "DELETE FROM community_members WHERE community_id = ? AND user_id = ?",
      [communityId, targetUserId]
    );

    await connection.execute(
      `DELETE channel_members FROM channel_members
       INNER JOIN channels ON channels.id = channel_members.channel_id
       WHERE channels.community_id = ? AND channel_members.user_id = ?`,
      [communityId, targetUserId]
    );
  });

  return { removed: true, userId: Number(targetUserId) };
}

/**
 * Découverte : communautés publiques dont l'utilisateur n'est PAS encore
 * membre.
 *
 * On se base uniquement sur les adhésions réelles (`community_members`), et non
 * sur « les communautés visibles », sinon une communauté publique jamais
 * rejointe n'apparaîtrait jamais dans la découverte.
 */
async function discover(userId, search) {
  const communities = await listPublic(search);

  const rows = await query(
    "SELECT community_id FROM community_members WHERE user_id = ?",
    [userId]
  );

  const mine = new Set(rows.map((row) => Number(row.community_id)));

  return communities
    .filter((item) => !mine.has(item.id))
    .map((item) => ({ ...item, isMember: false }));
}

function isSystemCommunity(communityId) {
  return Number(communityId) === Number(config.systemCommunityId);
}

/**
 * Garantit que le compte fait partie de la communauté historique.
 *
 * L'ancien DevMeet diffusait la liste des salons à tout utilisateur connecté :
 * pour ne rien casser, chaque compte authentifié est membre de la communauté
 * technique. Le premier compte en devient propriétaire (il administre les
 * salons historiques) ; les suivants sont simples membres.
 */
async function ensureSystemMembership(userId) {
  const communityId = config.systemCommunityId;
  const community = await getById(communityId);

  if (!community) {
    return null;
  }

  const existing = await getMembership(communityId, userId);

  if (existing) {
    return existing;
  }

  const ownerRow = await queryOne(
    `SELECT cm.user_id
     FROM community_members cm
     INNER JOIN roles r ON r.id = cm.role_id
     WHERE cm.community_id = ? AND r.\`key\` = ?
     LIMIT 1`,
    [communityId, ROLES.OWNER]
  );

  await addMember(communityId, userId, ownerRow ? ROLES.MEMBER : ROLES.OWNER);

  return getMembership(communityId, userId);
}

module.exports = {
  COMMUNITY_SELECT,
  getById,
  getForUser,
  getMembership,
  listForUser,
  listPublic,
  create,
  update,
  remove,
  join,
  addMember,
  leave,
  listMembers,
  updateMemberRole,
  addMemberByActor,
  removeMember,
  discover,
  assertReadAccess,
  assertPermission,
  countMembers,
  countChannels,
  isSystemCommunity,
  ensureSystemMembership,
  resolveRolesFor,
};
