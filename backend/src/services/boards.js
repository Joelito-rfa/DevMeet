const { query, queryOne } = require("../db/pool");
const { conflict } = require("../utils/errors");
const { toIso } = require("../utils/serialize");

/**
 * État du tableau blanc, persistant par salon.
 *
 * `version` permet une gestion optimiste des modifications concurrentes :
 * un client peut annoncer la version sur laquelle il s'appuie. Si elle a
 * changé entre-temps, le serveur refuse l'écriture et renvoie l'état courant
 * afin que le client se resynchronise au lieu d'écraser le travail des autres.
 */
async function get(channelId) {
  const row = await queryOne(
    `SELECT b.*, u.name AS updated_by_name
     FROM board_states b
     LEFT JOIN users u ON u.id = b.updated_by
     WHERE b.channel_id = ?`,
    [channelId]
  );

  if (!row) {
    return {
      channelId: Number(channelId),
      data: null,
      version: 0,
      updatedAt: null,
      updatedBy: null,
    };
  }

  let data = row.data;

  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (error) {
      data = null;
    }
  }

  return {
    channelId: Number(channelId),
    data,
    version: Number(row.version),
    updatedAt: toIso(row.updated_at),
    updatedBy: row.updated_by
      ? { id: Number(row.updated_by), name: row.updated_by_name || "Utilisateur" }
      : null,
  };
}

async function save(channelId, data, userId, { expectedVersion = null } = {}) {
  const current = await get(channelId);

  if (expectedVersion !== null && Number(expectedVersion) !== current.version) {
    const error = conflict(
      "Le tableau a été modifié entre-temps.",
      "board_version_conflict"
    );
    error.currentState = current;
    throw error;
  }

  const serialized = data === null || data === undefined ? null : JSON.stringify(data);

  await query(
    `INSERT INTO board_states (channel_id, data, version, updated_by)
     VALUES (?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       data = VALUES(data),
       version = version + 1,
       updated_by = VALUES(updated_by)`,
    [channelId, serialized, userId]
  );

  return get(channelId);
}

async function clear(channelId, userId) {
  await query("DELETE FROM board_states WHERE channel_id = ?", [channelId]);
  return { channelId: Number(channelId), cleared: true, clearedBy: Number(userId) };
}

module.exports = { get, save, clear };
