const { query, queryOne, withTransaction, safeInt } = require("../db/pool");
const { notFound, badRequest } = require("../utils/errors");
const { categoryDto } = require("../utils/serialize");

async function getById(categoryId) {
  return queryOne("SELECT * FROM categories WHERE id = ?", [categoryId]);
}

async function list(communityId) {
  const rows = await query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM channels ch
              WHERE ch.category_id = c.id AND ch.archived_at IS NULL) AS channel_count
     FROM categories c
     WHERE c.community_id = ?
     ORDER BY c.\`position\` ASC, c.id ASC`,
    [communityId]
  );

  return rows.map((row) => categoryDto(row, { channelCount: row.channel_count }));
}

async function nextPosition(communityId) {
  const row = await queryOne(
    "SELECT COALESCE(MAX(`position`), -1) + 1 AS next FROM categories WHERE community_id = ?",
    [communityId]
  );

  return row ? Number(row.next) : 0;
}

async function create({ communityId, name, description, creatorId }) {
  const position = await nextPosition(communityId);

  const result = await query(
    `INSERT INTO categories (community_id, name, description, \`position\`, creator_id)
     VALUES (?, ?, ?, ?, ?)`,
    [communityId, name, description, position, creatorId]
  );

  const created = await getById(result.insertId);
  return categoryDto(created, { channelCount: 0 });
}

async function update(categoryId, patch) {
  const category = await getById(categoryId);

  if (!category) {
    throw notFound("Catégorie introuvable.");
  }

  const fields = [];
  const values = [];

  if (patch.name !== undefined) {
    fields.push("name = ?");
    values.push(patch.name);
  }

  if (patch.description !== undefined) {
    fields.push("description = ?");
    values.push(patch.description);
  }

  if (fields.length > 0) {
    values.push(categoryId);
    await query(`UPDATE categories SET ${fields.join(", ")} WHERE id = ?`, values);
  }

  return categoryDto(await getById(categoryId));
}

/**
 * Supprime une catégorie.
 *
 * `strategy` est OBLIGATOIRE :
 *   - "keep"   : les salons sont conservés et deviennent sans catégorie ;
 *   - "delete" : les salons sont supprimés, ainsi que leurs messages et
 *                leur tableau blanc (cascade SQL explicite).
 *
 * Rien n'est jamais supprimé silencieusement : le détail est renvoyé.
 */
async function remove(categoryId, strategy) {
  const category = await getById(categoryId);

  if (!category) {
    throw notFound("Catégorie introuvable.");
  }

  if (strategy !== "keep" && strategy !== "delete") {
    throw badRequest(
      "Stratégie de suppression obligatoire : « keep » (conserver les salons sans catégorie) ou « delete » (supprimer les salons).",
      "strategy_required"
    );
  }

  const channelRows = await query(
    "SELECT id, name, type FROM channels WHERE category_id = ?",
    [categoryId]
  );

  return withTransaction(async (connection) => {
    let affectedChannels = [];

    if (strategy === "keep") {
      await connection.execute(
        "UPDATE channels SET category_id = NULL WHERE category_id = ?",
        [categoryId]
      );
      affectedChannels = channelRows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        outcome: "kept_without_category",
      }));
    } else {
      await connection.execute("DELETE FROM channels WHERE category_id = ?", [
        categoryId,
      ]);
      affectedChannels = channelRows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        outcome: "deleted",
      }));
    }

    await connection.execute("DELETE FROM categories WHERE id = ?", [categoryId]);

    return {
      deletedId: Number(categoryId),
      strategy,
      affectedChannels,
    };
  });
}

/**
 * Réordonne les catégories d'une communauté. La liste doit contenir exactement
 * les catégories existantes (sinon on refuserait un ordre partiel, source
 * d'incohérence). Tout se joue dans une transaction.
 */
async function reorder(communityId, orderedIds) {
  const existing = await query(
    "SELECT id FROM categories WHERE community_id = ? ORDER BY `position` ASC, id ASC",
    [communityId]
  );

  const existingIds = existing.map((row) => Number(row.id));
  const requested = orderedIds.map((id) => Number(id));

  const sameLength = existingIds.length === requested.length;
  const sameSet =
    sameLength && existingIds.every((id) => requested.includes(id));

  if (!sameSet) {
    throw badRequest(
      "L'ordre fourni doit contenir exactement toutes les catégories de la communauté.",
      "invalid_order"
    );
  }

  await withTransaction(async (connection) => {
    let position = 0;

    for (const id of requested) {
      await connection.execute("UPDATE categories SET `position` = ? WHERE id = ?", [
        position,
        id,
      ]);
      position += 1;
    }
  });

  return list(communityId);
}

module.exports = {
  getById,
  list,
  create,
  update,
  remove,
  reorder,
  nextPosition,
  safeInt,
};
