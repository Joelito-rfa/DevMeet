-- =============================================================================
-- 003 — Catégorie par défaut pour les communautés existantes.
--
-- La création d'une communauté range désormais son salon « general » dans une
-- catégorie « GÉNÉRAL ». Les communautés créées avant cette règle (dont la
-- communauté technique DevMeet, seedée en 002) ont des salons sans catégorie :
-- on leur ajoute la même catégorie pour que l'arborescence soit cohérente.
--
-- NON DESTRUCTIVE : aucune ligne n'est supprimée ni renommée, aucune position
-- de catégorie existante n'est modifiée. Les salons déjà rangés ne bougent pas.
-- IDEMPOTENTE : `WHERE NOT EXISTS` empêche toute catégorie en double.
-- =============================================================================

-- 1) Créer la catégorie manquante pour les communautés dont au moins un salon
--    n'est rangé dans aucune catégorie.
INSERT INTO categories (community_id, name, description, `position`, creator_id)
SELECT c.id,
       'GÉNÉRAL',
       'Catégorie par défaut de la communauté.',
       0,
       c.owner_id
FROM communities c
WHERE EXISTS (
        SELECT 1
        FROM channels ch
        WHERE ch.community_id = c.id
          AND ch.category_id IS NULL
          AND ch.archived_at IS NULL
      )
  AND NOT EXISTS (
        SELECT 1
        FROM categories cat
        WHERE cat.community_id = c.id
          AND cat.name = 'GÉNÉRAL'
      );

-- 2) Les salons sans catégorie rejoignent la catégorie « GÉNÉRAL » de LEUR
--    communauté (la jointure garantit qu'aucun salon ne change de communauté).
UPDATE channels ch
JOIN categories cat
  ON cat.community_id = ch.community_id
 AND cat.name = 'GÉNÉRAL'
SET ch.category_id = cat.id
WHERE ch.category_id IS NULL
  AND ch.archived_at IS NULL;
