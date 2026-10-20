-- Historique de versions du tableau blanc.
--
-- `board_states` ne conserve que l'état courant. Cette table garde des
-- instantanés de l'état précédent (au plus un toutes les deux minutes) afin de
-- pouvoir consulter et restaurer une version antérieure sans alourdir chaque
-- trait de crayon.
CREATE TABLE IF NOT EXISTS board_versions (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  channel_id INT UNSIGNED NOT NULL,
  data       JSON         NULL,
  version    INT UNSIGNED NOT NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_board_versions_channel (channel_id, created_at),
  CONSTRAINT fk_board_versions_channel FOREIGN KEY (channel_id)
    REFERENCES channels (id) ON DELETE CASCADE,
  CONSTRAINT fk_board_versions_user FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
