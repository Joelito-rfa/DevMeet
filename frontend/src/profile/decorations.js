/**
 * Catalogue des décorations de profil (thème gratuit, accessible à tous).
 *
 * Les identifiants sont strictement les mêmes que ceux validés par l'API
 * (`backend/src/utils/profileCustomization.js`). Les rendus sont purement CSS :
 * aucune grande image n'est chargée à l'ouverture d'un profil.
 */

export const PROFILE_BACKGROUNDS = [
  { id: "midnight-purple", label: "Midnight Purple" },
  { id: "neon-violet", label: "Neon Violet" },
  { id: "cyber-blue", label: "Cyber Blue" },
  { id: "crimson-night", label: "Crimson Night" },
  { id: "emerald-glow", label: "Emerald Glow" },
  { id: "cosmic-space", label: "Cosmic Space" },
  { id: "sunset-gradient", label: "Sunset Gradient" },
  { id: "abstract-dark", label: "Abstract Dark" },
  { id: "aurora", label: "Aurora" },
  { id: "minimal-black", label: "Minimal Black" },
];

export const PROFILE_BANNERS = [
  { id: "violet-dusk", label: "Crépuscule violet", group: "Dégradé" },
  { id: "abstract-shard", label: "Éclat abstrait", group: "Abstrait" },
  { id: "cosmic-nebula", label: "Nébuleuse", group: "Espace" },
  { id: "light-waves", label: "Vagues de lumière", group: "Vagues" },
  { id: "cyber-grid", label: "Grille cyber", group: "Cyber" },
  { id: "emerald-aurora", label: "Aurore émeraude", group: "Abstrait" },
  { id: "crimson-ember", label: "Braise écarlate", group: "Dégradé" },
  { id: "minimal-line", label: "Ligne minérale", group: "Minimaliste" },
];

export const AVATAR_FRAMES = [
  { id: "purple-neon", label: "Purple Neon" },
  { id: "electric-blue", label: "Electric Blue" },
  { id: "crimson-ring", label: "Crimson Ring" },
  { id: "emerald-ring", label: "Emerald Ring" },
  { id: "cosmic-frame", label: "Cosmic Frame" },
  { id: "minimal-silver", label: "Minimal Silver" },
  { id: "golden-glow", label: "Golden Glow" },
  { id: "cyber-frame", label: "Cyber Frame" },
];

export const PROFILE_EFFECTS = [
  {
    id: "halo",
    label: "Halo lumineux",
    description: "Une lueur douce autour de la carte.",
  },
  {
    id: "violet-glow",
    label: "Lueur violette",
    description: "Un halo violet discret, sans flash.",
  },
  {
    id: "animated-outline",
    label: "Contour animé",
    description: "Un liseré lent autour du profil.",
  },
  {
    id: "particles",
    label: "Particules",
    description: "Quelques points lumineux statiques ou lents.",
  },
  {
    id: "neon-static",
    label: "Néon statique",
    description: "Un contour néon net, sans animation.",
  },
  {
    id: "holographic",
    label: "Holographique",
    description: "Un reflet irisé subtil sur la carte.",
  },
];

export const DEFAULT_DECORATIONS = Object.freeze({
  profileBackground: null,
  profileBanner: null,
  avatarFrame: null,
  profileEffects: [],
});

const BACKGROUND_IDS = new Set(PROFILE_BACKGROUNDS.map((item) => item.id));
const BANNER_IDS = new Set(PROFILE_BANNERS.map((item) => item.id));
const FRAME_IDS = new Set(AVATAR_FRAMES.map((item) => item.id));

function validId(set, value) {
  return typeof value === "string" && set.has(value) ? value : null;
}

/** Nettoie une liste d'effets venant de la base, du formulaire ou d'un cache. */
export function normalizeEffectList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return PROFILE_EFFECTS.map((effect) => effect.id).filter((id) =>
    value.includes(id)
  );
}

/** Lit les décorations d'un utilisateur de l'API, avec valeurs par défaut. */
export function readDecorations(user) {
  return {
    profileBackground: validId(BACKGROUND_IDS, user?.profileBackground),
    profileBanner: validId(BANNER_IDS, user?.profileBanner),
    avatarFrame: validId(FRAME_IDS, user?.avatarFrame),
    profileEffects: normalizeEffectList(user?.profileEffects),
  };
}

/** Objet envoyé à l'API : les valeurs vides sont explicitement effacées. */
export function decorationsPayload(decorations) {
  return {
    profileBackground: decorations?.profileBackground || null,
    profileBanner: decorations?.profileBanner || null,
    avatarFrame: decorations?.avatarFrame || null,
    profileEffects: normalizeEffectList(decorations?.profileEffects),
  };
}

export function hasDecorations(decorations) {
  return Boolean(
    decorations?.profileBackground ||
      decorations?.profileBanner ||
      decorations?.avatarFrame ||
      (decorations?.profileEffects?.length ?? 0) > 0
  );
}

export function effectClassList(effects) {
  return normalizeEffectList(effects)
    .map((id) => `pf-effect-${id}`)
    .join(" ");
}

export function backgroundClass(id) {
  return id ? `pf-bg-${id}` : "";
}

export function bannerClass(id) {
  return id ? `pf-banner-${id}` : "";
}

export function frameClass(id) {
  return id ? `pf-frame-${id}` : "";
}
