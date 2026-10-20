const express = require("express");

const usersService = require("../services/users");
const { requireAuth } = require("../middleware/auth");
const { parseId } = require("../utils/validate");
const { notFound } = require("../utils/errors");
const { profileDto } = require("../utils/serialize");

const router = express.Router();

/**
 * Profil public d'un utilisateur.
 *
 * Accessible à tout compte connecté : c'est la fiche que les autres membres
 * consultent depuis un message ou la liste des membres. Elle ne contient que
 * les informations destinées au public (jamais l'email, le thème ou un jeton).
 */
router.get("/:id/profile", requireAuth, async (req, res, next) => {
  try {
    const userId = parseId(req.params.id, "utilisateur");
    const user = await usersService.findById(userId);

    if (!user) {
      throw notFound("Utilisateur introuvable.", "user_not_found");
    }

    res.json({ profile: profileDto(user) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
