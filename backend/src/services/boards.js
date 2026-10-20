const { query, queryOne } = require("../db/pool");
const { conflict, notFound } = require("../utils/errors");
const { toIso } = require("../utils/serialize");

/**
 * État du tableau blanc, persistant par salon.
 *
 * `version` permet une gestion optimiste des modifications concurrentes :
 * un client peut annoncer la version sur laquelle il s'appuie. Si elle a
 * changé entre-temps, le serveur refuse l'écriture et renvoie l'état courant
 * afin que le client se resynchronise au lieu d'écraser le travail des autres.
 *
 * `board_states` ne garde que l'état courant. `board_versions` conserve des
 * instantanés de l'état *précédent* chaque écriture (au plus un toutes les
 * deux minutes) : l'historique reste léger malgré les sauvegardes fréquentes,
 * et la restauration force toujours un instantané pour rester réversible.
 */

/** Nombre maximal de versions conservées par salon. */
const MAX_VERSIONS = 40;

/** Intervalle minimal entre deux instantanés automatiques, en secondes. */
const SNAPSHOT_INTERVAL_SECONDS = 120;

function parseDataColumn(data) {
  if (typeof data !== "string") {
    return data ?? null;
  }

  try {
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

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

  return {
    channelId: Number(channelId),
    data: parseDataColumn(row.data),
    version: Number(row.version),
    updatedAt: toIso(row.updated_at),
    updatedBy: row.updated_by
      ? { id: Number(row.updated_by), name: row.updated_by_name || "Utilisateur" }
      : null,
  };
}

/**
 * Secondes écoulées depuis le dernier instantané, ou `null` s'il n'y en a
 * aucun. Le calcul est fait par MySQL pour éviter tout décalage de fuseau.
 */
async function secondsSinceLastSnapshot(channelId) {
  const row = await queryOne(
    `SELECT TIMESTAMPDIFF(SECOND, MAX(created_at), CURRENT_TIMESTAMP(3)) AS seconds
     FROM board_versions
     WHERE channel_id = ?`,
    [channelId]
  );

  if (!row || row.seconds === null) {
    return null;
  }

  return Number(row.seconds);
}

/** Ne garde que les `MAX_VERSIONS` instantanés les plus récents. */
async function purgeOldVersions(channelId) {
  await query(
    `DELETE FROM board_versions
      WHERE channel_id = ?
        AND id NOT IN (
          SELECT id FROM (
            SELECT id
              FROM board_versions
             WHERE channel_id = ?
             ORDER BY created_at DESC, id DESC
             LIMIT ${MAX_VERSIONS}
          ) AS keep_rows
        )`,
    [channelId, channelId]
  );
}

/**
 * Enregistre l'état `state` dans l'historique.
 *
 * Sans `force`, l'instantané est ignoré si le précédent date de moins de
 * `SNAPSHOT_INTERVAL_SECONDS` secondes : c'est ce qui évite une ligne par
 * trait de crayon. Renvoie `true` si une ligne a été créée.
 */
async function snapshot(channelId, state, userId, { force = false } = {}) {
  if (!state || state.data === null || state.data === undefined || state.version <= 0) {
    return false;
  }

  if (!force) {
    const elapsed = await secondsSinceLastSnapshot(channelId);

    if (elapsed !== null && elapsed < SNAPSHOT_INTERVAL_SECONDS) {
      return false;
    }
  }

  await query(
    `INSERT INTO board_versions (channel_id, data, version, created_by)
     VALUES (?, ?, ?, ?)`,
    [channelId, JSON.stringify(state.data), state.version, userId ?? null]
  );

  await purgeOldVersions(channelId);
  return true;
}

async function save(
  channelId,
  data,
  userId,
  { expectedVersion = null, history = true } = {}
) {
  const current = await get(channelId);

  if (expectedVersion !== null && Number(expectedVersion) !== current.version) {
    const error = conflict(
      "Le tableau a été modifié entre-temps.",
      "board_version_conflict"
    );
    error.currentState = current;
    throw error;
  }

  if (history) {
    try {
      await snapshot(channelId, current, userId);
    } catch (error) {
      // Un incident sur l'historique ne doit jamais empêcher d'enregistrer le
      // travail en cours : l'état courant reste la source de vérité.
    }
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

/**
 * Liste des versions, de la plus récente à la plus ancienne. `data` est
 * volontairement absent : la liste ne doit pas transporter plusieurs
 * mégaoctets de dessin.
 */
async function listVersions(channelId, { limit = MAX_VERSIONS } = {}) {
  const bounded = Math.min(
    Math.max(Number.parseInt(limit, 10) || MAX_VERSIONS, 1),
    MAX_VERSIONS
  );

  const rows = await query(
    `SELECT v.id, v.version, v.created_at, v.created_by,
            u.name AS created_by_name
       FROM board_versions v
       LEFT JOIN users u ON u.id = v.created_by
      WHERE v.channel_id = ?
      ORDER BY v.created_at DESC, v.id DESC
      LIMIT ${bounded}`,
    [channelId]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    version: Number(row.version),
    createdAt: toIso(row.created_at),
    createdBy: row.created_by
      ? {
          id: Number(row.created_by),
          name: row.created_by_name || "Utilisateur",
        }
      : null,
  }));
}

/** Détail complet (avec le dessin) d'une version précise. */
async function getVersion(channelId, versionId) {
  const row = await queryOne(
    `SELECT v.*, u.name AS created_by_name
       FROM board_versions v
       LEFT JOIN users u ON u.id = v.created_by
      WHERE v.channel_id = ? AND v.id = ?`,
    [channelId, versionId]
  );

  if (!row) {
    throw notFound("Version du tableau introuvable.", "board_version_not_found");
  }

  return {
    id: Number(row.id),
    version: Number(row.version),
    createdAt: toIso(row.created_at),
    createdBy: row.created_by
      ? {
          id: Number(row.created_by),
          name: row.created_by_name || "Utilisateur",
        }
      : null,
    data: parseDataColumn(row.data),
  };
}

/**
 * Restaure une version : l'état courant est d'abord archivé (même si le délai
 * d'instantané n'est pas écoulé), puis remplacé par le dessin choisi.
 */
async function restore(channelId, versionId, userId) {
  const version = await getVersion(channelId, versionId);
  const current = await get(channelId);

  try {
    await snapshot(channelId, current, userId, { force: true });
  } catch (error) {
    // Même logique que dans `save` : on ne bloque pas la restauration.
  }

  return save(channelId, version.data, userId, { history: false });
}

async function clear(channelId, userId) {
  await query("DELETE FROM board_states WHERE channel_id = ?", [channelId]);
  return { channelId: Number(channelId), cleared: true, clearedBy: Number(userId) };
}

module.exports = {
  MAX_VERSIONS,
  get,
  save,
  clear,
  snapshot,
  listVersions,
  getVersion,
  restore,
};
