-- -----------------------------------------------------------------------------
-- Mot de passe oublié : jetons de réinitialisation à usage unique
--
-- Le jeton lui-même n'est PAS stocké : seule son empreinte SHA-256 l'est, et
-- l'original ne vit que dans le lien envoyé à la personne concernée. Un vol de
-- base ne permet donc pas de purger les comptes.
--
-- `used_at` garde le jeton consommé (rejouable -> refus) ; une purges des
-- expirés peut être ajoutée plus tard côté tâche planifiée.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED    NOT NULL,
  token_hash  CHAR(64)        NOT NULL COMMENT 'sha256 hex du jeton brut',
  expires_at  DATETIME(3)     NOT NULL,
  used_at     DATETIME(3)     NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_password_resets_user (user_id),
  UNIQUE KEY uq_password_resets_hash (token_hash),
  CONSTRAINT fk_password_resets_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
