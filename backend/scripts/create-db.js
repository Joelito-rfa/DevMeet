/**
 * Création de la base et de l'utilisateur applicatif (à lancer UNE SEULE FOIS).
 *
 * Ce script se connecte en administrateur (root par défaut) uniquement pour :
 *   - créer la base `devmeet_db` si elle n'existe pas ;
 *   - créer l'utilisateur applicatif et lui donner des droits limités à cette
 *     base uniquement.
 *
 * Il ne supprime rien, ne touche à aucune autre base et n'accorde aucun droit
 * global. Une fois lancé, l'application se connecte avec `DB_USER`.
 *
 *   node scripts/create-db.js
 *   DB_ROOT_USER=root DB_ROOT_PASSWORD=... node scripts/create-db.js
 */
require("dotenv").config();

const mysql = require("mysql2/promise");
const config = require("../src/config");

const ROOT_USER = process.env.DB_ROOT_USER || "root";
const ROOT_PASSWORD = process.env.DB_ROOT_PASSWORD ?? "";
const APP_USER = config.db.user;
const APP_PASSWORD = config.db.password;
const DATABASE = config.db.database;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;

if (!IDENTIFIER_PATTERN.test(DATABASE)) {
  console.error(
    `Nom de base invalide : « ${DATABASE} ». Utilisez uniquement lettres, chiffres et underscore.`
  );
  process.exit(1);
}

if (!IDENTIFIER_PATTERN.test(APP_USER)) {
  console.error(
    `Nom d'utilisateur invalide : « ${APP_USER} ». Utilisez uniquement lettres, chiffres et underscore.`
  );
  process.exit(1);
}

async function main() {
  let connection;

  try {
    connection = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: ROOT_USER,
      password: ROOT_PASSWORD,
    });
  } catch (error) {
    console.error(
      "\nImpossible de se connecter à MySQL en administrateur.\n" +
        "Vérifiez que le serveur est démarré (voir backend/README.md) et que DB_ROOT_USER / DB_ROOT_PASSWORD sont corrects.\n" +
        `Détail : ${error.code || ""} ${error.message}\n`
    );
    process.exit(1);
  }

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
    );
    console.log(`[db:create] base « ${DATABASE} » prête.`);

    const hosts = ["localhost", "127.0.0.1"];

    for (const host of hosts) {
      await connection.query(
        `CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?`,
        [APP_USER, host, APP_PASSWORD]
      );
      await connection.query(`ALTER USER ?@? IDENTIFIED BY ?`, [
        APP_USER,
        host,
        APP_PASSWORD,
      ]);
      await connection.query(
        `GRANT ALL PRIVILEGES ON \`${DATABASE}\`.* TO ?@?`,
        [APP_USER, host]
      );
    }

    await connection.query("FLUSH PRIVILEGES");
    console.log(
      `[db:create] utilisateur « ${APP_USER} » autorisé uniquement sur « ${DATABASE} ».`
    );
    console.log("[db:create] terminé. Lancez maintenant : npm run db:migrate");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("[db:create] erreur :", error.message);
  process.exit(1);
});
