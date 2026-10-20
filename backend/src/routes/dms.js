const express = require("express");

const dms = require("../services/dms");
const bus = require("../realtime/bus");
const notify = require("../realtime/notify");
const { requireAuth } = require("../middleware/auth");
const { requireString, parseId, parseBigId } = require("../utils/validate");

/**
 * Messagerie privée entre comptes.
 *
 * Aucune permission de communauté n'intervient : l'accès dépend uniquement du
 * fait d'être l'un des deux participants. Un tiers reçoit un `404`, identique à
 * celui d'une conversation inexistante (aucune fuite d'information).
 *
 * La diffusion passe par la chambre personnelle `user:<id>` : un message privé
 * ne peut donc jamais atteindre un compte qui n'est pas participant.
 */
const router = express.Router();

router.use(requireAuth);

/** Mes conversations, la plus récemment active en tête. */
router.get("/", async (req, res, next) => {
  try {
    const conversations = await dms.listForUser(req.user.id);
    res.json({ conversations });
  } catch (error) {
    next(error);
  }
});

/** Badge de navigation : total des messages privés non lus. */
router.get("/unread-count", async (req, res, next) => {
  try {
    res.json({ unreadCount: await dms.totalUnread(req.user.id) });
  } catch (error) {
    next(error);
  }
});

/** Contacts avec qui ouvrir une conversation (communautés partagées). */
router.get("/candidates", async (req, res, next) => {
  try {
    const search =
      typeof req.query.search === "string" && req.query.search.trim()
        ? req.query.search.trim()
        : null;

    res.json({ candidates: await dms.listCandidates(req.user.id, { search }) });
  } catch (error) {
    next(error);
  }
});

/** Ouvrir la conversation avec un compte, ou retrouver celle qui existe. */
router.post("/", async (req, res, next) => {
  try {
    const otherUserId = parseId(req.body?.userId, "userId");

    const { conversation, created } = await dms.getOrCreate(
      req.user.id,
      otherUserId
    );

    const view = await dms.viewFor(conversation.id, req.user.id);

    res.status(created ? 201 : 200).json({
      message: created ? "Conversation ouverte." : "Conversation existante.",
      conversation: view,
    });
  } catch (error) {
    next(error);
  }
});

/** Historique d'une conversation (paginé par curseur). */
router.get("/:conversationId/messages", async (req, res, next) => {
  try {
    const conversationId = parseId(req.params.conversationId, "conversationId");

    await dms.assertAccess(conversationId, req.user.id);

    const result = await dms.listMessages(conversationId, {
      limit: req.query.limit,
      before: req.query.before ?? null,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Écrire un message privé. */
router.post("/:conversationId/messages", async (req, res, next) => {
  try {
    const conversationId = parseId(req.params.conversationId, "conversationId");

    const conversation = await dms.assertAccess(conversationId, req.user.id);

    const content = requireString(
      req.body?.content ?? req.body?.message,
      "message",
      { min: 1, max: 4000 }
    );

    const message = await dms.createMessage({
      conversationId,
      authorId: req.user.id,
      content,
    });

    // Diffusion aux deux participants — et à eux seuls.
    if (bus.isBound()) {
      for (const userId of dms.participantsOf(conversation)) {
        bus.toUser(userId, "dm:new", {
          conversationId: Number(conversationId),
          message,
        });
      }
    }

    // Notification persistée : le destinataire la retrouve même hors ligne.
    await notify.notifyDirectMessage({
      recipientId: dms.otherParticipant(conversation, req.user.id),
      actorId: req.user.id,
      actorName: req.user.name,
      conversationId,
      messageId: message.id,
      excerpt: content,
    });

    res.status(201).json({ message: "Message envoyé.", data: message });
  } catch (error) {
    next(error);
  }
});

/** Marquer la conversation comme lue (pour le compte connecté). */
router.post("/:conversationId/read", async (req, res, next) => {
  try {
    const conversationId = parseId(req.params.conversationId, "conversationId");

    const conversation = await dms.assertAccess(conversationId, req.user.id);

    const messageId = req.body?.messageId
      ? parseBigId(req.body.messageId, "messageId")
      : null;

    const result = await dms.markRead({
      conversationId,
      userId: req.user.id,
      messageId,
    });

    // L'auteur voit « Lu » sans recharger la page.
    if (bus.isBound() && !result.skipped) {
      bus.toUser(dms.otherParticipant(conversation, req.user.id), "dm:read", {
        conversationId: Number(conversationId),
        readerId: Number(req.user.id),
        messageId: result.messageId,
      });
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** Supprimer son propre message (suppression logique). */
router.delete("/:conversationId/messages/:messageId", async (req, res, next) => {
  try {
    const conversationId = parseId(req.params.conversationId, "conversationId");

    const conversation = await dms.assertAccess(conversationId, req.user.id);

    const messageId = parseBigId(req.params.messageId, "messageId");

    const result = await dms.removeMessage({
      conversationId,
      messageId,
      actorId: req.user.id,
    });

    if (bus.isBound()) {
      for (const userId of dms.participantsOf(conversation)) {
        bus.toUser(userId, "dm:deleted", { ...result });
      }
    }

    res.json({ message: "Message supprimé.", ...result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
