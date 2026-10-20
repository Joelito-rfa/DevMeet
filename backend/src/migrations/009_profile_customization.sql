-- =============================================================================
-- Personnalisation visuelle du profil (gratuite pour tous les comptes).
--
-- Quatre préférences indépendantes :
--   - profile_background : fond de la carte de profil ;
--   - profile_banner     : bannière affichée en haut du profil ;
--   - avatar_frame       : cadre décoratif autour de l'avatar ;
--   - profile_effects    : liste JSON d'effets légers (halo, particules…).
--
-- Les valeurs sont des identifiants validés côté serveur. `NULL` signifie
-- « aucune décoration » : les comptes existants n'ont donc rien à migrer.
-- Aucune permission, rôle ou donnée d'authentification n'est stockée ici.
-- =============================================================================

ALTER TABLE users
  ADD COLUMN profile_background VARCHAR(40) NULL AFTER theme,
  ADD COLUMN profile_banner VARCHAR(40) NULL AFTER profile_background,
  ADD COLUMN avatar_frame VARCHAR(40) NULL AFTER profile_banner,
  ADD COLUMN profile_effects JSON NULL AFTER avatar_frame;
