/**
 * Diagnostic de la base : version, tables, migrations appliquées, volumes.
 *
 *   npm run db:status
 *
 * En lecture seule : ce script n'écrit rien.
 */
require("dotenv").config();

const config = require("../src/config");
const { query, queryOne, inspectDatabase, closePool } = require("../src/db/pool");
const { listMigrationFiles } = require("../src/db/migrate");

async function main() {
  const diagnosis = await inspectDatabase();

  if (!diagnosis.ok) {
    console.error(
      `\nBase injoignable : ${diagnosis.code || ""} ${diagnosis.message}\n` +
        "Démarrez MySQL (voir backend/README.md) puis relancez.\n"
    );
    process.exit(1);
  }

  console.log("\n=== DevMeet 2.0 — état de la base ===");
  console.log(`Hôte            : ${config.db.host}:${config.db.port}`);
  console.log(`Base            : ${config.db.database}`);
  console.log(`Utilisateur     : ${config.db.user}`);
  console.log(`MySQL           : ${diagnosis.version}`);
  console.log(`Tables          : ${diagnosis.tableCount}`);

  let applied = [];

  try {
    const rows = await query("SELECT version FROM schema_migrations ORDER BY version");
    applied = rows.map((row) => row.version);
  } catch (error) {
    console.log("Migrations      : table `schema_migrations` absente");
  }

  const files = listMigrationFiles().map((file) => file.replace(/\.sql$/, ""));
  const pending = files.filter((file) => !applied.includes(file));

  console.log(`Migrations      : ${applied.length}/${files.length} appliquées`);

  if (pending.length > 0) {
    console.log(`  ⚠ en attente  : ${pending.join(", ")}`);
    console.log("  → lancez `npm run db:migrate`");
  }

  const counters = [
    ["users", "comptes"],
    ["communities", "communautés"],
    ["community_members", "adhésions"],
    ["categories", "catégories"],
    ["channels", "salons"],
    ["messages", "messages"],
    ["message_reads", "accusés de lecture"],
    ["invitations", "invitations"],
    ["notifications", "notifications"],
    ["board_states", "tableaux blancs enregistrés"],
  ];

  console.log("\n--- Contenu ---");

  for (const [table, label] of counters) {
    try {
      const row = await queryOne(`SELECT COUNT(*) AS total FROM \`${table}\``);
      console.log(`${label.padEnd(28)}: ${row ? row.total : 0}`);
    } catch (error) {
      console.log(`${label.padEnd(28)}: table absente`);
    }
  }

  console.log("");
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[db:status] erreur :", error.message);
    try {
      await closePool();
    } catch (closeError) {
      /* ignore */
    }
    process.exit(1);
  });
