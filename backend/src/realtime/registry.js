/**
 * Registre des connexions temps réel.
 *
 * Les sockets sont indexés par IDENTIFIANT DE COMPTE (et non par identifiant de
 * connexion) : c'est ce qui rend l'appartenance stable à la reconnexion et
 * permet de diffuser vers un utilisateur, tous onglets confondus.
 */
const userSockets = new Map();

/** Toutes les sockets actives, indexées par identifiant de connexion. */
const socketsById = new Map();

/** État vocal en mémoire : channelId -> Map(userId -> { socketId, muted }) */
const voiceParticipants = new Map();

/** Présence des salons historiques : channelId -> Set(socketId) */
const legacyRoomPresence = new Map();

function addSocket(socket) {
  socketsById.set(socket.id, socket);
}

function removeSocket(socketId) {
  socketsById.delete(socketId);
}

function getSocket(socketId) {
  return socketsById.get(socketId) || null;
}

function register(userId, socket) {
  const key = Number(userId);
  const set = userSockets.get(key) || new Set();
  set.add(socket);
  userSockets.set(key, set);
}

function unregister(userId, socket) {
  const key = Number(userId);
  const set = userSockets.get(key);

  if (!set) {
    return;
  }

  set.delete(socket);

  if (set.size === 0) {
    userSockets.delete(key);
  }
}

function socketsOf(userId) {
  return Array.from(userSockets.get(Number(userId)) || []);
}

function isOnline(userId) {
  return socketsOf(userId).length > 0;
}

function onlineUserIds() {
  return Array.from(userSockets.keys());
}

function socketCount() {
  let total = 0;

  for (const set of userSockets.values()) {
    total += set.size;
  }

  return total;
}

/**
 * Fait rejoindre une chambre à tous les sockets d'un utilisateur.
 */
function joinRoomForUser(userId, room) {
  for (const socket of socketsOf(userId)) {
    socket.join(room);
  }
}

function leaveRoomForUser(userId, room) {
  for (const socket of socketsOf(userId)) {
    socket.leave(room);
  }
}

function communityRoom(communityId) {
  return `community:${communityId}`;
}

function channelRoom(channelId) {
  return `channel:${channelId}`;
}

function userRoom(userId) {
  return `user:${userId}`;
}

// -----------------------------------------------------------------------------
// État vocal
// -----------------------------------------------------------------------------

function joinVoice(channelId, userId, socketId, name = null) {
  const key = Number(channelId);
  const participants = voiceParticipants.get(key) || new Map();
  participants.set(Number(userId), {
    socketId,
    muted: false,
    joinedAt: Date.now(),
    // Pseudo du compte : affiché dans le panneau vocal sans requête supplémentaire.
    name: name || null,
  });
  voiceParticipants.set(key, participants);
  return participants;
}

function setVoiceMuted(channelId, userId, muted) {
  const participants = voiceParticipants.get(Number(channelId));

  if (!participants || !participants.has(Number(userId))) {
    return null;
  }

  const entry = participants.get(Number(userId));
  entry.muted = Boolean(muted);
  participants.set(Number(userId), entry);
  return entry;
}

function leaveVoice(channelId, userId) {
  const participants = voiceParticipants.get(Number(channelId));

  if (!participants) {
    return false;
  }

  const removed = participants.delete(Number(userId));

  if (participants.size === 0) {
    voiceParticipants.delete(Number(channelId));
  }

  return removed;
}

function voiceParticipantsOf(channelId) {
  const participants = voiceParticipants.get(Number(channelId));

  if (!participants) {
    return [];
  }

  return Array.from(participants.entries()).map(([userId, entry]) => ({
    userId,
    socketId: entry.socketId,
    muted: entry.muted,
    name: entry.name || null,
  }));
}

function voiceChannelIdsForUser(userId) {
  const ids = [];

  for (const [channelId, participants] of voiceParticipants.entries()) {
    if (participants.has(Number(userId))) {
      ids.push(channelId);
    }
  }

  return ids;
}

// -----------------------------------------------------------------------------
// Présence des salons historiques (compatibilité ancien protocole)
// -----------------------------------------------------------------------------

function addLegacyPresence(channelId, socketId) {
  const key = String(channelId);
  const set = legacyRoomPresence.get(key) || new Set();
  set.add(socketId);
  legacyRoomPresence.set(key, set);
  return set;
}

function removeLegacyPresence(channelId, socketId) {
  const key = String(channelId);
  const set = legacyRoomPresence.get(key);

  if (!set) {
    return;
  }

  set.delete(socketId);

  if (set.size === 0) {
    legacyRoomPresence.delete(key);
  }
}

function legacyMembers(channelId) {
  return Array.from(legacyRoomPresence.get(String(channelId)) || []);
}

/**
 * Participants d'un salon historique, avec le nom du compte.
 *
 * L'ancien format (`room-members`) ne contenait que des identifiants de
 * connexion, ce qui obligeait l'interface à afficher des identifiants à la
 * place des noms. Une seule entrée par compte : deux onglets ne comptent pas
 * comme deux personnes.
 */
function legacyParticipants(channelId) {
  const seen = new Set();
  const participants = [];

  for (const socketId of legacyRoomPresence.get(String(channelId)) || []) {
    const socket = socketsById.get(socketId);

    if (!socket || !socket.user) {
      continue;
    }

    const userId = Number(socket.user.id);

    if (seen.has(userId)) {
      continue;
    }

    seen.add(userId);

    participants.push({
      userId,
      name: socket.user.name,
      socketId,
    });
  }

  return participants;
}

function clearLegacyPresenceForSocket(socketId) {
  const affected = [];

  for (const [key, set] of legacyRoomPresence.entries()) {
    if (set.delete(socketId)) {
      affected.push(Number(key));
    }

    if (set.size === 0) {
      legacyRoomPresence.delete(key);
    }
  }

  return affected;
}

function clearVoiceForSocket(socketId) {
  const left = [];

  for (const [channelId, participants] of voiceParticipants.entries()) {
    for (const [userId, entry] of participants.entries()) {
      if (entry.socketId === socketId) {
        participants.delete(userId);
        left.push({ channelId, userId });
      }
    }

    if (participants.size === 0) {
      voiceParticipants.delete(channelId);
    }
  }

  return left;
}

module.exports = {
  addSocket,
  removeSocket,
  getSocket,
  register,
  unregister,
  socketsOf,
  isOnline,
  onlineUserIds,
  socketCount,
  joinRoomForUser,
  leaveRoomForUser,
  communityRoom,
  channelRoom,
  userRoom,
  joinVoice,
  setVoiceMuted,
  leaveVoice,
  voiceParticipantsOf,
  voiceChannelIdsForUser,
  addLegacyPresence,
  removeLegacyPresence,
  legacyMembers,
  legacyParticipants,
  clearLegacyPresenceForSocket,
  clearVoiceForSocket,
};
