const { query, queryOne, safeInt } = require("../db/pool");
const { notificationDto } = require("../utils/serialize");

const MAX_LIMIT = 50;

async function create({ userId, type, title, body = null, payload = null }) {
  const result = await query(
    `INSERT INTO notifications (user_id, type, title, body, payload)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, type, title, body, payload ? JSON.stringify(payload) : null]
  );

  return getById(result.insertId);
}

async function getById(id) {
  const row = await queryOne("SELECT * FROM notifications WHERE id = ?", [String(id)]);
  return notificationDto(row);
}

async function list(userId, { limit, before = null } = {}) {
  const safeLimit = safeInt(limit, 30, { min: 1, max: MAX_LIMIT });

  const conditions = ["user_id = ?"];
  const params = [userId];

  if (before) {
    conditions.push("id < ?");
    params.push(String(before));
  }

  const rows = await query(
    `SELECT * FROM notifications
     WHERE ${conditions.join(" AND ")}
     ORDER BY id DESC
     LIMIT ${safeLimit}`,
    params
  );

  return {
    notifications: rows.map(notificationDto),
    hasMore: rows.length === safeLimit,
  };
}

async function unreadCount(userId) {
  const row = await queryOne(
    "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND read_at IS NULL",
    [userId]
  );

  return row ? Number(row.total) : 0;
}

async function markRead(userId, notificationId) {
  await query(
    `UPDATE notifications SET read_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND user_id = ? AND read_at IS NULL`,
    [String(notificationId), userId]
  );

  return { id: String(notificationId), read: true };
}

async function markAllRead(userId) {
  const result = await query(
    "UPDATE notifications SET read_at = CURRENT_TIMESTAMP(3) WHERE user_id = ? AND read_at IS NULL",
    [userId]
  );

  return { updated: result.affectedRows };
}

async function remove(userId, notificationId) {
  await query("DELETE FROM notifications WHERE id = ? AND user_id = ?", [
    String(notificationId),
    userId,
  ]);

  return { deleted: true };
}

/**
 * Notifie tous les membres d'une communauté sauf l'auteur de l'action.
 * Utilisé pour les créations de salons, catégories, invitations, etc.
 */
async function notifyCommunity(communityId, { exceptUserId = null, type, title, body, payload }) {
  const members = await query(
    "SELECT user_id FROM community_members WHERE community_id = ?",
    [communityId]
  );

  const targets = members
    .map((row) => Number(row.user_id))
    .filter((id) => id !== Number(exceptUserId));

  const created = [];

  for (const userId of targets) {
    created.push(
      await create({ userId, type, title, body, payload })
    );
  }

  return created;
}

module.exports = {
  create,
  getById,
  list,
  unreadCount,
  markRead,
  markAllRead,
  remove,
  notifyCommunity,
};
