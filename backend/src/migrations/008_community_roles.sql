-- =============================================================================
-- DevMeet 2.0 — rôles par communauté (RBAC stocké en base)
--
-- Objectif : les rôles ne sont plus un ENUM figé. Chaque communauté possède
-- ses propres rôles, y compris des rôles personnalisés créés par ses membres.
--
--   roles             : un rôle par communauté (4 rôles système amorcés +
--                       autant de rôles personnalisés que voulu)
--   role_permissions  : permissions accordées à un rôle
--   community_members : `role_id` remplace l'ENUM `role`
--
-- Migration additive puis normalisation : l'ENUM `role` est supprimé à la fin,
-- une fois `role_id` renseigné pour TOUS les membres existants.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rôles d'une communauté
--   `key` : owner | admin | moderator | member pour les rôles système,
--           NULL pour un rôle personnalisé (le libellé est alors libre).
--   `rank`: hiérarchie. 100 = propriétaire, 10 = membre. Un rôle personnalisé
--           se place entre 1 et 99, et ne peut pas prendre un rang déjà utilisé
--           par un rôle système.
-- =============================================================================
CREATE TABLE IF NOT EXISTS roles (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  community_id  INT UNSIGNED NOT NULL,
  `key`         VARCHAR(32)  NULL,
  name          VARCHAR(60)  NOT NULL,
  description   VARCHAR(300) NULL,
  color         VARCHAR(20)  NULL,
  `rank`        INT UNSIGNED NOT NULL DEFAULT 10,
  is_system     TINYINT(1)   NOT NULL DEFAULT 0,
  is_assignable TINYINT(1)   NOT NULL DEFAULT 1,
  `position`    INT          NOT NULL DEFAULT 0,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_community_key (community_id, `key`),
  UNIQUE KEY uq_roles_community_name (community_id, name),
  KEY idx_roles_community_rank (community_id, `position`, `rank`),
  CONSTRAINT fk_roles_community FOREIGN KEY (community_id)
    REFERENCES communities (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Permissions d'un rôle
--   `'*'` n'est PAS stockable : le propriétaire a toutes les permissions par
--   construction (`services/roles.resolveRole` Court-circuite sur le rôle owner).
-- =============================================================================
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id    INT UNSIGNED NOT NULL,
  permission VARCHAR(40)  NOT NULL,
  PRIMARY KEY (role_id, permission),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id)
    REFERENCES roles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Rattachement du membre à un rôle
--   Ajoutée nullable : la colonne est remplie juste après, puis durcie.
-- =============================================================================
ALTER TABLE community_members
  ADD COLUMN role_id INT UNSIGNED NULL AFTER user_id;

-- -----------------------------------------------------------------------------
-- Amorçage : un jeu de rôles système par communauté
--   NOT EXISTS rend l'opération rejouable sans dupliquer les rôles.
-- =============================================================================
INSERT INTO roles (community_id, `key`, name, description, `rank`, is_system, is_assignable, `position`)
SELECT c.id, s.role_key, s.role_name, s.role_desc, s.role_rank, 1, 1, s.role_position
FROM communities c
CROSS JOIN (
  SELECT 'owner' AS role_key, 'Propriétaire' AS role_name,
         'Propriétaire de la communauté.' AS role_desc,
         100 AS role_rank, 0 AS role_position
  UNION ALL SELECT 'admin', 'Administrateur',
         'Administre la communauté, les rôles, les salons et les membres.', 75, 1
  UNION ALL SELECT 'moderator', 'Modérateur',
         'Modère les échanges et invite des membres.', 50, 2
  UNION ALL SELECT 'member', 'Membre',
         'Participe aux échanges.', 10, 3
) s
WHERE NOT EXISTS (
  SELECT 1 FROM roles r WHERE r.community_id = c.id AND r.`key` = s.role_key
);

-- -----------------------------------------------------------------------------
-- Permissions des rôles système (matrice d'origine)
--   Le propriétaire est ignoré : il possède tout par construction.
-- =============================================================================
INSERT IGNORE INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
CROSS JOIN (
  SELECT 'admin' AS role_key, 'community:update' AS permission
  UNION ALL SELECT 'admin', 'role:manage'
  UNION ALL SELECT 'admin', 'category:manage'
  UNION ALL SELECT 'admin', 'channel:manage'
  UNION ALL SELECT 'admin', 'member:invite'
  UNION ALL SELECT 'admin', 'member:manage'
  UNION ALL SELECT 'admin', 'message:moderate'
  UNION ALL SELECT 'admin', 'message:send'
  UNION ALL SELECT 'admin', 'message:react'
  UNION ALL SELECT 'admin', 'message:pin'
  UNION ALL SELECT 'admin', 'voice:join'
  UNION ALL SELECT 'admin', 'announcement:publish'
  UNION ALL SELECT 'admin', 'board:access'
  UNION ALL SELECT 'moderator', 'member:invite'
  UNION ALL SELECT 'moderator', 'message:moderate'
  UNION ALL SELECT 'moderator', 'message:send'
  UNION ALL SELECT 'moderator', 'message:react'
  UNION ALL SELECT 'moderator', 'message:pin'
  UNION ALL SELECT 'moderator', 'voice:join'
  UNION ALL SELECT 'moderator', 'board:access'
  UNION ALL SELECT 'member', 'message:send'
  UNION ALL SELECT 'member', 'message:react'
  UNION ALL SELECT 'member', 'voice:join'
  UNION ALL SELECT 'member', 'board:access'
) p
WHERE r.`key` = p.role_key;

-- -----------------------------------------------------------------------------
-- Normalisation des membres : ENUM `role` -> `role_id`
-- =============================================================================
UPDATE community_members cm
INNER JOIN roles r
  ON r.community_id = cm.community_id AND r.`key` = cm.role
SET cm.role_id = r.id
WHERE cm.role_id IS NULL;

-- Toute ligne restée sans rôle est un état invalide : on la rattache au rôle
-- « membre » de sa communauté plutôt que de laisser une adhésion sans droits.
UPDATE community_members cm
INNER JOIN roles r
  ON r.community_id = cm.community_id AND r.`key` = 'member'
SET cm.role_id = r.id
WHERE cm.role_id IS NULL;

ALTER TABLE community_members
  MODIFY COLUMN role_id INT UNSIGNED NOT NULL;

-- -----------------------------------------------------------------------------
-- Suppression de l'ancien ENUM et de son index
-- =============================================================================
ALTER TABLE community_members
  DROP KEY idx_community_members_role;

ALTER TABLE community_members
  DROP COLUMN role;

ALTER TABLE community_members
  ADD KEY idx_community_members_role_id (community_id, role_id),
  ADD CONSTRAINT fk_cm_role FOREIGN KEY (role_id)
    REFERENCES roles (id) ON DELETE RESTRICT;