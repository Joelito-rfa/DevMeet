const notifications = require("../services/notifications");
const { query } = require("../db/pool");
const bus = require("./bus");

/**
 * Création de notifications réelles + diffusion temps réel.
 *
 * Une notification est d'abord écrite en base (elle survit donc à la
 * déconnexion), puis poussée au compte concerné via la chambre `user:<id>`.
 * Si Socket.IO n'est pas encore initialisé (scripts, tests unitaires), la
 * diffusion est simplement ignorée : l'écriture en base reste la source de
 * vérité, l'interface la retrouve par `GET /api/notifications`.
 */

async function notifyUsers(userIds, { type, title, body = null, payload = null }) {
  const created = [];

  for (const userId of userIds) {
    const notification = await notifications.create({
      userId,
      type,
      title,
      body,
      payload,
    });

    if (!notification) {
      continue;
    }

    created.push(notification);

    if (bus.isBound()) {
      bus.toUser(userId, "notification:new", { notification });
    }
  }

  return created;
}

/** Notifie tous les membres d'une communauté sauf l'auteur de l'action. */
async function notifyCommunity(
  communityId,
  { exceptUserId = null, ...rest }
) {
  const rows = await query(
    "SELECT user_id FROM community_members WHERE community_id = ?",
    [communityId]
  );

  const targets = rows
    .map((row) => Number(row.user_id))
    .filter((userId) => userId !== Number(exceptUserId));

  return notifyUsers(targets, rest);
}

/**
 * Mentions d'un message : seuls les comptes réellement mentionnés sont
 * notifiés, et jamais l'auteur de sa propre mention.
 */
async function notifyMentions({
  mentionedUserIds,
  actorId,
  actorName,
  channelName,
  channelId,
  communityId,
  messageId,
  excerpt = null,
}) {
  const targets = (mentionedUserIds || [])
    .map((id) => Number(id))
    .filter((id) => id !== Number(actorId));

  if (targets.length === 0) {
    return [];
  }

  return notifyUsers(targets, {
    type: "message:mention",
    title: `${actorName} vous a mentionné dans #${channelName}`,
    body: excerpt ? excerpt.slice(0, 180) : null,
    payload: {
      communityId: Number(communityId),
      channelId: Number(channelId),
      messageId: String(messageId),
    },
  });
}

/** Réponse à un message : l'auteur du message d'origine est prévenu. */
async function notifyReply({
  parentAuthorId,
  actorId,
  actorName,
  channelName,
  channelId,
  communityId,
  messageId,
  excerpt = null,
}) {
  if (!parentAuthorId || Number(parentAuthorId) === Number(actorId)) {
    return [];
  }

  return notifyUsers([Number(parentAuthorId)], {
    type: "message:reply",
    title: `${actorName} a répondu à votre message dans #${channelName}`,
    body: excerpt ? excerpt.slice(0, 180) : null,
    payload: {
      communityId: Number(communityId),
      channelId: Number(channelId),
      messageId: String(messageId),
    },
  });
}

/** Message privé : seul le destinataire est prévenu, jamais l'auteur. */
async function notifyDirectMessage({
  recipientId,
  actorId,
  actorName,
  conversationId,
  messageId,
  excerpt = null,
}) {
  if (!recipientId || Number(recipientId) === Number(actorId)) {
    return [];
  }

  return notifyUsers([Number(recipientId)], {
    type: "dm:message",
    title: `${actorName} vous a envoyé un message privé`,
    body: excerpt ? excerpt.slice(0, 180) : null,
    payload: {
      conversationId: Number(conversationId),
      messageId: String(messageId),
      authorId: Number(actorId),
    },
  });
}

module.exports = {
  notifyUsers,
  notifyCommunity,
  notifyMentions,
  notifyReply,
  notifyDirectMessage,
};
