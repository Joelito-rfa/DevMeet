/**
 * Aide-champs pour les rôles côté interface.
 *
 * ⚠️ Ce fichier ne protège RIEN : il sert uniquement à masquer ou désactiver
 * les actions qui échoueraient de toute façon. La décision finale est toujours
 * prise par le serveur, qui répond 403 sinon.
 *
 * Il n'a plus SA copie de la matrice des droits : chaque rôle porte ses
 * permissions réelles (`role.permissions`), renvoyées par l'API. Le serveur
 * reste la seule source de vérité — ici on se contente de les lire.
 */

export const ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MODERATOR: "moderator",
  MEMBER: "member",
};

export const PERMISSIONS = {
  MANAGE_COMMUNITY: "community:manage",
  UPDATE_COMMUNITY: "community:update",
  MANAGE_ROLES: "role:manage",
  MANAGE_CATEGORIES: "category:manage",
  MANAGE_CHANNELS: "channel:manage",
  INVITE_MEMBERS: "member:invite",
  MANAGE_MEMBERS: "member:manage",
  MODERATE_MESSAGES: "message:moderate",
  SEND_MESSAGES: "message:send",
  REACT_MESSAGES: "message:react",
  PIN_MESSAGES: "message:pin",
  JOIN_VOICE: "voice:join",
  PUBLISH_ANNOUNCEMENTS: "announcement:publish",
  ACCESS_WHITEBOARD: "board:access",
};

/**
 * Libellés affichables des permissions.
 *
 * ⚠️ Purement cosmétique : ce dictionnaire ne sert qu'à formater des cases à
 * cocher. La liste VRAIE des permissions est renvoyée par
 * `GET /communities/:id/roles/permissions` — si le serveur en ajoute une que ce
 * fichier ne connaît pas, l'interface affiche sa clé brute plutôt que de la
 * masquer.
 */
export const PERMISSION_LABELS = {
  [PERMISSIONS.MANAGE_COMMUNITY]: "Supprimer la communauté",
  [PERMISSIONS.UPDATE_COMMUNITY]: "Modifier la communauté",
  [PERMISSIONS.MANAGE_ROLES]: "Gérer les rôles",
  [PERMISSIONS.MANAGE_CATEGORIES]: "Gérer les catégories",
  [PERMISSIONS.MANAGE_CHANNELS]: "Gérer les salons",
  [PERMISSIONS.INVITE_MEMBERS]: "Inviter des membres",
  [PERMISSIONS.MANAGE_MEMBERS]: "Gérer les membres",
  [PERMISSIONS.MODERATE_MESSAGES]: "Modérer les messages",
  [PERMISSIONS.SEND_MESSAGES]: "Écrire dans les salons",
  [PERMISSIONS.REACT_MESSAGES]: "Réagir aux messages",
  [PERMISSIONS.PIN_MESSAGES]: "Épingler des messages",
  [PERMISSIONS.JOIN_VOICE]: "Rejoindre les salons vocaux",
  [PERMISSIONS.PUBLISH_ANNOUNCEMENTS]: "Publier des annonces",
  [PERMISSIONS.ACCESS_WHITEBOARD]: "Utiliser les tableaux blancs",
};

/**
 * Regroupement des permissions pour l'affichage.
 *
 * Les clés sont des préfixes de permission (`message:`, `community:`…). Une
 * permission dont le préfixe ne figure pas ici est placée dans « Autres » plutôt
 * que d'être perdue.
 */
export const PERMISSION_GROUPS = [
  ["Communauté", ["community:", "role:"]],
  ["Membres", ["member:"]],
  ["Messages", ["message:", "announcement:"]],
  ["Salons", ["category:", "channel:", "voice:", "board:"]],
];

/** Libellé d'une permission inconnue du dictionnaire local : sa clé brute. */
export function permissionLabel(permission) {
  return PERMISSION_LABELS[permission] || permission;
}

/**
 * Libellés des rôles système (servent de repli si le serveur n'a pas encore
 * renvoyé le rôle). Les rôles personnalisés portent leur propre nom en base.
 */
const ROLE_LABELS = {
  [ROLES.OWNER]: "Propriétaire",
  [ROLES.ADMIN]: "Administrateur",
  [ROLES.MODERATOR]: "Modérateur",
  [ROLES.MEMBER]: "Membre",
};

/**
 * Réactions proposées par l'interface. Le serveur applique EXACTEMENT la même
 * liste blanche : une réaction envoyée à la main hors de cette liste est
 * refusée (`emoji_not_allowed`).
 */
export const REACTION_EMOJIS = [
  "👍",
  "👎",
  "❤️",
  "😂",
  "😮",
  "😢",
  "🎉",
  "🔥",
  "🚀",
  "👀",
  "✅",
  "❌",
  "🙏",
  "💡",
];

/**
 * Accepte les trois formes rencontrées dans le code :
 *   - un objet rôle complet (forme normale, renvoyée par l'API) ;
 *   - une chaîne (clé système, legacy) ;
 *   - `null` (non membre) et ses formes particulières (chaîne vide, 0).
 */
function normalizeRole(role) {
  if (role === null || role === undefined || role === "" || role === 0) {
    return null;
  }

  if (typeof role === "object") {
    return role;
  }

  return { key: String(role), name: ROLE_LABELS[role] || null, rank: 0 };
}

/** Clé utilisable dans une classe CSS (`ws-badge-owner`, …). */
export function roleKey(role) {
  const normalized = normalizeRole(role);

  if (!normalized) {
    return "guest";
  }

  return normalized.key || "custom";
}

/** Libellé affichable : le nom du rôle, système ou personnalisé. */
export function roleLabel(role) {
  const normalized = normalizeRole(role);

  if (!normalized) {
    return "Visiteur";
  }

  return normalized.name || ROLE_LABELS[normalized.key] || "Membre";
}

/**
 * Permission accordée à ce rôle ? On lit les permissions que le serveur a
 * réellement renvoyées pour le rôle, jamais une table par défaut locale.
 */
export function hasPermission(role, permission) {
  const normalized = normalizeRole(role);

  if (!normalized || !permission) {
    return false;
  }

  if (Array.isArray(normalized.permissions)) {
    return (
      normalized.permissions.includes("*") ||
      normalized.permissions.includes(permission)
    );
  }

  return false;
}

/** Permissions effectives d'un rôle (tableau toujours valide pour l'UI). */
export function effectivePermissions(role) {
  const normalized = normalizeRole(role);

  if (!normalized || !Array.isArray(normalized.permissions)) {
    return [];
  }

  return normalized.permissions;
}

/**
 * Rôles qu'un acteur peut attribuer : strictement moins puissants, jamais le
 * propriétaire.
 *
 * `roles` est la liste renvoyée par `GET /communities/:id/roles` (résolue par
 * le serveur) ; sans elle on ne peut pas connaître les rôles personnalisés.
 */
export function assignableRoles(actorRole, roles = []) {
  const actor = normalizeRole(actorRole);

  if (!actor) {
    return [];
  }

  if (Array.isArray(roles) && roles.length > 0) {
    return roles.filter(
      (role) =>
        !role.isOwner &&
        role.isAssignable &&
        role.key !== ROLES.OWNER &&
        Number(role.rank) < Number(actor.rank)
    );
  }

  // Repli avant le chargement des rôles : les seuls rôles connus ici sont les
  // quatre systèmes, d'après leur rang par défaut. Aucune matrice de droits
  // n'est dupliquée localement.
  const DEFAULT_RANKS = {
    [ROLES.ADMIN]: 75,
    [ROLES.MODERATOR]: 50,
    [ROLES.MEMBER]: 10,
  };

  return [ROLES.ADMIN, ROLES.MODERATOR, ROLES.MEMBER]
    .filter((key) => DEFAULT_RANKS[key] < Number(actor.rank))
    .map((key) => ({
      id: null,
      key,
      name: ROLE_LABELS[key],
      rank: DEFAULT_RANKS[key],
    }));
}

/** Peut-on agir sur ce membre (rôle strictement inférieur, jamais le propriétaire) ? */
export function canManageMember(actorRole, targetRole) {
  const actor = normalizeRole(actorRole);
  const target = normalizeRole(targetRole);

  if (!actor || !target) {
    return false;
  }

  if (target.isOwner || target.key === ROLES.OWNER) {
    return false;
  }

  return Number(actor.rank) > Number(target.rank);
}