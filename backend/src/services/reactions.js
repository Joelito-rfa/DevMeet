const { query, queryOne } = require("../db/pool");
const { badRequest, notFound } = require("../utils/errors");

/**
 * Réactions emoji sur les messages.
 *
 * L'emoji est validé contre une liste blanche : il est affiché tel quel chez
 * tous les participants, un texte libre deviendrait un vecteur d'injection.
 * Rejouer la même réaction n'est pas une erreur (contrainte UNIQUE en base) :
 * c'est simplement sans effet.
 */

const ALLOWED_EMOJIS = [
  "👍",
  "👎",
  "❤️",
  "😂",
  "😮",
  "😢",
  "🎉",
  "🔥",
  "🚀",
  "👀",
  "✅",
  "❌",
  "🙏",
  "💡",
];

function assertEmoji(emoji) {
  const value = typeof emoji === "string" ? emoji.trim() : "";

  if (!value) {
    throw badRequest("Aucune réaction fournie.", "emoji_required");
  }

  if (!ALLOWED_EMOJIS.includes(value)) {
    throw badRequest(
      "Cette réaction n'est pas autorisée.",
      "emoji_not_allowed"
    );
  }

  return value;
}

/** Le message doit exister dans CE salon : on ne réagit pas à travers les salons. */
async function assertMessageInChannel(messageId, channelId) {
  const row = await queryOne(
    "SELECT id, deleted_at FROM messages WHERE id = ? AND channel_id = ?",
    [String(messageId), channelId]
  );

  if (!row) {
    throw notFound("Message introuvable dans ce salon.", "message_not_found");
  }

  if (row.deleted_at) {
    throw badRequest("Ce message a été supprimé.", "message_deleted");
  }

  return row;
}

async function add({ channelId, messageId, userId, emoji }) {
  const value = assertEmoji(emoji);
  await assertMessageInChannel(messageId, channelId);

  // `INSERT IGNORE` : rejouer la même réaction ne casse rien.
  await query(
    `INSERT IGNORE INTO message_reactions (message_id, channel_id, user_id, emoji)
     VALUES (?, ?, ?, ?)`,
    [String(messageId), channelId, userId, value]
  );

  return { messageId: String(messageId), emoji: value, userId: Number(userId) };
}

async function remove({ channelId, messageId, userId, emoji }) {
  const value = assertEmoji(emoji);

  await query(
    `DELETE FROM message_reactions
     WHERE message_id = ? AND channel_id = ? AND user_id = ? AND emoji = ?`,
    [String(messageId), channelId, userId, value]
  );

  return { messageId: String(messageId), emoji: value, userId: Number(userId) };
}

/**
 * Réactions agrégées pour une série de messages.
 *
 * @returns {Map<string, Array<{emoji: string, count: number, users: number[]}>>}
 */
async function mapForMessages(messageIds) {
  const map = new Map();

  if (!messageIds || messageIds.length === 0) {
    return map;
  }

  const rows = await query(
    `SELECT message_id, emoji, user_id
     FROM message_reactions
     WHERE message_id IN (${messageIds.map(() => "?").join(",")})
     ORDER BY id ASC`,
    messageIds.map((id) => String(id))
  );

  for (const row of rows) {
    const key = String(row.message_id);
    const list = map.get(key) || [];
    let entry = list.find((item) => item.emoji === row.emoji);

    if (!entry) {
      entry = { emoji: row.emoji, count: 0, users: [] };
      list.push(entry);
    }

    entry.count += 1;
    entry.users.push(Number(row.user_id));
    map.set(key, list);
  }

  return map;
}

module.exports = { ALLOWED_EMOJIS, add, remove, mapForMessages };
