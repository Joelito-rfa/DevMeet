import { io } from "socket.io-client";

import { SOCKET_URL, readStoredToken } from "./api";

/**
 * Connexion temps réel authentifiée.
 *
 * Le serveur refuse toute connexion sans jeton valide : le singleton conserve
 * donc l'identifiant de compte et le jeton, et les composants existants
 * continuent d'utiliser `socket.emit(...)` / `socket.on(...)` sans changement.
 *
 * Le module s'exporte par défaut sous forme d'instance pour rester compatible
 * avec `import socket from "../services/socket"` (utilisé partout).
 */
const socket = io(SOCKET_URL, {
  autoConnect: false,
  withCredentials: true,
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionDelay: 700,
  reconnectionDelayMax: 5000,
  auth: { token: readStoredToken() },
});

/** Ouvre la connexion pour un jeton donné (après connexion ou restauration). */
export function connectSocket(token) {
  socket.auth = { token: token || "" };

  if (socket.connected) {
    socket.disconnect();
  }

  socket.connect();
  return socket;
}

/** Ferme la connexion et oublie le jeton. */
export function disconnectSocket() {
  socket.auth = { token: "" };

  if (socket.connected) {
    socket.disconnect();
  }
}

/**
 * À chaque reconnexion, le serveur a oublié les salons rejoints par ce socket :
 * on redemande l'état de session. Les écrans se réabonnent en écoutant
 * `session:resumed`.
 */
socket.on("reconnect", () => {
  if (socket.auth?.token) {
    socket.emit("session:resume", {}, () => {});
  }
});

export default socket;
