const { query, queryOne } = require("../db/pool");
const { attachmentDto } = require("../utils/serialize");

/**
 * Pièces jointes : les octets vivent sur le disque (`config.uploads.dir`), les
 * métadonnées en base. `storage_key` est un nom aléatoire impossible à deviner.
 */

async function create({
  channelId,
  uploaderId,
  fileName,
  storageKey,
  mimeType,
  size,
}) {
  const result = await query(
    `INSERT INTO attachments
       (channel_id, message_id, uploader_id, file_name, storage_key, mime_type, size)
     VALUES (?, NULL, ?, ?, ?, ?, ?)`,
    [channelId, uploaderId, fileName, storageKey, mimeType, size]
  );

  return getById(result.insertId);
}

async function getById(id) {
  const row = await queryOne("SELECT * FROM attachments WHERE id = ?", [id]);
  return attachmentDto(row);
}

async function getRawById(id) {
  return queryOne("SELECT * FROM attachments WHERE id = ?", [id]);
}

/**
 * Rattache des pièces jointes à un message.
 *
 * Trois garde-fous : la pièce jointe doit appartenir au même salon, avoir été
 * déposée par l'auteur du message, et ne pas être déjà rattachée. Un
 * identifiant fourni par le client ne peut donc pas détourner le fichier d'un
 * autre utilisateur.
 */
async function linkToMessage({ channelId, messageId, attachmentIds, uploaderId }) {
  if (!Array.isArray(attachmentIds) || attachmentIds.length === 0) {
    return [];
  }

  const ids = attachmentIds
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => "?").join(", ");

  await query(
    `UPDATE attachments
        SET message_id = ?
      WHERE id IN (${placeholders})
        AND channel_id = ?
        AND uploader_id = ?
        AND message_id IS NULL`,
    [String(messageId), ...ids, channelId, uploaderId]
  );

  return listForMessage(messageId);
}

async function listForMessage(messageId) {
  const rows = await query(
    "SELECT * FROM attachments WHERE message_id = ? ORDER BY id ASC",
    [String(messageId)]
  );

  return rows.map(attachmentDto);
}

/**
 * Pièces jointes de plusieurs messages, regroupées par identifiant de message.
 * Une seule requête : on évite le N+1 sur l'historique d'un salon.
 */
async function mapForMessages(messageIds) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return new Map();
  }

  const placeholders = messageIds.map(() => "?").join(", ");

  const rows = await query(
    `SELECT * FROM attachments
      WHERE message_id IN (${placeholders})
      ORDER BY id ASC`,
    messageIds.map((id) => String(id))
  );

  const grouped = new Map();

  for (const row of rows) {
    const key = String(row.message_id);
    const list = grouped.get(key) || [];
    list.push(attachmentDto(row));
    grouped.set(key, list);
  }

  return grouped;
}

module.exports = {
  create,
  getById,
  getRawById,
  linkToMessage,
  listForMessage,
  mapForMessages,
};
