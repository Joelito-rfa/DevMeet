-- =============================================================================
-- 004 — Suivi de lecture des messages privés.
--
-- `dm_messages` ne conserve aucune trace de « qui a lu quoi » : sans cela, un
-- compteur de non-lus réel serait impossible (on ne saurait pas depuis quand
-- compter). On ajoute donc un pointeur « dernier message lu » par conversation
-- et par compte, exactement comme `channel_read_states` pour les salons.
--
-- NON DESTRUCTIVE : table ajoutée, aucune donnée existante touchée.
-- IDEMPOTENTE : `CREATE TABLE IF NOT EXISTS`.
-- =============================================================================

CREATE TABLE IF NOT EXISTS dm_read_states (
  conversation_id      INT UNSIGNED    NOT NULL,
  user_id              INT UNSIGNED    NOT NULL,
  last_read_message_id BIGINT UNSIGNED NULL,
  updated_at           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (conversation_id, user_id),
  KEY idx_dm_read_states_user (user_id),
  CONSTRAINT fk_drs_conversation FOREIGN KEY (conversation_id)
    REFERENCES dm_conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_drs_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
