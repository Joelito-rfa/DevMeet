-- =============================================================================
-- Données techniques minimales.
--
-- Communauté « DevMeet » : elle héberge les salons créés via l'ancien
-- protocole (nom + code d'accès) afin que rien ne soit perdu côté client.
-- Elle n'appartient à personne (owner_id NULL) et ne peut être ni renommée
-- ni supprimée via l'API.
-- =============================================================================

INSERT INTO communities (id, name, description, is_public, is_system, owner_id)
SELECT 1,
       'DevMeet',
       'Communauté historique : salons créés avec un code d''accès.',
       1,
       1,
       NULL
WHERE NOT EXISTS (SELECT 1 FROM communities WHERE id = 1);

INSERT INTO channels (community_id, name, type, is_private, `position`, legacy_room_id, description)
SELECT 1,
       'Général',
       'text',
       0,
       0,
       'general',
       'Salon général historique de DevMeet.'
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE legacy_room_id = 'general');
