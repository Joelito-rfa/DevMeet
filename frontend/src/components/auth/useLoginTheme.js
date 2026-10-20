import { PARALLAX, THEMES } from "./AuthShowcaseThemes";

/** Thème appliqué si l'id demandé est absent ou inconnu (page jamais cassée). */
const DEFAULT_THEME_ID = "neon";

const THEME_BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

/**
 * Résout l'id de thème demandé en objet complet : palette (aurores, faisceau,
 * poussières, halo…) + amplitudes de parallaxe.
 *
 * Pure et synchrone : aucun état React, donc appelable depuis n'importe quel
 * composant, y compris plusieurs fois par rendu.
 *
 * @param {string} theme id du thème (« neon », « sunset », …)
 * @returns {object} définition complète du thème
 */
export function useLoginTheme(theme) {
  const resolved = THEME_BY_ID.get(theme) ?? THEME_BY_ID.get(DEFAULT_THEME_ID);

  return { ...resolved, ...PARALLAX[resolved.id] };
}

export default useLoginTheme;
