const mysql = require("mysql2/promise");
const config = require("../config");

/**
 * Pool MySQL partagé.
 *
 * Toutes les valeurs sont passées en requêtes paramétrées (`?`) : aucune
 * concaténation de chaîne n'est utilisée pour construire du SQL.
 *
 * Le fuseau horaire de session est forcé à UTC et mysql2 convertit les Date
 * JS en UTC : les horodatages sont donc cohérents entre la base, le serveur
 * et les clients.
 */
const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  charset: "utf8mb4_0900_ai_ci",
  timezone: "Z",
  supportBigNumbers: true,
  bigNumberStrings: false,
  multipleStatements: false,
});

pool.on("connection", (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

/**
 * Exécute une requête paramétrée et renvoie les lignes.
 */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * Exécute une requête paramétrée et renvoie le premier enregistrement (ou null).
 */
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Exécute une transaction. La fonction reçoit une connexion dédiée.
 *
 * MySQL ne sait pas annuler du DDL (il est auto-commité), mais toutes les
 * opérations métier liées (communauté + adhésion, catégorie + salons,
 * invitation + usage, etc.) passent par ici.
 */
async function withTransaction(handler) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const result = await handler(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error("[db] échec du rollback :", rollbackError.message);
    }
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Convertit une valeur non sûre en entier positif utilisable dans un LIMIT/OFFSET.
 * Les requêtes préparées MySQL n'acceptent pas toujours un `?` dans LIMIT :
 * on valide donc strictement la valeur puis on l'incorpore.
 */
function safeInt(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Vérifie que la base est joignable et que les migrations sont appliquées.
 * Renvoie un diagnostic lisible plutôt que de laisser remonter une erreur brute.
 */
async function inspectDatabase() {
  try {
    const versionRow = await queryOne("SELECT VERSION() AS version");
    const tables = await query(
      "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
      [config.db.database]
    );

    return {
      ok: true,
      version: versionRow ? versionRow.version : "inconnue",
      tableCount: tables.length,
      tables: tables.map((table) => table.name),
    };
  } catch (error) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
    };
  }
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  query,
  queryOne,
  withTransaction,
  safeInt,
  inspectDatabase,
  closePool,
};
