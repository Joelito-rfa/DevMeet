const { Server } = require("socket.io");

const config = require("../config");
const { authenticateToken } = require("../middleware/auth");
const usersService = require("../services/users");
const communities = require("../services/communities");
const { query } = require("../db/pool");
const registry = require("./registry");
const bus = require("./bus");
const { syncUserRooms } = require("./sync");
const chat = require("./chat");
const board = require("./board");
const voice = require("./voice");
const legacyRooms = require("./legacy-rooms");

/**
 * Toute erreur dans un handler Socket.IO est capturée et transformée en
 * événement `socket:error` : un plantage silencieux côté serveur ne doit jamais
 * laisser le client dans le flou.
 */
function wrapSocketHandlers(socket) {
  const originalOn = socket.on.bind(socket);

  socket.on = (event, handler) => {
    if (typeof handler !== "function") {
      return originalOn(event, handler);
    }

    return originalOn(event, (...args) => {
      try {
        const result = handler(...args);

        if (result && typeof result.then === "function") {
          result.catch((error) => {
            console.error(`[socket] « ${event} » a échoué :`, error.message);

            socket.emit("socket:error", {
              event,
              message: error.message || "Une erreur est survenue.",
              code: error.code || "internal_error",
            });
          });
        }
      } catch (error) {
        console.error(`[socket] « ${event} » a échoué :`, error.message);

        socket.emit("socket:error", {
          event,
          message: error.message || "Une erreur est survenue.",
          code: error.code || "internal_error",
        });
      }
    });
  };
}

/** Diffuse la présence aux communautés dont l'utilisateur est membre. */
async function broadcastPresence(user, online) {
  if (!bus.isBound()) {
    return;
  }

  const rows = await query(
    "SELECT community_id FROM community_members WHERE user_id = ?",
    [user.id]
  );

  const payload = {
    userId: Number(user.id),
    name: user.name,
    avatarUrl: user.avatar_url || null,
    online,
  };

  for (const row of rows) {
    bus.toCommunity(Number(row.community_id), "presence:update", payload);
  }
}

function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: config.clientUrl,
      methods: ["GET", "POST"],
      credentials: true,
    },
    maxHttpBufferSize: 2 * 1024 * 1024,
  });

  bus.bind(io);

  /**
   * Authentification de la connexion : le jeton JWT est vérifié, le compte est
   * rechargé en base, et `socket.user` devient la SEULE source d'identité.
   * Aucun événement n'est traité avant cette étape.
   */
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (socket.handshake.headers?.authorization?.startsWith("Bearer ")
          ? socket.handshake.headers.authorization.slice(7)
          : null);

      if (!token) {
        return next(Object.assign(new Error("Authentification requise."), { data: { code: "auth_required" } }));
      }

      socket.user = await authenticateToken(token);
      return next();
    } catch (error) {
      return next(
        Object.assign(new Error(error.message || "Authentification refusée."), {
          data: { code: error.code || "auth_failed" },
        })
      );
    }
  });

  io.on("connection", async (socket) => {
    wrapSocketHandlers(socket);

    registry.addSocket(socket);
    registry.register(socket.user.id, socket);
    socket.join(registry.userRoom(socket.user.id));

    try {
      await syncUserRooms(socket.user.id);
      await usersService.touchLastSeen(socket.user.id);
    } catch (error) {
      console.error("[socket] synchronisation initiale impossible :", error.message);
    }

    socket.emit("session:ready", {
      user: {
        id: Number(socket.user.id),
        name: socket.user.name,
        email: socket.user.email,
        avatarUrl: socket.user.avatar_url || null,
      },
      socketId: socket.id,
      onlineUserIds: registry.onlineUserIds(),
    });

    broadcastPresence(socket.user, true).catch(() => {});

    chat.register(io, socket);
    board.register(io, socket);
    voice.register(io, socket);
    legacyRooms.register(io, socket);

    /**
     * Resynchronisation demandée par le client (reconnexion, retour d'onglet) :
     * on recalcule ses chambres et on lui renvoie l'état minimal à recharger.
     */
    socket.on("session:resume", async (payload, ack) => {
      await syncUserRooms(socket.user.id);

      const communityRows = await query(
        "SELECT community_id FROM community_members WHERE user_id = ?",
        [socket.user.id]
      );

      const resumed = {
        user: {
          id: Number(socket.user.id),
          name: socket.user.name,
          email: socket.user.email,
          avatarUrl: socket.user.avatar_url || null,
        },
        communityIds: communityRows.map((row) => Number(row.community_id)),
        voiceChannelIds: registry.voiceChannelIdsForUser(socket.user.id),
        // Salons auxquels ce socket est réellement abonné (chat).
        channelIds: Array.from(socket.data.channels || []),
        onlineUserIds: registry.onlineUserIds(),
      };

      socket.emit("session:resumed", resumed);

      if (typeof ack === "function") {
        ack({ success: true, ...resumed });
      }
    });

    socket.on("presence:ping", async () => {
      await usersService.touchLastSeen(socket.user.id);
      socket.emit("presence:pong", { at: Date.now() });
    });

    socket.on("disconnect", async (reason) => {
      voice.cleanup(socket);
      legacyRooms.cleanup(socket, io);

      const communityIds = (await query(
        "SELECT community_id FROM community_members WHERE user_id = ?",
        [socket.user.id]
      ).catch(() => [])).map((row) => Number(row.community_id));

      registry.unregister(socket.user.id, socket);
      registry.removeSocket(socket.id);

      if (!registry.isOnline(socket.user.id)) {
        for (const communityId of communityIds) {
          bus.toCommunity(communityId, "presence:update", {
            userId: Number(socket.user.id),
            name: socket.user.name,
            online: false,
          });
        }
      }

      legacyRooms.emitRoomsList(io).catch(() => {});

      console.log(`[socket] ${socket.user.name} déconnecté (${reason})`);
    });
  });

  return io;
}

module.exports = { attachRealtime };
