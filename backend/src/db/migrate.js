const fs = require("fs");
const path = require("path");

const { pool, query } = require("./pool");

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");

/**
 * Découpe un fichier SQL en instructions.
 *
 * On ne peut pas utiliser `multipleStatements: true` (risque d'injection) :
 * les instructions sont donc exécutées une par une. Le découpage respecte les
 * chaînes entre quotes simples et les commentaires SQL (ligne et bloc).
 */
function splitStatements(sql) {
  const statements = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        current += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === "-" && next === "-") {
        inLineComment = true;
        index += 1;
        continue;
      }
      if (char === "/" && next === "*") {
        inBlockComment = true;
        index += 1;
        continue;
      }
    }

    if (char === "'" && !inDoubleQuote) {
      const escaped = sql[index - 1] === "\\";
      if (!escaped) {
        inSingleQuote = !inSingleQuote;
      }
    } else if (char === '"' && !inSingleQuote) {
      const escaped = sql[index - 1] === "\\";
      if (!escaped) {
        inDoubleQuote = !inDoubleQuote;
      }
    }

    if (char === ";" && !inSingleQuote && !inDoubleQuote) {
      const statement = current.trim();
      if (statement) {
        statements.push(statement);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const last = current.trim();
  if (last) {
    statements.push(last);
  }

  return statements;
}

async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    VARCHAR(64) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

async function getAppliedVersions() {
  const rows = await query("SELECT version FROM schema_migrations");
  return new Set(rows.map((row) => row.version));
}

/**
 * Applique les migrations manquantes. Idempotent : relancer la commande ne
 * rejoue pas une migration déjà appliquée et ne détruit aucune donnée.
 */
async function runMigrations({ log = console.log } = {}) {
  await ensureMigrationsTable();

  const applied = await getAppliedVersions();
  const files = listMigrationFiles();
  const executed = [];

  for (const file of files) {
    const version = path.basename(file, ".sql");

    if (applied.has(version)) {
      continue;
    }

    const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const statements = splitStatements(raw);

    log(`[migrations] application de ${file} (${statements.length} instruction(s))`);

    for (const statement of statements) {
      try {
        await query(statement);
      } catch (error) {
        error.message = `Migration ${file} échouée : ${error.message}`;
        throw error;
      }
    }

    await query("INSERT INTO schema_migrations (version) VALUES (?)", [version]);
    executed.push(version);
    log(`[migrations] ${file} appliquée.`);
  }

  if (executed.length === 0) {
    log("[migrations] base déjà à jour.");
  }

  return executed;
}

module.exports = { runMigrations, splitStatements, listMigrationFiles };

if (require.main === module) {
  runMigrations()
    .then(async () => {
      console.log("[migrations] terminé.");
      await pool.end();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error("[migrations] erreur :", error.message);
      try {
        await pool.end();
      } catch (closeError) {
        /* ignore */
      }
      process.exit(1);
    });
}
