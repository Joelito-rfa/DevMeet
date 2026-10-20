/**
 * Conversion des lignes SQL en objets exposés à l'API.
 *
 * Les identifiants de messages (BIGINT) sont sérialisés en chaînes de
 * caractères pour ne jamais perdre de précision côté JavaScript.
 */

function toIso(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toBoolean(value) {
  return value === 1 || value === true || value === "1";
}

/** Utilisateur public : jamais de hash de mot de passe. */
function publicUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url || null,
    bio: row.bio || null,
    status: row.status || "offline",
    theme: row.theme || "dark",
    createdAt: toIso(row.created_at),
    lastSeenAt: toIso(row.last_seen_at),
  };
}

/** Auteur minimal embarqué dans un message ou une liste de membres. */
function authorSummary(row, prefix = "author_") {
  const id = row[`${prefix}id`];

  if (!id) {
    return null;
  }

  return {
    id: Number(id),
    name: row[`${prefix}name`] || "Utilisateur supprimé",
    avatarUrl: row[`${prefix}avatar_url`] || null,
    status: row[`${prefix}status`] || "offline",
  };
}

function communityDto(row, extra = {}) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    name: row.name,
    description: row.description || null,
    iconUrl: row.icon_url || null,
    isPublic: toBoolean(row.is_public),
    isSystem: toBoolean(row.is_system),
    ownerId: row.owner_id ? Number(row.owner_id) : null,
    createdAt: toIso(row.created_at),
    // Rôle de l'utilisateur dans cette communauté : objet complet (id, libellé,
    // rang, permissions) ou `null` s'il n'est pas membre.
    role: extra.role || null,
    memberCount: extra.memberCount !== undefined ? Number(extra.memberCount) : undefined,
    channelCount: extra.channelCount !== undefined ? Number(extra.channelCount) : undefined,
    unreadCount: extra.unreadCount !== undefined ? Number(extra.unreadCount) : undefined,
  };
}

function categoryDto(row, extra = {}) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    communityId: Number(row.community_id),
    name: row.name,
    description: row.description || null,
    position: Number(row.position),
    creatorId: row.creator_id ? Number(row.creator_id) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    channelCount: extra.channelCount !== undefined ? Number(extra.channelCount) : undefined,
  };
}

function channelDto(row, extra = {}) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    communityId: Number(row.community_id),
    categoryId: row.category_id ? Number(row.category_id) : null,
    name: row.name,
    description: row.description || null,
    type: row.type,
    isPrivate: toBoolean(row.is_private),
    position: Number(row.position),
    // Le code d'accès n'est jamais renvoyé au client : il se saisit, il ne se lit pas.
    hasAccessCode: Boolean(row.access_code),
    legacyRoomId: row.legacy_room_id || null,
    creatorId: row.creator_id ? Number(row.creator_id) : null,
    archivedAt: toIso(row.archived_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    unreadCount: extra.unreadCount !== undefined ? Number(extra.unreadCount) : undefined,
    members: extra.members || undefined,
  };
}

function messageDto(row, extra = {}) {
  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    channelId: Number(row.channel_id),
    content: row.content,
    // Suppression logique : la ligne existe toujours (contexte conservé) mais le
    // contenu est vide. L'interface doit pouvoir le distinguer d'un vrai vide.
    deleted: Boolean(row.deleted_at),
    createdAt: toIso(row.created_at),
    editedAt: toIso(row.edited_at),
    replyToId: row.reply_to_id ? String(row.reply_to_id) : null,
    author: authorSummary(row),
    readBy: extra.readBy || [],
    attachments: extra.attachments || [],
    // Messagerie avancée (jalon 5) : réactions agrégées, épinglage, fils de
    // discussion et mentions résolues côté serveur.
    reactions: extra.reactions || [],
    pinned: Boolean(extra.pinned),
    pinnedBy: extra.pinnedBy !== undefined ? extra.pinnedBy : null,
    pinnedAt: extra.pinnedAt !== undefined ? extra.pinnedAt : null,
    replyCount: extra.replyCount !== undefined ? Number(extra.replyCount) : 0,
    lastReplyAt: extra.lastReplyAt !== undefined ? extra.lastReplyAt : null,
    mentions: extra.mentions || [],
  };
}

/**
 * Forme « historique » attendue par l'interface existante (chat.jsx) afin de
 * ne rien casser : l'auteur est identifié par `authorId`/`senderId` (l'id du
 * COMPTE, plus jamais l'id de socket) et le pseudo vient de la base.
 */
function legacyMessageDto(row, extra = {}) {
  if (!row) {
    return null;
  }

  const authorId = row.author_id ? Number(row.author_id) : null;

  return {
    id: String(row.id),
    createdAt: toIso(row.created_at),
    channelId: Number(row.channel_id),
    authorId,
    senderId: authorId,
    userName: row.author_name || "Utilisateur supprimé",
    avatarUrl: row.author_avatar_url || null,
    message: row.deleted_at ? "Message supprimé" : row.content,
    deleted: Boolean(row.deleted_at),
    replyToId: row.reply_to_id ? String(row.reply_to_id) : null,
    readBy: extra.readBy || [],
    attachments: extra.attachments || [],
    reactions: extra.reactions || [],
    pinned: Boolean(extra.pinned),
    replyCount: extra.replyCount !== undefined ? Number(extra.replyCount) : 0,
    lastReplyAt: extra.lastReplyAt !== undefined ? extra.lastReplyAt : null,
    mentions: extra.mentions || [],
  };
}

/**
 * Membre d'une communauté.
 *
 * `extra.role` est l'objet rôle résolu (id, libellé, rang, permissions) : le
 * client n'a plus qu'à l'afficher, sans deviner la matrice des droits.
 */
function memberDto(row, extra = {}) {
  if (!row) {
    return null;
  }

  const role = extra.role ?? null;

  return {
    userId: Number(row.user_id),
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url || null,
    status: row.status || "offline",
    // Rôle complet (objet) ET sa clé système pour les comparaisons legacies.
    role,
    roleKey: role ? role.key : null,
    roleId: role ? role.id : null,
    joinedAt: toIso(row.joined_at),
  };
}

function invitationDto(row) {
  if (!row) {
    return null;
  }

  const maxUses = row.max_uses === null || row.max_uses === undefined ? null : Number(row.max_uses);
  const uses = Number(row.uses || 0);
  const expiresAt = toIso(row.expires_at);

  const expired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;
  const exhausted = maxUses !== null && uses >= maxUses;

  return {
    id: Number(row.id),
    communityId: Number(row.community_id),
    code: row.code,
    createdBy: row.created_by ? Number(row.created_by) : null,
    expiresAt,
    maxUses,
    uses,
    revokedAt: toIso(row.revoked_at),
    createdAt: toIso(row.created_at),
    isActive: !row.revoked_at && !expired && !exhausted,
  };
}

function notificationDto(row) {
  if (!row) {
    return null;
  }

  let payload = null;

  if (row.payload) {
    try {
      payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    } catch (error) {
      payload = null;
    }
  }

  return {
    id: String(row.id),
    type: row.type,
    title: row.title,
    body: row.body || null,
    payload,
    readAt: toIso(row.read_at),
    createdAt: toIso(row.created_at),
  };
}

/**
 * Pièce jointe. On n'expose JAMAIS `storage_key` : c'est le nom réel sur le
 * disque, il ne doit pas être devinable ni manipulable depuis le navigateur.
 * Le téléchargement passe par une route authentifiée.
 */
function attachmentDto(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    channelId: Number(row.channel_id),
    messageId: row.message_id === null ? null : String(row.message_id),
    uploaderId: row.uploader_id === null ? null : Number(row.uploader_id),
    fileName: row.file_name,
    mimeType: row.mime_type,
    size: Number(row.size),
    createdAt: toIso(row.created_at),
    isImage: String(row.mime_type || "").startsWith("image/"),
  };
}

/**
 * Message privé. Comme pour les salons, la suppression est logique : on renvoie
 * un marqueur explicite plutôt qu'un contenu vide ambigu.
 */
function dmMessageDto(row) {
  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    conversationId: Number(row.conversation_id),
    content: row.deleted_at ? "" : row.content,
    deleted: Boolean(row.deleted_at),
    createdAt: toIso(row.created_at),
    author: authorSummary(row),
  };
}

/**
 * Conversation privée, vue par UN participant donné.
 *
 * Le participant exposé est toujours **l'autre** : l'appelant n'a pas besoin de
 * se voir lui-même, et cela évite de divulguer la paire complète côté client.
 */
function dmConversationDto(row, extra = {}) {
  if (!row) {
    return null;
  }

  const viewerId = Number(extra.viewerId);
  const viewerIsA = Number(row.user_a_id) === viewerId;

  const otherId = viewerIsA ? Number(row.user_b_id) : Number(row.user_a_id);
  const otherName = viewerIsA ? row.b_name : row.a_name;
  const otherAvatar = viewerIsA ? row.b_avatar_url : row.a_avatar_url;
  const otherStatus = viewerIsA ? row.b_status : row.a_status;

  return {
    id: Number(row.id),
    participant: {
      id: otherId,
      name: otherName || "Utilisateur supprimé",
      avatarUrl: otherAvatar || null,
      status: otherStatus || "offline",
    },
    lastMessage: row.last_message_id
      ? {
          id: String(row.last_message_id),
          content: row.last_deleted_at ? "Message supprimé" : row.last_content || "",
          deleted: Boolean(row.last_deleted_at),
          authorId: row.last_author_id ? Number(row.last_author_id) : null,
          createdAt: toIso(row.last_created_at),
        }
      : null,
    unreadCount: Number(extra.unreadCount || 0),
    lastReadMessageId:
      extra.lastReadMessageId === undefined || extra.lastReadMessageId === null
        ? null
        : String(extra.lastReadMessageId),
    // Position de lecture de l'AUTRE participant : c'est ce qui permet à
    // l'auteur d'afficher « Lu » sur le bon message, sans le confondre avec
    // sa propre position de lecture.
    partnerLastReadMessageId:
      extra.partnerLastReadMessageId === undefined ||
      extra.partnerLastReadMessageId === null
        ? null
        : String(extra.partnerLastReadMessageId),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

module.exports = {
  toIso,
  toBoolean,
  publicUser,
  authorSummary,
  communityDto,
  categoryDto,
  channelDto,
  messageDto,
  legacyMessageDto,
  memberDto,
  invitationDto,
  notificationDto,
  attachmentDto,
  dmMessageDto,
  dmConversationDto,
};
