const express = require("express");

const channelsService = require("../services/channels");
const messagesService = require("../services/messages");
const boardsService = require("../services/boards");
const attachmentsService = require("../services/attachments");
const reactionsService = require("../services/reactions");
const pinsService = require("../services/pins");
const communities = require("../services/communities");
const bus = require("../realtime/bus");
const notify = require("../realtime/notify");
const { requireAuth } = require("../middleware/auth");
const { requireChannelAccess } = require("../middleware/channel");
const { singleFile, storeFile, sendFile } = require("../middleware/uploads");
const {
  PERMISSIONS,
  hasPermission,
  effectivePermissions,
} = require("../permissions");
const {
  requireString,
  optionalString,
  parseBoolean,
  parseId,
  normalizeChannelName,
} = require("../utils/validate");
const { forbidden, notFound, badRequest } = require("../utils/errors");

const router = express.Router();

router.use(requireAuth);

/** Détail d'un salon (`:channelId` accepte aussi un identifiant historique). */
router.get("/:channelId", requireChannelAccess(), async (req, res, next) => {
  try {
    const role = req.channelAccess.role;

    res.json({
      channel: channelsService.serializeChannel(req.channel),
      // Rôle effectif de l'appelant DANS CE SALON et permissions qui en
      // découlent. L'interface s'en sert uniquement pour ne pas proposer une
      // action qui serait refusée : le serveur revérifie tout de toute façon.
      role,
      permissions: effectivePermissions(role),
    });
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/:channelId",
  requireChannelAccess(),
  async (req, res, next) => {
    try {
      const role = req.channelAccess.role;

      if (!hasPermission(role, PERMISSIONS.MANAGE_CHANNELS)) {
        throw forbidden("Votre rôle ne permet pas de modifier ce salon.", "missing_permission");
      }

      const patch = {};

      if (req.body?.name !== undefined) {
        const raw = requireString(req.body.name, "nom du salon", { min: 1, max: 80 });
        patch.name =
          req.channel.type === "text" || req.channel.type === "board"
            ? normalizeChannelName(raw)
            : raw;
      }

      if (req.body?.description !== undefined) {
        patch.description = optionalString(req.body.description, "description", {
          max: 300,
        });
      }

      if (req.body?.isPrivate !== undefined) {
        patch.isPrivate = parseBoolean(req.body.isPrivate, false);
      }

      if (req.body?.type !== undefined) {
        patch.type = req.body.type;
      }

      if (req.body?.accessCode !== undefined) {
        patch.accessCode = optionalString(req.body.accessCode, "code d'accès", {
          max: 120,
        });
      }

      if (req.body?.archived !== undefined) {
        patch.archived = parseBoolean(req.body.archived, false);
      }

      const channel = await channelsService.update(req.channel.id, patch);

      bus.toCommunity(req.channel.community_id, "channel:updated", {
        communityId: Number(req.channel.community_id),
        channel,
      });

      res.json({ message: "Salon mis à jour.", channel });
    } catch (error) {
      next(error);
    }
  }
);

router.delete("/:channelId", requireChannelAccess(), async (req, res, next) => {
  try {
    const role = req.channelAccess.role;

    if (!hasPermission(role, PERMISSIONS.MANAGE_CHANNELS)) {
      throw forbidden("Votre rôle ne permet pas de supprimer ce salon.", "missing_permission");
    }

    const communityId = Number(req.channel.community_id);
    const result = await channelsService.remove(req.channel.id);

    bus.toCommunity(communityId, "channel:deleted", {
      communityId,
      ...result,
    });

    res.json({ message: "Salon supprimé.", ...result });
  } catch (error) {
    next(error);
  }
});

/**
 * Déplacer un salon : changement de catégorie (ou « sans catégorie ») et/ou
 * changement de position, les deux dans une seule transaction.
 */
router.post("/:channelId/move", requireChannelAccess(), async (req, res, next) => {
  try {
    const role = req.channelAccess.role;

    if (!hasPermission(role, PERMISSIONS.MANAGE_CHANNELS)) {
      throw forbidden("Votre rôle ne permet pas de déplacer ce salon.", "missing_permission");
    }

    const categoryId =
      req.body?.categoryId === undefined || req.body?.categoryId === null
        ? null
        : parseId(req.body.categoryId, "categoryId");

    const position =
      req.body?.position === undefined || req.body?.position === null
        ? undefined
        : Number.parseInt(req.body.position, 10);

    const channel = await channelsService.move(req.channel.id, {
      categoryId,
      position,
    });

    bus.toCommunity(Number(req.channel.community_id), "channel:moved", {
      communityId: Number(req.channel.community_id),
      channel,
      fromCategoryId: req.channel.category_id ? Number(req.channel.category_id) : null,
      toCategoryId: categoryId,
    });

    res.json({ message: "Salon déplacé.", channel });
  } catch (error) {
    next(error);
  }
});

/**
 * Déverrouillage d'un salon protégé par un code d'accès.
 *
 * Cette route ne peut pas utiliser `requireChannelAccess()` : par définition,
 * l'accès est justement refusé avant la saisie du code. On résout donc le salon
 * ici, puis on applique la règle unique du service (`unlock`).
 *
 * Un code correct crée une autorisation permanente (`channel_members`).
 */
router.post("/:channelId/unlock", async (req, res, next) => {
  try {
    const channel = await channelsService.resolveByClientId(req.params.channelId);

    if (!channel) {
      throw notFound("Salon introuvable.", "channel_not_found");
    }

    const result = await channelsService.unlock(
      channel,
      req.user.id,
      req.body?.accessCode
    );

    res.json({
      message: result.grantedByCode
        ? "Accès accordé : le code d'accès est enregistré pour ce compte."
        : "Accès déjà autorisé.",
      channel: channelsService.serializeChannel(channel),
      grantedByCode: result.grantedByCode,
    });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------------
// Membres d'un salon privé
// -----------------------------------------------------------------------------

router.get("/:channelId/members", requireChannelAccess(), async (req, res, next) => {
  try {
    const members = await channelsService.listMembers(req.channel.id);
    res.json({ members });
  } catch (error) {
    next(error);
  }
});

router.post("/:channelId/members", requireChannelAccess(), async (req, res, next) => {
  try {
    const role = req.channelAccess.role;

    if (!hasPermission(role, PERMISSIONS.MANAGE_MEMBERS)) {
      throw forbidden(
        "Votre rôle ne permet pas de gérer les accès à ce salon.",
        "missing_permission"
      );
    }

    const userId = parseId(req.body?.userId, "userId");
    const membership = await communities.getMembership(
      req.channel.community_id,
      userId
    );

    if (!membership) {
      throw forbidden(
        "Cet utilisateur n'appartient pas à la communauté.",
        "not_a_member"
      );
    }

    await channelsService.addMember(req.channel.id, userId);

    bus.toUser(userId, "channel:access:granted", {
      channelId: Number(req.channel.id),
      communityId: Number(req.channel.community_id),
    });

    res.status(201).json({ message: "Accès accordé.", channelId: Number(req.channel.id), userId });
  } catch (error) {
    next(error);
  }
});

router.delete("/:channelId/members/:userId", requireChannelAccess(), async (req, res, next) => {
  try {
    const role = req.channelAccess.role;

    if (!hasPermission(role, PERMISSIONS.MANAGE_MEMBERS)) {
      throw forbidden(
        "Votre rôle ne permet pas de gérer les accès à ce salon.",
        "missing_permission"
      );
    }

    const userId = parseId(req.params.userId, "userId");
    await channelsService.removeMember(req.channel.id, userId);

    bus.toUser(userId, "channel:access:revoked", {
      channelId: Number(req.channel.id),
      communityId: Number(req.channel.community_id),
    });

    res.json({ message: "Accès retiré.", channelId: Number(req.channel.id), userId });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

router.get("/:channelId/messages", requireChannelAccess(), async (req, res, next) => {
  try {
    const result = await messagesService.list({
      channelId: req.channel.id,
      limit: req.query.limit,
      before: req.query.before ?? null,
      after: req.query.after ?? null,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:channelId/messages", requireChannelAccess(), async (req, res, next) => {
  try {
    const role = req.channelAccess.role;

    if (!hasPermission(role, PERMISSIONS.SEND_MESSAGES)) {
      throw forbidden("Votre rôle ne permet pas d'écrire ici.", "missing_permission");
    }

    // Un salon d'annonces n'accepte que les publications autorisées.
    if (req.channel.type === "announcement") {
      if (!hasPermission(role, PERMISSIONS.PUBLISH_ANNOUNCEMENTS)) {
        throw forbidden(
          "Seuls les responsables peuvent publier une annonce.",
          "missing_permission"
        );
      }
    }

    const content = requireString(req.body?.content ?? req.body?.message, "message", {
      min: 1,
      max: 4000,
    });

    const message = await messagesService.create({
      channelId: req.channel.id,
      authorId: req.user.id,
      content,
      replyToId: req.body?.replyToId ? String(req.body.replyToId) : null,
      attachmentIds: req.body?.attachmentIds ?? null,
      // Sert uniquement à résoudre les mentions contre les membres réels.
      communityId: Number(req.channel.community_id),
    });

    bus.toChannel(req.channel.id, "message:new", {
      channelId: Number(req.channel.id),
      communityId: Number(req.channel.community_id),
      message,
    });

    // Notifications réelles : mentions (@nom reconnus par le serveur) et réponse
    // à un message. L'auteur n'est jamais notifié de sa propre action.
    await notify.notifyMentions({
      mentionedUserIds: message.mentions,
      actorId: req.user.id,
      actorName: req.user.name,
      channelName: req.channel.name,
      channelId: req.channel.id,
      communityId: req.channel.community_id,
      messageId: message.id,
      excerpt: message.content,
    });

    if (message.replyToId) {
      const parent = await messagesService.getById(message.replyToId);

      await notify.notifyReply({
        parentAuthorId: parent?.author_id,
        actorId: req.user.id,
        actorName: req.user.name,
        channelName: req.channel.name,
        channelId: req.channel.id,
        communityId: req.channel.community_id,
        messageId: message.id,
        excerpt: message.content,
      });
    }

    res.status(201).json({ message: "Message envoyé.", data: message });
  } catch (error) {
    next(error);
  }
});

router.post("/:channelId/read", requireChannelAccess(), async (req, res, next) => {
  try {
    const messageId = req.body?.messageId ?? req.body?.message_id;

    if (!messageId) {
      return res.json({ channelId: Number(req.channel.id), skipped: true });
    }

    const result = await messagesService.markRead({
      channelId: req.channel.id,
      userId: req.user.id,
      messageId: String(messageId),
    });

    bus.toChannel(req.channel.id, "message:read", {
      channelId: Number(req.channel.id),
      messageId: result.messageId,
      readerId: Number(req.user.id),
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.delete("/:channelId/messages/:messageId", requireChannelAccess(), async (req, res, next) => {
  try {
    const role = req.channelAccess.role;
    const canModerate = hasPermission(role, PERMISSIONS.MODERATE_MESSAGES);

    const result = await messagesService.remove(req.params.messageId, {
      actorId: req.user.id,
      canModerate,
    });

    bus.toChannel(req.channel.id, "message:deleted", {
      channelId: Number(req.channel.id),
      ...result,
    });

    res.json({ message: "Message supprimé.", ...result });
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------------
// Messagerie avancée : recherche, réactions, épinglage, fils
// -----------------------------------------------------------------------------

/**
 * Recherche dans l'historique du salon.
 *
 * Un salon vocal n'a pas de messages : la recherche y renvoie une liste vide
 * plutôt qu'une erreur (l'interface n'affiche pas l'onglet recherche).
 */
router.get("/:channelId/messages/search", requireChannelAccess(), async (req, res, next) => {
  try {
    const term = requireString(req.query.q ?? req.query.search, "recherche", {
      min: 2,
      max: 120,
    });

    const result = await messagesService.search({
      channelIds: [req.channel.id],
      term,
      limit: req.query.limit,
      before: req.query.before ?? null,
    });

    res.json({ ...result, channelId: Number(req.channel.id) });
  } catch (error) {
    next(error);
  }
});

/** Réponses d'un fil de discussion. */
router.get(
  "/:channelId/messages/:messageId/replies",
  requireChannelAccess(),
  async (req, res, next) => {
    try {
      const replies = await messagesService.listReplies({
        channelId: req.channel.id,
        messageId: req.params.messageId,
        limit: req.query.limit,
      });

      res.json({
        parentId: String(req.params.messageId),
        channelId: Number(req.channel.id),
        replies,
      });
    } catch (error) {
      next(error);
    }
  }
);

/** Ajouter une réaction. L'emoji est validé contre une liste blanche. */
router.post(
  "/:channelId/messages/:messageId/reactions",
  requireChannelAccess(),
  async (req, res, next) => {
    try {
      if (!hasPermission(req.channelAccess.role, PERMISSIONS.REACT_MESSAGES)) {
        throw forbidden("Votre rôle ne permet pas de réagir ici.", "missing_permission");
      }

      const result = await reactionsService.add({
        channelId: req.channel.id,
        messageId: req.params.messageId,
        userId: req.user.id,
        emoji: req.body?.emoji,
      });

      const reactions = await reactionsService.mapForMessages([
        result.messageId,
      ]);

      bus.toChannel(req.channel.id, "message:reaction", {
        channelId: Number(req.channel.id),
        messageId: result.messageId,
        emoji: result.emoji,
        userId: Number(req.user.id),
        added: true,
        reactions: reactions.get(result.messageId) || [],
      });

      res.status(201).json({
        message: "Réaction ajoutée.",
        ...result,
        reactions: reactions.get(result.messageId) || [],
      });
    } catch (error) {
      next(error);
    }
  }
);

/** Retirer sa propre réaction. */
router.delete(
  "/:channelId/messages/:messageId/reactions/:emoji",
  requireChannelAccess(),
  async (req, res, next) => {
    try {
      if (!hasPermission(req.channelAccess.role, PERMISSIONS.REACT_MESSAGES)) {
        throw forbidden("Votre rôle ne permet pas de réagir ici.", "missing_permission");
      }

      const result = await reactionsService.remove({
        channelId: req.channel.id,
        messageId: req.params.messageId,
        userId: req.user.id,
        // Express décode déjà les paramètres d'URL (`%F0%9F%91%8D` → 👍).
        emoji: req.params.emoji,
      });

      const reactions = await reactionsService.mapForMessages([
        result.messageId,
      ]);

      bus.toChannel(req.channel.id, "message:reaction", {
        channelId: Number(req.channel.id),
        messageId: result.messageId,
        emoji: result.emoji,
        userId: Number(req.user.id),
        added: false,
        reactions: reactions.get(result.messageId) || [],
      });

      res.json({
        message: "Réaction retirée.",
        ...result,
        reactions: reactions.get(result.messageId) || [],
      });
    } catch (error) {
      next(error);
    }
  }
);

/** Messages épinglés du salon. */
router.get("/:channelId/pins", requireChannelAccess(), async (req, res, next) => {
  try {
    const pins = await messagesService.listPinned(req.channel.id, {
      limit: req.query.limit,
    });

    res.json({ channelId: Number(req.channel.id), pins });
  } catch (error) {
    next(error);
  }
});

/** Épingler un message (modérateurs et au-dessus). */
router.post(
  "/:channelId/messages/:messageId/pin",
  requireChannelAccess(),
  async (req, res, next) => {
    try {
      if (!hasPermission(req.channelAccess.role, PERMISSIONS.PIN_MESSAGES)) {
        throw forbidden(
          "Votre rôle ne permet pas d'épingler un message.",
          "missing_permission"
        );
      }

      const result = await pinsService.pin({
        channelId: req.channel.id,
        messageId: req.params.messageId,
        userId: req.user.id,
      });

      bus.toChannel(req.channel.id, "message:pinned", {
        channelId: Number(req.channel.id),
        ...result,
        actorId: Number(req.user.id),
      });

      res.status(201).json({ message: "Message épinglé.", ...result });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/:channelId/messages/:messageId/pin",
  requireChannelAccess(),
  async (req, res, next) => {
    try {
      if (!hasPermission(req.channelAccess.role, PERMISSIONS.PIN_MESSAGES)) {
        throw forbidden(
          "Votre rôle ne permet pas de détacher un message épinglé.",
          "missing_permission"
        );
      }

      const result = await pinsService.unpin({
        channelId: req.channel.id,
        messageId: req.params.messageId,
      });

      bus.toChannel(req.channel.id, "message:unpinned", {
        channelId: Number(req.channel.id),
        ...result,
        actorId: Number(req.user.id),
      });

      res.json({ message: "Message détaché.", ...result });
    } catch (error) {
      next(error);
    }
  }
);

// -----------------------------------------------------------------------------
// Pièces jointes
// -----------------------------------------------------------------------------

/**
 * Dépôt d'un fichier dans un salon.
 *
 * Le fichier est enregistré avant tout message : le message suivant le
 * référencera par `attachmentIds`. Seul l'auteur du dépôt pourra le rattacher.
 */
router.post(
  "/:channelId/attachments",
  requireChannelAccess(),
  singleFile("file"),
  async (req, res, next) => {
    try {
      if (!hasPermission(req.channelAccess.role, PERMISSIONS.SEND_MESSAGES)) {
        throw forbidden(
          "Votre rôle ne permet pas de déposer un fichier ici.",
          "missing_permission"
        );
      }

      if (!req.file) {
        throw badRequest("Aucun fichier reçu (champ « file »).", "file_missing");
      }

      const attachment = await storeFile({
        file: req.file,
        channelId: req.channel.id,
        uploaderId: req.user.id,
      });

      res.status(201).json({ message: "Fichier enregistré.", attachment });
    } catch (error) {
      next(error);
    }
  }
);

/** Téléchargement authentifié : le fichier n'est servi qu'aux ayants accès. */
router.get(
  "/:channelId/attachments/:attachmentId",
  requireChannelAccess(),
  async (req, res, next) => {
    try {
      const attachmentId = parseId(req.params.attachmentId, "attachmentId");
      const attachment = await attachmentsService.getRawById(attachmentId);

      if (!attachment || Number(attachment.channel_id) !== Number(req.channel.id)) {
        throw notFound("Pièce jointe introuvable.", "attachment_not_found");
      }

      await sendFile(res, attachment);
    } catch (error) {
      next(error);
    }
  }
);

// -----------------------------------------------------------------------------
// Tableau blanc
// -----------------------------------------------------------------------------

router.get("/:channelId/board", requireChannelAccess(), async (req, res, next) => {
  try {
    if (
      !hasPermission(req.channelAccess.role, PERMISSIONS.ACCESS_WHITEBOARD) &&
      req.channelAccess.community.is_public !== 1
    ) {
      throw forbidden("Accès au tableau blanc refusé.", "missing_permission");
    }

    const board = await boardsService.get(req.channel.id);
    res.json({ board });
  } catch (error) {
    next(error);
  }
});

router.put("/:channelId/board", requireChannelAccess(), async (req, res, next) => {
  try {
    if (
      !hasPermission(req.channelAccess.role, PERMISSIONS.ACCESS_WHITEBOARD) &&
      req.channelAccess.community.is_public !== 1
    ) {
      throw forbidden("Modification du tableau blanc refusée.", "missing_permission");
    }

    const board = await boardsService.save(req.channel.id, req.body?.data ?? null, req.user.id, {
      expectedVersion:
        req.body?.expectedVersion === undefined ? null : req.body.expectedVersion,
    });

    bus.toChannel(req.channel.id, "board:update", {
      channelId: Number(req.channel.id),
      board,
    });

    res.json({ message: "Tableau enregistré.", board });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
