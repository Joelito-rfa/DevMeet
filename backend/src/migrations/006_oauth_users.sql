-- -----------------------------------------------------------------------------
-- Connexion Google / GitHub (OAuth 2.0)
--
-- Un compte OAuth n'a pas de mot de passe : `password_hash` devient nullable
-- et l'identité distante est conservée pour relier la session à son compte
-- (id Google `sub`, id GitHub numérique).
--
-- La clé unique couvre le couple (provider, provider_id) : plusieurs NULL ne
-- violent jamais la clé, les comptes « habituels » restent donc libres.
-- -----------------------------------------------------------------------------

ALTER TABLE users
  MODIFY password_hash VARCHAR(255) NULL,
  ADD COLUMN oauth_provider    VARCHAR(16) NULL AFTER password_hash,
  ADD COLUMN oauth_provider_id VARCHAR(64) NULL AFTER oauth_provider,
  ADD UNIQUE KEY uq_users_oauth (oauth_provider, oauth_provider_id);
