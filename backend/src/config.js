require("dotenv").config();

const path = require("path");

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const JWT_SECRET = process.env.JWT_SECRET || "";

if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET est absent de backend/.env. Ajoutez une valeur (au moins 32 caractères) puis relancez le serveur."
  );
}

if (JWT_SECRET.length < 24) {
  console.warn(
    "[config] JWT_SECRET est court. Utilisez une valeur d'au moins 32 caractères en production."
  );
}

const config = {
  env: process.env.NODE_ENV || "development",

  port: toInt(process.env.PORT, 3000),
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",

  jwt: {
    secret: JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || "1h",
  },

  /**
   * Limitation de débit. Désactivée uniquement en environnement de test, pour
   * que les scénarios puissent enchaîner les requêtes. En développement et en
   * production, elle est active.
   */
  rateLimit: {
    enabled: (process.env.NODE_ENV || "development") !== "test",
    authWindowMs: toInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000),
    authMax: toInt(process.env.AUTH_RATE_LIMIT_MAX, 30),
  },

  /**
   * Connexion Google / GitHub (OAuth 2.0, flux « authorization code »).
   * Une paire de clés absente désactive simplement le bouton correspondant :
   * le client est redirigé avec `?oauth=unconfigured` et affiche un message,
   * sans casser l'écran de connexion.
   *
   * Redirect URIs à déclarer chez le fournisseur :
   *   http://localhost:3000/api/auth/oauth/google/callback
   *   http://localhost:3000/api/auth/oauth/github/callback
   */
  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    },
  },

  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: toInt(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME || "devmeet_db",
    connectionLimit: toInt(process.env.DB_CONNECTION_LIMIT, 10),
  },

  uploads: {
    dir: process.env.UPLOAD_DIR
      ? path.resolve(process.cwd(), process.env.UPLOAD_DIR)
      : path.resolve(__dirname, "..", "uploads"),
    maxSizeBytes: toInt(process.env.MAX_UPLOAD_SIZE_MB, 10) * 1024 * 1024,
    allowedMimeTypes: [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/svg+xml",
      "application/pdf",
      "text/plain",
      "text/csv",
      "application/zip",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
  },

  // Communauté technique qui héberge les salons historiques créés via
  // l'ancien protocole Socket.IO (create-room / join-room + code d'accès).
  systemCommunityId: toInt(process.env.SYSTEM_COMMUNITY_ID, 1),
};

module.exports = config;
