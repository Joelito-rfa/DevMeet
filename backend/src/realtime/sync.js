const { query } = require("../db/pool");
const registry = require("./registry");
const config = require("../config");
const communities = require("../services/communities");

/**
 * Recalcule les chambres Socket.IO d'un utilisateur.
 *
 * Appelé après toute modification d'appartenance (création de communauté,
 * adhésion, départ, acceptation d'invitation, réordonnancement) : les sockets
 * déjà connectés sont ajoutés ou retirés des chambres concernées, sans attendre
 * une reconnexion.
 */
async function syncUserRooms(userId) {
  const rows = await query(
    `SELECT c.id
     FROM communities c
     LEFT JOIN community_members cm
       ON cm.community_id = c.id AND cm.user_id = ?
     WHERE cm.user_id IS NOT NULL`,
    [userId]
  );

  const allowed = new Set(rows.map((row) => Number(row.id)));

  // La communauté technique est accessible à tout compte authentifié.
  const system = await communities.getById(config.systemCommunityId);

  if (system) {
    allowed.add(Number(system.id));
  }

  const sockets = registry.socketsOf(userId);

  for (const socket of sockets) {
    socket.join(registry.userRoom(userId));

    for (const room of socket.rooms) {
      if (room.startsWith("community:")) {
        const communityId = Number(room.split(":")[1]);

        if (!allowed.has(communityId)) {
          socket.leave(room);
        }
      }
    }

    for (const communityId of allowed) {
      socket.join(registry.communityRoom(communityId));
    }
  }

  return Array.from(allowed);
}

module.exports = { syncUserRooms };
