const { query, queryOne, withTransaction, safeInt } = require("../db/pool");
const { badRequest, notFound, forbidden } = require("../utils/errors");
const { dmMessageDto, dmConversationDto } = require("../utils/serialize");

/**
 * Messagerie privée entre deux comptes.
 *
 * Trois règles structurent ce service :
 *   1. une conversation n'existe qu'une fois par paire de comptes — la paire est
 *      ordonnée pour respecter la clé unique `uq_dm_pair`, si bien que A→B et
 *      B→A désignent la même ligne ;
 *   2. seul un participant peut lire, écrire ou supprimer ; un tiers reçoit le
 *      même `404` qu'une conversation inexistante (on ne divulgue pas son
 *      existence) ;
 *   3. la suppression est logique : la ligne reste, le contenu disparaît.
 *
 * Aucune modération extérieure n'est possible : un message privé ne relève
 * d'aucune communauté, donc même un propriétaire de communauté ne peut pas
 * supprimer le message d'un autre dans une conversation où il n'est pas auteur.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const MESSAGE_SELECT = `
  SELECT m.*,
         u.name AS author_name,
         u.avatar_url AS author_avatar_url,
         u.status AS author_status
    FROM dm_messages m
    LEFT JOIN users u ON u.id = m.author_id
`;

const CONVERSATION_SELECT = `
  SELECT c.*,
         ua.name AS a_name,
         ua.avatar_url AS a_avatar_url,
         ua.status AS a_status,
         ub.name AS b_name,
         ub.avatar_url AS b_avatar_url,
         ub.status AS b_status,
         m.content AS last_content,
         m.created_at AS last_created_at,
         m.author_id AS last_author_id,
         m.deleted_at AS last_deleted_at
    FROM dm_conversations c
    JOIN users ua ON ua.id = c.user_a_id
    JOIN users ub ON ub.id = c.user_b_id
    LEFT JOIN dm_messages m ON m.id = c.last_message_id
`;

/** Ordonne la paire : `user_a_id` est toujours le plus petit identifiant. */
function orderPair(first, second) {
  const a = Number(first);
  const b = Number(second);

  return a < b ? [a, b] : [b, a];
}

function participantsOf(conversation) {
  return [Number(conversation.user_a_id), Number(conversation.user_b_id)];
}

function isParticipant(conversation, userId) {
  return participantsOf(conversation).includes(Number(userId));
}

/** L'autre participant, vu depuis un compte donné. */
function otherParticipant(conversation, userId) {
  return participantsOf(conversation).find(
    (id) => id !== Number(userId)
  );
}

async function getRawById(conversationId) {
  return queryOne("SELECT * FROM dm_conversations WHERE id = ?", [
    Number(conversationId),
  ]);
}

/**
 * Vérifie l'accès à une conversation.
 *
 * Un compte qui n'est pas participant reçoit exactement la même réponse qu'une
 * conversation inexistante : impossible de sonder l'existence d'une discussion
 * privée entre deux autres personnes.
 */
async function assertAccess(conversationId, userId) {
  const conversation = await getRawById(conversationId);

  if (!conversation || !isParticipant(conversation, userId)) {
    throw notFound("Conversation introuvable.", "conversation_not_found");
  }

  return conversation;
}

/** Ouvre la conversation avec un compte, ou la retrouve si elle existe déjà. */
async function getOrCreate(actorId, otherId) {
  const target = Number(otherId);

  if (!Number.isFinite(target) || target <= 0) {
    throw badRequest("Compte visé invalide.", "invalid_user");
  }

  if (target === Number(actorId)) {
    throw badRequest(
      "Impossible d'ouvrir une conversation privée avec son propre compte.",
      "self_conversation"
    );
  }

  const exists = await queryOne("SELECT id FROM users WHERE id = ?", [target]);

  if (!exists) {
    throw notFound("Compte introuvable.", "user_not_found");
  }

  const [userA, userB] = orderPair(actorId, target);

  const existing = await queryOne(
    "SELECT * FROM dm_conversations WHERE user_a_id = ? AND user_b_id = ?",
    [userA, userB]
  );

  if (existing) {
    return { conversation: existing, created: false };
  }

  try {
    const result = await query(
      "INSERT INTO dm_conversations (user_a_id, user_b_id) VALUES (?, ?)",
      [userA, userB]
    );

    return { conversation: await getRawById(result.insertId), created: true };
  } catch (error) {
    // Deux créations simultanées : la clé unique départage, on relit la gagnante
    // au lieu de renvoyer une erreur à l'utilisateur.
    if (error && error.code === "ER_DUP_ENTRY") {
      const raced = await queryOne(
        "SELECT * FROM dm_conversations WHERE user_a_id = ? AND user_b_id = ?",
        [userA, userB]
      );

      if (raced) {
        return { conversation: raced, created: false };
      }
    }

    throw error;
  }
}

/** Positions de lecture de TOUS les participants, indexées par `id:compte`. */
async function readStatesFor(conversationIds) {
  const map = new Map();

  if (!conversationIds || conversationIds.length === 0) {
    return map;
  }

  const rows = await query(
    `SELECT conversation_id, user_id, last_read_message_id
       FROM dm_read_states
      WHERE conversation_id IN (${conversationIds.map(() => "?").join(",")})`,
    [...conversationIds]
  );

  for (const row of rows) {
    map.set(
      `${Number(row.conversation_id)}:${Number(row.user_id)}`,
      row.last_read_message_id
    );
  }

  return map;
}

/** Messages non lus par conversation (jamais ses propres messages). */
async function unreadCounts(userId, conversationIds) {
  const map = new Map();

  if (!conversationIds || conversationIds.length === 0) {
    return map;
  }

  const rows = await query(
    `SELECT m.conversation_id, COUNT(*) AS unread
       FROM dm_messages m
       LEFT JOIN dm_read_states rs
         ON rs.conversation_id = m.conversation_id AND rs.user_id = ?
      WHERE m.conversation_id IN (${conversationIds.map(() => "?").join(",")})
        AND m.deleted_at IS NULL
        AND m.id > COALESCE(rs.last_read_message_id, 0)
        AND (m.author_id IS NULL OR m.author_id <> ?)
      GROUP BY m.conversation_id`,
    [userId, ...conversationIds, userId]
  );

  for (const row of rows) {
    map.set(Number(row.conversation_id), Number(row.unread));
  }

  return map;
}

/** Positions de lecture mises en forme pour une conversation donnée. */
function readExtras(reads, conversationId, viewerId, partnerId) {
  const mine = reads.get(`${conversationId}:${Number(viewerId)}`);
  const theirs = partnerId
    ? reads.get(`${conversationId}:${Number(partnerId)}`)
    : undefined;

  return {
    lastReadMessageId: mine === undefined ? null : mine,
    partnerLastReadMessageId: theirs === undefined ? null : theirs,
  };
}

/** Une conversation, mise en forme pour un participant donné. */
async function viewFor(conversationId, viewerId) {
  const row = await queryOne(`${CONVERSATION_SELECT} WHERE c.id = ?`, [
    Number(conversationId),
  ]);

  if (!row) {
    return null;
  }

  const id = Number(row.id);
  const unread = await unreadCounts(viewerId, [id]);
  const reads = await readStatesFor([id]);

  return dmConversationDto(row, {
    viewerId,
    unreadCount: unread.get(id) || 0,
    ...readExtras(reads, id, viewerId, otherParticipant(row, viewerId)),
  });
}

/** Conversations d'un compte, la plus récemment active en tête. */
async function listForUser(userId) {
  const rows = await query(
    `${CONVERSATION_SELECT}
      WHERE c.user_a_id = ? OR c.user_b_id = ?
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT 200`,
    [userId, userId]
  );

  const ids = rows.map((row) => Number(row.id));
  const unread = await unreadCounts(userId, ids);
  const reads = await readStatesFor(ids);

  return rows.map((row) => {
    const id = Number(row.id);

    return dmConversationDto(row, {
      viewerId: userId,
      unreadCount: unread.get(id) || 0,
      ...readExtras(reads, id, userId, otherParticipant(row, userId)),
    });
  });
}

/** Total des messages privés non lus (badge de navigation). */
async function totalUnread(userId) {
  const row = await queryOne(
    `SELECT COUNT(*) AS total
       FROM dm_messages m
       INNER JOIN dm_conversations c ON c.id = m.conversation_id
       LEFT JOIN dm_read_states rs
         ON rs.conversation_id = m.conversation_id AND rs.user_id = ?
      WHERE (c.user_a_id = ? OR c.user_b_id = ?)
        AND m.deleted_at IS NULL
        AND m.id > COALESCE(rs.last_read_message_id, 0)
        AND (m.author_id IS NULL OR m.author_id <> ?)`,
    [userId, userId, userId, userId]
  );

  return row ? Number(row.total) : 0;
}

async function getMessageById(messageId) {
  return queryOne(`${MESSAGE_SELECT} WHERE m.id = ?`, [String(messageId)]);
}

/** Historique d'une conversation, paginé par curseur. */
async function listMessages(conversationId, { limit, before = null } = {}) {
  const safeLimit = safeInt(limit, DEFAULT_LIMIT, { min: 1, max: MAX_LIMIT });
  const conditions = ["m.conversation_id = ?"];
  const params = [Number(conversationId)];

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

  return {
    messages: ordered.map((row) => dmMessageDto(row)),
    hasMore: rows.length === safeLimit,
    oldestId: ordered.length > 0 ? String(ordered[0].id) : null,
    newestId: ordered.length > 0 ? String(ordered[ordered.length - 1].id) : null,
  };
}

/**
 * Écrit un message et met à jour le pointeur de la conversation dans la même
 * transaction : le dernier message affiché dans la liste ne peut pas être
 * incohérent avec l'historique.
 */
async function createMessage({ conversationId, authorId, content }) {
  const messageId = await withTransaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO dm_messages (conversation_id, author_id, content)
       VALUES (?, ?, ?)`,
      [Number(conversationId), Number(authorId), content]
    );

    await connection.execute(
      `UPDATE dm_conversations
          SET last_message_id = ?, updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
      [result.insertId, Number(conversationId)]
    );

    return result.insertId;
  });

  return dmMessageDto(await getMessageById(messageId));
}

/**
 * Suppression logique, réservée à l'auteur du message.
 *
 * Aucune permission de modération n'intervient ici : un message privé ne relève
 * d'aucune communauté.
 */
async function removeMessage({ conversationId, messageId, actorId }) {
  const row = await queryOne(
    "SELECT * FROM dm_messages WHERE id = ? AND conversation_id = ?",
    [String(messageId), Number(conversationId)]
  );

  if (!row) {
    throw notFound("Message introuvable.", "message_not_found");
  }

  if (row.author_id === null || Number(row.author_id) !== Number(actorId)) {
    throw forbidden(
      "Vous ne pouvez supprimer que vos propres messages.",
      "not_author"
    );
  }

  await query(
    `UPDATE dm_messages
        SET deleted_at = CURRENT_TIMESTAMP(3), content = ''
      WHERE id = ?`,
    [String(messageId)]
  );

  return {
    deletedId: String(messageId),
    conversationId: Number(row.conversation_id),
  };
}

/**
 * Marque comme lu jusqu'à un message donné (le dernier visible si absent).
 * Le pointeur ne recule jamais.
 */
async function markRead({ conversationId, userId, messageId = null }) {
  let target = messageId;

  if (!target) {
    const row = await getRawById(conversationId);
    target = row && row.last_message_id ? row.last_message_id : null;
  }

  if (!target) {
    return { conversationId: Number(conversationId), skipped: true };
  }

  await query(
    `INSERT INTO dm_read_states (conversation_id, user_id, last_read_message_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), VALUES(last_read_message_id))`,
    [Number(conversationId), Number(userId), String(target)]
  );

  return {
    conversationId: Number(conversationId),
    userId: Number(userId),
    messageId: String(target),
  };
}

/**
 * Comptes avec qui ouvrir une conversation : ceux qui partagent au moins une
 * communauté avec l'appelant.
 *
 * Aucun annuaire global n'est exposé : on ne peut pas énumérer les comptes de
 * la plateforme. En pratique, chaque compte est membre de la communauté
 * technique, donc la liste reste utile.
 */
async function listCandidates(userId, { search = null, limit = 30 } = {}) {
  const safeLimit = safeInt(limit, 30, { min: 1, max: 50 });
  const params = [Number(userId), Number(userId)];
  let filter = "";

  if (search) {
    filter = "AND u.name LIKE ? ESCAPE '!'";
    params.push(
      `%${String(search).replace(/[!%_]/g, (char) => `!${char}`)}%`
    );
  }

  const rows = await query(
    `SELECT DISTINCT u.id, u.name, u.avatar_url, u.status
       FROM users u
       JOIN community_members others ON others.user_id = u.id
      WHERE u.id <> ?
        AND others.community_id IN (
              SELECT community_id FROM community_members WHERE user_id = ?
            )
        ${filter}
      ORDER BY u.name ASC
      LIMIT ${safeLimit}`,
    params
  );

  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    avatarUrl: row.avatar_url || null,
    status: row.status || "offline",
  }));
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  orderPair,
  participantsOf,
  isParticipant,
  otherParticipant,
  getRawById,
  assertAccess,
  getOrCreate,
  viewFor,
  listForUser,
  totalUnread,
  listCandidates,
  listMessages,
  createMessage,
  removeMessage,
  markRead,
};
