const channelsService = require("../services/channels");
const { hasPermission } = require("../permissions");

/**
 * Contrôles partagés par tous les handlers Socket.IO.
 *
 * Règle absolue : ni l'identité ni les droits ne viennent du client. On
 * recharge le salon et on vérifie l'accès à chaque événement sensible.
 */

function sendError(socket, event, message, extra = {}) {
  socket.emit(event, { message, ...extra });
}

function ackOk(ack, payload = {}) {
  if (typeof ack === "function") {
    ack({ success: true, ...payload });
  }
}

function ackError(ack, message, code) {
  if (typeof ack === "function") {
    ack({ success: false, message, code });
  }
}

/**
 * Résout un salon (identifiant numérique ou historique) et vérifie les droits.
 *
 * @returns {Promise<{channel: object, access: object}|null>}
 */
async function resolveChannel(socket, rawChannelId, { permission = null, ack = null } = {}) {
  const channel = await channelsService.resolveByClientId(rawChannelId);

  if (!channel) {
    ackError(ack, "Salon introuvable.", "channel_not_found");
    sendError(socket, "channel:error", "Salon introuvable.");
    return null;
  }

  let access;

  try {
    access = await channelsService.assertChannelAccess(channel, socket.user.id);
  } catch (error) {
    ackError(ack, error.message, error.code);
    socket.emit("channel:forbidden", {
      channelId: Number(channel.id),
      message: error.message,
      code: error.code,
    });
    return null;
  }

  if (permission && !hasPermission(access.role, permission)) {
    // Cas particulier : une communauté publique est consultable sans y adhérer,
    // mais on ne peut pas y écrire. Le message doit le dire clairement au lieu
    // d'invoquer un rôle que l'utilisateur n'a pas.
    const message = access.role
      ? "Votre rôle ne permet pas cette action."
      : "Rejoignez la communauté pour participer.";
    const code = access.role ? "missing_permission" : "not_a_member";

    ackError(ack, message, code);
    socket.emit("channel:forbidden", {
      channelId: Number(channel.id),
      message,
      code,
    });
    return null;
  }

  return { channel, access };
}

/** Identifiant de chambre Socket.IO d'un salon. */
function channelRoom(channelId) {
  return `channel:${channelId}`;
}

module.exports = {
  sendError,
  ackOk,
  ackError,
  resolveChannel,
  channelRoom,
};
