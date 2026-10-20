/**
 * Composition de l'application HTTP et temps réel.
 *
 * Séparé de `server.js` pour deux raisons :
 *   - `server.js` reste le point d'entrée `npm start` / `npm run dev` ;
 *   - les tests peuvent créer une instance isolée sur un port libre sans lancer
 *     le processus de production.
 */
const http = require("http");

const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const config = require("./config");
const apiRouter = require("./routes");
const { attachRealtime } = require("./realtime");
const { HttpError } = require("./utils/errors");

function createApp({ rateLimiting = config.rateLimit.enabled } = {}) {
  const app = express();

  app.set("trust proxy", 1);

  app.use(
    helmet({
      // API pure, consommée par un client Vite sur un autre port : la CSP par
      // défaut de Helmet n'a pas de sens ici.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  app.use(
    cors({
      origin: config.clientUrl,
      credentials: true,
    })
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));

  // Limitation de débit globale, en complément de celles des routes sensibles.
  // Désactivée en test pour ne pas fausser les scénarios.
  if (rateLimiting) {
    app.use(
      rateLimit({
        windowMs: 60 * 1000,
        limit: 600,
        standardHeaders: true,
        legacyHeaders: false,
      })
    );
  }

  // Message de bienvenue : conservé pour la compatibilité de l'ancien client.
  app.get("/", (req, res) => {
    res.json({
      message: "Serveur DevMeet opérationnel !",
      version: "2.0.0",
      persistence: "mysql",
    });
  });

  app.use("/api", apiRouter);

  app.use((req, res) => {
    res.status(404).json({ message: "Route introuvable." });
  });

  /**
   * Handler d'erreur unique : les erreurs prévues (HttpError) renvoient leur
   * statut et un message lisible ; les autres sont journalisées et masquées
   * derrière un 500 générique (jamais de trace SQL exposée).
   */
  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    if (error instanceof HttpError) {
      const payload = { message: error.message };

      if (error.code) {
        payload.code = error.code;
      }

      if (error.currentState) {
        payload.currentState = error.currentState;
      }

      return res.status(error.status).json(payload);
    }

    console.error("[api] erreur non gérée :", error);

    return res.status(500).json({
      message: "Une erreur interne est survenue.",
      code: "internal_error",
    });
  });

  return app;
}

/**
 * Crée le serveur HTTP et branche Socket.IO.
 * L'appelant décide du port (utile pour les tests).
 */
function createHttpServer(options) {
  const app = createApp(options);
  const server = http.createServer(app);
  const io = attachRealtime(server);

  return { app, server, io };
}

module.exports = { createApp, createHttpServer };
