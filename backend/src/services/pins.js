const { query, queryOne } = require("../db/pool");
const { notFound, badRequest } = require("../utils/errors");

/**
 * Épinglage de messages.
 *
 * Un message est épinglé ou non (clé primaire = identifiant du message) : il ne
 * peut donc pas y avoir de doublon, et `INSERT ... ON DUPLICATE KEY UPDATE`
 * rend l'opération idempotente (épingler deux fois n'est pas une erreur).
 *
 * Ce module ne construit PAS les messages exposés à l'API : c'est le rôle de
 * `services/messages.js`, seul propriétaire de la requête `MESSAGE_SELECT`.
 * Cela évite une dépendance circulaire entre les deux fichiers.
 */

async function assertMessageInChannel(messageId, channelId) {
  const row = await queryOne(
    "SELECT id, deleted_at FROM messages WHERE id = ? AND channel_id = ?",
    [String(messageId), channelId]
  );

  if (!row) {
    throw notFound("Message introuvable dans ce salon.", "message_not_found");
  }

  if (row.deleted_at) {
    throw badRequest(
      "Un message supprimé ne peut pas être épinglé.",
      "message_deleted"
    );
  }

  return row;
}

async function pin({ channelId, messageId, userId }) {
  await assertMessageInChannel(messageId, channelId);

  await query(
    `INSERT INTO message_pins (message_id, channel_id, pinned_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE pinned_by = VALUES(pinned_by)`,
    [String(messageId), channelId, userId]
  );

  return {
    messageId: String(messageId),
    channelId: Number(channelId),
    pinnedBy: Number(userId),
  };
}

async function unpin({ channelId, messageId }) {
  const result = await query(
    "DELETE FROM message_pins WHERE message_id = ? AND channel_id = ?",
    [String(messageId), channelId]
  );

  return {
    messageId: String(messageId),
    channelId: Number(channelId),
    removed: result.affectedRows > 0,
  };
}

/**
 * État d'épinglage d'une série de messages.
 * @returns {Map<string, {pinnedBy: number|null, pinnedAt: string|null}>}
 */
async function mapForMessages(messageIds) {
  const map = new Map();

  if (!messageIds || messageIds.length === 0) {
    return map;
  }

  const rows = await query(
    `SELECT message_id, pinned_by, created_at FROM message_pins
     WHERE message_id IN (${messageIds.map(() => "?").join(",")})`,
    messageIds.map((id) => String(id))
  );

  for (const row of rows) {
    map.set(String(row.message_id), {
      pinnedBy: row.pinned_by === null ? null : Number(row.pinned_by),
      pinnedAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    });
  }

  return map;
}

module.exports = { pin, unpin, mapForMessages };
