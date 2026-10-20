-- =============================================================================
-- 004 — Messagerie avancée (jalon 5) : réactions, épinglage, mentions.
--
-- Trois tables seulement, en `CREATE TABLE IF NOT EXISTS` : la migration est donc
-- naturellement idempotente et strictement non destructive (aucune colonne
-- ajoutée à `messages`, aucun `ALTER TABLE`). Supprimer un message ou un salon
-- efface les lignes associées en cascade.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Réactions emoji sur les messages.
--   UNIQUE (message_id, user_id, emoji) : un compte ne réagit qu'une fois avec
--   le même emoji (rejouer la même réaction est donc sans effet, pas une erreur).
--   La collation binaire évite toute assimilation (👍 ≠ 👍🏽).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_reactions (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id BIGINT UNSIGNED NOT NULL,
  channel_id INT UNSIGNED    NOT NULL,
  user_id    INT UNSIGNED    NOT NULL,
  emoji      VARCHAR(16)     CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_message_reactions (message_id, user_id, emoji),
  KEY idx_message_reactions_channel (channel_id, message_id),
  KEY idx_message_reactions_user (user_id),
  CONSTRAINT fk_message_reactions_message FOREIGN KEY (message_id)
    REFERENCES messages (id) ON DELETE CASCADE,
  CONSTRAINT fk_message_reactions_channel FOREIGN KEY (channel_id)
    REFERENCES channels (id) ON DELETE CASCADE,
  CONSTRAINT fk_message_reactions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Messages épinglés.
--   La clé primaire est l'identifiant du message : un message est épinglé ou non,
--   il ne peut donc pas y avoir de doublon.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_pins (
  message_id BIGINT UNSIGNED NOT NULL,
  channel_id INT UNSIGNED    NOT NULL,
  pinned_by  INT UNSIGNED    NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (message_id),
  KEY idx_message_pins_channel (channel_id, created_at),
  CONSTRAINT fk_message_pins_message FOREIGN KEY (message_id)
    REFERENCES messages (id) ON DELETE CASCADE,
  CONSTRAINT fk_message_pins_channel FOREIGN KEY (channel_id)
    REFERENCES channels (id) ON DELETE CASCADE,
  CONSTRAINT fk_message_pins_user FOREIGN KEY (pinned_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- Mentions résolues (@nom reconnu).
--   Seules les mentions correspondant à un VRAI membre de la communauté sont
--   enregistrées : « @nimportequoi » reste du texte. Cela permet de notifier
--   sans se fier à ce que le client prétend, et sans réanalyser l'historique.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_mentions (
  message_id BIGINT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED    NOT NULL,
  channel_id INT UNSIGNED    NOT NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (message_id, user_id),
  KEY idx_message_mentions_user (user_id, message_id),
  CONSTRAINT fk_message_mentions_message FOREIGN KEY (message_id)
    REFERENCES messages (id) ON DELETE CASCADE,
  CONSTRAINT fk_message_mentions_channel FOREIGN KEY (channel_id)
    REFERENCES channels (id) ON DELETE CASCADE,
  CONSTRAINT fk_message_mentions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
