const express = require("express");

const notificationsService = require("../services/notifications");
const { requireAuth } = require("../middleware/auth");
const { parseBigId } = require("../utils/validate");

const router = express.Router();

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const result = await notificationsService.list(req.user.id, {
      limit: req.query.limit,
      before: req.query.before ?? null,
    });

    res.json({
      ...result,
      unreadCount: await notificationsService.unreadCount(req.user.id),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/unread-count", async (req, res, next) => {
  try {
    res.json({ unreadCount: await notificationsService.unreadCount(req.user.id) });
  } catch (error) {
    next(error);
  }
});

router.post("/read-all", async (req, res, next) => {
  try {
    const result = await notificationsService.markAllRead(req.user.id);
    res.json({ message: "Notifications marquées comme lues.", ...result });
  } catch (error) {
    next(error);
  }
});

router.post("/:notificationId/read", async (req, res, next) => {
  try {
    const notificationId = parseBigId(req.params.notificationId, "notificationId");
    const result = await notificationsService.markRead(req.user.id, notificationId);
    res.json({ message: "Notification lue.", ...result });
  } catch (error) {
    next(error);
  }
});

router.delete("/:notificationId", async (req, res, next) => {
  try {
    const notificationId = parseBigId(req.params.notificationId, "notificationId");
    const result = await notificationsService.remove(req.user.id, notificationId);
    res.json({ message: "Notification supprimée.", ...result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
