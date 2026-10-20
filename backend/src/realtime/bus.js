/**
 * Point d'accès unique à l'instance Socket.IO.
 *
 * Les routes REST et les handlers Socket.IO diffusent les mêmes événements :
 * cette indirection évite de faire circuler `io` dans toute la couche service.
 */
let ioRef = null;

function bind(io) {
  ioRef = io;
}

function getIo() {
  if (!ioRef) {
    throw new Error("Socket.IO n'est pas encore initialisé.");
  }

  return ioRef;
}

function isBound() {
  return Boolean(ioRef);
}

/** Chambre d'un utilisateur (notifications, multi-onglets). */
function toUser(userId, event, payload) {
  getIo().to(`user:${userId}`).emit(event, payload);
}

/** Chambre d'une communauté (membres autorisés uniquement). */
function toCommunity(communityId, event, payload) {
  getIo().to(`community:${communityId}`).emit(event, payload);
}

/** Chambre d'un salon (participants autorisés uniquement). */
function toChannel(channelId, event, payload) {
  getIo().to(`channel:${channelId}`).emit(event, payload);
}

module.exports = {
  bind,
  getIo,
  isBound,
  toUser,
  toCommunity,
  toChannel,
};
