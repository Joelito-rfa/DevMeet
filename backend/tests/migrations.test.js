/**
 * Migrations : découpage SQL et idempotence.
 *
 * Le point critique est l'idempotence : rejouer `npm run db:migrate` ne doit
 * jamais rejouer une migration déjà appliquée ni détruire de données.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");

const { splitStatements, runMigrations, listMigrationFiles } = require("../src/db/migrate");
const { query, closePool } = require("../src/db/pool");

after(async () => {
  await closePool();
});

test("splitStatements découpe correctement un script SQL", () => {
  const sql = `
    -- commentaire de ligne avec un ; à l'intérieur
    CREATE TABLE a (id INT); /* bloc ; commentaire */
    INSERT INTO a VALUES ('point-virgule ; dans une chaîne');
    SELECT 1;
  `;

  const statements = splitStatements(sql);

  assert.equal(statements.length, 3);
  assert.match(statements[0], /CREATE TABLE a/);
  assert.match(statements[1], /point-virgule ; dans une chaîne/);
  assert.equal(statements[2], "SELECT 1");
});

test("splitStatements ignore les instructions vides", () => {
  assert.deepEqual(splitStatements("   \n\n  "), []);
  assert.deepEqual(splitStatements("SELECT 1;"), ["SELECT 1"]);
});

test("les fichiers de migration sont ordonnés", () => {
  const files = listMigrationFiles();

  assert.ok(files.length >= 2, "au moins deux migrations doivent exister");
  assert.deepEqual(files, [...files].sort());
});

test("les migrations sont idempotentes et non destructives", async () => {
  // Première exécution : rien à faire, la base est déjà migrée.
  const first = await runMigrations({ log: () => {} });
  const second = await runMigrations({ log: () => {} });

  assert.deepEqual(first, [], "aucune migration ne doit être rejouée");
  assert.deepEqual(second, []);

  const rows = await query(
    "SELECT version FROM schema_migrations ORDER BY version"
  );

  const versions = rows.map((row) => row.version);
  const declared = listMigrationFiles().map((file) => file.replace(/\.sql$/, ""));

  assert.deepEqual(versions, declared, "toutes les migrations sont enregistrées");

  const tables = await query(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()`
  );

  const names = tables.map((row) => row.name);

  for (const expected of [
    "users",
    "communities",
    "community_members",
    "categories",
    "channels",
    "channel_members",
    "messages",
    "message_reads",
    "channel_read_states",
    "attachments",
    "invitations",
    "notifications",
    "board_states",
    "schema_migrations",
  ]) {
    assert.ok(names.includes(expected), `table manquante : ${expected}`);
  }
});

test("la communauté historique et son salon général sont présents", async () => {
  const community = await query(
    "SELECT * FROM communities WHERE is_system = 1 LIMIT 1"
  );

  assert.equal(community.length, 1, "une communauté système doit être seedée");

  const channel = await query(
    "SELECT * FROM channels WHERE legacy_room_id = 'general' LIMIT 1"
  );

  assert.equal(channel.length, 1);
  assert.equal(Number(channel[0].community_id), Number(community[0].id));
});
