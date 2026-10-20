/**
 * Outillage des tests.
 *
 * Les tests démarrent une vraie instance du serveur (HTTP + Socket.IO) sur un
 * port libre, contre la base MySQL migrée. Aucune base séparée n'est créée :
 * toutes les données de test portent un suffixe unique et sont supprimées à la
 * fin du fichier de test.
 */
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

// Les tests forcent l'environnement « test » APRÈS le chargement de .env :
// cela désactive la limitation de débit (voir src/config.js) sans changer la
// base de données utilisée.
process.env.NODE_ENV = "test";

const { io: createClient } = require("socket.io-client");

const { createHttpServer } = require("../src/app");
const { query, queryOne, closePool } = require("../src/db/pool");
const { runMigrations } = require("../src/db/migrate");

let server = null;
let serverIo = null;
let baseUrl = null;

async function startTestServer() {
  if (server) {
    return { baseUrl, io: serverIo };
  }

  await runMigrations({ log: () => {} });

  const created = createHttpServer({ rateLimiting: false });
  server = created.server;
  serverIo = created.io;

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  baseUrl = `http://127.0.0.1:${server.address().port}`;

  return { baseUrl, io: serverIo };
}

async function stopTestServer() {
  if (serverIo) {
    serverIo.close();
    serverIo = null;
  }

  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
    baseUrl = null;
  }

  await closePool();
}

function uniqueSuffix() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Appel HTTP avec jeton optionnel. Renvoie toujours le statut et le corps
 * analysé, ce qui rend les assertions lisibles.
 */
async function api(urlPath, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();

  let parsed = null;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (error) {
    parsed = null;
  }

  return { status: response.status, body: parsed, text };
}

/** Crée un compte réel et renvoie son jeton + ses identifiants. */
async function createAccount(label = "user", extra = {}) {
  const suffix = uniqueSuffix();
  const email = `${label}-${suffix}@devmeet.test`;
  const password = "MotDePasse!2026";

  const result = await api("/api/auth/register", {
    method: "POST",
    body: {
      name: extra.name || `${label} ${suffix}`,
      email,
      password,
    },
  });

  if (result.status !== 201) {
    throw new Error(
      `Création de compte impossible (${result.status}) : ${result.text}`
    );
  }

  const login = await api("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });

  if (login.status !== 200) {
    throw new Error(`Connexion impossible (${login.status}) : ${login.text}`);
  }

  return {
    id: login.body.user.id,
    email,
    password,
    token: login.body.token,
    name: login.body.user.name,
  };
}

/** Crée une communauté dont l'utilisateur est propriétaire. */
async function createCommunity(owner, overrides = {}) {
  const suffix = uniqueSuffix();

  const result = await api("/api/communities", {
    method: "POST",
    token: owner.token,
    body: {
      name: overrides.name || `Test ${suffix}`,
      description: "Communauté créée par les tests.",
      isPublic: overrides.isPublic ?? false,
    },
  });

  if (result.status !== 201) {
    throw new Error(
      `Création de communauté impossible (${result.status}) : ${result.text}`
    );
  }

  return result.body.community;
}

async function addMember(communityId, actor, target, role) {
  const created = await api(`/api/communities/${communityId}/members`, {
    method: "POST",
    token: actor.token,
    body: { userId: target.id, role },
  });

  if (created.status === 201 || created.status === 200) {
    return created.body.member;
  }

  throw new Error(
    `Ajout du membre impossible (${created.status}) : ${created.text}`
  );
}

/**
 * Identifiant du rôle système, ou `null` pour un rôle personnalisé.
 *
 * Le membre est renvoyé avec son rôle COMPLET (id, libellé, rang,
 * permissions) et non plus une simple chaîne : ce helper sert d'accord
 * d'écriture pour les assertions « le rôle est bien « modérateur » ».
 */
function roleKeyOf(memberOrRole) {
  if (!memberOrRole) {
    return null;
  }

  const role = memberOrRole.role ?? memberOrRole;

  if (!role || typeof role !== "object") {
    return null;
  }

  return role.key || null;
}

/** Rôle d'un membre en base, via la table `roles` (la colonne `role` n'existe plus). */
async function dbRoleKeyOf(communityId, userId) {
  const row = await queryOne(
    `SELECT r.\`key\` AS role_key
     FROM community_members cm
     LEFT JOIN roles r ON r.id = cm.role_id
     WHERE cm.community_id = ? AND cm.user_id = ?`,
    [communityId, userId]
  );

  return row ? row.role_key : undefined;
}

/**
 * Ouvre une connexion Socket.IO authentifiée et attend `session:ready`.
 */
function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = createClient(baseUrl, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
      timeout: 8000,
    });

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Délai d'attente de session:ready dépassé."));
    }, 9000);

    socket.on("session:ready", (payload) => {
      clearTimeout(timer);
      resolve({ socket, ready: payload });
    });

    socket.on("connect_error", (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

/** Attend un unique événement Socket.IO (avec délai maximal). */
function waitFor(socket, event, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Événement « ${event} » non reçu.`));
    }, timeoutMs);

    function handler(payload) {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }

    socket.on(event, handler);
  });
}

/** Émet et attend l'accusé de réception `ack`. */
function emitWithAck(socket, event, payload, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Aucun accusé pour « ${event} ».`));
    }, timeoutMs);

    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

/** Supprime une communauté de test et tout son contenu (cascades SQL). */
async function cleanupCommunity(communityId) {
  await query("DELETE FROM communities WHERE id = ?", [communityId]);
}

/** Supprime les comptes de test créés (les messages restent, author_id → NULL). */
async function cleanupUsers(users) {
  const ids = users.map((user) => user.id).filter(Boolean);

  if (ids.length === 0) {
    return;
  }

  await query(
    `DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
}

async function countRows(table, whereSql, params) {
  const row = await queryOne(
    `SELECT COUNT(*) AS total FROM \`${table}\` WHERE ${whereSql}`,
    params
  );

  return row ? Number(row.total) : 0;
}

module.exports = {
  startTestServer,
  stopTestServer,
  uniqueSuffix,
  api,
  createAccount,
  createCommunity,
  addMember,
  roleKeyOf,
  dbRoleKeyOf,
  connectSocket,
  waitFor,
  emitWithAck,
  cleanupCommunity,
  cleanupUsers,
  countRows,
  getBaseUrl: () => baseUrl,
  query,
  queryOne,
};
