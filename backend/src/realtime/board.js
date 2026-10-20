const boardsService = require("../services/boards");
const bus = require("../realtime/bus");
const { PERMISSIONS } = require("../permissions");
const { resolveChannel, ackOk, ackError, channelRoom } = require("../realtime/guards");

/**
 * Tableau blanc.
 *
 * Deux formes d'événement coexistent :
 *   - `board:update`  (nouveau) : objet complet `{ data, version, updatedAt }`
 *   - `canvas-update` (ancien)  : `{ roomId, data }` où `data` est le JSON
 *     Fabric.js brut, exactement ce qu'attend le composant Whiteboard existant.
 *
 * Dans les deux cas l'état est écrit dans `board_states`, donc persistant.
 */
async function handleBoardUpdate(socket, payload, ack) {
  const { channel, data, expectedVersion } = payload || {};

  const resolved = await resolveChannel(socket, channel, {
    permission: PERMISSIONS.ACCESS_WHITEBOARD,
    ack,
  });

  if (!resolved) {
    return;
  }

  try {
    const board = await boardsService.save(
      resolved.channel.id,
      data ?? null,
      socket.user.id,
      { expectedVersion: expectedVersion ?? null }
    );

    bus.toChannel(resolved.channel.id, "board:update", {
      channelId: Number(resolved.channel.id),
      board,
    });

    ackOk(ack, { board });
  } catch (error) {
    if (error.currentState) {
      socket.emit("board:conflict", {
        channelId: Number(resolved.channel.id),
        board: error.currentState,
        message: error.message,
      });
    }

    ackError(ack, error.message, error.code);
  }
}

async function handleBoardFetch(socket, payload, ack) {
  const { channel } = payload || {};

  const resolved = await resolveChannel(socket, channel, {
    permission: PERMISSIONS.ACCESS_WHITEBOARD,
    ack,
  });

  if (!resolved) {
    return;
  }

  const board = await boardsService.get(resolved.channel.id);

  socket.emit("board:state", {
    channelId: Number(resolved.channel.id),
    board,
  });

  ackOk(ack, { board });
}

/** Ancien format : on stocke puis on rediffuse le JSON brut du canvas. */
async function handleLegacyCanvasUpdate(socket, payload, ack) {
  const { roomId, data } = payload || {};

  if (!data) {
    return;
  }

  const resolved = await resolveChannel(socket, roomId, {
    permission: PERMISSIONS.ACCESS_WHITEBOARD,
  });

  if (!resolved) {
    return;
  }

  await boardsService.save(resolved.channel.id, data, socket.user.id);

  socket.to(channelRoom(resolved.channel.id)).emit("canvas-update", data);

  ackOk(ack, { saved: true });

  // Informe les autres onglets / membres abonnés du nouveau format.
  bus.toChannel(resolved.channel.id, "board:update", {
    channelId: Number(resolved.channel.id),
    legacy: true,
  });
}

module.exports = {
  register(io, socket) {
    socket.on("board:update", (payload, ack) => handleBoardUpdate(socket, payload, ack));
    socket.on("board:fetch", (payload, ack) => handleBoardFetch(socket, payload, ack));
    socket.on("canvas-update", (payload, ack) => handleLegacyCanvasUpdate(socket, payload, ack));
  },
  exports: { handleBoardUpdate, handleLegacyCanvasUpdate },
};
