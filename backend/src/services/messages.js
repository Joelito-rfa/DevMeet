const { query, queryOne, withTransaction, safeInt } = require("../db/pool");
const { notFound, forbidden } = require("../utils/errors");
const { messageDto, legacyMessageDto } = require("../utils/serialize");
const attachments = require("./attachments");
const reactions = require("./reactions");
const pins = require("./pins");
const mentions = require("./mentions");

const MESSAGE_SELECT = `
  SELECT m.*,
         u.name AS author_name,
         u.avatar_url AS author_avatar_url,
         u.status AS author_status
  FROM messages m
  LEFT JOIN users u ON u.id = m.author_id
`;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_SEARCH_LIMIT = 100;

/**
 * Historique paginé par curseur.
 *
 * `before` → messages plus anciens que cet id (remonter l'historique)
 * `after`  → messages plus récents que cet id (rattrapage après reconnexion)
 *
 * Les résultats sont toujours renvoyés dans l'ordre chronologique.
 */
async function list({ channelId, limit, before = null, after = null }) {
  const safeLimit = safeInt(limit, DEFAULT_LIMIT, { min: 1, max: MAX_LIMIT });

  const conditions = ["m.channel_id = ?"];
  const params = [channelId];

  if (before) {
    conditions.push("m.id < ?");
    params.push(String(before));
  }

  if (after) {
    conditions.push("m.id > ?");
    params.push(String(after));
  }

  const rows = await query(
    `${MESSAGE_SELECT}
     WHERE ${conditions.join(" AND ")}
     ORDER BY m.id DESC
     LIMIT ${safeLimit}`,
    params
  );

  const ordered = rows.slice().reverse();
  const extras = await extrasFor(ordered);

  return {
    messages: ordered.map((row) => messageDto(row, extras.get(String(row.id)))),
    hasMore: rows.length === safeLimit,
    oldestId: ordered.length > 0 ? String(ordered[0].id) : null,
    newestId: ordered.length > 0 ? String(ordered[ordered.length - 1].id) : null,
  };
}

/**
 * Variante « historique » attendue par l'interface existante.
 */
async function listLegacy(channelId, limit = MAX_LIMIT) {
  const safeLimit = safeInt(limit, MAX_LIMIT, { min: 1, max: MAX_LIMIT });

  const rows = await query(
    `${MESSAGE_SELECT}
     WHERE m.channel_id = ?
     ORDER BY m.id DESC
     LIMIT ${safeLimit}`,
    [channelId]
  );

  const ordered = rows.slice().reverse();
  const extras = await extrasFor(ordered);

  return ordered.map((row) => legacyMessageDto(row, extras.get(String(row.id))));
}

async function getById(messageId) {
  return queryOne(`${MESSAGE_SELECT} WHERE m.id = ?`, [String(messageId)]);
}

/**
 * Envoi d'un message.
 *
 * `communityId` sert uniquement à résoudre les mentions `@nom` : seuls des
 * membres réels de la communauté peuvent être mentionnés. Sans lui (appel
 * interne), aucune mention n'est enregistrée.
 */
async function create({
  channelId,
  authorId,
  content,
  replyToId = null,
  attachmentIds = null,
  communityId = null,
}) {
  if (replyToId) {
    const parent = await queryOne(
      "SELECT id FROM messages WHERE id = ? AND channel_id = ?",
      [String(replyToId), channelId]
    );

    if (!parent) {
      throw notFound("Le message cité est introuvable dans ce salon.");
    }
  }

  const result = await query(
    `INSERT INTO messages (channel_id, author_id, content, reply_to_id)
     VALUES (?, ?, ?, ?)`,
    [channelId, authorId, content, replyToId ? String(replyToId) : null]
  );

  // Les pièces jointes sont rattachées au message dans le même mouvement :
  // seul l'auteur qui les a déposées dans CE salon peut les rattacher.
  const files = await attachments.linkToMessage({
    channelId,
    messageId: result.insertId,
    attachmentIds,
    uploaderId: authorId,
  });

  const resolvedMentions = await mentions.resolve(communityId, content);

  await mentions.saveForMessage({
    messageId: result.insertId,
    channelId,
    mentions: resolvedMentions,
  });

  const row = await getById(result.insertId);
  const extras = await extrasFor([row]);

  return messageDto(row, {
    ...(extras.get(String(row.id)) || {}),
    // L'auteur a évidemment lu son propre message.
    readBy: [Number(authorId)],
    attachments: files,
  });
}

/**
 * Recherche plein texte simple (`LIKE`) dans un ou plusieurs salons.
 *
 * Les caractères `%` et `_` saisis par l'utilisateur sont neutralisés : ils ne
 * doivent pas se comporter comme des jokers. Aucun index FULLTEXT n'est utilisé
 * (voir les limites connues du README).
 */
async function search({ channelIds, term, limit = 25, before = null }) {
  const ids = (channelIds || []).map((id) => Number(id));

  if (ids.length === 0) {
    return { messages: [], hasMore: false, term: String(term || "") };
  }

  const safeLimit = safeInt(limit, 25, { min: 1, max: MAX_SEARCH_LIMIT });
  const needle = `%${String(term).replace(/[!%_]/g, (char) => `!${char}`)}%`;

  const conditions = [
    `m.channel_id IN (${ids.map(() => "?").join(",")})`,
    "m.deleted_at IS NULL",
    "m.content LIKE ? ESCAPE '!'",
  ];

  const params = [...ids, needle];

  if (before) {
    conditions.push("m.id < ?");
    params.push(String(before));
  }

  const rows = await query(
    `${MESSAGE_SELECT}
     WHERE ${conditions.join(" AND ")}
     ORDER BY m.id DESC
     LIMIT ${safeLimit}`,
    params
  );

  const ordered = rows.slice().reverse();
  const extras = await extrasFor(ordered);

  return {
    messages: ordered.map((row) => messageDto(row, extras.get(String(row.id)))),
    hasMore: rows.length === safeLimit,
    term: String(term),
  };
}

/** Messages épinglés d'un salon, du plus ancien au plus récent. */
async function listPinned(channelId, { limit = 50 } = {}) {
  const rows = await query(
    `${MESSAGE_SELECT}
     INNER JOIN message_pins p ON p.message_id = m.id
     WHERE m.channel_id = ? AND m.deleted_at IS NULL
     ORDER BY p.created_at DESC
     LIMIT ${safeInt(limit, 50, { min: 1, max: MAX_LIMIT })}`,
    [channelId]
  );

  const ordered = rows.slice().reverse();
  const extras = await extrasFor(ordered);

  return ordered.map((row) => messageDto(row, extras.get(String(row.id))));
}

/** Réponses d'un fil de discussion, du plus ancien au plus récent. */
async function listReplies({ channelId, messageId, limit = MAX_LIMIT }) {
  const parent = await queryOne(
    "SELECT id FROM messages WHERE id = ? AND channel_id = ?",
    [String(messageId), channelId]
  );

  if (!parent) {
    throw notFound("Message introuvable dans ce salon.", "message_not_found");
  }

  const rows = await query(
    `${MESSAGE_SELECT}
     WHERE m.channel_id = ? AND m.reply_to_id = ?
     ORDER BY m.id ASC
     LIMIT ${safeInt(limit, MAX_LIMIT, { min: 1, max: MAX_LIMIT })}`,
    [channelId, String(messageId)]
  );

  const extras = await extrasFor(rows);

  return rows.map((row) => messageDto(row, extras.get(String(row.id))));
}

/** Lecture des accusés de lecture pour une série de messages. */
async function readsFor(messageIds) {
  const map = new Map();

  if (!messageIds || messageIds.length === 0) {
    return map;
  }

  const rows = await query(
    `SELECT message_id, user_id FROM message_reads
     WHERE message_id IN (${messageIds.map(() => "?").join(",")})`,
    messageIds.map((id) => String(id))
  );

  for (const row of rows) {
    const key = String(row.message_id);
    const list = map.get(key) || [];
    list.push(Number(row.user_id));
    map.set(key, list);
  }

  return map;
}

/** Nombre de réponses et date de la dernière réponse, par message parent. */
async function replyStatsFor(messageIds) {
  const map = new Map();

  if (!messageIds || messageIds.length === 0) {
    return map;
  }

  const rows = await query(
    `SELECT reply_to_id, COUNT(*) AS total, MAX(created_at) AS last_at
     FROM messages
     WHERE reply_to_id IN (${messageIds.map(() => "?").join(",")})
       AND deleted_at IS NULL
     GROUP BY reply_to_id`,
    messageIds.map((id) => String(id))
  );

  for (const row of rows) {
    map.set(String(row.reply_to_id), {
      count: Number(row.total),
      lastReplyAt: row.last_at ? new Date(row.last_at).toISOString() : null,
    });
  }

  return map;
}

/**
 * Données annexes d'une page de messages : accusés de lecture, pièces jointes,
 * réactions, épinglage, mentions et compteurs de réponses.
 *
 * Tout est chargé en six requêtes groupées au maximum, jamais une par message.
 *
 * @returns {Map<string, object>}
 */
async function extrasFor(rows) {
  const map = new Map();

  if (!rows || rows.length === 0) {
    return map;
  }

  const ids = rows.map((row) => row.id);

  const [reads, files, reactionMap, pinMap, mentionMap, replyStats] =
    await Promise.all([
      readsFor(ids),
      attachments.mapForMessages(ids),
      reactions.mapForMessages(ids),
      pins.mapForMessages(ids),
      mentions.mapForMessages(ids),
      replyStatsFor(ids),
    ]);

  for (const row of rows) {
    const key = String(row.id);

    map.set(key, {
      readBy: reads.get(key) || [],
      // Un message supprimé ne réexpose jamais son fichier : les métadonnées
      // restent en base, mais elles ne sont plus servies au client.
      attachments: row.deleted_at ? [] : files.get(key) || [],
      reactions: reactionMap.get(key) || [],
      pinned: pinMap.has(key),
      pinnedBy: pinMap.get(key)?.pinnedBy ?? null,
      pinnedAt: pinMap.get(key)?.pinnedAt ?? null,
      replyCount: replyStats.get(key)?.count || 0,
      lastReplyAt: replyStats.get(key)?.lastReplyAt || null,
      mentions: mentionMap.get(key) || [],
    });
  }

  return map;
}

/**
 * Marque un message (et tout ce qui précède dans le salon) comme lu par
 * l'utilisateur, puis met à jour l'état de lecture du salon.
 */
async function markRead({ channelId, userId, messageId }) {
  const message = await queryOne(
    "SELECT id FROM messages WHERE id = ? AND channel_id = ?",
    [String(messageId), channelId]
  );

  if (!message) {
    throw notFound("Message introuvable dans ce salon.");
  }

  const result = await withTransaction(async (connection) => {
    const [insertResult] = await connection.execute(
      `INSERT INTO message_reads (message_id, user_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE read_at = read_at`,
      [String(messageId), userId]
    );

    const [stateResult] = await connection.execute(
      `INSERT INTO channel_read_states (channel_id, user_id, last_read_message_id, unread_count)
       VALUES (?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), VALUES(last_read_message_id)),
         unread_count = 0`,
      [channelId, userId, String(messageId)]
    );

    return {
      inserted: insertResult.affectedRows > 0,
      stateUpdated: stateResult.affectedRows > 0,
    };
  });

  return {
    messageId: String(messageId),
    channelId: Number(channelId),
    readerId: Number(userId),
    ...result,
  };
}

/** Nombre de messages non lus par salon, pour un utilisateur et une communauté. */
async function unreadByChannel(communityId, userId) {
  const rows = await query(
    `SELECT ch.id AS channel_id,
            (SELECT COUNT(*) FROM messages m
              WHERE m.channel_id = ch.id
                AND m.deleted_at IS NULL
                AND m.id > COALESCE(crs.last_read_message_id, 0)
                AND (m.author_id IS NULL OR m.author_id <> ?)) AS unread
     FROM channels ch
     LEFT JOIN channel_read_states crs
       ON crs.channel_id = ch.id AND crs.user_id = ?
     WHERE ch.community_id = ? AND ch.archived_at IS NULL`,
    [userId, userId, communityId]
  );

  const map = new Map();

  for (const row of rows) {
    map.set(Number(row.channel_id), Number(row.unread));
  }

  return map;
}

async function totalUnread(userId) {
  const row = await queryOne(
    `SELECT COUNT(*) AS total
     FROM messages m
     INNER JOIN channels ch ON ch.id = m.channel_id
     LEFT JOIN channel_read_states crs
       ON crs.channel_id = ch.id AND crs.user_id = ?
     WHERE m.deleted_at IS NULL
       AND m.id > COALESCE(crs.last_read_message_id, 0)
       AND (m.author_id IS NULL OR m.author_id <> ?)`,
    [userId, userId]
  );

  return row ? Number(row.total) : 0;
}

/** Suppression logique : le contenu est retiré, la ligne reste pour le contexte. */
async function remove(messageId, { actorId, canModerate }) {
  const row = await queryOne("SELECT * FROM messages WHERE id = ?", [String(messageId)]);

  if (!row) {
    throw notFound("Message introuvable.");
  }

  if (!canModerate && Number(row.author_id) !== Number(actorId)) {
    throw forbidden("Vous ne pouvez supprimer que vos propres messages.", "not_author");
  }

  await query(
    "UPDATE messages SET deleted_at = CURRENT_TIMESTAMP(3), content = '' WHERE id = ?",
    [String(messageId)]
  );

  return { deletedId: String(messageId), channelId: Number(row.channel_id) };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MESSAGE_SELECT,
  list,
  listLegacy,
  getById,
  create,
  search,
  listPinned,
  listReplies,
  extrasFor,
  readsFor,
  replyStatsFor,
  markRead,
  unreadByChannel,
  totalUnread,
  remove,
};
