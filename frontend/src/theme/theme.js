/**
 * Source de vérité des thèmes de l'application.
 *
 * Le thème est appliqué sur `<html data-theme="…">` : toutes les couleurs de
 * l'interface passent par les jetons `--color-*` définis dans `index.css`.
 * La préférence est enregistrée en base (`users.theme`) pour les comptes
 * connectés, et dans `localStorage` pour les visiteurs / l'affichage immédiat.
 *
 * Tous les thèmes sont gratuits : aucun abonnement, aucun déblocage payant.
 */

export const DEFAULT_THEME = "discord-dark";

/** Thèmes proposés dans Paramètres → Apparence → Thèmes. */
export const APP_THEMES = [
  {
    id: "discord-dark",
    label: "Discord Dark",
    tagline: "Anthracite, gris profond, accent bleu-violet.",
    description:
      "L'ambiance classique et familière : des surfaces anthracite, des panneaux gris foncé et un accent bleu-violet.",
    free: true,
  },
  {
    id: "midnight",
    label: "Midnight",
    tagline: "Presque noir, bleu nuit, accent électrique.",
    description:
      "Une ambiance profonde et minimaliste : fond presque noir, panneaux bleu nuit et bleu électrique.",
    free: true,
  },
  {
    id: "badass",
    label: "BADASS",
    tagline: "Sombre. Intense. Sans limites.",
    description:
      "Un dark premium aux accents violets et roses électriques, avec des éléments actifs très visibles.",
    free: true,
  },
  {
    id: "ocean",
    label: "Ocean",
    tagline: "Bleu marine, profondeur, cyan technologique.",
    description:
      "Une ambiance fraîche et technologique : fond bleu marine, panneaux profonds et accent cyan.",
    free: true,
  },
  {
    id: "emerald",
    label: "Emerald",
    tagline: "Vert profond, émeraude, élégance discrète.",
    description:
      "Un thème sombre et élégant : panneaux vert profond, accent émeraude et contrastes sobres.",
    free: true,
  },
  {
    id: "sunset",
    label: "Sunset",
    tagline: "Anthracite chaleureux, orange et rose.",
    description:
      "Une ambiance chaleureuse : fond anthracite, reflets orange et rose, sans surcharge lumineuse.",
    free: true,
  },
  {
    id: "cotton-candy",
    label: "Cotton Candy",
    tagline: "Violacé doux, rose pastel et bleu ciel.",
    description:
      "Une palette tendre et colorée : fond sombre légèrement violacé, accents rose pastel et bleu ciel.",
    free: true,
  },
];

/** Identifiants connus (les valeurs héritées restent lisibles côté API). */
const KNOWN_THEMES = new Set(APP_THEMES.map((theme) => theme.id));

/**
 * Correspondances des anciennes préférences. Les comptes qui avaient choisi
 * « Sombre » retrouvent donc automatiquement le thème par défaut actuel, sans
 * migration de données ni écran cassé.
 */
const LEGACY_THEME_ALIASES = {
  dark: "discord-dark",
  light: "discord-dark",
  system: "discord-dark",
};

/**
 * Normalise une valeur pouvant venir de la base ou du stockage local.
 * `light` et `system` restent acceptés par l'API (compatibilité) mais
 * s'affichent avec le thème sombre par défaut.
 */
export function normalizeTheme(value) {
  if (typeof value !== "string") {
    return DEFAULT_THEME;
  }

  const id = value.trim().toLowerCase();
  const normalized = LEGACY_THEME_ALIASES[id] || id;

  return KNOWN_THEMES.has(normalized) ? normalized : DEFAULT_THEME;
}

export const THEME_STORAGE_KEY = "devmeet.theme";

/** Lit le thème mémorisé dans le navigateur (jamais de donnée sensible). */
export function readStoredTheme() {
  if (typeof window === "undefined") {
    return DEFAULT_THEME;
  }

  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

/** Mémorise le thème localement, sans jamais toucher au jeton de session. */
export function storeTheme(theme) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, normalizeTheme(theme));
  } catch {
    // Stockage indisponible (navigation privée stricte) : le thème reste
    // appliqué pour la session en cours, sans persistance.
  }
}

/**
 * Applique le thème au document. L'attribut est posé sur `<html>` pour que
 * les jetons soient disponibles partout, y compris dans les portails.
 */
export function applyTheme(theme) {
  const id = normalizeTheme(theme);

  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = id;
    // Les contrôles natifs (select, scrollbars) suivent le thème sombre.
    document.documentElement.style.colorScheme = "dark";
  }

  return id;
}

/** Retrouve la définition d'un thème pour l'affichage. */
export function getThemeDefinition(theme) {
  const id = normalizeTheme(theme);
  return APP_THEMES.find((item) => item.id === id) || APP_THEMES[0];
}
