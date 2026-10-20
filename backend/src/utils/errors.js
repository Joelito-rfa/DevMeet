/**
 * Erreur HTTP normalisée. Toute la couche service lève ces erreurs : les
 * routes n'ont pas à deviner le code de statut, et le handler global les
 * convertit en réponse JSON cohérente.
 */
class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code || undefined;
  }
}

const badRequest = (message, code) => new HttpError(400, message, code);
const unauthorized = (message = "Authentification requise.", code) =>
  new HttpError(401, message, code);
const forbidden = (message = "Action non autorisée.", code) =>
  new HttpError(403, message, code);
const notFound = (message = "Ressource introuvable.", code) =>
  new HttpError(404, message, code);
const conflict = (message, code) => new HttpError(409, message, code);

module.exports = {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
};
