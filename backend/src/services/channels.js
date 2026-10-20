const { query, queryOne, withTransaction } = require("../db/pool");
const { forbidden, notFound, badRequest, conflict } = require("../utils/errors");
const { channelDto } = require("../utils/serialize");
const { hasPermission, PERMISSIONS } = require("../permissions");
const communities = require("./communities");
const config = require("../config");

const CHANNEL_TYPES = ["text", "voice", "announcement", "board"];

function isChannelType(value) {
  return CHANNEL_TYPES.includes(value);
}

async function getById(channelId) {
  return queryOne("SELECT * FROM channels WHERE id = ?", [channelId]);
}

/**
 * Résout un salon à partir de la valeur utilisée par le client :
 *   - identifiant numérique (« 42 ») ;
 *   - identifiant historique de l'ancien protocole (« general »,
 *     « 1712345678901 »).
 */
async function resolveByClientId(rawId) {
  const value = String(rawId ?? "").trim();

  if (!value) {
    return null;
  }

  if (/^\d+$/.test(value)) {
    const byId = await getById(Number(value));

    if (byId) {
      return byId;
    }
  }

  return queryOne("SELECT * FROM channels WHERE legacy_room_id = ?", [value]);
}

async function requireById(channelId) {
  const channel = await getById(channelId);

  if (!channel) {
    throw notFound("Salon introuvable.");
  }

  return channel;
}

async function nextPosition(communityId, categoryId) {
  const row = await queryOne(
    `SELECT COALESCE(MAX(\`position\`), -1) + 1 AS next
     FROM channels
     WHERE community_id = ?
       AND ((category_id IS NULL AND ? IS NULL) OR category_id = ?)`,
    [communityId, categoryId, categoryId]
  );

  return row ? Number(row.next) : 0;
}

async function listRaw(communityId) {
  return query(
    `SELECT * FROM channels
     WHERE community_id = ? AND archived_at IS NULL
     ORDER BY (category_id IS NULL) ASC, \`position\` ASC, id ASC`,
    [communityId]
  );
}

/**
 * Liste des salons accessibles par l'utilisateur, avec compteur de non-lus.
 * Les salons privés (ou protégés par un code d'accès) auxquels l'utilisateur
 * n'a pas droit sont retirés de la liste : ils ne sont même pas visibles.
 */
async function listForUser(communityId, userId) {
  const rows = await query(
    `SELECT ch.*,
            (SELECT COUNT(*) FROM messages m
              WHERE m.channel_id = ch.id
                AND m.deleted_at IS NULL
                AND m.id > COALESCE(crs.last_read_message_id, 0)
                AND (m.author_id IS NULL OR m.author_id <> ?)) AS unread_count
     FROM channels ch
     LEFT JOIN channel_read_states crs
       ON crs.channel_id = ch.id AND crs.user_id = ?
     WHERE ch.community_id = ? AND ch.archived_at IS NULL
     ORDER BY (ch.category_id IS NULL) ASC, ch.\`position\` ASC, ch.id ASC`,
    [userId, userId, communityId]
  );

  if (rows.length === 0) {
    return [];
  }

  const community = await communities.getById(communityId);

  if (!community) {
    throw notFound("Communauté introuvable.");
  }

  const membership = await communities.getMembership(communityId, userId);
  const role = membership ? membership.role : null;

  // « Staff » n'est plus une question de rang mais de droit : un rôle
  // personnalisé qui porte `message:moderate` voit les salons restreints, comme
  // le faisait naguère le rôle modérateur.
  const isStaff = hasPermission(role, PERMISSIONS.MODERATE_MESSAGES);

  const explicitRows = await query(
    `SELECT channel_id FROM channel_members
     WHERE user_id = ? AND channel_id IN (${rows.map(() => "?").join(",")})`,
    [userId, ...rows.map((row) => row.id)]
  );

  const explicitSet = new Set(explicitRows.map((row) => Number(row.channel_id)));
  const canBrowseCommunity = community.is_public === 1 || Boolean(membership);

  return rows
    .filter((row) => {
      if (isStaff) {
        return true;
      }

      const restricted = row.is_private === 1 || Boolean(row.access_code);

      if (restricted) {
        return explicitSet.has(Number(row.id));
      }

      return canBrowseCommunity;
    })
    .map((row) =>
      channelDto(row, { unreadCount: row.unread_count, members: [] })
    );
}

async function create({
  communityId,
  categoryId,
  name,
  description,
  type,
  isPrivate,
  accessCode,
  creatorId,
}) {
  if (!isChannelType(type)) {
    throw badRequest(
      `Type de salon invalide. Types acceptés : ${CHANNEL_TYPES.join(", ")}.`,
      "invalid_channel_type"
    );
  }

  if (categoryId) {
    const category = await queryOne(
      "SELECT id FROM categories WHERE id = ? AND community_id = ?",
      [categoryId, communityId]
    );

    if (!category) {
      throw notFound("Catégorie introuvable dans cette communauté.");
    }
  }

  const duplicate = await queryOne(
    `SELECT id FROM channels
     WHERE community_id = ? AND LOWER(name) = LOWER(?)
       AND ((category_id IS NULL AND ? IS NULL) OR category_id = ?)
       AND archived_at IS NULL`,
    [communityId, name, categoryId, categoryId]
  );

  if (duplicate) {
    throw conflict(
      "Un salon porte déjà ce nom dans cette catégorie.",
      "channel_name_taken"
    );
  }

  const position = await nextPosition(communityId, categoryId);

  const result = await query(
    `INSERT INTO channels
       (community_id, category_id, name, description, type, is_private, \`position\`, access_code, creator_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      communityId,
      categoryId,
      name,
      description,
      type,
      isPrivate ? 1 : 0,
      position,
      accessCode,
      creatorId,
    ]
  );

  const created = await getById(result.insertId);

  // Le créateur d'un salon protégé y a accès d'office.
  if (created.access_code || created.is_private) {
    await addMember(created.id, creatorId);
  }

  return channelDto(created, { unreadCount: 0 });
}

async function update(channelId, patch) {
  const channel = await requireById(channelId);
  const fields = [];
  const values = [];

  if (patch.name !== undefined) {
    const duplicate = await queryOne(
      `SELECT id FROM channels
       WHERE community_id = ? AND LOWER(name) = LOWER(?) AND id <> ?
         AND ((category_id IS NULL AND ? IS NULL) OR category_id = ?)
         AND archived_at IS NULL`,
      [channel.community_id, patch.name, channelId, channel.category_id, channel.category_id]
    );

    if (duplicate) {
      throw conflict(
        "Un salon porte déjà ce nom dans cette catégorie.",
        "channel_name_taken"
      );
    }

    fields.push("name = ?");
    values.push(patch.name);
  }

  if (patch.description !== undefined) {
    fields.push("description = ?");
    values.push(patch.description);
  }

  if (patch.isPrivate !== undefined) {
    fields.push("is_private = ?");
    values.push(patch.isPrivate ? 1 : 0);
  }

  if (patch.type !== undefined) {
    if (!isChannelType(patch.type)) {
      throw badRequest("Type de salon invalide.", "invalid_channel_type");
    }
    fields.push("type = ?");
    values.push(patch.type);
  }

  if (patch.accessCode !== undefined) {
    fields.push("access_code = ?");
    values.push(patch.accessCode);
  }

  if (patch.archived !== undefined) {
    fields.push("archived_at = ?");
    values.push(patch.archived ? new Date() : null);
  }

  if (patch.categoryId !== undefined) {
    if (patch.categoryId !== null) {
      const category = await queryOne(
        "SELECT id FROM categories WHERE id = ? AND community_id = ?",
        [patch.categoryId, channel.community_id]
      );

      if (!category) {
        throw notFound("Catégorie introuvable dans cette communauté.");
      }
    }

    fields.push("category_id = ?");
    values.push(patch.categoryId);
  }

  if (fields.length > 0) {
    values.push(channelId);
    await query(`UPDATE channels SET ${fields.join(", ")} WHERE id = ?`, values);
  }

  return channelDto(await getById(channelId));
}

/**
 * Supprime un salon et tout son contenu (messages, pièces jointes, tableau
 * blanc) via les cascades déclarées dans le schéma.
 *
 * La suppression n'est jamais silencieuse : on compte d'abord ce qui va
 * disparaître et on le renvoie à l'appelant (l'interface peut ainsi prévenir
 * avant de confirmer). L'opération est atomique.
 */
async function remove(channelId) {
  const channel = await requireById(channelId);

  return withTransaction(async (connection) => {
    const [[counts]] = await connection.execute(
      `SELECT
         (SELECT COUNT(*) FROM messages WHERE channel_id = ?) AS messages,
         (SELECT COUNT(*) FROM attachments
           WHERE message_id IN (SELECT id FROM messages WHERE channel_id = ?)) AS attachments`,
      [channelId, channelId]
    );

    await connection.execute("DELETE FROM channels WHERE id = ?", [channelId]);

    return {
      deletedId: Number(channelId),
      name: channel.name,
      deletedMessages: Number(counts?.messages ?? 0),
      deletedAttachments: Number(counts?.attachments ?? 0),
    };
  });
}

/**
 * Déplace un salon vers une autre catégorie (ou « sans catégorie ») et/ou
 * vers une autre position.
 */
async function move(channelId, { categoryId = undefined, position = undefined }) {
  const channel = await requireById(channelId);
  const targetCategoryId = categoryId ?? null;

  await withTransaction(async (connection) => {
    const [siblings] = await connection.execute(
      `SELECT id FROM channels
       WHERE community_id = ? AND archived_at IS NULL AND id <> ?
         AND ((category_id IS NULL AND ? IS NULL) OR category_id = ?)
       ORDER BY \`position\` ASC, id ASC`,
      [channel.community_id, channelId, targetCategoryId, targetCategoryId]
    );

    const ordered = siblings.map((row) => Number(row.id));
    const target =
      position === undefined || position === null
        ? ordered.length
        : Math.min(Math.max(Number(position), 0), ordered.length);

    ordered.splice(target, 0, Number(channelId));

    let index = 0;

    for (const id of ordered) {
      await connection.execute(
        "UPDATE channels SET category_id = ?, `position` = ? WHERE id = ?",
        [targetCategoryId, index, id]
      );
      index += 1;
    }
  });

  // Relecture APRÈS la transaction : relire depuis une autre connexion pendant
  // la transaction renverrait l'ancienne valeur (isolation InnoDB).
  return channelDto(await getById(channelId));
}

/**
 * Réordonne les salons d'un groupe (une catégorie, ou les salons sans
 * catégorie). La liste doit correspondre exactement au groupe visé.
 */
async function reorder(communityId, categoryId, orderedIds) {
  const existing = await query(
    `SELECT id FROM channels
     WHERE community_id = ? AND archived_at IS NULL
       AND ((category_id IS NULL AND ? IS NULL) OR category_id = ?)`,
    [communityId, categoryId, categoryId]
  );

  const existingIds = existing.map((row) => Number(row.id));
  const requested = orderedIds.map((id) => Number(id));

  const sameSet =
    existingIds.length === requested.length &&
    existingIds.every((id) => requested.includes(id));

  if (!sameSet) {
    throw badRequest(
      "L'ordre fourni doit contenir exactement les salons de ce groupe.",
      "invalid_order"
    );
  }

  await withTransaction(async (connection) => {
    let index = 0;

    for (const id of requested) {
      await connection.execute("UPDATE channels SET `position` = ? WHERE id = ?", [
        index,
        id,
      ]);
      index += 1;
    }
  });

  return listRaw(communityId);
}

// -----------------------------------------------------------------------------
// Accès
// -----------------------------------------------------------------------------

async function hasExplicitAccess(channelId, userId) {
  const row = await queryOne(
    "SELECT 1 AS ok FROM channel_members WHERE channel_id = ? AND user_id = ?",
    [channelId, userId]
  );

  return Boolean(row);
}

/**
 * Règle d'accès à un salon, appliquée à l'identique par le REST et par
 * Socket.IO :
 *
 *   1. Un modérateur (ou plus) passe toujours.
 *   2. Un salon privé ou protégé par un code d'accès exige une autorisation
 *      explicite (`channel_members`), obtenue après validation du code par
 *      l'ancien parcours « rejoindre un salon ».
 *   3. Sinon, la communauté doit être publique ou l'utilisateur doit en être
 *      membre.
 *
 * Deviner l'identifiant d'un salon privé ne suffit donc jamais.
 */
async function assertChannelAccess(channel, userId) {
  if (!channel) {
    throw notFound("Salon introuvable.");
  }

  const community = await communities.getById(channel.community_id);

  if (!community) {
    throw notFound("Communauté introuvable.");
  }

  const membership = await communities.getMembership(channel.community_id, userId);
  const role = membership ? membership.role : null;
  const isStaff = hasPermission(role, PERMISSIONS.MODERATE_MESSAGES);

  if (isStaff) {
    return { community, membership, role, grantedBy: "staff" };
  }

  const restricted = channel.is_private === 1 || Boolean(channel.access_code);

  if (restricted) {
    if (await hasExplicitAccess(channel.id, userId)) {
      return { community, membership, role, grantedBy: "channel_member" };
    }

    throw forbidden(
      channel.is_private
        ? "Ce salon est privé."
        : "Ce salon est protégé par un code d'accès.",
      "channel_forbidden"
    );
  }

  if (community.is_public === 1) {
    return { community, membership, role, grantedBy: "public_community" };
  }

  if (membership) {
    return { community, membership, role, grantedBy: "community_member" };
  }

  throw forbidden("Vous n'êtes pas membre de cette communauté.", "not_a_member");
}

async function resolveAndAssert(rawChannelId, userId) {
  const channel = await resolveByClientId(rawChannelId);

  if (!channel) {
    throw notFound("Salon introuvable.");
  }

  const access = await assertChannelAccess(channel, userId);

  return { channel, access };
}

/**
 * Déverrouille un salon protégé par un code d'accès.
 *
 * Règle unique, partagée par le REST et par l'ancien événement Socket.IO
 * `join-room` : un code correct crée une ligne `channel_members`, donc l'accès
 * devient PERSISTANT (il survit à la reconnexion). Rien d'autre n'ouvre un
 * salon protégé : ni un rôle deviné, ni un identifiant deviné.
 *
 * @returns {Promise<{access: object, grantedByCode: boolean}>}
 */
async function unlock(channel, userId, accessCode) {
  const existing = await assertChannelAccess(channel, userId).catch(
    (error) => error
  );

  if (!(existing instanceof Error)) {
    return { access: existing, grantedByCode: false };
  }

  const provided = String(accessCode ?? "").trim();

  if (!channel.access_code) {
    // Salon privé sans code : seul un responsable peut en donner l'accès.
    throw forbidden(
      "Ce salon est privé : demandez à un responsable de la communauté.",
      "channel_forbidden"
    );
  }

  if (!provided) {
    throw forbidden("Le code d'accès est obligatoire.", "access_code_required");
  }

  if (String(channel.access_code) !== provided) {
    throw forbidden("Code d'accès incorrect.", "access_code_invalid");
  }

  await addMember(channel.id, userId);

  const access = await assertChannelAccess(channel, userId);

  return { access, grantedByCode: true };
}

async function addMember(channelId, userId) {
  await query(
    `INSERT INTO channel_members (channel_id, user_id) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE added_at = added_at`,
    [channelId, userId]
  );
}

async function removeMember(channelId, userId) {
  await query("DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?", [
    channelId,
    userId,
  ]);
}

async function listMembers(channelId) {
  const rows = await query(
    `SELECT u.id, u.name, u.email, u.avatar_url, u.status
     FROM channel_members cm
     INNER JOIN users u ON u.id = cm.user_id
     WHERE cm.channel_id = ?
     ORDER BY u.name ASC`,
    [channelId]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url || null,
    status: row.status || "offline",
  }));
}

// -----------------------------------------------------------------------------
// Compatibilité avec l'ancien protocole (salons + code d'accès)
// -----------------------------------------------------------------------------

/**
 * Salons historiques de la communauté technique, dans la forme attendue par
 * l'ancien événement `rooms-list`.
 */
async function listLegacyRooms() {
  const rows = await query(
    `SELECT * FROM channels
     WHERE community_id = ? AND archived_at IS NULL
     ORDER BY \`position\` ASC, id ASC`,
    [config.systemCommunityId]
  );

  return rows;
}

async function createLegacyRoom({ name, accessCode, creatorId }) {
  const communityId = 1;
  const slug = `room-${Date.now()}`;

  const result = await query(
    `INSERT INTO channels
       (community_id, name, description, type, is_private, \`position\`, access_code, creator_id)
     VALUES (?, ?, NULL, 'text', ?, ?, ?, ?)`,
    [
      communityId,
      name,
      accessCode ? 1 : 0,
      await nextPosition(communityId, null),
      accessCode,
      creatorId,
    ]
  );

  const created = await getById(result.insertId);

  // Le créateur rejoint immédiatement son salon : il n'a pas à ressaisir le code.
  if (created.access_code) {
    await addMember(created.id, creatorId);
  }

  return { channel: created, slug };
}

module.exports = {
  CHANNEL_TYPES,
  isChannelType,
  serializeChannel: (row, extra = {}) => channelDto(row, extra),
  getById,
  requireById,
  resolveByClientId,
  resolveAndAssert,
  listRaw,
  listForUser,
  create,
  update,
  remove,
  move,
  reorder,
  assertChannelAccess,
  hasExplicitAccess,
  unlock,
  addMember,
  removeMember,
  listMembers,
  listLegacyRooms,
  createLegacyRoom,
  nextPosition,
};
