/**
 * M2 — communautés, catégories et salons : création réelle en base,
 * persistance, réordonnancement, cloisonnement entre communautés et
 * suppression de catégorie non destructive par défaut du choix de l'utilisateur.
 */
const test = require("node:test");
const { after, before } = require("node:test");
const assert = require("node:assert/strict");

const {
  startTestServer,
  stopTestServer,
  api,
  createAccount,
  createCommunity,
  addMember,
  dbRoleKeyOf,
  roleKeyOf,
  cleanupCommunity,
  cleanupUsers,
  countRows,
  uniqueSuffix,
  query,
  queryOne,
} = require("./helpers");

const { ROLES } = require("../src/permissions");

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

async function owner() {
  const account = await createAccount("m2-owner");
  accounts.push(account);
  return account;
}

async function newCommunity(overrides = {}) {
  const account = await owner();
  const community = await createCommunity(account, overrides);
  communities.push(community.id);
  return { account, community };
}

async function newChannel(token, communityId, body) {
  const result = await api(`/api/communities/${communityId}/channels`, {
    method: "POST",
    token,
    body,
  });

  assert.equal(result.status, 201, result.text);
  return result.body.channel;
}

// -----------------------------------------------------------------------------
// Communautés
// -----------------------------------------------------------------------------

test("créer une communauté écrit réellement en base", async () => {
  assert.ok(ready);

  const account = await owner();
  const community = await createCommunity(account, { isPublic: true });
  communities.push(community.id);

  const row = await queryOne("SELECT * FROM communities WHERE id = ?", [
    community.id,
  ]);

  assert.ok(row, "la communauté doit exister dans MySQL");
  assert.equal(Number(row.owner_id), account.id);
  assert.equal(row.is_system, 0);

  // L'adhésion est rattachée à un rôle via `role_id` : la colonne `role` en
  // dur a disparu avec les rôles personnalisés.
  assert.equal(await dbRoleKeyOf(community.id, account.id), ROLES.OWNER);

  // Un premier salon utilisable est créé dans la même transaction.
  const channels = await query(
    "SELECT * FROM channels WHERE community_id = ?",
    [community.id]
  );

  assert.equal(channels.length, 1);
  assert.equal(channels[0].name, "general");

  // …rangé dans la catégorie par défaut, comme l'annonce l'interface.
  const categories = await query(
    "SELECT * FROM categories WHERE community_id = ?",
    [community.id]
  );

  assert.equal(categories.length, 1);
  assert.equal(categories[0].name, "GÉNÉRAL");
  assert.equal(
    Number(channels[0].category_id),
    Number(categories[0].id),
    "le salon general doit appartenir à la catégorie par défaut"
  );

  // L'API publie bien cette catégorie (et non un décor côté client).
  const categoryList = await api(
    `/api/communities/${community.id}/categories`,
    { token: account.token }
  );

  assert.equal(categoryList.status, 200);
  assert.deepEqual(
    categoryList.body.categories.map((category) => category.name),
    ["GÉNÉRAL"]
  );

  // Et la communauté apparaît dans la liste de son propriétaire.
  const list = await api("/api/communities", { token: account.token });

  assert.equal(list.status, 200);

  const found = list.body.communities.find((item) => item.id === community.id);

  assert.ok(found);
  assert.equal(found.role.key, ROLES.OWNER);
  assert.equal(found.memberCount, 1);
  assert.equal(found.channelCount, 1);
});

test("une communauté privée n'est pas proposée à la découverte", async () => {
  const { community } = await newCommunity({ isPublic: false });
  const other = await owner();

  const discover = await api("/api/communities/discover", { token: other.token });

  assert.equal(discover.status, 200);
  assert.equal(
    discover.body.communities.some((item) => item.id === community.id),
    false
  );
});

test("une communauté publique est découvrable et rejoignable librement", async () => {
  const { community } = await newCommunity({ isPublic: true });
  const visitor = await owner();

  const discover = await api("/api/communities/discover", { token: visitor.token });

  assert.ok(discover.body.communities.some((item) => item.id === community.id));

  const join = await api(`/api/communities/${community.id}/join`, {
    method: "POST",
    token: visitor.token,
  });

  assert.equal(join.status, 200);
  assert.equal(join.body.community.role.key, ROLES.MEMBER);
  assert.equal(await dbRoleKeyOf(community.id, visitor.id), ROLES.MEMBER);
});

test("la découverte filtre par nom, sans tenir compte de la casse ni des espaces", async () => {
  const { community } = await newCommunity({ isPublic: true });
  const visitor = await owner();

  const exact = await api(
    `/api/communities/discover?search=${encodeURIComponent(community.name)}`,
    { token: visitor.token }
  );

  assert.equal(exact.status, 200);
  assert.ok(exact.body.communities.some((item) => item.id === community.id));

  // Casse différente et espaces superflus : même résultat.
  const noisy = `  ${community.name.toUpperCase()}  `;
  const uppercase = await api(
    `/api/communities/discover?search=${encodeURIComponent(noisy)}`,
    { token: visitor.token }
  );

  assert.equal(uppercase.status, 200);
  assert.ok(uppercase.body.communities.some((item) => item.id === community.id));

  // Un terme qui ne correspond à rien renvoie une liste vide, pas une erreur.
  const none = await api(
    `/api/communities/discover?search=${encodeURIComponent(
      `introuvable-${uniqueSuffix()}`
    )}`,
    { token: visitor.token }
  );

  assert.equal(none.status, 200);
  assert.deepEqual(none.body.communities, []);

  // Une recherche vide (ou seulement des espaces) ne filtre rien.
  const blank = await api("/api/communities/discover?search=%20%20%20", {
    token: visitor.token,
  });

  assert.equal(blank.status, 200);
  assert.ok(blank.body.communities.some((item) => item.id === community.id));

  // Après adhésion, la communauté n'est plus proposée : elle est déjà rejointe.
  await api(`/api/communities/${community.id}/join`, {
    method: "POST",
    token: visitor.token,
  });

  const afterJoin = await api("/api/communities/discover", {
    token: visitor.token,
  });

  assert.equal(
    afterJoin.body.communities.some((item) => item.id === community.id),
    false
  );

  // ... mais elle est bien dans ses communautés, avec un rôle réel (donc dans
  // la navigation), et pas seulement en aperçu public.
  const mine = await api("/api/communities", { token: visitor.token });
  const joined = mine.body.communities.find(
    (item) => item.id === community.id
  );

  assert.ok(joined);
  assert.equal(joined.role.key, ROLES.MEMBER);
});

// -----------------------------------------------------------------------------
// Catégories
// -----------------------------------------------------------------------------

test("créer, renommer et lister des catégories", async () => {
  const { account, community } = await newCommunity();

  // La communauté naît avec sa catégorie par défaut (« GÉNÉRAL », position 0).
  const initial = await api(`/api/communities/${community.id}/categories`, {
    token: account.token,
  });

  assert.deepEqual(
    initial.body.categories.map((category) => category.name),
    ["GÉNÉRAL"]
  );

  const first = await api(`/api/communities/${community.id}/categories`, {
    method: "POST",
    token: account.token,
    body: { name: "Première", description: "Description 1" },
  });

  const second = await api(`/api/communities/${community.id}/categories`, {
    method: "POST",
    token: account.token,
    body: { name: "Deuxième" },
  });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(first.body.category.position, 1);
  assert.equal(second.body.category.position, 2);

  const renamed = await api(
    `/api/communities/${community.id}/categories/${first.body.category.id}`,
    {
      method: "PATCH",
      token: account.token,
      body: { name: "Première (renommée)" },
    }
  );

  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.category.name, "Première (renommée)");

  const row = await queryOne("SELECT name FROM categories WHERE id = ?", [
    first.body.category.id,
  ]);

  assert.equal(row.name, "Première (renommée)");

  const list = await api(`/api/communities/${community.id}/categories`, {
    token: account.token,
  });

  assert.equal(list.body.categories.length, 3);
  assert.deepEqual(
    list.body.categories.map((item) => item.name),
    ["GÉNÉRAL", "Première (renommée)", "Deuxième"]
  );
});

test("réordonner les catégories exige la liste complète", async () => {
  const { account, community } = await newCommunity();

  const initial = await api(`/api/communities/${community.id}/categories`, {
    token: account.token,
  });

  // La catégorie par défaut fait partie du groupe : elle doit figurer dans la liste.
  const ids = [initial.body.categories[0].id];

  for (const name of ["A", "B", "C"]) {
    const created = await api(`/api/communities/${community.id}/categories`, {
      method: "POST",
      token: account.token,
      body: { name },
    });

    ids.push(created.body.category.id);
  }

  const partial = await api(`/api/communities/${community.id}/categories/reorder`, {
    method: "PATCH",
    token: account.token,
    body: { order: [ids[0], ids[1]] },
  });

  assert.equal(partial.status, 400);
  assert.equal(partial.body.code, "invalid_order");

  const reordered = await api(
    `/api/communities/${community.id}/categories/reorder`,
    {
      method: "PATCH",
      token: account.token,
      body: { order: [ids[3], ids[0], ids[1], ids[2]] },
    }
  );

  assert.equal(reordered.status, 200);
  assert.deepEqual(
    reordered.body.categories.map((item) => item.name),
    ["C", "GÉNÉRAL", "A", "B"]
  );

  const rows = await query(
    "SELECT id, `position` FROM categories WHERE community_id = ? ORDER BY `position`",
    [community.id]
  );

  assert.deepEqual(
    rows.map((row) => Number(row.id)),
    [ids[3], ids[0], ids[1], ids[2]]
  );
});

test("supprimer une catégorie sans stratégie est refusé", async () => {
  const { account, community } = await newCommunity();

  const category = await api(`/api/communities/${community.id}/categories`, {
    method: "POST",
    token: account.token,
    body: { name: "Sans stratégie" },
  });

  const result = await api(
    `/api/communities/${community.id}/categories/${category.body.category.id}`,
    { method: "DELETE", token: account.token }
  );

  assert.equal(result.status, 400);
  assert.equal(result.body.code, "strategy_required");

  const stillThere = await queryOne("SELECT id FROM categories WHERE id = ?", [
    category.body.category.id,
  ]);

  assert.ok(stillThere, "rien ne doit être supprimé sans choix explicite");
});

test("stratégie « keep » : les salons sont conservés sans catégorie", async () => {
  const { account, community } = await newCommunity();

  const category = await api(`/api/communities/${community.id}/categories`, {
    method: "POST",
    token: account.token,
    body: { name: "À conserver" },
  });

  const channel = await newChannel(account.token, community.id, {
    name: "salon-conserve",
    type: "text",
    categoryId: category.body.category.id,
  });

  const message = await api(`/api/channels/${channel.id}/messages`, {
    method: "POST",
    token: account.token,
    body: { content: "Message à conserver." },
  });

  assert.equal(message.status, 201);

  const result = await api(
    `/api/communities/${community.id}/categories/${category.body.category.id}?strategy=keep`,
    { method: "DELETE", token: account.token }
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.strategy, "keep");
  assert.equal(result.body.affectedChannels.length, 1);
  assert.equal(result.body.affectedChannels[0].outcome, "kept_without_category");

  const channelRow = await queryOne("SELECT * FROM channels WHERE id = ?", [
    channel.id,
  ]);

  assert.ok(channelRow, "le salon doit être conservé");
  assert.equal(channelRow.category_id, null);

  const messages = await countRows("messages", "channel_id = ?", [channel.id]);
  assert.equal(messages, 1, "les messages doivent être conservés");

  const categoryRow = await queryOne("SELECT id FROM categories WHERE id = ?", [
    category.body.category.id,
  ]);

  assert.equal(categoryRow, null);
});

test("stratégie « delete » : les salons et leur contenu sont supprimés", async () => {
  const { account, community } = await newCommunity();

  const category = await api(`/api/communities/${community.id}/categories`, {
    method: "POST",
    token: account.token,
    body: { name: "À supprimer" },
  });

  const channel = await newChannel(account.token, community.id, {
    name: "salon-supprime",
    type: "text",
    categoryId: category.body.category.id,
  });

  await api(`/api/channels/${channel.id}/messages`, {
    method: "POST",
    token: account.token,
    body: { content: "Message qui part avec le salon." },
  });

  const result = await api(
    `/api/communities/${community.id}/categories/${category.body.category.id}`,
    {
      method: "DELETE",
      token: account.token,
      body: { strategy: "delete" },
    }
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.strategy, "delete");
  assert.equal(result.body.affectedChannels[0].outcome, "deleted");

  assert.equal(
    await countRows("channels", "id = ?", [channel.id]),
    0,
    "le salon doit être supprimé"
  );
  assert.equal(
    await countRows("messages", "channel_id = ?", [channel.id]),
    0,
    "les messages doivent partir avec le salon"
  );

  // Un salon supprimé ne doit pas provoquer une erreur serveur : l'API répond
  // un 404 explicite (régression corrigée : la route renvoyait 500).
  const gone = await api(`/api/channels/${channel.id}`, {
    token: account.token,
  });

  assert.equal(gone.status, 404);
  assert.equal(gone.body.code, "channel_not_found");

  const goneMessages = await api(`/api/channels/${channel.id}/messages`, {
    token: account.token,
  });

  assert.equal(goneMessages.status, 404);
});

test("supprimer un salon annonce ce qui disparaît", async () => {
  const { account, community } = await newCommunity();

  const created = await newChannel(account.token, community.id, {
    name: "salon-avec-contenu",
    type: "text",
  });

  for (let index = 1; index <= 3; index += 1) {
    const posted = await api(`/api/channels/${created.id}/messages`, {
      method: "POST",
      token: account.token,
      body: { content: `Message ${index}` },
    });

    assert.equal(posted.status, 201);
  }

  const removed = await api(`/api/channels/${created.id}`, {
    method: "DELETE",
    token: account.token,
  });

  assert.equal(removed.status, 200);
  assert.equal(removed.body.deletedId, created.id);
  assert.equal(
    removed.body.deletedMessages,
    3,
    "le nombre de messages supprimés doit être annoncé, jamais silencieux"
  );

  assert.equal(await countRows("channels", "id = ?", [created.id]), 0);
  assert.equal(
    await countRows("messages", "channel_id = ?", [created.id]),
    0,
    "les messages partent avec le salon"
  );
});

test("un salon inexistant répond 404 et non 500", async () => {
  const { account } = await newCommunity();

  const unknown = await api("/api/channels/999999999", {
    token: account.token,
  });

  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, "channel_not_found");

  const byLegacyId = await api("/api/channels/salon-qui-nexiste-pas", {
    token: account.token,
  });

  assert.equal(byLegacyId.status, 404);
  assert.equal(byLegacyId.body.code, "channel_not_found");
});

// -----------------------------------------------------------------------------
// Salons
// -----------------------------------------------------------------------------

test("le nom d'un salon textuel est normalisé et les doublons refusés", async () => {
  const { account, community } = await newCommunity();

  const created = await newChannel(account.token, community.id, {
    name: "Revue de Code",
    type: "text",
  });

  assert.equal(created.name, "revue-de-code");

  const duplicate = await api(`/api/communities/${community.id}/channels`, {
    method: "POST",
    token: account.token,
    body: { name: "revue-de-code", type: "text" },
  });

  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "channel_name_taken");
});

test("un type de salon inconnu est refusé", async () => {
  const { account, community } = await newCommunity();

  const result = await api(`/api/communities/${community.id}/channels`, {
    method: "POST",
    token: account.token,
    body: { name: "bizarre", type: "hologramme" },
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.code, "invalid_channel_type");
});

test("déplacer un salon change sa catégorie et sa position", async () => {
  const { account, community } = await newCommunity();

  const category = await api(`/api/communities/${community.id}/categories`, {
    method: "POST",
    token: account.token,
    body: { name: "Cible" },
  });

  const channel = await newChannel(account.token, community.id, {
    name: "a-deplacer",
    type: "text",
  });

  assert.equal(channel.categoryId, null);

  const moved = await api(`/api/channels/${channel.id}/move`, {
    method: "POST",
    token: account.token,
    body: { categoryId: category.body.category.id, position: 0 },
  });

  assert.equal(moved.status, 200);
  assert.equal(moved.body.channel.categoryId, category.body.category.id);

  const row = await queryOne("SELECT category_id FROM channels WHERE id = ?", [
    channel.id,
  ]);

  assert.equal(Number(row.category_id), category.body.category.id);
});

test("réordonner les salons d'un groupe exige la liste exacte", async () => {
  const { account, community } = await newCommunity();

  const first = await newChannel(account.token, community.id, {
    name: "un",
    type: "text",
  });
  const second = await newChannel(account.token, community.id, {
    name: "deux",
    type: "text",
  });

  // `general` est rangé dans la catégorie par défaut : le groupe « sans
  // catégorie » ne contient donc que les deux salons créés ici.
  const general = await queryOne(
    "SELECT id, category_id FROM channels WHERE community_id = ? AND name = 'general'",
    [community.id]
  );

  assert.ok(general.category_id, "general doit être rangé dans « GÉNÉRAL »");

  // Liste partielle → refus : l'ordre doit couvrir tout le groupe.
  const partial = await api(`/api/communities/${community.id}/channels/reorder`, {
    method: "PATCH",
    token: account.token,
    body: { categoryId: null, order: [first.id] },
  });

  assert.equal(partial.status, 400);
  assert.equal(partial.body.code, "invalid_order");

  // Un salon d'un autre groupe → refus également.
  const foreign = await api(`/api/communities/${community.id}/channels/reorder`, {
    method: "PATCH",
    token: account.token,
    body: {
      categoryId: null,
      order: [first.id, second.id, Number(general.id)],
    },
  });

  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.code, "invalid_order");

  const valid = await api(`/api/communities/${community.id}/channels/reorder`, {
    method: "PATCH",
    token: account.token,
    body: { categoryId: null, order: [second.id, first.id] },
  });

  assert.equal(valid.status, 200);

  const rows = await query(
    "SELECT id FROM channels WHERE community_id = ? AND category_id IS NULL ORDER BY `position`",
    [community.id]
  );

  assert.deepEqual(
    rows.map((row) => Number(row.id)),
    [second.id, first.id]
  );

  // Et le salon `general` n'a pas bougé de sa catégorie.
  const generalAfter = await queryOne("SELECT category_id FROM channels WHERE id = ?", [
    Number(general.id),
  ]);

  assert.equal(Number(generalAfter.category_id), Number(general.category_id));
});

test("un salon protégé se déverrouille par code via l'API REST", async () => {
  const { account: ownerAccount, community } = await newCommunity();

  const member = await createAccount("m2-code-member");
  accounts.push(member);
  await addMember(community.id, ownerAccount, member, ROLES.MEMBER);

  const protectedChannel = await newChannel(ownerAccount.token, community.id, {
    name: "acces-code",
    type: "text",
    accessCode: "s3cret-2026",
  });

  // Sans le code : refus explicite.
  const refused = await api(`/api/channels/${protectedChannel.id}`, {
    token: member.token,
  });

  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, "channel_forbidden");

  // Code absent → 403 access_code_required.
  const missing = await api(`/api/channels/${protectedChannel.id}/unlock`, {
    method: "POST",
    token: member.token,
    body: {},
  });

  assert.equal(missing.status, 403);
  assert.equal(missing.body.code, "access_code_required");

  // Code erroné → 403 access_code_invalid, et aucun accès créé.
  const wrong = await api(`/api/channels/${protectedChannel.id}/unlock`, {
    method: "POST",
    token: member.token,
    body: { accessCode: "mauvais" },
  });

  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.code, "access_code_invalid");
  assert.equal(
    await countRows("channel_members", "channel_id = ? AND user_id = ?", [
      protectedChannel.id,
      member.id,
    ]),
    0,
    "un code erroné ne doit rien autoriser"
  );

  // Code correct → accès accordé, puis persistant.
  const unlocked = await api(`/api/channels/${protectedChannel.id}/unlock`, {
    method: "POST",
    token: member.token,
    body: { accessCode: "s3cret-2026" },
  });

  assert.equal(unlocked.status, 200);
  assert.equal(unlocked.body.grantedByCode, true);

  const afterUnlock = await api(`/api/channels/${protectedChannel.id}`, {
    token: member.token,
  });

  assert.equal(afterUnlock.status, 200);

  // Rejouer la requête n'accorde rien de plus : l'accès est déjà enregistré.
  const again = await api(`/api/channels/${protectedChannel.id}/unlock`, {
    method: "POST",
    token: member.token,
    body: { accessCode: "s3cret-2026" },
  });

  assert.equal(again.status, 200);
  assert.equal(again.body.grantedByCode, false);
  assert.equal(
    await countRows("channel_members", "channel_id = ? AND user_id = ?", [
      protectedChannel.id,
      member.id,
    ]),
    1,
    "aucun doublon d'autorisation"
  );
});

test("ajouter un membre crée une notification réelle, lisible et marquable", async () => {
  const { account: ownerAccount, community } = await newCommunity();

  const member = await createAccount("m2-notif-member");
  accounts.push(member);

  const added = await api(`/api/communities/${community.id}/members`, {
    method: "POST",
    token: ownerAccount.token,
    body: { userId: member.id, role: ROLES.MEMBER },
  });

  assert.equal(added.status, 201);

  const list = await api("/api/notifications", { token: member.token });

  assert.equal(list.status, 200);
  assert.equal(list.body.unreadCount, 1, "une notification non lue");
  assert.equal(list.body.notifications.length, 1);

  const notification = list.body.notifications[0];

  assert.equal(notification.type, "community:member:added");
  assert.equal(notification.readAt, null);
  assert.equal(notification.payload.communityId, community.id);

  const marked = await api(`/api/notifications/${notification.id}/read`, {
    method: "POST",
    token: member.token,
  });

  assert.equal(marked.status, 200);

  const after = await api("/api/notifications/unread-count", {
    token: member.token,
  });

  assert.equal(after.body.unreadCount, 0);

  // Le propriétaire n'a rien reçu pour sa propre action.
  const ownerList = await api("/api/notifications", {
    token: ownerAccount.token,
  });

  assert.equal(ownerList.body.notifications.length, 0);
});

test("changer un rôle notifie le membre concerné", async () => {
  const { account: ownerAccount, community } = await newCommunity();

  const member = await createAccount("m2-notif-role");
  accounts.push(member);

  await api(`/api/communities/${community.id}/members`, {
    method: "POST",
    token: ownerAccount.token,
    body: { userId: member.id, role: ROLES.MEMBER },
  });

  await api(`/api/notifications/read-all`, {
    method: "POST",
    token: member.token,
  });

  const promoted = await api(
    `/api/communities/${community.id}/members/${member.id}`,
    {
      method: "PATCH",
      token: ownerAccount.token,
      body: { role: ROLES.MODERATOR },
    }
  );

  assert.equal(promoted.status, 200);

  const list = await api("/api/notifications", { token: member.token });

  assert.equal(list.body.unreadCount, 1);
  assert.equal(list.body.notifications[0].type, "community:role:changed");
  assert.equal(list.body.notifications[0].payload.role, ROLES.MODERATOR);
  assert.equal(list.body.notifications[0].payload.roleName, "Modérateur");
});

// -----------------------------------------------------------------------------
// Salons privés
// -----------------------------------------------------------------------------
test("un salon privé est invisible et inaccessible sans autorisation", async () => {
  const { account: ownerAccount, community } = await newCommunity();

  const member = await createAccount("m2-private-member");
  accounts.push(member);
  await addMember(community.id, ownerAccount, member, ROLES.MEMBER);

  const privateChannel = await newChannel(ownerAccount.token, community.id, {
    name: "secret",
    type: "text",
    isPrivate: true,
  });

  // Invisible dans la liste du membre.
  const list = await api(`/api/communities/${community.id}/channels`, {
    token: member.token,
  });

  assert.equal(list.status, 200);
  assert.equal(
    list.body.channels.some((item) => item.id === privateChannel.id),
    false,
    "un salon privé ne doit pas apparaître"
  );

  // Inaccessible même en connaissant son identifiant.
  const direct = await api(`/api/channels/${privateChannel.id}`, {
    token: member.token,
  });

  assert.equal(direct.status, 403);
  assert.equal(direct.body.code, "channel_forbidden");

  const write = await api(`/api/channels/${privateChannel.id}/messages`, {
    method: "POST",
    token: member.token,
    body: { content: "intrusion" },
  });

  assert.equal(write.status, 403);

  // Le propriétaire peut l'accorder explicitement.
  const granted = await api(`/api/channels/${privateChannel.id}/members`, {
    method: "POST",
    token: ownerAccount.token,
    body: { userId: member.id },
  });

  assert.equal(granted.status, 201);

  // Accès persistant : la ligne channel_members vaut autorisation durable.
  const allowed = await api(`/api/channels/${privateChannel.id}`, {
    token: member.token,
  });

  assert.equal(allowed.status, 200);

  const posted = await api(`/api/channels/${privateChannel.id}/messages`, {
    method: "POST",
    token: member.token,
    body: { content: "maintenant autorisé" },
  });

  assert.equal(posted.status, 201);

  // Révocation → accès de nouveau refusé.
  const revoked = await api(
    `/api/channels/${privateChannel.id}/members/${member.id}`,
    { method: "DELETE", token: ownerAccount.token }
  );

  assert.equal(revoked.status, 200);

  const afterRevoke = await api(`/api/channels/${privateChannel.id}`, {
    token: member.token,
  });

  assert.equal(afterRevoke.status, 403);
});

test("un salon protégé par un code n'est pas accessible sans ce code", async () => {
  const { account: ownerAccount, community } = await newCommunity();
  const other = await createAccount("m2-protege");
  accounts.push(other);
  await addMember(community.id, ownerAccount, other, ROLES.MEMBER);

  const protectedChannel = await newChannel(ownerAccount.token, community.id, {
    name: "avec-code",
    type: "text",
    accessCode: "code-secret-1234",
  });

  const list = await api(`/api/communities/${community.id}/channels`, {
    token: other.token,
  });

  assert.equal(
    list.body.channels.some((item) => item.id === protectedChannel.id),
    false
  );

  const direct = await api(`/api/channels/${protectedChannel.id}`, {
    token: other.token,
  });

  assert.equal(direct.status, 403);

  // Le code n'est jamais renvoyé au client.
  const ownerView = await api(`/api/channels/${protectedChannel.id}`, {
    token: ownerAccount.token,
  });

  assert.equal(ownerView.body.channel.accessCode, undefined);
  assert.equal(ownerView.body.channel.hasAccessCode, true);
});

// -----------------------------------------------------------------------------
// Cloisonnement entre communautés
// -----------------------------------------------------------------------------

test("les ressources d'une communauté ne sont pas modifiables via une autre", async () => {
  const { account: firstOwner, community: first } = await newCommunity();
  const { account: secondOwner, community: second } = await newCommunity();

  const category = await api(`/api/communities/${first.id}/categories`, {
    method: "POST",
    token: firstOwner.token,
    body: { name: "Catégorie A" },
  });

  const channel = await newChannel(firstOwner.token, first.id, {
    name: "salon-a",
    type: "text",
  });

  // Le propriétaire de B ne peut pas toucher une catégorie de A.
  const patch = await api(
    `/api/communities/${second.id}/categories/${category.body.category.id}`,
    {
      method: "PATCH",
      token: secondOwner.token,
      body: { name: "Détournement" },
    }
  );

  assert.equal(patch.status, 404);

  const remove = await api(
    `/api/communities/${second.id}/categories/${category.body.category.id}?strategy=keep`,
    { method: "DELETE", token: secondOwner.token }
  );

  assert.equal(remove.status, 404);

  const readChannel = await api(`/api/channels/${channel.id}`, {
    token: secondOwner.token,
  });

  assert.equal(readChannel.status, 403);

  const name = await queryOne("SELECT name FROM categories WHERE id = ?", [
    category.body.category.id,
  ]);

  assert.equal(name.name, "Catégorie A", "la catégorie ne doit pas avoir changé");
});

// -----------------------------------------------------------------------------
// Messages, non-lus et accusés de lecture
// -----------------------------------------------------------------------------

test("les messages sont persistés avec l'auteur et les non-lus suivent le bon utilisateur", async () => {
  const { account: ownerAccount, community } = await newCommunity();

  const member = await createAccount("m2-reader");
  accounts.push(member);
  await addMember(community.id, ownerAccount, member, ROLES.MEMBER);

  const channel = await newChannel(ownerAccount.token, community.id, {
    name: "messagerie",
    type: "text",
  });

  const first = await api(`/api/channels/${channel.id}/messages`, {
    method: "POST",
    token: ownerAccount.token,
    body: { content: "Premier message." },
  });

  assert.equal(first.status, 201);
  assert.equal(first.body.data.author.id, ownerAccount.id);
  assert.equal(first.body.data.content, "Premier message.");

  const row = await queryOne("SELECT * FROM messages WHERE id = ?", [
    first.body.data.id,
  ]);

  assert.equal(Number(row.author_id), ownerAccount.id);
  assert.equal(row.content, "Premier message.");

  // Le membre a 1 non-lu ; l'auteur n'a rien de non-lu.
  const memberChannels = await api(`/api/communities/${community.id}/channels`, {
    token: member.token,
  });

  const memberView = memberChannels.body.channels.find(
    (item) => item.id === channel.id
  );

  assert.equal(memberView.unreadCount, 1);

  const ownerChannels = await api(`/api/communities/${community.id}/channels`, {
    token: ownerAccount.token,
  });

  const ownerView = ownerChannels.body.channels.find(
    (item) => item.id === channel.id
  );

  assert.equal(ownerView.unreadCount, 0);

  // Accusé de lecture par le membre : enregistré au nom du BON utilisateur.
  const read = await api(`/api/channels/${channel.id}/read`, {
    method: "POST",
    token: member.token,
    body: { messageId: first.body.data.id },
  });

  assert.equal(read.status, 200);
  assert.equal(read.body.readerId, member.id);

  const readRow = await queryOne(
    "SELECT * FROM message_reads WHERE message_id = ? AND user_id = ?",
    [first.body.data.id, member.id]
  );

  assert.ok(readRow, "l'accusé de lecture doit viser le bon compte");

  const wrongUser = await queryOne(
    "SELECT * FROM message_reads WHERE message_id = ? AND user_id = ?",
    [first.body.data.id, ownerAccount.id]
  );

  assert.equal(wrongUser, null);

  // Après lecture, le compteur retombe à zéro.
  const afterRead = await api(`/api/communities/${community.id}/channels`, {
    token: member.token,
  });

  assert.equal(
    afterRead.body.channels.find((item) => item.id === channel.id).unreadCount,
    0
  );
});

test("l'historique d'un salon est paginé et complet", async () => {
  const { account, community } = await newCommunity();

  const channel = await newChannel(account.token, community.id, {
    name: "historique",
    type: "text",
  });

  for (let index = 1; index <= 5; index += 1) {
    await api(`/api/channels/${channel.id}/messages`, {
      method: "POST",
      token: account.token,
      body: { content: `Message ${index}` },
    });
  }

  const page = await api(`/api/channels/${channel.id}/messages?limit=3`, {
    token: account.token,
  });

  assert.equal(page.status, 200);
  assert.equal(page.body.messages.length, 3);
  assert.equal(page.body.hasMore, true);
  assert.deepEqual(
    page.body.messages.map((message) => message.content),
    ["Message 3", "Message 4", "Message 5"]
  );

  const previous = await api(
    `/api/channels/${channel.id}/messages?limit=3&before=${page.body.oldestId}`,
    { token: account.token }
  );

  assert.deepEqual(
    previous.body.messages.map((message) => message.content),
    ["Message 1", "Message 2"]
  );
  assert.equal(previous.body.hasMore, false);
});

// -----------------------------------------------------------------------------
// Invitations
// -----------------------------------------------------------------------------

test("une invitation réelle permet de rejoindre la communauté", async () => {
  const { account: ownerAccount, community } = await newCommunity();

  const created = await api(`/api/communities/${community.id}/invitations`, {
    method: "POST",
    token: ownerAccount.token,
    body: { maxUses: 2 },
  });

  assert.equal(created.status, 201);
  const code = created.body.invitation.code;

  assert.ok(code && code.length >= 8);
  assert.equal(created.body.url.includes(code), true);

  // Aperçu public, sans compte.
  const preview = await api(`/api/invitations/${code}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.community.id, community.id);

  const row = await queryOne("SELECT * FROM invitations WHERE code = ?", [code]);
  assert.ok(row, "l'invitation doit être en base");

  // Acceptation par un compte réel.
  const joiner = await createAccount("m2-joiner");
  accounts.push(joiner);

  const accept = await api(`/api/invitations/${code}/accept`, {
    method: "POST",
    token: joiner.token,
  });

  assert.equal(accept.status, 200);
  assert.equal(accept.body.alreadyMember, false);

  assert.equal(await dbRoleKeyOf(community.id, joiner.id), ROLES.MEMBER);

  const afterAccept = await queryOne("SELECT uses FROM invitations WHERE code = ?", [
    code,
  ]);

  assert.equal(Number(afterAccept.uses), 1);

  // Deuxième acceptation par le même compte : idempotente.
  const again = await api(`/api/invitations/${code}/accept`, {
    method: "POST",
    token: joiner.token,
  });

  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyMember, true);

  // Aucune invitation ne fonctionne sans compte.
  const anonymous = await api(`/api/invitations/${code}/accept`, { method: "POST" });
  assert.equal(anonymous.status, 401);
});

test("une invitation révoquée, expirée ou épuisée est refusée", async () => {
  const { account: ownerAccount, community } = await newCommunity();

  const limited = await api(`/api/communities/${community.id}/invitations`, {
    method: "POST",
    token: ownerAccount.token,
    body: { maxUses: 1 },
  });

  const code = limited.body.invitation.code;

  const first = await createAccount("m2-invite-1");
  accounts.push(first);

  const used = await api(`/api/invitations/${code}/accept`, {
    method: "POST",
    token: first.token,
  });

  assert.equal(used.status, 200);

  const second = await createAccount("m2-invite-2");
  accounts.push(second);

  const exhausted = await api(`/api/invitations/${code}/accept`, {
    method: "POST",
    token: second.token,
  });

  assert.equal(exhausted.status, 403);

  // Révocation.
  const revocable = await api(`/api/communities/${community.id}/invitations`, {
    method: "POST",
    token: ownerAccount.token,
    body: {},
  });

  const revoke = await api(
    `/api/communities/${community.id}/invitations/${revocable.body.invitation.id}`,
    { method: "DELETE", token: ownerAccount.token }
  );

  assert.equal(revoke.status, 200);
  assert.equal(revoke.body.invitation.revokedAt !== null, true);

  const preview = await api(`/api/invitations/${revocable.body.invitation.code}`);
  assert.equal(preview.status, 404);

  // Expiration.
  const expired = await api(`/api/communities/${community.id}/invitations`, {
    method: "POST",
    token: ownerAccount.token,
    body: {},
  });

  await query("UPDATE invitations SET expires_at = ? WHERE id = ?", [
    new Date(Date.now() - 3600 * 1000),
    expired.body.invitation.id,
  ]);

  const expiredAccept = await api(
    `/api/invitations/${expired.body.invitation.code}/accept`,
    { method: "POST", token: ownerAccount.token }
  );

  assert.equal(expiredAccept.status, 403);
});

test("seuls les rôles autorisés peuvent gérer les invitations", async () => {
  const { account: ownerAccount, community } = await newCommunity();

  const member = await createAccount("m2-invite-member");
  accounts.push(member);
  await addMember(community.id, ownerAccount, member, ROLES.MEMBER);

  const refused = await api(`/api/communities/${community.id}/invitations`, {
    method: "POST",
    token: member.token,
    body: {},
  });

  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, "missing_permission");

  // Le modérateur, lui, peut inviter.
  const moderator = await createAccount("m2-invite-modo");
  accounts.push(moderator);
  await addMember(community.id, ownerAccount, moderator, ROLES.MODERATOR);

  const allowed = await api(`/api/communities/${community.id}/invitations`, {
    method: "POST",
    token: moderator.token,
    body: {},
  });

  assert.equal(allowed.status, 201);
});

test("des paramètres d'invitation invalides sont refusés proprement", async () => {
  const { account, community } = await newCommunity();

  const badExpiration = await api(
    `/api/communities/${community.id}/invitations`,
    {
      method: "POST",
      token: account.token,
      body: { expiresInHours: 0 },
    }
  );

  assert.equal(badExpiration.status, 400);
  assert.equal(badExpiration.body.code, "invalid_expiration");

  const badMaxUses = await api(`/api/communities/${community.id}/invitations`, {
    method: "POST",
    token: account.token,
    body: { maxUses: 999999 },
  });

  assert.equal(badMaxUses.status, 400);
  assert.equal(badMaxUses.body.code, "invalid_max_uses");
});

// -----------------------------------------------------------------------------
// Tableau blanc
// -----------------------------------------------------------------------------

test("le tableau blanc est persisté et restitué", async () => {
  const { account, community } = await newCommunity();

  const channel = await newChannel(account.token, community.id, {
    name: "board-test",
    type: "board",
  });

  const empty = await api(`/api/channels/${channel.id}/board`, {
    token: account.token,
  });

  assert.equal(empty.status, 200);
  assert.equal(empty.body.board.data, null);
  assert.equal(empty.body.board.version, 0);

  const data = {
    version: "6.7.0",
    objects: [{ type: "rect", left: 10, top: 20, width: 100, height: 50 }],
  };

  const saved = await api(`/api/channels/${channel.id}/board`, {
    method: "PUT",
    token: account.token,
    body: { data },
  });

  assert.equal(saved.status, 200);
  assert.equal(saved.body.board.version, 1);

  const row = await queryOne("SELECT * FROM board_states WHERE channel_id = ?", [
    channel.id,
  ]);

  assert.ok(row, "l'état doit être en base");

  const restored = await api(`/api/channels/${channel.id}/board`, {
    token: account.token,
  });

  assert.equal(restored.body.board.version, 1);
  assert.deepEqual(restored.body.board.data, data);
  assert.equal(restored.body.board.updatedBy.id, account.id);
});

test("une écriture du tableau avec une version obsolète est refusée", async () => {
  const { account, community } = await newCommunity();

  const channel = await newChannel(account.token, community.id, {
    name: "board-conflit",
    type: "board",
  });

  await api(`/api/channels/${channel.id}/board`, {
    method: "PUT",
    token: account.token,
    body: { data: { objects: [1] } },
  });

  const conflict = await api(`/api/channels/${channel.id}/board`, {
    method: "PUT",
    token: account.token,
    body: { data: { objects: [2] }, expectedVersion: 0 },
  });

  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "board_version_conflict");
  assert.equal(conflict.body.currentState.version, 1);
});

test("un nom de salon identique est accepté dans deux catégories différentes", async () => {
  const { account, community } = await newCommunity();

  const firstCategory = await api(`/api/communities/${community.id}/categories`, {
    method: "POST",
    token: account.token,
    body: { name: "Catégorie 1" },
  });

  const secondCategory = await api(`/api/communities/${community.id}/categories`, {
    method: "POST",
    token: account.token,
    body: { name: "Catégorie 2" },
  });

  await newChannel(account.token, community.id, {
    name: "partage",
    type: "text",
    categoryId: firstCategory.body.category.id,
  });

  const second = await newChannel(account.token, community.id, {
    name: "partage",
    type: "text",
    categoryId: secondCategory.body.category.id,
  });

  assert.ok(second.id);
  assert.equal(second.categoryId, secondCategory.body.category.id);
});
