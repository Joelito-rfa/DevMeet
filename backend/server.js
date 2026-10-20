/**
 * DevMeet 2.0 — point d'entrée du serveur.
 *
 * Ce fichier reste le point d'entrée (`npm start` / `npm run dev` inchangés)
 * mais ne contient plus que le démarrage. Le reste est réparti en modules :
 *
 *   src/config.js          configuration (lue depuis .env, validée)
 *   src/db/                pool MySQL + migrations versionnées
 *   src/services/          logique métier (une responsabilité par fichier)
 *   src/routes/            API REST
 *   src/realtime/          Socket.IO (authentifié, permissions vérifiées)
 *   src/app.js             composition HTTP
 *   src/permissions.js     rôles et matrice de permissions (source unique)
 *
 * Aucune donnée métier n'est stockée en mémoire : tout passe par MySQL.
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");

const config = require("./src/config");
const { createHttpServer } = require("./src/app");
const { runMigrations } = require("./src/db/migrate");
const { inspectDatabase, closePool } = require("./src/db/pool");
const bus = require("./src/realtime/bus");

/**
 * Démarrage : la base doit être joignable ET migrée avant d'accepter du trafic.
 * Échouer immédiatement avec un message actionnable vaut mieux que servir des
 * erreurs 500 en boucle.
 */
async function start() {
  const diagnosis = await inspectDatabase();

  if (!diagnosis.ok) {
    console.error(
      "\n=== MySQL est injoignable — le serveur ne peut pas démarrer ===\n" +
        `Base visée : ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}\n` +
        `Détail : ${diagnosis.code || ""} ${diagnosis.message}\n\n` +
        "Démarrez le serveur MySQL puis relancez :\n" +
        "  & 'C:\\laragon\\bin\\mysql\\mysql-8.4.3-winx64\\bin\\mysqld.exe' " +
        "--datadir='C:\\laragon\\data\\mysql' --port=3306 --bind-address=127.0.0.1 --console\n\n" +
        "Si la base ou l'utilisateur n'existent pas encore :\n" +
        "  npm run db:create && npm run db:migrate\n"
    );
    process.exit(1);
  }

  console.log(
    `[db] connecté à MySQL ${diagnosis.version} — base « ${config.db.database} » (${diagnosis.tableCount} tables).`
  );

  // Dossier des pièces jointes : créé au démarrage pour que le premier envoi
  // de fichier ne dépende jamais d'une création manuelle.
  fs.mkdirSync(config.uploads.dir, { recursive: true });
  console.log(`[api] pièces jointes : ${path.relative(process.cwd(), config.uploads.dir) || config.uploads.dir}`);

  if (config.env !== "production") {
    // Migrations non destructives : sûres à rejouer, elles ne s'exécutent pas
    // deux fois grâce à la table `schema_migrations`.
    await runMigrations();
  } else {
    console.log("[db] production : lancez `npm run db:migrate` explicitement.");
  }

  const { server } = createHttpServer();

  server.listen(config.port, () => {
    console.log(
      `[api] DevMeet 2.0 à l'écoute sur http://localhost:${config.port} (client autorisé : ${config.clientUrl})`
    );
    console.log(
      "[api] persistance MySQL active — comptes, communautés, salons, messages et tableaux blancs survivent aux redémarrages."
    );
  });

  const shutdown = async (signal) => {
    console.log(`\n[api] ${signal} reçu, arrêt en cours…`);

    if (bus.isBound()) {
      bus.getIo().close();
    }

    server.close(async () => {
      try {
        await closePool();
      } catch (error) {
        console.error("[db] fermeture du pool impossible :", error.message);
      }
      console.log("[api] arrêt terminé.");
      process.exit(0);
    });

    // Filet de sécurité si des connexions traînent.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

process.on("unhandledRejection", (reason) => {
  console.error("[api] promesse rejetée non gérée :", reason);
});

start().catch((error) => {
  console.error("[api] démarrage impossible :", error.message);
  process.exit(1);
});
