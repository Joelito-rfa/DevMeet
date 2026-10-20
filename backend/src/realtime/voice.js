const registry = require("../realtime/registry");
const { PERMISSIONS } = require("../permissions");
const { resolveChannel, ackOk, ackError, channelRoom } = require("../realtime/guards");

/**
 * Signalisation vocale (WebRTC en maillage P2P).
 *
 * Corrections apportées par rapport à la version précédente :
 *   - authentification et vérification du droit `voice:join` avant l'entrée ;
 *   - une offre/réponse/ICE n'est transmise que si l'émetteur ET le destinataire
 *     sont dans le MÊME salon vocal (impossible d'appeler un socket arbitraire) ;
 *   - l'état des participants est persistant tant qu'ils sont connectés, et
 *     nettoyé proprement à la déconnexion.
 *
 * Rappel honnête : c'est un maillage P2P, pas une SFU. Au-delà de ~5
 * participants, la charge montante devient limitante.
 */
async function handleVoiceJoin(socket, payload, ack) {
  const rawChannelId = payload?.channelId ?? payload?.roomId ?? payload;

  const resolved = await resolveChannel(socket, rawChannelId, {
    permission: PERMISSIONS.JOIN_VOICE,
    ack,
  });

  if (!resolved) {
    return;
  }

  const { channel } = resolved;

  // Le vocal reste disponible dans les salons de discussion historiques (type
  // « text ») : c'est une fonctionnalité existante qu'il ne faut pas casser.
  // Un salon d'annonces ou un tableau blanc, en revanche, n'accueille pas de
  // conversation vocale.
  const VOICE_CAPABLE_TYPES = new Set(["text", "voice"]);

  if (!VOICE_CAPABLE_TYPES.has(channel.type)) {
    return ackError(
      ack,
      "Ce salon n'accueille pas de conversation vocale.",
      "not_a_voice_channel"
    );
  }

  registry.joinVoice(channel.id, socket.user.id, socket.id, socket.user.name);
  socket.join(channelRoom(channel.id));

  socket.data.voiceChannelId = Number(channel.id);

  const participants = registry.voiceParticipantsOf(channel.id);

  socket.to(channelRoom(channel.id)).emit("voice:user-joined", {
    channelId: Number(channel.id),
    userId: Number(socket.user.id),
    socketId: socket.id,
    userName: socket.user.name,
    avatarUrl: socket.user.avatar_url || null,
  });

  // Compatibilité : ancien événement attendu par VoiceChannel.jsx
  socket.to(channelRoom(channel.id)).emit("voice-user-joined", socket.id);

  ackOk(ack, {
    channelId: Number(channel.id),
    participants,
  });
}

function handleVoiceLeave(socket, payload, ack) {
  const channelId = payload?.channelId ?? payload?.roomId ?? socket.data.voiceChannelId;

  if (!channelId) {
    return ackOk(ack, {});
  }

  registry.leaveVoice(channelId, socket.user.id);

  socket.to(channelRoom(channelId)).emit("voice:user-left", {
    channelId: Number(channelId),
    userId: Number(socket.user.id),
    socketId: socket.id,
  });

  socket.to(channelRoom(channelId)).emit("voice-user-left", socket.id);

  socket.leave(channelRoom(channelId));
  socket.data.voiceChannelId = null;

  ackOk(ack, { channelId: Number(channelId) });
}

function setMuted(socket, payload, ack) {
  const channelId = payload?.channelId ?? socket.data.voiceChannelId;

  if (!channelId) {
    return ackError(ack, "Vous n'êtes pas dans un salon vocal.", "not_in_voice");
  }

  const muted = Boolean(payload?.muted);
  registry.setVoiceMuted(channelId, socket.user.id, muted);

  socket.to(channelRoom(channelId)).emit("voice:mute", {
    channelId: Number(channelId),
    userId: Number(socket.user.id),
    muted,
  });

  ackOk(ack, { muted });
}

/**
 * Transmet une charge de signalisation au destinataire, uniquement si les deux
 * sockets sont présents dans le même salon vocal.
 */
function relaySignal(socket, { to, event, payload }, ack) {
  const target = registry.getSocket(to);

  if (!target) {
    return ackError(ack, "Destinataire introuvable.", "peer_not_found");
  }

  const myChannel = socket.data.voiceChannelId;
  const targetChannel = target.data.voiceChannelId;

  if (!myChannel || !targetChannel || Number(myChannel) !== Number(targetChannel)) {
    return ackError(
      ack,
      "Le destinataire n'est pas dans le même salon vocal.",
      "peer_not_in_channel"
    );
  }

  target.emit(event, { from: socket.id, fromUserId: Number(socket.user.id), ...payload });

  ackOk(ack, { relayed: true });
}

function handleOffer(socket, payload, ack) {
  relaySignal(socket, { to: payload?.to, event: "voice-offer", payload: { offer: payload?.offer } }, ack);
}

function handleAnswer(socket, payload, ack) {
  relaySignal(
    socket,
    { to: payload?.to, event: "voice-answer", payload: { answer: payload?.answer } },
    ack
  );
}

function handleIce(socket, payload, ack) {
  relaySignal(
    socket,
    { to: payload?.to, event: "voice-ice", payload: { candidate: payload?.candidate } },
    ack
  );
}

function voiceState(socket, payload, ack) {
  const channelId = payload?.channelId ?? socket.data.voiceChannelId;

  if (!channelId) {
    return ackOk(ack, { participants: [] });
  }

  ackOk(ack, { participants: registry.voiceParticipantsOf(channelId) });
}

/** Nettoyage à la déconnexion : aucune PeerConnection ni état fantôme. */
function cleanup(socket) {
  const left = registry.clearVoiceForSocket(socket.id);

  for (const { channelId } of left) {
    socket.to(channelRoom(channelId)).emit("voice:user-left", {
      channelId: Number(channelId),
      userId: Number(socket.user.id),
      socketId: socket.id,
    });
    socket.to(channelRoom(channelId)).emit("voice-user-left", socket.id);
  }

  return left;
}

module.exports = {
  register(io, socket) {
    // Nouveaux événements
    socket.on("voice:join", (payload, ack) => handleVoiceJoin(socket, payload, ack));
    socket.on("voice:leave", (payload, ack) => handleVoiceLeave(socket, payload, ack));
    socket.on("voice:mute", (payload, ack) => setMuted(socket, payload, ack));
    socket.on("voice:state", (payload, ack) => voiceState(socket, payload, ack));

    // Signalisation (mêmes noms qu'avant, désormais contrôlés)
    socket.on("voice-offer", (payload, ack) => handleOffer(socket, payload, ack));
    socket.on("voice-answer", (payload, ack) => handleAnswer(socket, payload, ack));
    socket.on("voice-ice", (payload, ack) => handleIce(socket, payload, ack));

    // Ancien nom d'entrée/sortie
    socket.on("voice-join", (payload, ack) => handleVoiceJoin(socket, payload, ack));
    socket.on("voice-leave", (payload, ack) => handleVoiceLeave(socket, payload, ack));
  },
  cleanup,
  exports: { handleVoiceJoin, handleVoiceLeave, setMuted, relaySignal },
};
