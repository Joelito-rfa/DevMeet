const { badRequest } = require("./errors");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Valide une chaîne obligatoire et renvoie sa version nettoyée.
 */
function requireString(value, field, { min = 1, max = 255, trim = true } = {}) {
  if (typeof value !== "string") {
    throw badRequest(`Le champ « ${field} » est obligatoire.`, "invalid_field");
  }

  const cleaned = trim ? value.trim() : value;

  if (cleaned.length < min) {
    throw badRequest(
      `Le champ « ${field} » doit contenir au moins ${min} caractère${min > 1 ? "s" : ""}.`,
      "invalid_field"
    );
  }

  if (cleaned.length > max) {
    throw badRequest(
      `Le champ « ${field} » ne doit pas dépasser ${max} caractères.`,
      "invalid_field"
    );
  }

  return cleaned;
}

/**
 * Valide une chaîne facultative. Renvoie null si absente ou vide.
 */
function optionalString(value, field, { max = 500 } = {}) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw badRequest(`Le champ « ${field} » doit être du texte.`, "invalid_field");
  }

  const cleaned = value.trim();

  if (cleaned === "") {
    return null;
  }

  if (cleaned.length > max) {
    throw badRequest(
      `Le champ « ${field} » ne doit pas dépasser ${max} caractères.`,
      "invalid_field"
    );
  }

  return cleaned;
}

function requireEmail(value) {
  const email = requireString(value, "email", { min: 3, max: 190 }).toLowerCase();

  if (!EMAIL_PATTERN.test(email)) {
    throw badRequest("L'adresse email est invalide.", "invalid_email");
  }

  return email;
}

function requirePassword(value) {
  if (typeof value !== "string") {
    throw badRequest("Le mot de passe est obligatoire.", "invalid_password");
  }

  if (value.length < 8) {
    throw badRequest(
      "Le mot de passe doit contenir au moins 8 caractères.",
      "invalid_password"
    );
  }

  if (value.length > 200) {
    throw badRequest("Le mot de passe est trop long.", "invalid_password");
  }

  return value;
}

/**
 * Identifiant numérique strict (utilisé pour les ids d'URL).
 */
function parseId(value, field = "id") {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`Identifiant « ${field} » invalide.`, "invalid_id");
  }

  return parsed;
}

/**
 * Identifiant de message : BIGINT, donc manipulé en chaîne pour éviter toute
 * perte de précision au-delà de 2^53.
 */
function parseBigId(value, field = "id") {
  const asString = String(value ?? "").trim();

  if (!/^\d+$/.test(asString) || asString === "0") {
    throw badRequest(`Identifiant « ${field} » invalide.`, "invalid_id");
  }

  return asString;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value === 1 || value === "1" || value === "true") {
    return true;
  }

  if (value === 0 || value === "0" || value === "false") {
    return false;
  }

  throw badRequest("Valeur booléenne invalide.", "invalid_boolean");
}

/**
 * Nom de salon normalisé, à la manière de Discord : minuscules, tirets,
 * pas de caractères ambigus.
 */
function normalizeChannelName(value) {
  const raw = requireString(value, "nom du salon", { min: 1, max: 80 });

  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);

  return normalized || raw.toLowerCase().slice(0, 60);
}

/**
 * Extrait et valide la liste ordonnée d'identifiants d'un réordonnancement.
 */
function parseIdList(value, field = "ordre") {
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest(`Le champ « ${field} » doit être une liste non vide.`, "invalid_order");
  }

  if (value.length > 500) {
    throw badRequest(`Le champ « ${field} » est trop long.`, "invalid_order");
  }

  return value.map((item) => parseId(item, field));
}

module.exports = {
  requireString,
  optionalString,
  requireEmail,
  requirePassword,
  parseId,
  parseBigId,
  parseBoolean,
  normalizeChannelName,
  parseIdList,
};
