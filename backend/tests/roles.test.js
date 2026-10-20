/**
 * Rôles personnalisés (RBAC stocké en base).
 *
 * Les rôles ne sont plus un ENUM figé : chaque communauté possède les siens.
 * Ces tests couvrent ce qui change concrètement :
 *   - la gestion des rôles (création, modification, suppression) ;
 *   - l'attribution d'un rôle personnalisé à un membre ;
 *   - les garde-fous de hiérarchie : un rôle ne doit jamais rendre plus
 *     puissant que celui qui l'a fabriqué.
 *
 * Un bouton masqué dans React ne protège rien : tout est vérifié par le
 * serveur.
 */
const test = require("node:test");
const { after, before } = require("node:test");
const assert = require("node:assert/strict");

const {
  ROLES,
  PERMISSIONS,
  canGrantPermission,
  hasPermission,
  roleRank,
  effectivePermissions,
  DEFAULT_ROLE_RANKS,
  ALL_PERMISSIONS,
} = require("../src/permissions");

const {
  startTestServer,
  stopTestServer,
  api,
  createAccount,
  createCommunity,
  addMember,
  cleanupCommunity,
  cleanupUsers,
} = require("./helpers");

let ready = false;
const accounts = [];
const communities = [];

before(async () => {
  await startTestServer();
  ready = true;
});

after(async () => {
  for (const communityId of communities) {
    await cleanupCommunity(communityId);
  }

  await cleanupUsers(accounts);
  await stopTestServer();
});

async function setupCommunity() {
  const owner = await createAccount("role-owner");
  const admin = await createAccount("role-admin");
  const member = await createAccount("role-member");
  const outsider = await createAccount("role-outsider");

  accounts.push(owner, admin, member, outsider);

  const community = await createCommunity(owner, { isPublic: false });
  communities.push(community.id);

  await addMember(community.id, owner, admin, ROLES.ADMIN);
  await addMember(community.id, owner, member, ROLES.MEMBER);

  return { owner, admin, member, outsider, community };
}

function rolesUrl(communityId) {
  return `/api/communities/${communityId}/roles`;
}

// -----------------------------------------------------------------------------
// Lecture
// -----------------------------------------------------------------------------

test("les rôles système sont amorcés avec leurs permissions réelles", async () => {
  assert.ok(ready);
  const { owner, member, community } = await setupCommunity();

  const list = await api(rolesUrl(community.id), { token: owner.token });

  assert.equal(list.status, 200);

  const keys = list.body.roles.map((role) => role.key);

  assert.deepEqual(keys.sort(), ["admin", "member", "moderator", "owner"].sort());

  // Le propriétaire d'abord, puis les rôles par rang décroissant.
  assert.equal(list.body.roles[0].key, ROLES.OWNER);
  assert.ok(list.body.roles[0].isOwner);

  const moderator = list.body.roles.find((role) => role.key === ROLES.MODERATOR);

  assert.equal(moderator.rank, DEFAULT_ROLE_RANKS[ROLES.MODERATOR]);
  assert.ok(moderator.permissions.includes(PERMISSIONS.MODERATE_MESSAGES));
  assert.ok(!moderator.permissions.includes(PERMISSIONS.MANAGE_CHANNELS));

  // Un simple membre voit les rôles, mais n'en peut gérer aucun.
  const asMember = await api(rolesUrl(community.id), { token: member.token });

  assert.equal(asMember.status, 200);
  assert.equal(asMember.body.canManage, false);
  assert.deepEqual(asMember.body.assignableRoleIds, []);
  assert.deepEqual(asMember.body.editableRoleIds, []);
});

test("un non-membre ne voit pas les rôles d'une communauté privée", async () => {
  const { outsider, community } = await setupCommunity();

  const list = await api(rolesUrl(community.id), { token: outsider.token });

  assert.equal(list.status, 403);
});

test("le catalogue de permissions distingue ce qui est accordable", async () => {
  const { owner, admin, community } = await setupCommunity();

  const catalog = await api(`${rolesUrl(community.id)}/permissions`, {
    token: owner.token,
  });

  assert.equal(catalog.status, 200);
  assert.ok(catalog.body.permissions.includes(PERMISSIONS.MANAGE_COMMUNITY));
  // Le propriétaire a toutes les permissions… sauf la suppression, qui n'est
  // jamais déléguable à un rôle (voir `canGrantPermission`).
  assert.equal(
    catalog.body.grantable.length,
    ALL_PERMISSIONS.length - 1,
    "la suppression n'est jamais déléguable"
  );
  assert.ok(!catalog.body.grantable.includes(PERMISSIONS.MANAGE_COMMUNITY));
  assert.equal(catalog.body.maxAssignableRank, 99);

  const asAdmin = await api(`${rolesUrl(community.id)}/permissions`, {
    token: admin.token,
  });

  // Un administrateur ne peut PAS accorder la suppression : sinon il se
  // fabriquerait un rôle qui supprime la communauté à sa place.
  assert.ok(!asAdmin.body.grantable.includes(PERMISSIONS.MANAGE_COMMUNITY));
  assert.equal(asAdmin.body.maxAssignableRank, 74);
});

// -----------------------------------------------------------------------------
// Création / modification / suppression
// -----------------------------------------------------------------------------

test("un administrateur crée un rôle personnalisé et l'attribue", async () => {
  const { owner, admin, member, community } = await setupCommunity();

  const created = await api(rolesUrl(community.id), {
    method: "POST",
    token: admin.token,
    body: {
      name: "Animateur",
      description: "Anime les salons et les annonces.",
      color: "#f0b429",
      rank: 40,
      permissions: [
        PERMISSIONS.PUBLISH_ANNOUNCEMENTS,
        PERMISSIONS.SEND_MESSAGES,
        PERMISSIONS.REACT_MESSAGES,
      ],
    },
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.role.key, null, "un rôle personnalisé n'a pas de clé système");
  assert.equal(created.body.role.rank, 40);
  assert.equal(created.body.role.isSystem, false);
  assert.ok(created.body.role.permissions.includes(PERMISSIONS.PUBLISH_ANNOUNCEMENTS));

  // Le rôle est attribuable : il est strictement inférieur à celui de l'acteur.
  const assigned = await api(`/api/communities/${community.id}/members`, {
    method: "POST",
    token: admin.token,
    body: { userId: member.id, roleId: created.body.role.id },
  });

  // Le membre existait déjà (setup) : c'est une mise à jour de rôle (200),
  // pas une adhésion nouvelle (201).
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.member.role.id, created.body.role.id);
  assert.equal(assigned.body.member.role.name, "Animateur");
  assert.equal(assigned.body.member.roleKey, null);

  // …et la permission est réellement appliquée : ce membre peut publier une
  // annonce, ce qu'un simple membre ne peut pas faire.
  const channels = await api(`/api/communities/${community.id}/channels`, {
    token: owner.token,
  });

  assert.ok(channels.body.channels.length > 0, "le salon général doit exister");

  const announcement = await api(
    `/api/channels/${channels.body.channels[0].id}/messages`,
    {
      method: "POST",
      token: member.token,
      body: { content: "Rappel : réunion à 18h." },
    }
  );

  assert.equal(announcement.status, 201);
});

test("un rôle peut être modifié et ses permissions prennent effet", async () => {
  const { owner, admin, member, community } = await setupCommunity();

  const created = await api(rolesUrl(community.id), {
    method: "POST",
    token: owner.token,
    body: { name: "Pigeon", rank: 40, permissions: [PERMISSIONS.SEND_MESSAGES] },
  });

  assert.equal(created.status, 201);

  const roleId = created.body.role.id;

  await addMemberRole(community, owner, member, roleId);

  // Le membre n'a pas encore le droit d'épingler.
  assert.equal(
    hasPermission(
      (await memberRole(community, owner, member)).role,
      PERMISSIONS.PIN_MESSAGES
    ),
    false
  );

  const updated = await api(`${rolesUrl(community.id)}/${roleId}`, {
    method: "PATCH",
    token: owner.token,
    body: {
      name: "Pigeon voyageur",
      rank: 60,
      permissions: [PERMISSIONS.SEND_MESSAGES, PERMISSIONS.PIN_MESSAGES],
    },
  });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.role.name, "Pigeon voyageur");
  assert.equal(updated.body.role.rank, 60);
  assert.ok(updated.body.role.permissions.includes(PERMISSIONS.PIN_MESSAGES));

  // Le rôle du membre reflète aussitôt la modification.
  const after = await memberRole(community, owner, member);

  assert.equal(after.role.name, "Pigeon voyageur");
  assert.ok(after.role.permissions.includes(PERMISSIONS.PIN_MESSAGES));
});

async function addMemberRole(community, owner, target, roleId) {
  const added = await api(`/api/communities/${community.id}/members`, {
    method: "POST",
    token: owner.token,
    body: { userId: target.id, roleId },
  });

  assert.ok(
    added.status === 200 || added.status === 201,
    `ajout impossible : ${added.text}`
  );

  return added.body.member;
}

async function memberRole(community, owner, target) {
  const list = await api(`/api/communities/${community.id}/members`, {
    token: owner.token,
  });

  return list.body.members.find((member) => member.userId === target.id);
}

test("un rôle attribué à un membre ne peut pas être supprimé", async () => {
  const { owner, member, community } = await setupCommunity();

  const created = await api(rolesUrl(community.id), {
    method: "POST",
    token: owner.token,
    body: { name: "Temporaire", rank: 40, permissions: [PERMISSIONS.SEND_MESSAGES] },
  });

  await addMemberRole(community, owner, member, created.body.role.id);

  const removed = await api(`${rolesUrl(community.id)}/${created.body.role.id}`, {
    method: "DELETE",
    token: owner.token,
  });

  assert.equal(removed.status, 409);
  assert.equal(removed.body.code, "role_in_use");
});

test("un nom de rôle déjà pris est refusé", async () => {
  const { owner, community } = await setupCommunity();

  const first = await api(rolesUrl(community.id), {
    method: "POST",
    token: owner.token,
    body: { name: "Développeur", rank: 40, permissions: [] },
  });

  assert.equal(first.status, 201);

  const second = await api(rolesUrl(community.id), {
    method: "POST",
    token: owner.token,
    body: { name: "développeur", rank: 41, permissions: [] },
  });

  assert.equal(second.status, 409);
  assert.equal(second.body.code, "role_name_taken");
});

// -----------------------------------------------------------------------------
// Garde-fous
// -----------------------------------------------------------------------------

test("un rôle personnalisé ne peut pas obtenir une permission réservée", async () => {
  const { owner, community } = await setupCommunity();

  const result = await api(rolesUrl(community.id), {
    method: "POST",
    token: owner.token,
    body: {
      name: "Usurpateur",
      rank: 40,
      permissions: [PERMISSIONS.SEND_MESSAGES, PERMISSIONS.MANAGE_COMMUNITY],
    },
  });

  // Même le propriétaire ne peut pas déléguer la suppression de sa communauté.
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "permission_not_grantable");

  const unknown = await api(rolesUrl(community.id), {
    method: "POST",
    token: owner.token,
    body: { name: "Inconnu", rank: 40, permissions: ["world:destroy"] },
  });

  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, "unknown_permission");
});

test("un rang réservé aux rôles système est refusé", async () => {
  const { owner, community } = await setupCommunity();

  for (const [rank, code] of [
    [75, "rank_reserved"],
    [50, "rank_reserved"],
    [10, "rank_reserved"],
  ]) {
    const result = await api(rolesUrl(community.id), {
      method: "POST",
      token: owner.token,
      body: { name: `Rang ${rank}`, rank, permissions: [] },
    });

    assert.equal(result.status, 409, `rang ${rank} refusé`);
    assert.equal(result.body.code, code);
  }

  // Le rang du propriétaire est protégé par deux verrous : le contrôle de
  // rang de la route (403, « pas au-dessus de vous ») et, s'il passait, celui
  // des bornes système (409).
  const tooHigh = await api(rolesUrl(community.id), {
    method: "POST",
    token: owner.token,
    body: { name: "Au-dessus", rank: 100, permissions: [] },
  });

  assert.equal(tooHigh.status, 403);
  assert.equal(tooHigh.body.code, "insufficient_rank");
});

test("un administrateur ne peut pas créer de rôle plus puissant que lui", async () => {
  const { admin, community } = await setupCommunity();

  // Rang 76 > 75 : ce rôle surpasserait l'administrateur qui le crée.
  const escalation = await api(rolesUrl(community.id), {
    method: "POST",
    token: admin.token,
    body: { name: "Sur-admin", rank: 76, permissions: [PERMISSIONS.SEND_MESSAGES] },
  });

  assert.equal(escalation.status, 403);
  assert.equal(escalation.body.code, "insufficient_rank");

  // Un rang égal n'est pas accepté non plus.
  const same = await api(rolesUrl(community.id), {
    method: "POST",
    token: admin.token,
    body: { name: "Frère", rank: 75, permissions: [PERMISSIONS.SEND_MESSAGES] },
  });

  assert.equal(same.status, 403);
  assert.equal(same.body.code, "insufficient_rank");

  // En dessous, en revanche, c'est autorisé.
  const allowed = await api(rolesUrl(community.id), {
    method: "POST",
    token: admin.token,
    body: { name: "Assistant", rank: 74, permissions: [PERMISSIONS.SEND_MESSAGES] },
  });

  assert.equal(allowed.status, 201);
});

test("un simple membre ne peut pas créer de rôle", async () => {
  const { member, community } = await setupCommunity();

  const result = await api(rolesUrl(community.id), {
    method: "POST",
    token: member.token,
    body: { name: "Moi d'abord", rank: 40, permissions: [] },
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.code, "missing_permission");
});

test("on ne peut pas attribuer un rôle de rang égal ou supérieur au sien", async () => {
  const { owner, admin, community } = await setupCommunity();

  const adminRole = (
    await api(rolesUrl(community.id), { token: owner.token })
  ).body.roles.find((role) => role.key === ROLES.ADMIN);

  // L'administrateur s'auto-attribue le rôle administrateur : c'est le sien,
  // donc refusé.
  const target = await createAccount("role-self-target");
  accounts.push(target);

  await addMember(community.id, owner, target, ROLES.MEMBER);

  const attempt = await api(`/api/communities/${community.id}/members`, {
    method: "POST",
    token: admin.token,
    body: { userId: target.id, roleId: adminRole.id },
  });

  assert.equal(attempt.status, 403);
  assert.equal(attempt.body.code, "insufficient_rank");
});

test("les rôles système et le propriétaire ne sont jamais modifiables", async () => {
  const { owner, admin, community } = await setupCommunity();

  const list = await api(rolesUrl(community.id), { token: owner.token });
  const moderator = list.body.roles.find((role) => role.key === ROLES.MODERATOR);

  const renamed = await api(`${rolesUrl(community.id)}/${moderator.id}`, {
    method: "PATCH",
    token: owner.token,
    body: { name: "Grand chef" },
  });

  assert.equal(renamed.status, 403);
  assert.equal(renamed.body.code, "system_role_immutable");

  const deleted = await api(`${rolesUrl(community.id)}/${moderator.id}`, {
    method: "DELETE",
    token: owner.token,
  });

  assert.equal(deleted.status, 403);
  assert.equal(deleted.body.code, "system_role_immutable");

  // Le propriétaire n'a même pas de ligne de rôle : rien à éditer.
  const ownerRoleRow = list.body.roles.find((role) => role.isOwner);

  assert.equal(ownerRoleRow.id, null);

  const ownerPatched = await api(`${rolesUrl(community.id)}/null`, {
    method: "PATCH",
    token: admin.token,
    body: { name: "Moi" },
  });

  assert.ok(ownerPatched.status === 400 || ownerPatched.status === 404);
});

test("un rôle inconnu ne peut pas être attribué", async () => {
  const { owner, member, community } = await setupCommunity();

  const result = await api(`/api/communities/${community.id}/members`, {
    method: "POST",
    token: owner.token,
    body: { userId: member.id, roleId: 999999 },
  });

  assert.equal(result.status, 404);
  assert.equal(result.body.code, "role_not_found");
});

// -----------------------------------------------------------------------------
// Helpers purs (pas de base)
// -----------------------------------------------------------------------------

test("la hiérarchie est comparée par rang effectif, tous supports confondus", () => {
  const owner = { key: ROLES.OWNER, rank: 100, isOwner: true };
  const custom = { key: null, rank: 60, isOwner: false };

  assert.equal(roleRank(owner), 100);
  assert.equal(roleRank(custom), 60);
  assert.equal(roleRank(ROLES.ADMIN), DEFAULT_ROLE_RANKS[ROLES.ADMIN]);
  assert.equal(roleRank(null), null);

  assert.equal(hasPermission(custom, PERMISSIONS.SEND_MESSAGES), false, "sans permissions, aucun droit");
  assert.equal(hasPermission({ permissions: ["*"] }, PERMISSIONS.MANAGE_COMMUNITY), true);

  assert.deepEqual(effectivePermissions(null), []);
  assert.equal(effectivePermissions({ permissions: ["a", "b"] }).length, 2);
  assert.equal(effectivePermissions(ROLES.MEMBER).includes(PERMISSIONS.SEND_MESSAGES), true);
});

test("canGrantPermission interdit de déléguer la suppression", () => {
  const admin = { key: ROLES.ADMIN, rank: 75, permissions: [...effectivePermissions(ROLES.ADMIN)] };
  const owner = { key: ROLES.OWNER, rank: 100, isOwner: true, permissions: ["*"] };
  const member = { key: ROLES.MEMBER, rank: 10, permissions: [...effectivePermissions(ROLES.MEMBER)] };

  assert.equal(
    canGrantPermission(owner, PERMISSIONS.MANAGE_COMMUNITY),
    false,
    "même le propriétaire ne peut pas déléguer la suppression à un rôle"
  );
  assert.equal(
    canGrantPermission(admin, PERMISSIONS.MANAGE_COMMUNITY),
    false,
    "un administrateur ne peut pas non plus"
  );

  // On n'accorde jamais plus qu'on ne possède soi-même : sans cette règle, un
  // rôle avec `role:manage` fabriquerait un rôle plus riche et se l'attribuerait.
  assert.equal(
    canGrantPermission(admin, PERMISSIONS.MODERATE_MESSAGES),
    true,
    "l'administrateur détient ce droit, il peut l'accorder"
  );
  assert.equal(
    canGrantPermission(member, PERMISSIONS.MODERATE_MESSAGES),
    false,
    "un membre ne détient pas ce droit, il ne peut pas l'accorder"
  );
  assert.equal(canGrantPermission(admin, "world:destroy"), false);
});
