const express = require("express");

const authRouter = require("./auth");
const oauthRouter = require("./oauth");
const communitiesRouter = require("./communities");
const channelRouter = require("./channel");
const invitations = require("./invitations");
const notificationsRouter = require("./notifications");
const dmsRouter = require("./dms");

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({ status: "ok", service: "devmeet-api", version: "2.0.0" });
});

router.use("/auth", authRouter);
router.use("/auth/oauth", oauthRouter);
router.use("/communities", communitiesRouter);
router.use("/channels", channelRouter);
router.use("/invitations", invitations.publicRouter);
router.use("/notifications", notificationsRouter);
router.use("/dms", dmsRouter);

module.exports = router;
