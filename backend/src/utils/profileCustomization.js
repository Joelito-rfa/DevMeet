/**
 * Catalogue des décorations de profil acceptées par l'API.
 *
 * Les identifiants sont partagés avec `frontend/src/profile/decorations.js`.
 * Le serveur reste la source de vérité pour l'écriture : un client ne peut pas
 * enregistrer une valeur arbitraire, même en contournant l'interface.
 */

const PROFILE_BACKGROUNDS = [
  "midnight-purple",
  "neon-violet",
  "cyber-blue",
  "crimson-night",
  "emerald-glow",
  "cosmic-space",
  "sunset-gradient",
  "abstract-dark",
  "aurora",
  "minimal-black",
];

const PROFILE_BANNERS = [
  "violet-dusk",
  "abstract-shard",
  "cosmic-nebula",
  "light-waves",
  "cyber-grid",
  "emerald-aurora",
  "crimson-ember",
  "minimal-line",
];

const AVATAR_FRAMES = [
  "purple-neon",
  "electric-blue",
  "crimson-ring",
  "emerald-ring",
  "cosmic-frame",
  "minimal-silver",
  "golden-glow",
  "cyber-frame",
];

const PROFILE_EFFECTS = [
  "halo",
  "violet-glow",
  "animated-outline",
  "particles",
  "neon-static",
  "holographic",
];

const ALLOWED_THEMES = [
  "discord-dark",
  "midnight",
  "badass",
  "ocean",
  "emerald",
  "sunset",
  "cotton-candy",
  // Valeurs historiques conservées pour les clients déjà installés.
  "dark",
  "light",
  "system",
];

/** Les effets sont stockés en JSON, mais peuvent arriver déjà analysés. */
function parseEffects(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

module.exports = {
  PROFILE_BACKGROUNDS,
  PROFILE_BANNERS,
  AVATAR_FRAMES,
  PROFILE_EFFECTS,
  ALLOWED_THEMES,
  parseEffects,
};
