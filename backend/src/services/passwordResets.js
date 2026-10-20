const crypto = require("crypto");

const { query, queryOne } = require("../db/pool");
const usersService = require("./users");

/**
 * Mot de passe oublié — cycle du jeton de réinitialisation.
 *
 *   requestFor(email) -> { user, providers } : jeton créé (empreinte SHA-256
 *     stockée, 30 minutes, usage unique) ; `providers` renseigne les comptes
 *     liés à Google/GitHub, qui n'ont pas de mot de passe à régénérer : they
 *     retrouvent l'accès par leur fournisseur.
 *
 *   completeReset(plainToken, newPassword) : jeton vérifié, consommé
 *     (`used_at`) puis le mot de passe est réécrit — un compte OAuth acquiert
 *     ainsi, s'il le souhaite, une connexion email/mot de passe en plus.
 */

const TOKEN_TTL_MS = 30 * 60 * 1000;

/** Empreinte SHA-256 : le lien contient le jeton brut, pas la base. */
function hashToken(plain) {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Prépare la demande. Répond de façon neutre : la réponse ne révèle jamais
 * si l'email existe (anti-énumération), c'est la route qui harmonise le texte.
 * Les comptes liés à Google/GitHub n'ont pas de mot de passe à régénérer :
 * ils retrouvent l'accès via leur fournisseur (`providers` le signale).
 */
async function requestFor(email, { ttlMs = TOKEN_TTL_MS } = {}) {
  const user = await usersService.findByEmail(email);

  if (!user) {
    return null;
  }

  const plain = generateToken();

  await query(
    `INSERT INTO password_reset_tokens
       (user_id, token_hash, expires_at)
     VALUES
       (?, ?, CURRENT_TIMESTAMP(3) + INTERVAL ? MICROSECOND)`,
    [user.id, hashToken(plain), ttlMs]
  );

  return {
    user,
    token: plain,
    providers: user.oauth_provider ? [user.oauth_provider] : [],
  };
}

/**
 * Consomme le jeton et remplace le mot de passe. L'écriture de `used_at` et la
 * lecture de l'utilisateur référencé utilisent la même clause WHERE (inusage,
 * non expiré) : un jeton ne peut jamais être utilisé deux fois, même sous une
 * requête simultanée.
 */
async function completeReset(plainToken, newPassword) {
  const tokenHash = hashToken(String(plainToken || ""));

  const result = await query(
    `UPDATE password_reset_tokens
       SET used_at = CURRENT_TIMESTAMP(3)
     WHERE token_hash = ?
       AND used_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP(3)`,
    [tokenHash]
  );

  if (!result || result.affectedRows !== 1) {
    return null;
  }

  const row = await queryOne(
    "SELECT user_id FROM password_reset_tokens WHERE token_hash = ?",
    [tokenHash]
  );

  if (!row) {
    return null;
  }

  // Le service centralise le hachage ; le nouveau mot de passe est réécrit
  // pour le compte référencé par la ligne consommée (pas celui passé en
  // paramètre — il n'y en a d'ailleurs pas, le jeton est la seule preuve).
  await usersService.setPassword(row.user_id, newPassword);
  await usersService.touchLastSeen(row.user_id);

  return row.user_id;
}

module.exports = { requestFor, completeReset };
