/**
 * Point d'entrée unique vers l'API DevMeet.
 *
 * L'URL est configurable (VITE_API_URL) tout en gardant la valeur historique
 * http://localhost:3000 par défaut : rien à changer pour lancer le projet.
 */
export const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:3000"
).replace(/\/+$/, "");

export const SOCKET_URL = API_URL;

export const TOKEN_KEY = "devmeet.token";
export const USER_KEY = "devmeet.user";

export function readStoredToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function readStoredUser() {
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeSession(token, user) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);

    if (user) {
      window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
  } catch {
    // Stockage indisponible (navigation privée) : la session vit en mémoire.
  }
}

export function clearSession() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  } catch {
    // Rien à faire : il n'y avait rien à supprimer.
  }
}

/**
 * Requête HTTP authentifiée. Renvoie `{ ok, status, data }` de façon uniforme
 * pour éviter de répéter la gestion d'erreur dans chaque écran.
 */
export async function apiFetch(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  return readResponse(response);
}

/**
 * Envoi de fichier réel (`multipart/form-data`).
 *
 * On ne fixe surtout pas `Content-Type` : le navigateur doit poser lui-même la
 * frontière du formulaire, sinon le serveur ne peut pas analyser l'envoi.
 */
export async function apiUpload(
  path,
  { token, file, fields = {}, method = "POST" } = {}
) {
  const form = new FormData();

  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      form.append(key, value);
    }
  });

  if (file) {
    form.append("file", file, file.name);
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form,
  });

  return readResponse(response);
}

/** Lecture uniforme d'une réponse : JSON si possible, texte sinon. */
async function readResponse(response) {
  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Réponse non JSON (page d'erreur HTML, proxy…) : on laisse `data` à null.
  }

  return { ok: response.ok, status: response.status, data, text };
}
