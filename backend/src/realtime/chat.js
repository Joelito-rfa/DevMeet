const messagesService = require("../services/messages");
const channelsService = require("../services/channels");
const usersService = require("../services/users");
const bus = require("../realtime/bus");
const registry = require("../realtime/registry");
const notify = require("../realtime/notify");
const { PERMISSIONS } = require("../permissions");
const { requireString } = require("../utils/validate");
const { resolveChannel, ackOk, ackError, channelRoom } = require("../realtime/guards");
const { messageDto, legacyMessageDto } = require("../utils/serialize");

/**
 * Abonnement d'un socket à un salon : c'est ce qui détermine qui reçoit
 * `message:new`, `board:*` et `voice:*`. L'abonnement n'est accordé qu'après
 * vérification des droits.
 */
async function handleSubscribe(socket, payload, ack) {
  const { channel } = payload || {};

  const resolved = await resolveChannel(socket, channel, { ack });

  if (!resolved) {
    return;
  }

  const { channel: resolvedChannel } = resolved;

  socket.join(channelRoom(resolvedChannel.id));
  socket.data.channels = socket.data.channels || new Set();
  socket.data.channels.add(Number(resolvedChannel.id));

  ackOk(ack, {
    channel: channelsService.serializeChannel(resolvedChannel),
    channelId: Number(resolvedChannel.id),
  });
}

function handleUnsubscribe(socket, payload, ack) {
  const channelId = payload?.channelId ?? payload?.channel;

  if (channelId) {
    socket.leave(channelRoom(channelId));
    socket.data.channels?.delete(Number(channelId));
  }

  ackOk(ack, { channelId: Number(channelId) || null });
}

/**
 * Envoi d'un message. L'auteur est toujours `socket.user.id` : le pseudo et
 * l'identifiant fournis par le client ne sont jamais utilisés.
 */
async function handleSendMessage(socket, payload, ack) {
  const { channel, content, replyToId } = payload || {};

  const resolved = await resolveChannel(socket, channel, {
    permission: PERMISSIONS.SEND_MESSAGES,
    ack,
  });

  if (!resolved) {
    return;
  }

  const { channel: resolvedChannel, access } = resolved;

  if (resolvedChannel.type === "announcement") {
    const { hasPermission } = require("../permissions");

    if (!hasPermission(access.role, PERMISSIONS.PUBLISH_ANNOUNCEMENTS)) {
      return ackError(
        ack,
        "Seuls les responsables peuvent publier une annonce.",
        "missing_permission"
      );
    }
  }

  let text;

  try {
    text = requireString(content ?? payload?.message, "message", { min: 1, max: 4000 });
  } catch (error) {
    return ackError(ack, error.message, error.code);
  }

  const message = await messagesService.create({
    channelId: resolvedChannel.id,
    authorId: socket.user.id,
    content: text,
    replyToId: replyToId ? String(replyToId) : null,
    communityId: Number(resolvedChannel.community_id),
  });

  await usersService.touchLastSeen(socket.user.id);

  bus.toChannel(resolvedChannel.id, "message:new", {
    channelId: Number(resolvedChannel.id),
    communityId: Number(resolvedChannel.community_id),
    message,
  });

  // Mentions et réponses : mêmes règles que par l'API REST.
  await notify.notifyMentions({
    mentionedUserIds: message.mentions,
    actorId: socket.user.id,
    actorName: socket.user.name,
    channelName: resolvedChannel.name,
    channelId: resolvedChannel.id,
    communityId: resolvedChannel.community_id,
    messageId: message.id,
    excerpt: message.content,
  });

  if (message.replyToId) {
    const parent = await messagesService.getById(message.replyToId);

    await notify.notifyReply({
      parentAuthorId: parent?.author_id,
      actorId: socket.user.id,
      actorName: socket.user.name,
      channelName: resolvedChannel.name,
      channelId: resolvedChannel.id,
      communityId: resolvedChannel.community_id,
      messageId: message.id,
      excerpt: message.content,
    });
  }

  ackOk(ack, { message });
}

async function handleFetchHistory(socket, payload, ack) {
  const { channel, before, after, limit } = payload || {};

  const resolved = await resolveChannel(socket, channel, { ack });

  if (!resolved) {
    return;
  }

  const history = await messagesService.list({
    channelId: resolved.channel.id,
    limit,
    before: before ?? null,
    after: after ?? null,
  });

  const payloadOut = {
    channelId: Number(resolved.channel.id),
    ...history,
  };

  socket.emit("message:history", payloadOut);
  ackOk(ack, payloadOut);
}

async function handleMarkRead(socket, payload, ack) {
  const { channel, messageId } = payload || {};

  const resolved = await resolveChannel(socket, channel, { ack });

  if (!resolved || !messageId) {
    return;
  }

  const result = await messagesService.markRead({
    channelId: resolved.channel.id,
    userId: socket.user.id,
    messageId: String(messageId),
  });

  bus.toChannel(resolved.channel.id, "message:read", {
    channelId: Number(resolved.channel.id),
    messageId: result.messageId,
    readerId: Number(socket.user.id),
  });

  ackOk(ack, result);
}

/** Indicateurs de frappe : le pseudo vient du compte, jamais du client. */
function handleTyping(socket, payload) {
  const channelId = payload?.channelId ?? payload?.channel;

  if (!channelId) {
    return;
  }

  socket.to(channelRoom(channelId)).emit("typing:update", {
    channelId: Number(channelId) || null,
    userId: Number(socket.user.id),
    userName: socket.user.name,
  });
}

function handleStopTyping(socket, payload) {
  const channelId = payload?.channelId ?? payload?.channel;

  if (!channelId) {
    return;
  }

  socket.to(channelRoom(channelId)).emit("typing:stop", {
    channelId: Number(channelId) || null,
    userId: Number(socket.user.id),
  });
}

async function handleDeleteMessage(socket, payload, ack) {
  const { channel, messageId } = payload || {};

  const resolved = await resolveChannel(socket, channel, { ack });

  if (!resolved || !messageId) {
    return;
  }

  const { hasPermission } = require("../permissions");
  const canModerate = hasPermission(resolved.access.role, PERMISSIONS.MODERATE_MESSAGES);

  try {
    const result = await messagesService.remove(String(messageId), {
      actorId: socket.user.id,
      canModerate,
    });

    bus.toChannel(resolved.channel.id, "message:deleted", {
      channelId: Number(resolved.channel.id),
      ...result,
    });

    ackOk(ack, result);
  } catch (error) {
    ackError(ack, error.message, error.code);
  }
}

/**
 * Compatibilité avec l'ancien protocole : on garde les noms d'événements
 * `get-chat-history` / `send-message` / `message-read`, mais tout passe
 * désormais par la base de données.
 */
async function handleLegacyHistory(socket, roomId) {
  const resolved = await resolveChannel(socket, roomId);

  if (!resolved) {
    return;
  }

  const history = await messagesService.listLegacy(resolved.channel.id, 100);
  socket.emit("chat-history", history);
}

async function handleLegacySendMessage(socket, payload, ack) {
  const { roomId, message, attachmentIds, replyToId } = payload || {};

  const resolved = await resolveChannel(socket, roomId, {
    permission: PERMISSIONS.SEND_MESSAGES,
  });

  if (!resolved) {
    return;
  }

  // Un message peut n'être qu'un fichier : le texte devient facultatif dès
  // qu'une pièce jointe accompagne l'envoi. Les identifiants fournis sont
  // revérifiés en base (même salon, même auteur, pas déjà rattachés).
  const hasAttachments =
    Array.isArray(attachmentIds) && attachmentIds.length > 0;

  const raw = typeof message === "string" ? message.trim() : "";

  let text = "";

  if (raw) {
    try {
      text = requireString(raw, "message", { min: 1, max: 4000 });
    } catch (error) {
      socket.emit("room-error", error.message);
      return;
    }
  } else if (!hasAttachments) {
    socket.emit("room-error", "Le message ne peut pas être vide.");
    return;
  }

  let created;

  try {
    created = await messagesService.create({
      channelId: resolved.channel.id,
      authorId: socket.user.id,
      content: text,
      attachmentIds: hasAttachments ? attachmentIds : null,
      replyToId: replyToId ? String(replyToId) : null,
      communityId: Number(resolved.channel.community_id),
    });
  } catch (error) {
    // Ex. réponse visant un message d'un autre salon : on le dit au client au
    // lieu de laisser l'erreur remonter sans réponse.
    socket.emit("room-error", error.message || "Envoi impossible.");
    ackError(ack, error.message, error.code);
    return;
  }

  const row = await messagesService.getById(created.id);

  bus.toChannel(
    resolved.channel.id,
    "receive-message",
    legacyMessageDto(row, {
      readBy: [Number(socket.user.id)],
      attachments: created.attachments || [],
      reactions: created.reactions || [],
      mentions: created.mentions || [],
      replyCount: created.replyCount || 0,
    })
  );

  await notify.notifyMentions({
    mentionedUserIds: created.mentions,
    actorId: socket.user.id,
    actorName: socket.user.name,
    channelName: resolved.channel.name,
    channelId: resolved.channel.id,
    communityId: resolved.channel.community_id,
    messageId: created.id,
    excerpt: text,
  });

  if (created.replyToId) {
    const parent = await messagesService.getById(created.replyToId);

    await notify.notifyReply({
      parentAuthorId: parent?.author_id,
      actorId: socket.user.id,
      actorName: socket.user.name,
      channelName: resolved.channel.name,
      channelId: resolved.channel.id,
      communityId: resolved.channel.community_id,
      messageId: created.id,
      excerpt: text,
    });
  }

  ackOk(ack, {
    id: created.id,
    attachmentCount: (created.attachments || []).length,
    mentions: created.mentions || [],
    replyToId: created.replyToId,
  });
}

async function handleLegacyMessageRead(socket, payload) {
  const { roomId, messageId } = payload || {};

  const resolved = await resolveChannel(socket, roomId);

  if (!resolved || !messageId) {
    return;
  }

  const result = await messagesService.markRead({
    channelId: resolved.channel.id,
    userId: socket.user.id,
    messageId: String(messageId),
  });

  bus.toChannel(resolved.channel.id, "message-read", {
    messageId: result.messageId,
    readerId: Number(socket.user.id),
  });
}

function handleLegacyTyping(socket, payload) {
  const roomId = payload?.roomId;

  if (!roomId) {
    return;
  }

  socket.to(channelRoom(roomId)).emit("user-typing", {
    userName: socket.user.name,
  });
}

function handleLegacyStopTyping(socket, roomId) {
  if (!roomId) {
    return;
  }

  socket.to(channelRoom(roomId)).emit("user-stop-typing");
}

async function handleLegacyCursor(socket, payload) {
  const { roomId, x, y } = payload || {};

  const resolved = await resolveChannel(socket, roomId);

  if (!resolved) {
    return;
  }

  socket.to(channelRoom(resolved.channel.id)).emit("cursor-move", {
    socketId: socket.id,
    userId: Number(socket.user.id),
    userName: socket.user.name,
    x,
    y,
  });
}

module.exports = {
  register(io, socket) {
    socket.on("channel:subscribe", (payload, ack) => handleSubscribe(socket, payload, ack));
    socket.on("channel:unsubscribe", (payload, ack) => handleUnsubscribe(socket, payload, ack));

    socket.on("message:send", (payload, ack) => handleSendMessage(socket, payload, ack));
    socket.on("message:history", (payload, ack) => handleFetchHistory(socket, payload, ack));
    socket.on("message:read", (payload, ack) => handleMarkRead(socket, payload, ack));
    socket.on("message:delete", (payload, ack) => handleDeleteMessage(socket, payload, ack));

    socket.on("typing:start", (payload) => handleTyping(socket, payload));
    socket.on("typing:stop", (payload) => handleStopTyping(socket, payload));

    // --- Anciens noms d'événements (compatibilité) ---
    socket.on("get-chat-history", (roomId) => handleLegacyHistory(socket, roomId));
    socket.on("send-message", (payload, ack) => handleLegacySendMessage(socket, payload, ack));
    socket.on("message-read", (payload) => handleLegacyMessageRead(socket, payload));
    socket.on("typing", (payload) => handleLegacyTyping(socket, payload));
    socket.on("stop-typing", (roomId) => handleLegacyStopTyping(socket, roomId));
    socket.on("cursor-move", (payload) => handleLegacyCursor(socket, payload));
  },

  exports: { handleSubscribe, handleSendMessage, handleFetchHistory },
};
