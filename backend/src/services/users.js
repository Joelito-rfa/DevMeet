const bcrypt = require("bcryptjs");

const { query, queryOne } = require("../db/pool");
const { conflict, notFound, unauthorized } = require("../utils/errors");
const { publicUser } = require("../utils/serialize");

const BCRYPT_ROUNDS = 10;

async function findById(id) {
  return queryOne("SELECT * FROM users WHERE id = ?", [id]);
}

async function findByEmail(email) {
  return queryOne("SELECT * FROM users WHERE email = ?", [email]);
}

async function createUser({ name, email, password }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    const result = await query(
      "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
      [name, email, passwordHash]
    );

    return findById(result.insertId);
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw conflict("Cette adresse email est déjà utilisée.", "email_taken");
    }
    throw error;
  }
}

/**
 * Vérifie un couple email/mot de passe. Le message d'erreur est volontairement
 * identique dans les deux cas d'échec pour ne pas révéler l'existence d'un compte.
 */
async function verifyCredentials(email, password) {
  const user = await findByEmail(email);

  if (!user) {
    throw unauthorized("Adresse email ou mot de passe incorrect.", "invalid_credentials");
  }

  // Un compte créé via Google/GitHub n'a pas de mot de passe : tenter la
  // connexion classique doit renvoyer explicitement vers le fournisseur.
  if (!user.password_hash) {
    throw unauthorized(
      "Ce compte utilise la connexion Google/GitHub. Passez par le bouton du fournisseur.",
      "account_without_password"
    );
  }

  const valid = await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    throw unauthorized("Adresse email ou mot de passe incorrect.", "invalid_credentials");
  }

  return user;
}

/**
 * Connexion OAuth 2.0 (Google / GitHub). Trois cas couverts en une fonction :
 *
 *   1. l'identité distante est déjà connue  -> session existante ;
 *   2. l'email existe déjà sans lien OAuth  -> le compte est relié (et
 *      conservé : mêmes communautés, mêmes messages) ;
 *   3. l'email est inconnu                  -> nouveau compte sans mot de passe.
 *
 * `displayName` sert uniquement à la création : jamais une mise à jour du
 * pseudo choisi par le membre suite à un provider différent.
 */
async function connectWithOAuth({ provider, providerId, email, name, avatarUrl }) {
  const existing = await queryOne(
    "SELECT * FROM users WHERE oauth_provider = ? AND oauth_provider_id = ?",
    [provider, String(providerId)]
  );

  if (existing) {
    return existing;
  }

  const byEmail = await findByEmail(email);

  if (byEmail) {
    // Lien conservateur : on n'écrase l'identité stockée que si le compte
    // n'en a pas déjà une (empêche Google de remplacer un identifiant GitHub).
    await query(
      `UPDATE users
         SET oauth_provider    = IFNULL(oauth_provider, ?),
             oauth_provider_id = IFNULL(oauth_provider_id, ?),
             last_seen_at      = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [provider, String(providerId), byEmail.id]
    );

    return byEmail;
  }

  const result = await query(
    `INSERT INTO users
       (name, email, password_hash, avatar_url, oauth_provider, oauth_provider_id, last_seen_at)
     VALUES (?, ?, NULL, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [name, email, avatarUrl || null, provider, String(providerId)]
  );

  return findById(result.insertId);
}

/**
 * Définit (ou remplace) le mot de passe d'un compte. Sert à la création
 * classique comme à la réinitialisation « mot de passe oublié » : un compte
 * OAuth qui suit ce chemin acquiert ainsi une connexion email/mot de passe
 * complémentaire, sans jamais perdre le lien à son fournisseur.
 */
async function setPassword(userId, password) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await query("UPDATE users SET password_hash = ? WHERE id = ?", [
    passwordHash,
    userId,
  ]);
}

async function updateProfile(userId, patch) {
  const fields = [];
  const values = [];

  if (patch.name !== undefined) {
    fields.push("name = ?");
    values.push(patch.name);
  }

  if (patch.bio !== undefined) {
    fields.push("bio = ?");
    values.push(patch.bio);
  }

  if (patch.avatarUrl !== undefined) {
    fields.push("avatar_url = ?");
    values.push(patch.avatarUrl);
  }

  if (patch.theme !== undefined) {
    fields.push("theme = ?");
    values.push(patch.theme);
  }

  if (patch.status !== undefined) {
    fields.push("status = ?");
    values.push(patch.status);
  }

  if (patch.profileBackground !== undefined) {
    fields.push("profile_background = ?");
    values.push(patch.profileBackground);
  }

  if (patch.profileBanner !== undefined) {
    fields.push("profile_banner = ?");
    values.push(patch.profileBanner);
  }

  if (patch.avatarFrame !== undefined) {
    fields.push("avatar_frame = ?");
    values.push(patch.avatarFrame);
  }

  if (patch.profileEffects !== undefined) {
    fields.push("profile_effects = ?");
    values.push(
      patch.profileEffects === null ? null : JSON.stringify(patch.profileEffects)
    );
  }

  if (fields.length === 0) {
    const current = await findById(userId);

    if (!current) {
      throw notFound("Compte introuvable.");
    }

    return current;
  }

  values.push(userId);
  await query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values);

  const updated = await findById(userId);

  if (!updated) {
    throw notFound("Compte introuvable.");
  }

  return updated;
}

async function touchLastSeen(userId) {
  await query("UPDATE users SET last_seen_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [userId]);
}

/**
 * Recherche simple par pseudo (annuaire d'invitation / messages privés).
 * Ne renvoie jamais d'information sensible : le filtrage est fait par
 * `publicUser()` côté route.
 */
async function searchByName(term, limit = 20) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 50);

  return query(
    `SELECT * FROM users
     WHERE name LIKE ? OR email LIKE ?
     ORDER BY name ASC
     LIMIT ${safeLimit}`,
    [`%${term}%`, `%${term}%`]
  );
}

/**
 * Supprime un compte. Les messages restent en place (author_id passe à NULL)
 * pour ne pas détruire l'historique des communautés.
 */
async function deleteUser(userId) {
  await query("DELETE FROM users WHERE id = ?", [userId]);
}

module.exports = {
  BCRYPT_ROUNDS,
  findById,
  findByEmail,
  createUser,
  connectWithOAuth,
  verifyCredentials,
  setPassword,
  updateProfile,
  touchLastSeen,
  searchByName,
  deleteUser,
  publicUser,
};
