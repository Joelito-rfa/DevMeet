const { query } = require("../db/pool");
const { parseMentions } = require("../utils/mentions");

/**
 * Mentions résolues côté serveur.
 *
 * Le client n'envoie jamais la liste des personnes mentionnées : le serveur
 * relit le texte, cherche les noms de membres **réels** de la communauté et
 * n'enregistre que ceux-là. « @inconnu » reste donc du texte, et personne ne
 * peut fabriquer une notification envers quelqu'un qui n'est pas dans la
 * communauté.
 */

async function membersOf(communityId) {
  const rows = await query(
    `SELECT u.id, u.name
     FROM community_members cm
     INNER JOIN users u ON u.id = cm.user_id
     WHERE cm.community_id = ?`,
    [communityId]
  );

  return rows.map((row) => ({ id: Number(row.id), name: row.name }));
}

/** Mentions contenues dans un texte, exprimées en membres réels. */
async function resolve(communityId, content) {
  if (!communityId) {
    return [];
  }

  const text = String(content || "");

  if (!text.includes("@")) {
    return [];
  }

  return parseMentions(text, await membersOf(communityId));
}

/**
 * Enregistre les mentions d'un message (idempotent : la clé primaire est le
 * couple message/utilisateur).
 */
async function saveForMessage({ messageId, channelId, mentions }) {
  if (!mentions || mentions.length === 0) {
    return 0;
  }

  for (const mention of mentions) {
    await query(
      `INSERT INTO message_mentions (message_id, user_id, channel_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE channel_id = VALUES(channel_id)`,
      [String(messageId), mention.id, channelId]
    );
  }

  return mentions.length;
}

/** @returns {Map<string, number[]>} identifiants de comptes mentionnés par message. */
async function mapForMessages(messageIds) {
  const map = new Map();

  if (!messageIds || messageIds.length === 0) {
    return map;
  }

  const rows = await query(
    `SELECT message_id, user_id FROM message_mentions
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

module.exports = { membersOf, resolve, saveForMessage, mapForMessages };
