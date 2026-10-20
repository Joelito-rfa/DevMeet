/**
 * Permissions — catalogue serveur + hiérarchie des rôles.
 *
 * Le CATALOGUE (la liste des permissions) vit ici, en dur : il est court, stable,
 * et partagé par le REST, Socket.IO et l'interface.
 *
 * En revanche, lassociation permission -> rôle n'est PLUS en dur. Elle est stockée
 * en base (`roles` / `role_permissions`) et lue par `services/roles.js`. Les
 * tableaux `ROLE_PERMISSIONS` ci-dessous ne servent plus qu'à :
 *   - amorcer les rôles système d'une communauté neuve ;
 *   - documenter la matrice par défaut.
 *
 * Toute vérification passe par `hasPermission()` : masquer un bouton dans React
 * ne protège rien.
 */

const ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MODERATOR: "moderator",
  MEMBER: "member",
};

const ROLE_LIST = [ROLES.OWNER, ROLES.ADMIN, ROLES.MODERATOR, ROLES.MEMBER];

const PERMISSIONS = {
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

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

/**
 * Permissions réservés au propriétaire de la communauté. Ni le propriétaire
 * d'une autre communauté ni un administrateur ne peuvent les distribuer : c'est
 * ce qui rend `community:manage` (suppression) non délégable.
 */
const OWNER_ONLY_PERMISSIONS = [PERMISSIONS.MANAGE_COMMUNITY];

/**
 * Matrice par défaut des rôles système. Sert de source d'amorçage :
 * `services/roles.seedDefaultRoles()` la copie en base à la création d'une
 * communauté (et à la migration des communautés existantes).
 */
const ROLE_PERMISSIONS = {
  [ROLES.OWNER]: ["*"],

  [ROLES.ADMIN]: [
    PERMISSIONS.UPDATE_COMMUNITY,
    PERMISSIONS.MANAGE_ROLES,
    PERMISSIONS.MANAGE_CATEGORIES,
    PERMISSIONS.MANAGE_CHANNELS,
    PERMISSIONS.INVITE_MEMBERS,
    PERMISSIONS.MANAGE_MEMBERS,
    PERMISSIONS.MODERATE_MESSAGES,
    PERMISSIONS.SEND_MESSAGES,
    PERMISSIONS.REACT_MESSAGES,
    PERMISSIONS.PIN_MESSAGES,
    PERMISSIONS.JOIN_VOICE,
    PERMISSIONS.PUBLISH_ANNOUNCEMENTS,
    PERMISSIONS.ACCESS_WHITEBOARD,
  ],

  [ROLES.MODERATOR]: [
    PERMISSIONS.INVITE_MEMBERS,
    PERMISSIONS.MODERATE_MESSAGES,
    PERMISSIONS.SEND_MESSAGES,
    PERMISSIONS.REACT_MESSAGES,
    PERMISSIONS.PIN_MESSAGES,
    PERMISSIONS.JOIN_VOICE,
    PERMISSIONS.ACCESS_WHITEBOARD,
  ],

  [ROLES.MEMBER]: [
    PERMISSIONS.SEND_MESSAGES,
    PERMISSIONS.REACT_MESSAGES,
    PERMISSIONS.JOIN_VOICE,
    PERMISSIONS.ACCESS_WHITEBOARD,
  ],
};

/**
 * Rang par défaut des rôles système.
 *
 * Le rang est un ENTIER, pas un enum : les rôles personnalisés créés par la
 * communauté se placent entre deux rôles système (ex. 60 => au-dessus des
 * modérateurs, en dessous des administrateurs). La règle qui compte est simple :
 * on n'attribue jamais un rôle de rang >= au sien.
 */
const DEFAULT_ROLE_RANKS = {
  [ROLES.OWNER]: 100,
  [ROLES.ADMIN]: 75,
  [ROLES.MODERATOR]: 50,
  [ROLES.MEMBER]: 10,
};

/** Rangs réservés : un rôle personnalisé ne peut pas les prendre. */
const ROLE_RANK_BOUNDS = {
  MIN: 1,
  MAX: 99,
};

/** Rangs occupés par les rôles système, pour interdire les collisions. */
const SYSTEM_ROLE_RANKS = [
  DEFAULT_ROLE_RANKS[ROLES.OWNER],
  DEFAULT_ROLE_RANKS[ROLES.ADMIN],
  DEFAULT_ROLE_RANKS[ROLES.MODERATOR],
  DEFAULT_ROLE_RANKS[ROLES.MEMBER],
];

const ROLE_DESCRIPTIONS = {
  [ROLES.OWNER]: "Propriétaire de la communauté.",
  [ROLES.ADMIN]: "Administre la communauté, les rôles, les salons et les membres.",
  [ROLES.MODERATOR]: "Modère les échanges et invite des membres.",
  [ROLES.MEMBER]: "Participe aux échanges.",
};

function isRole(value) {
  return ROLE_LIST.includes(value);
}

function isPermission(value) {
  return ALL_PERMISSIONS.includes(value);
}

/**
 * Permissions accordées par défaut à un rôle système.
 * `owner` est un joker : il possède tout, y compris ce qui n'existe pas encore.
 *
 * Utilisée pour amorcer les rôles d'une communauté neuve. Pour un rôle existant
 * (donc pour les permissions réelles), lire `services/roles.js`.
 */
function permissionsForRole(role) {
  const granted = ROLE_PERMISSIONS[role];

  if (!granted) {
    return [];
  }

  return granted.includes("*") ? [...ALL_PERMISSIONS] : [...granted];
}

/**
 * Permissions EFFECTIVES d'un rôle, quelle que soit sa forme (résolu en base,
 * objet `{ permissions }`, tableau, ou clé système).
 *
 * C'est ce que l'API renvoie au client : la liste réelle, pas la matrice par
 * défaut. L'interface n'a donc plus sa propre copie à maintenir.
 */
function effectivePermissions(subject) {
  if (!subject) {
    return [];
  }

  if (Array.isArray(subject)) {
    return [...subject];
  }

  if (typeof subject === "object") {
    if (Array.isArray(subject.permissions)) {
      return subject.permissions.includes("*")
        ? [...ALL_PERMISSIONS]
        : [...subject.permissions];
    }

    if (typeof subject.key === "string") {
      return permissionsForRole(subject.key);
    }

    return [];
  }

  if (typeof subject === "string") {
    return permissionsForRole(subject);
  }

  return [];
}

/**
 * VRAIE source de vérité d'un contrôle d'accès.
 *
 * @param {string[]|{permissions?: string[]}|string|null} subject
 *   - un tableau de permissions (forme normale, venue de la base) ;
 *   - un rôle résolu (`{ permissions }`) ;
 *   - une clé de rôle système (repli : matrice par défaut) ;
 *   - `null` si l'utilisateur n'est pas membre.
 * @param {string} permission
 */
function hasPermission(subject, permission) {
  if (!subject || !permission) {
    return false;
  }

  let granted = null;

  if (Array.isArray(subject)) {
    granted = subject;
  } else if (typeof subject === "object" && Array.isArray(subject.permissions)) {
    granted = subject.permissions;
  } else if (typeof subject === "string") {
    granted = permissionsForRole(subject);
  } else {
    return false;
  }

  return granted.includes("*") || granted.includes(permission);
}

/** Rang effectif d'un rôle, sous toutes ses formes. `null` si inconnu. */
function roleRank(subject) {
  if (!subject) {
    return null;
  }

  if (typeof subject === "object" && Number.isFinite(Number(subject.rank))) {
    return Number(subject.rank);
  }

  if (typeof subject === "string" && DEFAULT_ROLE_RANKS[subject] !== undefined) {
    return DEFAULT_ROLE_RANKS[subject];
  }

  return null;
}

/** Le rôle appartient-il à l'un des quatre rôles système ? */
function isSystemRole(subject) {
  if (!subject) {
    return false;
  }

  if (typeof subject === "object") {
    return Boolean(subject.isSystem);
  }

  return isRole(subject);
}

/** Rôle de propriété (celui qui peut supprimer la communauté). */
function isOwnerRole(subject) {
  if (!subject) {
    return false;
  }

  if (typeof subject === "object") {
    return subject.key === ROLES.OWNER;
  }

  return subject === ROLES.OWNER;
}

/**
 * Un membre ne peut agir que sur un rôle strictement inférieur au sien.
 * Le propriétaire ne peut être ni modifié ni exclu, et son rang est unique.
 */
function canManageRole(actorRole, targetRole) {
  if (!actorRole || !targetRole || isOwnerRole(targetRole)) {
    return false;
  }

  const actor = roleRank(actorRole);
  const target = roleRank(targetRole);

  if (actor === null || target === null) {
    return false;
  }

  return actor > target;
}

/**
 * Un membre peut-il attribuer ce rôle ? On ne distribue jamais un rôle de rang
 * égal ou supérieur au sien, et le rang de propriétaire ne s'attribue pas.
 */
function canAssignRole(actorRole, targetRole) {
  if (!actorRole || !targetRole || isOwnerRole(targetRole)) {
    return false;
  }

  const actor = roleRank(actorRole);
  const target = roleRank(targetRole);

  if (actor === null || target === null) {
    return false;
  }

  return actor > target;
}

/**
 * Peut-on accorder cette permission à un rôle ?
 *
 * Deux règles, dans cet ordre :
 *
 *   1. `community:manage` (suppression de la communauté) n'est JAMAIS
 *      déléguable à un rôle, pas même depuis le compte du propriétaire. Un tel
 *      rôle serait attribuable par un administrateur (rang 75 > rang 40) à
 *      lui-même : le propriétaire la détient par nature (`owner_id`), pas par
 *      une permission.
 *
 *   2. On n'accorde jamais plus qu'on ne possède soi-même. Sans cette règle,
 *      un rôle portant `role:manage` mais peu de permissions pourrait créer un
 *      rôle plus riche que le sien — et le s'attribuer.
 *
 * @param {object} subject rôle résolu de l'acteur (ou `null`).
 */
function canGrantPermission(subject, permission) {
  if (!isPermission(permission)) {
    return false;
  }

  if (OWNER_ONLY_PERMISSIONS.includes(permission)) {
    return false;
  }

  return hasPermission(subject, permission);
}

module.exports = {
  ROLES,
  ROLE_LIST,
  PERMISSIONS,
  ALL_PERMISSIONS,
  OWNER_ONLY_PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_DESCRIPTIONS,
  DEFAULT_ROLE_RANKS,
  ROLE_RANK_BOUNDS,
  SYSTEM_ROLE_RANKS,
  isRole,
  isPermission,
  isSystemRole,
  isOwnerRole,
  hasPermission,
  roleRank,
  canManageRole,
  canAssignRole,
  canGrantPermission,
  permissionsForRole,
  effectivePermissions,
};