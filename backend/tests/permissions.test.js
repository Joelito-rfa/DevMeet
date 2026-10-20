/**
 * Rôles et permissions.
 *
 * Deux niveaux :
 *   - la matrice elle-même (tests unitaires) ;
 *   - l'application réelle côté serveur : un membre ne doit PAS pouvoir créer
 *     une catégorie, un administrateur ne doit PAS pouvoir rétrograder le
 *     propriétaire, etc. Masquer un bouton dans React ne protège rien.
 */
const test = require("node:test");
const { after, before } = require("node:test");
const assert = require("node:assert/strict");

const {
  ROLES,
  PERMISSIONS,
  hasPermission,
  canManageRole,
  canAssignRole,
  permissionsForRole,
  isRole,
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
  uniqueSuffix,
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

// -----------------------------------------------------------------------------
// Matrice de permissions
// -----------------------------------------------------------------------------

test("le propriétaire possède toutes les permissions", () => {
  const all = permissionsForRole(ROLES.OWNER);

  assert.equal(all.length, Object.keys(PERMISSIONS).length);

  for (const permission of Object.values(PERMISSIONS)) {
    assert.ok(hasPermission(ROLES.OWNER, permission), permission);
  }
});

test("un membre ne peut ni modérer ni gérer", () => {
  assert.ok(hasPermission(ROLES.MEMBER, PERMISSIONS.SEND_MESSAGES));
  assert.ok(hasPermission(ROLES.MEMBER, PERMISSIONS.JOIN_VOICE));
  assert.ok(hasPermission(ROLES.MEMBER, PERMISSIONS.ACCESS_WHITEBOARD));

  assert.equal(hasPermission(ROLES.MEMBER, PERMISSIONS.MANAGE_CHANNELS), false);
  assert.equal(hasPermission(ROLES.MEMBER, PERMISSIONS.MANAGE_CATEGORIES), false);
  assert.equal(hasPermission(ROLES.MEMBER, PERMISSIONS.MODERATE_MESSAGES), false);
  assert.equal(hasPermission(ROLES.MEMBER, PERMISSIONS.MANAGE_MEMBERS), false);
  assert.equal(hasPermission(ROLES.MEMBER, PERMISSIONS.MANAGE_COMMUNITY), false);
});

test("un modérateur modère mais n'administre pas la structure", () => {
  assert.ok(hasPermission(ROLES.MODERATOR, PERMISSIONS.MODERATE_MESSAGES));
  assert.ok(hasPermission(ROLES.MODERATOR, PERMISSIONS.INVITE_MEMBERS));

  assert.equal(hasPermission(ROLES.MODERATOR, PERMISSIONS.MANAGE_CHANNELS), false);
  assert.equal(hasPermission(ROLES.MODERATOR, PERMISSIONS.MANAGE_CATEGORIES), false);
  assert.equal(hasPermission(ROLES.MODERATOR, PERMISSIONS.MANAGE_MEMBERS), false);
  assert.equal(
    hasPermission(ROLES.MODERATOR, PERMISSIONS.PUBLISH_ANNOUNCEMENTS),
    false
  );
});

test("un administrateur gère la structure mais pas la propriété", () => {
  assert.ok(hasPermission(ROLES.ADMIN, PERMISSIONS.MANAGE_CHANNELS));
  assert.ok(hasPermission(ROLES.ADMIN, PERMISSIONS.MANAGE_CATEGORIES));
  assert.ok(hasPermission(ROLES.ADMIN, PERMISSIONS.MANAGE_MEMBERS));
  assert.ok(hasPermission(ROLES.ADMIN, PERMISSIONS.PUBLISH_ANNOUNCEMENTS));

  assert.equal(hasPermission(ROLES.ADMIN, PERMISSIONS.MANAGE_COMMUNITY), false);
});

test("on ne gère jamais un rang égal ou supérieur, ni le propriétaire", () => {
  assert.equal(canManageRole(ROLES.OWNER, ROLES.ADMIN), true);
  assert.equal(canManageRole(ROLES.OWNER, ROLES.OWNER), false);
  assert.equal(canManageRole(ROLES.ADMIN, ROLES.MODERATOR), true);
  assert.equal(canManageRole(ROLES.ADMIN, ROLES.ADMIN), false);
  assert.equal(canManageRole(ROLES.ADMIN, ROLES.OWNER), false);
  assert.equal(canManageRole(ROLES.MODERATOR, ROLES.MEMBER), true);
  assert.equal(canManageRole(ROLES.MEMBER, ROLES.MEMBER), false);

  assert.equal(canAssignRole(ROLES.ADMIN, ROLES.OWNER), false);
  assert.equal(canAssignRole(ROLES.ADMIN, ROLES.ADMIN), false);
  assert.equal(canAssignRole(ROLES.ADMIN, ROLES.MODERATOR), true);
  assert.equal(canAssignRole(ROLES.OWNER, ROLES.OWNER), false);
});

test("un rôle inconnu n'ouvre aucun droit", () => {
  assert.equal(isRole("superadmin"), false);
  assert.equal(hasPermission("superadmin", PERMISSIONS.MANAGE_CHANNELS), false);
  assert.deepEqual(permissionsForRole("superadmin"), []);
  assert.equal(hasPermission(undefined, PERMISSIONS.SEND_MESSAGES), false);
});

// -----------------------------------------------------------------------------
// Application réelle côté serveur
// -----------------------------------------------------------------------------

async function setupCommunity() {
  const owner = await createAccount("perm-owner");
  const admin = await createAccount("perm-admin");
  const moderator = await createAccount("perm-modo");
  const member = await createAccount("perm-member");
  const outsider = await createAccount("perm-outsider");

  accounts.push(owner, admin, moderator, member, outsider);

  const community = await createCommunity(owner, { isPublic: false });
  communities.push(community.id);

  await addMember(community.id, owner, admin, ROLES.ADMIN);
  await addMember(community.id, owner, moderator, ROLES.MODERATOR);
  await addMember(community.id, owner, member, ROLES.MEMBER);

  return { owner, admin, moderator, member, outsider, community };
}

test("un membre ne peut pas créer de catégorie, un modérateur non plus", async () => {
  assert.ok(ready);
  const context = await setupCommunity();

  for (const actor of [context.member, context.moderator]) {
    const result = await api(
      `/api/communities/${context.community.id}/categories`,
      {
        method: "POST",
        token: actor.token,
        body: { name: `Refusé ${uniqueSuffix()}` },
      }
    );

    assert.equal(result.status, 403, `${actor.email} ne doit pas pouvoir créer`);
    assert.equal(result.body.code, "missing_permission");
  }
});

test("un administrateur et le propriétaire peuvent créer des catégories", async () => {
  const context = await setupCommunity();

  const byOwner = await api(`/api/communities/${context.community.id}/categories`, {
    method: "POST",
    token: context.owner.token,
    body: { name: "Catégorie Propriétaire" },
  });

  const byAdmin = await api(`/api/communities/${context.community.id}/categories`, {
    method: "POST",
    token: context.admin.token,
    body: { name: "Catégorie Admin" },
  });

  assert.equal(byOwner.status, 201);
  assert.equal(byAdmin.status, 201);
  assert.equal(byAdmin.body.category.communityId, context.community.id);
});

test("un membre ne peut pas créer de salon", async () => {
  const context = await setupCommunity();

  const result = await api(`/api/communities/${context.community.id}/channels`, {
    method: "POST",
    token: context.member.token,
    body: { name: "salon-interdit", type: "text" },
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.code, "missing_permission");
});

test("un non-membre n'accède pas à une communauté privée", async () => {
  const context = await setupCommunity();

  const read = await api(`/api/communities/${context.community.id}`, {
    token: context.outsider.token,
  });

  assert.equal(read.status, 403);
  assert.equal(read.body.code, "not_a_member");

  const list = await api(
    `/api/communities/${context.community.id}/channels`,
    { token: context.outsider.token }
  );

  assert.equal(list.status, 403);

  const write = await api(
    `/api/communities/${context.community.id}/channels`,
    {
      method: "POST",
      token: context.outsider.token,
      body: { name: "intrusion", type: "text" },
    }
  );

  assert.equal(write.status, 403);
});

test("un administrateur ne peut pas modifier le propriétaire", async () => {
  const context = await setupCommunity();

  const demote = await api(
    `/api/communities/${context.community.id}/members/${context.owner.id}`,
    {
      method: "PATCH",
      token: context.admin.token,
      body: { role: ROLES.MEMBER },
    }
  );

  assert.equal(demote.status, 403);
  assert.equal(demote.body.code, "insufficient_rank");

  const removeOwner = await api(
    `/api/communities/${context.community.id}/members/${context.owner.id}`,
    { method: "DELETE", token: context.admin.token }
  );

  assert.equal(removeOwner.status, 403);
});

test("un administrateur ne peut pas promouvoir au niveau égal ou supérieur", async () => {
  const context = await setupCommunity();

  const toAdmin = await api(
    `/api/communities/${context.community.id}/members/${context.member.id}`,
    {
      method: "PATCH",
      token: context.admin.token,
      body: { role: ROLES.ADMIN },
    }
  );

  assert.equal(toAdmin.status, 403);
  assert.equal(toAdmin.body.code, "insufficient_rank");

  const toOwner = await api(
    `/api/communities/${context.community.id}/members/${context.member.id}`,
    {
      method: "PATCH",
      token: context.admin.token,
      body: { role: ROLES.OWNER },
    }
  );

  assert.equal(toOwner.status, 403);
});

test("un administrateur peut promouvoir un membre en modérateur", async () => {
  const context = await setupCommunity();

  const promoted = await api(
    `/api/communities/${context.community.id}/members/${context.member.id}`,
    {
      method: "PATCH",
      token: context.admin.token,
      body: { role: ROLES.MODERATOR },
    }
  );

  assert.equal(promoted.status, 200);
  // Le membre est renvoyé avec son rôle RÉSOLU : `key` identifie le rôle, et
  // `permissions` donne les droits réellement accordés.
  assert.equal(promoted.body.member.role.key, ROLES.MODERATOR);
  assert.ok(
    promoted.body.member.role.permissions.includes(PERMISSIONS.MODERATE_MESSAGES)
  );

  // Le nouveau modérateur peut désormais modérer.
  const channel = await api(
    `/api/communities/${context.community.id}/channels`,
    {
      method: "POST",
      token: context.owner.token,
      body: { name: "salon-moderation", type: "text" },
    }
  );

  assert.equal(channel.status, 201);
});

test("un membre ne peut pas changer les rôles", async () => {
  const context = await setupCommunity();

  const result = await api(
    `/api/communities/${context.community.id}/members/${context.moderator.id}`,
    {
      method: "PATCH",
      token: context.member.token,
      body: { role: ROLES.ADMIN },
    }
  );

  assert.equal(result.status, 403);
  assert.equal(result.body.code, "missing_permission");
});

test("seul le propriétaire peut supprimer la communauté", async () => {
  const context = await setupCommunity();

  const byAdmin = await api(`/api/communities/${context.community.id}`, {
    method: "DELETE",
    token: context.admin.token,
  });

  assert.equal(byAdmin.status, 403);

  const stillThere = await api(`/api/communities/${context.community.id}`, {
    token: context.owner.token,
  });

  assert.equal(stillThere.status, 200);

  const byOwner = await api(`/api/communities/${context.community.id}`, {
    method: "DELETE",
    token: context.owner.token,
  });

  assert.equal(byOwner.status, 200);

  communities.splice(communities.indexOf(context.community.id), 1);

  const gone = await api(`/api/communities/${context.community.id}`, {
    token: context.owner.token,
  });

  assert.equal(gone.status, 404);
});

test("la communauté historique ne peut pas être supprimée", async () => {
  const account = await createAccount("perm-system");
  accounts.push(account);

  const result = await api("/api/communities/1", {
    method: "DELETE",
    token: account.token,
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.code, "system_community");
});

test("le propriétaire ne peut pas quitter sa communauté", async () => {
  const context = await setupCommunity();

  const result = await api(`/api/communities/${context.community.id}/leave`, {
    method: "POST",
    token: context.owner.token,
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.code, "owner_cannot_leave");

  const leaveAsMember = await api(
    `/api/communities/${context.community.id}/leave`,
    { method: "POST", token: context.member.token }
  );

  assert.equal(leaveAsMember.status, 200);
});
