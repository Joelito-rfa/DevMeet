const { query, queryOne, withTransaction } = require("../db/pool");
const { forbidden, notFound, conflict, badRequest } = require("../utils/errors");
const {
  ROLES,
  ROLE_LIST,
  PERMISSIONS,
  ALL_PERMISSIONS,
  ROLE_DESCRIPTIONS,
  DEFAULT_ROLE_RANKS,
  ROLE_RANK_BOUNDS,
  SYSTEM_ROLE_RANKS,
  isRole,
  isPermission,
  isSystemRole,
  isOwnerRole,
  canGrantPermission,
  permissionsForRole,
} = require("../permissions");

/**
 * Rôles d'une communauté.
 *
 * Un rôle = un libellé + un rang + un ensemble de permissions. Les quatre rôles
 * système (propriétaire, administrateur, modérateur, membre) sont amorcés à la
 * création de la communauté ; les membres peuvent en ajouter d'autres.
 *
 * Le rôle du propriétaire est un cas particulier : il n'a pas de ligne en base
 * (il est porté par `communities.owner_id`), et il possède TOUTES les
 * permissions, y compris celles qui n'existent pas encore.
 */

/** Libellés français des rôles système (le nom affiché est stocké en base). */
const ROLE_LABEL_FR = {
  [ROLES.OWNER]: "Propriétaire",
  [ROLES.ADMIN]: "Administrateur",
  [ROLES.MODERATOR]: "Modérateur",
  [ROLES.MEMBER]: "Membre",
};

// -----------------------------------------------------------------------------
// Lecture
// -----------------------------------------------------------------------------

/**
 * Rôle par identifiant, permissions incluses.
 *
 * Les permissions sont obligatoires ici : `create` et `update` renvoient le
 * rôle créé via cette fonction, et une réponse sans permissions ferait croire à
 * l'interface que le rôle n'a aucun droit.
 */
async function getById(communityId, roleId) {
  const row = await queryOne(
    "SELECT * FROM roles WHERE id = ? AND community_id = ?",
    [roleId, communityId]
  );

  if (!row) {
    return null;
  }

  return hydrate(row, {
    permissions: row.key === ROLES.OWNER ? [...ALL_PERMISSIONS] : await permissionsOf(row.id),
  });
}

async function requireById(communityId, roleId) {
  const role = await getById(communityId, roleId);

  if (!role) {
    throw notFound("Rôle introuvable dans cette communauté.", "role_not_found");
  }

  return role;
}

/** Permissions d'un rôle, en base. Le propriétaire n'en a pas besoin. */
async function permissionsOf(roleId) {
  if (!roleId) {
    return [];
  }

  const rows = await query(
    "SELECT permission FROM role_permissions WHERE role_id = ?",
    [roleId]
  );

  return rows.map((row) => row.permission);
}

/**
 * Complète une ligne `roles` avec ses permissions et les champs attendus par
 * l'API. `isOwner` permet de fabriquer le rôle du propriétaire, qui n'existe
 * pas en base.
 */
function hydrate(row, { permissions = null, isOwner = false } = {}) {
  return {
    id: row.id ? Number(row.id) : null,
    communityId: row.community_id ? Number(row.community_id) : null,
    key: row.key ?? null,
    name: row.name,
    description: row.description || null,
    color: row.color || null,
    rank: Number(row.rank ?? DEFAULT_ROLE_RANKS[ROLES.MEMBER]),
    isSystem: isOwner || row.is_system === 1,
    isOwner,
    isAssignable: row.is_assignable === 1,
    position: Number(row.position ?? 0),
    permissions: permissions ?? [],
  };
}

/**
 * Normalise l'accès SQL : le pool renvoie les lignes, une connexion de
 * transaction renvoie `[lignes, champs]`. Les deux doivent se lire pareil.
 */
function executor(connection) {
  if (!connection) {
    return (sql, params) => query(sql, params);
  }

  return async (sql, params) => {
    const [rows] = await connection.execute(sql, params);
    return rows;
  };
}

/** Rôle synthétique du propriétaire, utilisable partout où l'on attend un rôle. */
function ownerRole(communityId) {
  return hydrate(
    {
      id: null,
      community_id: communityId,
      key: ROLES.OWNER,
      name: ROLE_DESCRIPTIONS[ROLES.OWNER],
      rank: DEFAULT_ROLE_RANKS[ROLES.OWNER],
      is_system: 1,
      is_assignable: 0,
      position: 0,
    },
    { permissions: [...ALL_PERMISSIONS], isOwner: true }
  );
}

/** Rôle « visiteur » : membre de la communauté publique, sans adhésion. */
function visitorRole(communityId) {
  return hydrate({
    id: null,
    community_id: communityId,
    key: ROLES.MEMBER,
    name: "Visiteur",
    rank: DEFAULT_ROLE_RANKS[ROLES.MEMBER],
    is_system: 1,
    is_assignable: 1,
    position: 3,
  });
}

async function listForCommunity(communityId, { includeOwner = true } = {}) {
  const rows = await query(
    `SELECT * FROM roles
     WHERE community_id = ?
     ORDER BY \`position\` ASC, \`rank\` DESC, id ASC`,
    [communityId]
  );

  if (rows.length === 0) {
    return includeOwner ? [ownerRole(communityId)] : [];
  }

  const permissionRows = await query(
    `SELECT rp.role_id, rp.permission
     FROM role_permissions rp
     INNER JOIN roles r ON r.id = rp.role_id
     WHERE r.community_id = ?`,
    [communityId]
  );

  const byRole = new Map();

  for (const row of permissionRows) {
    const key = Number(row.role_id);

    if (!byRole.has(key)) {
      byRole.set(key, []);
    }

    byRole.get(key).push(row.permission);
  }

  const roles = rows
    // Le rôle propriétaire est représenté par la version synthétique préparée
    // ci-dessus : la ligne en base ne sert qu'au rattachement des adhésions.
    // Sans ce filtre, le propriétaire apparaîtrait deux fois.
    .filter((row) => row.key !== ROLES.OWNER)
    .map((row) => hydrate(row, { permissions: byRole.get(Number(row.id)) || [] }));

  return includeOwner ? [ownerRole(communityId), ...roles] : roles;
}

/** Rôle système (`key`) d'une communauté. */
async function getSystemRole(communityId, key) {
  const row = await queryOne(
    "SELECT * FROM roles WHERE community_id = ? AND `key` = ?",
    [communityId, key]
  );

  if (!row) {
    return null;
  }

  const permissions =
    key === ROLES.OWNER ? [...ALL_PERMISSIONS] : await permissionsOf(row.id);

  return hydrate(row, { permissions, isOwner: key === ROLES.OWNER });
}

/**
 * Rôle d'un membre, résolu en base.
 *
 * Renvoie `null` si le membre n'existe pas ou si la ligne est incohérente —
 * l'appelant traitera alors l'utilisateur comme non membre, ce qui est le
 * comportement le plus restrictif.
 */
async function resolveForMember(membership) {
  if (!membership) {
    return null;
  }

  if (!membership.role_id) {
    return null;
  }

  const row = await queryOne("SELECT * FROM roles WHERE id = ?", [membership.role_id]);

  if (!row) {
    return null;
  }

  const permissions =
    row.key === ROLES.OWNER ? [...ALL_PERMISSIONS] : await permissionsOf(row.id);

  return hydrate(row, { permissions, isOwner: row.key === ROLES.OWNER });
}

/**
 * Rôle effectif d'un utilisateur dans une communauté, propriétaire compris.
 *
 * @param {number} communityId
 * @param {object|null} membership ligne `community_members` (ou `null`)
 */
async function resolveEffective(communityId, membership) {
  if (membership) {
    return resolveForMember(membership);
  }

  return null;
}

// -----------------------------------------------------------------------------
// Écriture
// -----------------------------------------------------------------------------

/**
 * Crée le jeu de rôles système d'une communauté. Idempotent.
 *
 * Utilise la matrice par défaut de `permissions.js` : la modifier ici change le
 * comportement de toutes les communautés créées ensuite.
 */
async function seedDefaultRoles(communityId, connection = null) {
  const run = executor(connection);

  const existing = await run("SELECT `key` FROM roles WHERE community_id = ?", [
    communityId,
  ]);

  const alreadyThere = new Set(existing.map((row) => row.key).filter(Boolean));

  let position = 0;

  for (const key of ROLE_LIST) {
    if (alreadyThere.has(key)) {
      continue;
    }

    const result = await run(
      `INSERT INTO roles (community_id, \`key\`, name, description, \`rank\`, is_system, is_assignable, \`position\`)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?)`,
      [
        communityId,
        key,
        ROLE_LABEL_FR[key],
        ROLE_DESCRIPTIONS[key] || null,
        DEFAULT_ROLE_RANKS[key],
        position,
      ]
    );

    const roleId = result.insertId;

    for (const permission of permissionsForRole(key)) {
      // Le propriétaire est un joker : rien à stocker.
      if (permission === "*") {
        continue;
      }

      await run("INSERT IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)", [
        roleId,
        permission,
      ]);
    }

    position += 1;
  }
}

/** Identifiant du rôle système, créé à la volée s'il manque. */
async function systemRoleId(communityId, key, connection = null) {
  const run = executor(connection);

  const row = await run("SELECT id FROM roles WHERE community_id = ? AND `key` = ?", [
    communityId,
    key,
  ]);

  if (row[0]) {
    return Number(row[0].id);
  }

  await seedDefaultRoles(communityId, connection);

  const created = await run(
    "SELECT id FROM roles WHERE community_id = ? AND `key` = ?",
    [communityId, key]
  );

  return created[0] ? Number(created[0].id) : null;
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

function normalizeName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function assertPermissionList(permissions, { actorRole = null } = {}) {
  if (permissions === undefined) {
    return [];
  }

  if (!Array.isArray(permissions)) {
    throw badRequest("La liste des permissions doit être un tableau.", "invalid_permissions");
  }

  const cleaned = [];

  for (const raw of permissions) {
    const permission = String(raw ?? "").trim();

    if (!isPermission(permission)) {
      throw badRequest(`Permission inconnue : « ${permission} ».`, "unknown_permission");
    }

    // Un rôle personnalisé ne peut pas s'accorder une permission réservée au
    // propriétaire (suppression de la communauté).
    if (!canGrantPermission(actorRole, permission)) {
      throw forbidden(
        `La permission « ${permission} » est réservée au propriétaire.`,
        "permission_not_grantable"
      );
    }

    if (!cleaned.includes(permission)) {
      cleaned.push(permission);
    }
  }

  return cleaned;
}

/**
 * Un rang personnalisé doit être :
 *   - entre ROLE_RANK_BOUNDS.MIN et MAX (donc jamais celui du propriétaire) ;
 *   - différent des rangs des rôles système, pour que l'ordre affiché reste
 *     prévisible et qu'aucune collision n'apparaisse entre un rôle système et
 *     un rôle personnalisé.
 */
function assertRank(value, communityId) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const rank = Number(value);

  if (!Number.isInteger(rank)) {
    throw badRequest("Le rang doit être un entier.", "invalid_rank");
  }

  if (rank < ROLE_RANK_BOUNDS.MIN || rank > ROLE_RANK_BOUNDS.MAX) {
    throw badRequest(
      `Le rang doit être compris entre ${ROLE_RANK_BOUNDS.MIN} et ${ROLE_RANK_BOUNDS.MAX}.`,
      "invalid_rank"
    );
  }

  return rank;
}

async function assertRankFree(communityId, rank, excludeRoleId = null) {
  if (rank === null) {
    return;
  }

  if (SYSTEM_ROLE_RANKS.includes(rank)) {
    throw conflict(
      "Ce rang est réservé à un rôle système.",
      "rank_reserved"
    );
  }

  const row = await queryOne(
    "SELECT id FROM roles WHERE community_id = ? AND `rank` = ? AND id <> ?",
    [communityId, rank, excludeRoleId || 0]
  );

  if (row) {
    throw conflict("Un autre rôle occupe déjà ce rang.", "rank_taken");
  }
}

async function assertNameFree(communityId, name, excludeRoleId = null) {
  const row = await queryOne(
    "SELECT id FROM roles WHERE community_id = ? AND LOWER(name) = LOWER(?) AND id <> ?",
    [communityId, name, excludeRoleId || 0]
  );

  if (row) {
    throw conflict("Un rôle porte déjà ce nom.", "role_name_taken");
  }
}

/**
 * L'acteur a-t-il le droit de gérer les rôles de cette communauté ?
 * Centralisé pour que REST, invitations et temps réel parlent la même langue.
 */
async function assertCanManageRoles(communityId, userId) {
  const communities = require("./communities");
  const { community, membership, role } = await communities.assertReadAccess(
    communityId,
    userId
  );

  if (!role || !role.permissions.includes(PERMISSIONS.MANAGE_ROLES)) {
    throw forbidden(
      "Votre rôle ne permet pas de gérer les rôles.",
      "missing_permission"
    );
  }

  return { community, membership, role };
}

/**
 * Cible d'attribution : soit un rôle de la communauté (par son id), soit l'une
 * des quatre clés système (parcourt de compatibilité avec l'ancien client).
 */
async function resolveTargetRole(communityId, input) {
  if (input === undefined || input === null || input === "") {
    return getSystemRole(communityId, ROLES.MEMBER);
  }

  if (typeof input === "string" && isRole(input)) {
    return getSystemRole(communityId, input);
  }

  const numeric = Number(input);

  if (Number.isInteger(numeric) && numeric > 0) {
    const role = await getById(communityId, numeric);

    if (!role) {
      throw notFound("Rôle introuvable dans cette communauté.", "role_not_found");
    }

    return role;
  }

  if (typeof input === "string") {
    const byName = await queryOne(
      "SELECT * FROM roles WHERE community_id = ? AND LOWER(name) = LOWER(?)",
      [communityId, input.trim()]
    );

    if (byName) {
      return hydrate(byName, { permissions: await permissionsOf(byName.id) });
    }
  }

  throw badRequest("Rôle inconnu.", "invalid_role");
}

// -----------------------------------------------------------------------------
// API de gestion
// -----------------------------------------------------------------------------

async function create(communityId, input, { actorRole = null } = {}) {
  const name = normalizeName(input.name);

  if (name.length < 2 || name.length > 60) {
    throw badRequest("Le nom du rôle doit contenir entre 2 et 60 caractères.", "invalid_name");
  }

  await assertNameFree(communityId, name);

  const rank = assertRank(input.rank, communityId) ?? nextFreeRank();
  await assertRankFree(communityId, rank);

  const permissions = assertPermissionList(input.permissions ?? [], { actorRole });

  const roleId = await withTransaction(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT COALESCE(MAX(`position`), -1) + 1 AS next FROM roles WHERE community_id = ?",
      [communityId]
    );

    const position = Number(rows[0]?.next ?? 0);

    const [result] = await connection.execute(
      `INSERT INTO roles (community_id, \`key\`, name, description, color, \`rank\`, is_system, is_assignable, \`position\`)
       VALUES (?, NULL, ?, ?, ?, ?, 0, ?, ?)`,
      [
        communityId,
        name,
        input.description ? String(input.description).trim().slice(0, 300) : null,
        input.color ? String(input.color).trim().slice(0, 20) : null,
        rank,
        input.isAssignable === false ? 0 : 1,
        position,
      ]
    );

    const newId = result.insertId;

    for (const permission of permissions) {
      await connection.execute(
        "INSERT IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)",
        [newId, permission]
      );
    }

    return newId;
  });

  return getById(communityId, roleId);
}

async function update(communityId, roleId, input, { actorRole = null } = {}) {
  const existing = await requireById(communityId, roleId);

  if (existing.isOwner || existing.key) {
    throw forbidden(
      "Un rôle système ne peut pas être modifié : dupliquez-le pour le customizing.",
      "system_role_immutable"
    );
  }

  const fields = [];
  const values = [];

  if (input.name !== undefined) {
    const name = normalizeName(input.name);

    if (name.length < 2 || name.length > 60) {
      throw badRequest(
        "Le nom du rôle doit contenir entre 2 et 60 caractères.",
        "invalid_name"
      );
    }

    await assertNameFree(communityId, name, roleId);

    fields.push("name = ?");
    values.push(name);
  }

  if (input.description !== undefined) {
    fields.push("description = ?");
    values.push(input.description ? String(input.description).trim().slice(0, 300) : null);
  }

  if (input.color !== undefined) {
    fields.push("color = ?");
    values.push(input.color ? String(input.color).trim().slice(0, 20) : null);
  }

  if (input.isAssignable !== undefined) {
    fields.push("is_assignable = ?");
    values.push(input.isAssignable ? 1 : 0);
  }

  if (input.rank !== undefined) {
    const rank = assertRank(input.rank, communityId);

    if (rank !== null) {
      await assertRankFree(communityId, rank, roleId);

      fields.push("`rank` = ?");
      values.push(rank);
    }
  }

  const permissions =
    input.permissions === undefined
      ? null
      : assertPermissionList(input.permissions, { actorRole });

  await withTransaction(async (connection) => {
    if (fields.length > 0) {
      await connection.execute(
        `UPDATE roles SET ${fields.join(", ")} WHERE id = ? AND community_id = ?`,
        [...values, roleId, communityId]
      );
    }

    if (permissions) {
      await connection.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);

      for (const permission of permissions) {
        await connection.execute(
          "INSERT IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)",
          [roleId, permission]
        );
      }
    }
  });

  return getById(communityId, roleId);
}

async function remove(communityId, roleId) {
  const existing = await requireById(communityId, roleId);

  if (existing.isOwner || existing.key) {
    throw forbidden("Un rôle système ne peut pas être supprimé.", "system_role_immutable");
  }

  const inUse = await queryOne(
    "SELECT COUNT(*) AS total FROM community_members WHERE community_id = ? AND role_id = ?",
    [communityId, roleId]
  );

  if (inUse && Number(inUse.total) > 0) {
    throw conflict(
      "Ce rôle est attribué à des membres : réattribuez-les avant de le supprimer.",
      "role_in_use"
    );
  }

  await query("DELETE FROM roles WHERE id = ? AND community_id = ?", [roleId, communityId]);

  return { deletedId: Number(roleId) };
}

function nextFreeRank() {
  return DEFAULT_ROLE_RANKS[ROLES.MODERATOR] - 10;
}

/** Rôles qu'un acteur donnée peut attribuer : strictement moins puissants. */
function assignableTo(actorRole, allRoles) {
  if (!actorRole) {
    return [];
  }

  return allRoles.filter(
    (role) =>
      role.isAssignable &&
      !role.isOwner &&
      role.rank < actorRole.rank &&
      role.key !== ROLES.OWNER
  );
}

module.exports = {
  ROLE_LABEL_FR,
  getById,
  requireById,
  permissionsOf,
  hydrate,
  ownerRole,
  visitorRole,
  listForCommunity,
  getSystemRole,
  resolveForMember,
  resolveEffective,
  resolveTargetRole,
  seedDefaultRoles,
  systemRoleId,
  assertCanManageRoles,
  assignableTo,
  create,
  update,
  remove,
};