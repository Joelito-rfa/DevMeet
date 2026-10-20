const channelsService = require("../services/channels");
const boardsService = require("../services/boards");
const communities = require("../services/communities");
const { PERMISSIONS } = require("../permissions");
const { resolveChannel, ackOk, ackError, channelRoom } = require("../realtime/guards");
const { requireString } = require("../utils/validate");
const registry = require("../realtime/registry");

/**
 * Compatibilité avec l'ancien protocole des salons.
 *
 * L'interface actuelle (Dashboard + Room) continue de fonctionner à
 * l'identique, mais tout est désormais lu et écrit en base :
 *   - `get-rooms`    → `rooms-list`
 *   - `create-room`  → création d'un salon persistant + code d'accès
 *   - `join-room`    → validation du code, autorisation durable, historique
 *   - `leave-room`   → sortie du salon
 *
 * Différence assumée : `create-room` exige maintenant un compte authentifié
 * (l'ancienne version acceptait n'importe quelle connexion anonyme).
 */

function toLegacyRoom(channel, members) {
  return {
    id: channel.legacy_room_id || String(channel.id),
    channelId: Number(channel.id),
    name: channel.name,
    type: channel.type,
    members,
    isPrivate: Boolean(channel.access_code),
    isCommunityChannel: !channel.legacy_room_id,
  };
}

async function buildRoomsList() {
  const channels = await channelsService.listLegacyRooms();

  return channels.map((channel) =>
    toLegacyRoom(channel, registry.legacyMembers(channel.id))
  );
}

async function emitRoomsList(io) {
  io.emit("rooms-list", await buildRoomsList());
}

function emitRoomPresence(io, channelId) {
  io.to(channelRoom(channelId)).emit("room-members", registry.legacyMembers(channelId));
  io.to(channelRoom(channelId)).emit(
    "room-participants",
    registry.legacyParticipants(channelId)
  );
}

function register(io, socket) {
  socket.on("get-rooms", async () => {
    socket.emit("rooms-list", await buildRoomsList());
  });

  socket.on("create-room", async ({ name, password } = {}) => {
    try {
      const roomName = requireString(name, "nom du salon", { min: 1, max: 80 });
      const code = requireString(password, "code d'accès", { min: 4, max: 120 });

      const { channel } = await channelsService.createLegacyRoom({
        name: roomName,
        accessCode: code,
        creatorId: socket.user.id,
      });

      await emitRoomsList(io);

      socket.emit("room-success", `Salon « ${channel.name} » créé avec succès.`);
    } catch (error) {
      socket.emit("room-error", error.message || "Impossible de créer le salon.");
    }
  });

  socket.on("join-room", async ({ roomId, accessCode } = {}, ack) => {
    const channel = await channelsService.resolveByClientId(roomId);

    if (!channel) {
      socket.emit("room-error", "Salon introuvable.");
      return ackError(ack, "Salon introuvable.", "channel_not_found");
    }

    // Règle unique de déverrouillage (partagée avec POST /channels/:id/unlock) :
    // un code correct crée une autorisation persistante.
    const result = await channelsService
      .unlock(channel, socket.user.id, accessCode)
      .then((value) => value)
      .catch((error) => error);

    if (result instanceof Error) {
      const message =
        channel.access_code && !accessCode
          ? "Le code d'accès est obligatoire."
          : result.message;

      socket.emit("room-error", message);
      return ackError(ack, message, result.code);
    }

    socket.join(channelRoom(channel.id));
    socket.data.channels = socket.data.channels || new Set();
    socket.data.channels.add(Number(channel.id));
    socket.data.currentRoomId = channel.legacy_room_id || String(channel.id);

    registry.addLegacyPresence(channel.id, socket.id);

    io.emit("rooms-list", await buildRoomsList());
    emitRoomPresence(io, channel.id);

    // Restauration du tableau blanc (persisté en base).
    const board = await boardsService.get(channel.id);

    if (board && board.data) {
      socket.emit("canvas-update", board.data);
      socket.emit("board:state", { channelId: Number(channel.id), board });
    }

    ackOk(ack, { channelId: Number(channel.id) });

    console.log(
      `[socket] ${socket.user.name} (${socket.id}) a rejoint « ${channel.name} »`
    );
  });

  socket.on("leave-room", async ({ roomId } = {}, ack) => {
    const channel = await channelsService.resolveByClientId(
      roomId || socket.data.currentRoomId
    );

    if (!channel) {
      return ackOk(ack, {});
    }

    registry.removeLegacyPresence(channel.id, socket.id);
    socket.leave(channelRoom(channel.id));
    socket.data.channels?.delete(Number(channel.id));
    socket.data.currentRoomId = null;

    io.emit("rooms-list", await buildRoomsList());
    emitRoomPresence(io, channel.id);

    ackOk(ack, { channelId: Number(channel.id) });
  });
}

async function cleanup(socket, io) {
  const affected = registry.clearLegacyPresenceForSocket(socket.id);

  // Les participants restants doivent voir le départ : sinon la liste des
  // membres d'un salon reste figée sur un utilisateur déconnecté.
  if (io) {
    for (const channelId of affected) {
      emitRoomPresence(io, channelId);
    }
  }

  return affected;
}

module.exports = { register, cleanup, buildRoomsList, emitRoomsList };
