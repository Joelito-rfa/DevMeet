-- =============================================================================
-- DevMeet 2.0 — schéma initial
--
-- Tout est en InnoDB (clés étrangères + transactions) et en utf8mb4.
-- Les dates sont stockées en DATETIME(3) et manipulées en UTC.
-- Migration NON destructive : uniquement des CREATE TABLE IF NOT EXISTS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Comptes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(60)  NOT NULL,
  email         VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar_url    VARCHAR(500) NULL,
  bio           VARCHAR(500) NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'online',
  theme         VARCHAR(16)  NOT NULL DEFAULT 'dark',
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_seen_at  DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Communautés
--   is_system = 1 -> communauté technique qui héberge les salons historiques
--   (créés avec un code d'accès avant DevMeet 2.0). owner_id peut être NULL
--   uniquement dans ce cas : la communauté n'appartient à personne.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS communities (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80)  NOT NULL,
  description VARCHAR(300) NULL,
  icon_url    VARCHAR(500) NULL,
  is_public   TINYINT(1)   NOT NULL DEFAULT 1,
  is_system   TINYINT(1)   NOT NULL DEFAULT 0,
  owner_id    INT UNSIGNED NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_communities_owner (owner_id),
  KEY idx_communities_public (is_public),
  CONSTRAINT fk_communities_owner FOREIGN KEY (owner_id)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Membres d'une communauté et leur rôle
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_members (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  community_id INT UNSIGNED NOT NULL,
  user_id      INT UNSIGNED NOT NULL,
  role         ENUM('owner','admin','moderator','member') NOT NULL DEFAULT 'member',
  joined_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_community_member (community_id, user_id),
  KEY idx_community_members_user (user_id),
  KEY idx_community_members_role (community_id, role),
  CONSTRAINT fk_cm_community FOREIGN KEY (community_id)
    REFERENCES communities (id) ON DELETE CASCADE,
  CONSTRAINT fk_cm_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Catégories (regroupements de salons)
--   Pas de contrainte UNIQUE sur (community_id, position) : MySQL ne gère pas
--   les contraintes différées, ce qui rendrait le réordonnancement impossible
--   sans fenêtre d'incohérence. Les positions sont renumérotées en transaction.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  community_id INT UNSIGNED NOT NULL,
  name         VARCHAR(80)  NOT NULL,
  description  VARCHAR(300) NULL,
  `position`   INT          NOT NULL DEFAULT 0,
  creator_id   INT UNSIGNED NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_categories_community (community_id, `position`),
  CONSTRAINT fk_categories_community FOREIGN KEY (community_id)
    REFERENCES communities (id) ON DELETE CASCADE,
  CONSTRAINT fk_categories_creator FOREIGN KEY (creator_id)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Salons
--   type        : text | voice | announcement | board
--   category_id : NULL -> salon sans catégorie
--   is_private  : accès réservé aux lignes de channel_members
--   access_code : code d'accès historique (compatibilité), distinct des
--                 invitations de communauté
--   legacy_room_id : identifiant textuel utilisé par l'ancien protocole
--                 Socket.IO (ex. « general », « 1712345678901 »)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS channels (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  community_id   INT UNSIGNED NOT NULL,
  category_id    INT UNSIGNED NULL,
  name           VARCHAR(80)  NOT NULL,
  description    VARCHAR(300) NULL,
  type           ENUM('text','voice','announcement','board') NOT NULL DEFAULT 'text',
  is_private     TINYINT(1)   NOT NULL DEFAULT 0,
  `position`     INT          NOT NULL DEFAULT 0,
  access_code    VARCHAR(120) NULL,
  legacy_room_id VARCHAR(64)  NULL,
  creator_id     INT UNSIGNED NULL,
  archived_at    DATETIME(3)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_channels_legacy_room (legacy_room_id),
  KEY idx_channels_community (community_id, `position`),
  KEY idx_channels_category (category_id, `position`),
  KEY idx_channels_type (community_id, type),
  CONSTRAINT fk_channels_community FOREIGN KEY (community_id)
    REFERENCES communities (id) ON DELETE CASCADE,
  CONSTRAINT fk_channels_category FOREIGN KEY (category_id)
    REFERENCES categories (id) ON DELETE SET NULL,
  CONSTRAINT fk_channels_creator FOREIGN KEY (creator_id)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Accès explicite aux salons privés
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS channel_members (
  channel_id INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  added_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (channel_id, user_id),
  KEY idx_channel_members_user (user_id),
  CONSTRAINT fk_chm_channel FOREIGN KEY (channel_id)
    REFERENCES channels (id) ON DELETE CASCADE,
  CONSTRAINT fk_chm_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Messages
--   author_id NULL + ON DELETE SET NULL : supprimer un compte ne détruit pas
--   l'historique de la communauté.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  channel_id  INT UNSIGNED    NOT NULL,
  author_id   INT UNSIGNED    NULL,
  content     TEXT            NOT NULL,
  reply_to_id BIGINT UNSIGNED NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  edited_at   DATETIME(3)     NULL,
  deleted_at  DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_messages_channel (channel_id, id),
  KEY idx_messages_author (author_id, id),
  CONSTRAINT fk_messages_channel FOREIGN KEY (channel_id)
    REFERENCES channels (id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_author FOREIGN KEY (author_id)
    REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_messages_reply FOREIGN KEY (reply_to_id)
    REFERENCES messages (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Accusés de lecture message par message
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_reads (
  message_id BIGINT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED    NOT NULL,
  read_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (message_id, user_id),
  KEY idx_message_reads_user (user_id),
  CONSTRAINT fk_message_reads_message FOREIGN KEY (message_id)
    REFERENCES messages (id) ON DELETE CASCADE,
  CONSTRAINT fk_message_reads_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- État de lecture par salon (compteurs de non-lus persistants)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS channel_read_states (
  channel_id           INT UNSIGNED    NOT NULL,
  user_id              INT UNSIGNED    NOT NULL,
  last_read_message_id BIGINT UNSIGNED NULL,
  unread_count         INT UNSIGNED    NOT NULL DEFAULT 0,
  updated_at           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (channel_id, user_id),
  KEY idx_channel_read_states_user (user_id),
  CONSTRAINT fk_crs_channel FOREIGN KEY (channel_id)
    REFERENCES channels (id) ON DELETE CASCADE,
  CONSTRAINT fk_crs_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Pièces jointes (métadonnées en base, octets sur disque)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
  id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  channel_id  INT UNSIGNED    NOT NULL,
  message_id  BIGINT UNSIGNED NULL,
  uploader_id INT UNSIGNED    NULL,
  file_name   VARCHAR(255)    NOT NULL,
  storage_key VARCHAR(255)    NOT NULL,
  mime_type   VARCHAR(120)    NOT NULL,
  size        BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_attachments_storage_key (storage_key),
  KEY idx_attachments_channel (channel_id, id),
  KEY idx_attachments_message (message_id),
  CONSTRAINT fk_attachments_channel FOREIGN KEY (channel_id)
    REFERENCES channels (id) ON DELETE CASCADE,
  CONSTRAINT fk_attachments_message FOREIGN KEY (message_id)
    REFERENCES messages (id) ON DELETE CASCADE,
  CONSTRAINT fk_attachments_uploader FOREIGN KEY (uploader_id)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Invitations de communauté (à ne pas confondre avec channels.access_code)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invitations (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  community_id INT UNSIGNED NOT NULL,
  code         VARCHAR(64)  NOT NULL,
  created_by   INT UNSIGNED NULL,
  expires_at   DATETIME(3)  NULL,
  max_uses     INT UNSIGNED NULL,
  uses         INT UNSIGNED NOT NULL DEFAULT 0,
  revoked_at   DATETIME(3)  NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_invitations_code (code),
  KEY idx_invitations_community (community_id, id),
  CONSTRAINT fk_invitations_community FOREIGN KEY (community_id)
    REFERENCES communities (id) ON DELETE CASCADE,
  CONSTRAINT fk_invitations_author FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED    NOT NULL,
  type       VARCHAR(40)     NOT NULL,
  title      VARCHAR(200)    NOT NULL,
  body       VARCHAR(500)    NULL,
  payload    JSON            NULL,
  read_at    DATETIME(3)     NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_notifications_user (user_id, id),
  KEY idx_notifications_unread (user_id, read_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- État du tableau blanc par salon (persistant, avec version pour la
-- synchronisation concurrente)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS board_states (
  channel_id INT UNSIGNED NOT NULL,
  data       JSON         NULL,
  version    INT UNSIGNED NOT NULL DEFAULT 0,
  updated_by INT UNSIGNED NULL,
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (channel_id),
  CONSTRAINT fk_board_states_channel FOREIGN KEY (channel_id)
    REFERENCES channels (id) ON DELETE CASCADE,
  CONSTRAINT fk_board_states_user FOREIGN KEY (updated_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Messages privés (jalon 7 — tables créées dès maintenant pour éviter une
-- migration lourde plus tard)
--   user_a_id < user_b_id est garanti par l'application : une seule ligne par
--   paire de participants.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_conversations (
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  user_a_id       INT UNSIGNED    NOT NULL,
  user_b_id       INT UNSIGNED    NOT NULL,
  last_message_id BIGINT UNSIGNED NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_dm_pair (user_a_id, user_b_id),
  KEY idx_dm_user_b (user_b_id),
  CONSTRAINT fk_dm_user_a FOREIGN KEY (user_a_id)
    REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_dm_user_b FOREIGN KEY (user_b_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS dm_messages (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id INT UNSIGNED    NOT NULL,
  author_id       INT UNSIGNED    NULL,
  content         TEXT            NOT NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_dm_messages_conversation (conversation_id, id),
  CONSTRAINT fk_dm_messages_conversation FOREIGN KEY (conversation_id)
    REFERENCES dm_conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_dm_messages_author FOREIGN KEY (author_id)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
