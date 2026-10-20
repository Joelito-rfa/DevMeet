/**
 * Messagerie avancée (jalon 5) : mentions, réactions, épinglage, fils de
 * discussion, recherche.
 *
 * Tous les scénarios passent par l'API réelle et vérifient la base MySQL : une
 * fonctionnalité qui n'écrirait rien serait détectée ici.
 */
const test = require("node:test");
const { after, before } = require("node:test");
const assert = require("node:assert/strict");

const { ROLES, PERMISSIONS, hasPermission } = require("../src/permissions");

const {
  startTestServer,
  stopTestServer,
  api,
  createAccount,
  createCommunity,
  addMember,
  cleanupCommunity,
  cleanupUsers,
  countRows,
  connectSocket,
  emitWithAck,
  waitFor,
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

async function newAccount(label) {
  const account = await createAccount(label);

  if (account) {
    accounts.push(account);
  }

  return account;
}

async function newCommunity(overrides = {}) {
  const account = await newAccount("proprietaire");
  const community = await createCommunity(account, overrides);
  communities.push(community.id);

  return { account, community };
}

async function newChannel(token, communityId, body = {}) {
  const created = await api(`/api/communities/${communityId}/channels`, {
    method: "POST",
    token,
    body: {
      name: `salon-${uniqueSuffix()}`,
      type: "text",
      ...body,
    },
  });

  assert.equal(created.status, 201, created.text);

  return created.body.channel;
}

async function sendMessage(token, channelId, body) {
  const created = await api(`/api/channels/${channelId}/messages`, {
    method: "POST",
    token,
    body,
  });

  assert.equal(created.status, 201, created.text);

  return created.body.data;
}

// -----------------------------------------------------------------------------
// Matrice de permissions
// -----------------------------------------------------------------------------

test("réagir est ouvert à tous, épingler exige un modérateur ou plus", () => {
  assert.equal(hasPermission(ROLES.MEMBER, PERMISSIONS.REACT_MESSAGES), true);
  assert.equal(hasPermission(ROLES.MEMBER, PERMISSIONS.PIN_MESSAGES), false);
  assert.equal(
    hasPermission(ROLES.MODERATOR, PERMISSIONS.PIN_MESSAGES),
    true
  );
  assert.equal(hasPermission(ROLES.ADMIN, PERMISSIONS.PIN_MESSAGES), true);
  assert.equal(hasPermission(ROLES.OWNER, PERMISSIONS.PIN_MESSAGES), true);
});

// -----------------------------------------------------------------------------
// Mentions
// -----------------------------------------------------------------------------

test("une mention d'un membre réel est enregistrée et le notifie", async () => {
  assert.ok(ready);

  const { account, community } = await newCommunity();
  const channel = await newChannel(account.token, community.id);
  const member = await newAccount("collegue");
  await addMember(community.id, account, member, ROLES.MEMBER);

  const message = await sendMessage(member.token, channel.id, {
    content: `Bonjour @${account.name}, peux-tu relire ceci ?`,
  });

  assert.deepEqual(message.mentions, [account.id]);
  assert.equal(
    await countRows("message_mentions", "message_id = ?", [message.id]),
    1,
    "la mention doit être écrite en base"
  );

  const notifications = await api("/api/notifications", {
    token: account.token,
  });

  const mention = notifications.body.notifications.find(
    (item) => item.type === "message:mention"
  );

  assert.ok(mention, "le membre mentionné doit recevoir une notification");
  assert.equal(Number(mention.payload.channelId), channel.id);
  assert.equal(mention.payload.messageId, message.id);

  // L'auteur d'une mention n'est jamais notifié par sa propre mention.
  const own = await api("/api/notifications", { token: member.token });
  assert.equal(
    own.body.notifications.some((item) => item.type === "message:mention"),
    false
  );
});

test("une mention d'un non-membre reste du texte", async () => {
  const { account, community } = await newCommunity();
  const channel = await newChannel(account.token, community.id);
  const outsider = await newAccount("externe");

  const message = await sendMessage(account.token, channel.id, {
    content: `Coucou @${outsider.name} et @Personne Inconnue`,
  });

  assert.deepEqual(message.mentions, []);
  assert.equal(
    await countRows("message_mentions", "message_id = ?", [message.id]),
    0
  );

  const notifications = await api("/api/notifications", {
    token: outsider.token,
  });

  assert.equal(
    notifications.body.notifications.some((item) => item.type === "message:mention"),
    false,
    "un compte hors communauté ne doit pas être notifié"
  );
});

// -----------------------------------------------------------------------------
// Réactions
// -----------------------------------------------------------------------------

test("réactions : ajout réel, idempotence, liste blanche, retrait", async () => {
  const { account, community } = await newCommunity();
  const channel = await newChannel(account.token, community.id);
  const member = await newAccount("reactif");
  await addMember(community.id, account, member, ROLES.MEMBER);

  const message = await sendMessage(account.token, channel.id, {
    content: "Le build est vert.",
  });

  const added = await api(
    `/api/channels/${channel.id}/messages/${message.id}/reactions`,
    { method: "POST", token: member.token, body: { emoji: "👍" } }
  );

  assert.equal(added.status, 201, added.text);
  assert.deepEqual(added.body.reactions, [
    { emoji: "👍", count: 1, users: [member.id] },
  ]);

  const replayed = await api(
    `/api/channels/${channel.id}/messages/${message.id}/reactions`,
    { method: "POST", token: member.token, body: { emoji: "👍" } }
  );

  assert.equal(replayed.status, 201);
  assert.equal(
    replayed.body.reactions[0].count,
    1,
    "rejouer la même réaction ne doit rien dupliquer"
  );
  assert.equal(
    await countRows("message_reactions", "message_id = ?", [message.id]),
    1
  );

  const refused = await api(
    `/api/channels/${channel.id}/messages/${message.id}/reactions`,
    { method: "POST", token: member.token, body: { emoji: "<script>" } }
  );

  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, "emoji_not_allowed");

  // Les réactions remontent dans l'historique lu par les autres.
  const history = await api(`/api/channels/${channel.id}/messages`, {
    token: account.token,
  });

  assert.deepEqual(history.body.messages.at(-1).reactions, [
    { emoji: "👍", count: 1, users: [member.id] },
  ]);

  // Réagir à un message d'un autre salon est refusé.
  const other = await newChannel(account.token, community.id);
  const crossChannel = await api(
    `/api/channels/${other.id}/messages/${message.id}/reactions`,
    { method: "POST", token: account.token, body: { emoji: "👍" } }
  );

  assert.equal(crossChannel.status, 404);
  assert.equal(crossChannel.body.code, "message_not_found");

  const removed = await api(
    `/api/channels/${channel.id}/messages/${message.id}/reactions/${encodeURIComponent("👍")}`,
    { method: "DELETE", token: member.token }
  );

  assert.equal(removed.status, 200, removed.text);
  assert.deepEqual(removed.body.reactions, []);
  assert.equal(
    await countRows("message_reactions", "message_id = ?", [message.id]),
    0
  );
});

// -----------------------------------------------------------------------------
// Épinglage
// -----------------------------------------------------------------------------

test("épinglage : refusé au membre, réel pour un responsable, retirable", async () => {
  const { account, community } = await newCommunity();
  const channel = await newChannel(account.token, community.id);
  const member = await newAccount("simple");
  await addMember(community.id, account, member, ROLES.MEMBER);

  const message = await sendMessage(account.token, channel.id, {
    content: "Décision de l'équipe.",
  });

  const denied = await api(
    `/api/channels/${channel.id}/messages/${message.id}/pin`,
    { method: "POST", token: member.token }
  );

  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "missing_permission");
  assert.equal(
    await countRows("message_pins", "message_id = ?", [message.id]),
    0,
    "un refus ne doit rien écrire"
  );

  const pinned = await api(
    `/api/channels/${channel.id}/messages/${message.id}/pin`,
    { method: "POST", token: account.token }
  );

  assert.equal(pinned.status, 201, pinned.text);
  assert.equal(pinned.body.pinnedBy, account.id);

  const replayed = await api(
    `/api/channels/${channel.id}/messages/${message.id}/pin`,
    { method: "POST", token: account.token }
  );

  assert.equal(replayed.status, 201);
  assert.equal(
    await countRows("message_pins", "message_id = ?", [message.id]),
    1,
    "épingler deux fois ne crée pas de doublon"
  );

  const pins = await api(`/api/channels/${channel.id}/pins`, {
    token: member.token,
  });

  assert.equal(pins.status, 200);
  assert.equal(pins.body.pins.length, 1);
  assert.equal(pins.body.pins[0].pinned, true);
  assert.equal(pins.body.pins[0].id, message.id);

  const history = await api(`/api/channels/${channel.id}/messages`, {
    token: member.token,
  });

  assert.equal(history.body.messages.at(-1).pinned, true);

  const unknown = await api(
    `/api/channels/${channel.id}/messages/999999999999/pin`,
    { method: "POST", token: account.token }
  );

  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, "message_not_found");

  // Un message supprimé ne peut pas être épinglé.
  await api(`/api/channels/${channel.id}/messages/${message.id}`, {
    method: "DELETE",
    token: account.token,
  });

  const onDeleted = await api(
    `/api/channels/${channel.id}/messages/${message.id}/pin`,
    { method: "POST", token: account.token }
  );

  assert.equal(onDeleted.status, 400);
  assert.equal(onDeleted.body.code, "message_deleted");

  // …et il disparaît de la liste des épinglés (contenu retiré).
  const afterDelete = await api(`/api/channels/${channel.id}/pins`, {
    token: account.token,
  });

  assert.equal(afterDelete.body.pins.length, 0);
});

// -----------------------------------------------------------------------------
// Fils de discussion
// -----------------------------------------------------------------------------

test("fil de discussion : réponse reliée, comptée et notifiée", async () => {
  const { account, community } = await newCommunity();
  const channel = await newChannel(account.token, community.id);
  const member = await newAccount("repondeur");
  await addMember(community.id, account, member, ROLES.MEMBER);

  const parent = await sendMessage(account.token, channel.id, {
    content: "Quelqu'un peut confirmer ?",
  });

  const reply = await sendMessage(member.token, channel.id, {
    content: "Je confirme.",
    replyToId: parent.id,
  });

  assert.equal(reply.replyToId, parent.id);

  const replies = await api(
    `/api/channels/${channel.id}/messages/${parent.id}/replies`,
    { token: account.token }
  );

  assert.equal(replies.status, 200);
  assert.equal(replies.body.replies.length, 1);
  assert.equal(replies.body.replies[0].id, reply.id);

  const history = await api(`/api/channels/${channel.id}/messages`, {
    token: account.token,
  });

  const parentInHistory = history.body.messages.find(
    (item) => item.id === parent.id
  );

  assert.equal(parentInHistory.replyCount, 1);
  assert.ok(parentInHistory.lastReplyAt, "la date de dernière réponse est exposée");

  const notifications = await api("/api/notifications", {
    token: account.token,
  });

  const replyNotification = notifications.body.notifications.find(
    (item) => item.type === "message:reply"
  );

  assert.ok(replyNotification, "l'auteur du message d'origine est prévenu");
  assert.equal(replyNotification.payload.messageId, reply.id);

  // On ne répond pas à un message d'un autre salon.
  const other = await newChannel(account.token, community.id);
  const crossChannel = await api(`/api/channels/${other.id}/messages`, {
    method: "POST",
    token: account.token,
    body: { content: "Hors salon", replyToId: parent.id },
  });

  assert.equal(crossChannel.status, 404);
});

// -----------------------------------------------------------------------------
// Recherche
// -----------------------------------------------------------------------------

test("recherche dans un salon : résultat réel et jokers neutralisés", async () => {
  const { account, community } = await newCommunity();
  const channel = await newChannel(account.token, community.id);

  await sendMessage(account.token, channel.id, {
    content: "remise de 100% sur les licences",
  });
  await sendMessage(account.token, channel.id, {
    content: "le taux exact est de 42 pourcent",
  });
  await sendMessage(account.token, channel.id, {
    content: "sujet totalement différent",
  });

  const found = await api(
    `/api/channels/${channel.id}/messages/search?q=${encodeURIComponent("100%")}`,
    { token: account.token }
  );

  assert.equal(found.status, 200, found.text);
  assert.equal(found.body.messages.length, 1);
  assert.match(found.body.messages[0].content, /100%/);

  // « %% » ne doit PAS se comporter comme un joker universel.
  const wildcard = await api(
    `/api/channels/${channel.id}/messages/search?q=${encodeURIComponent("%%")}`,
    { token: account.token }
  );

  assert.equal(wildcard.body.messages.length, 0, "les jokers sont neutralisés");

  const underscore = await api(
    `/api/channels/${channel.id}/messages/search?q=${encodeURIComponent("__")}`,
    { token: account.token }
  );

  assert.equal(underscore.body.messages.length, 0);

  const tooShort = await api(
    `/api/channels/${channel.id}/messages/search?q=a`,
    { token: account.token }
  );

  assert.equal(tooShort.status, 400, "un terme d'un seul caractère est refusé");

  const anon = await api(
    `/api/channels/${channel.id}/messages/search?q=${encodeURIComponent("remise")}`
  );

  assert.equal(anon.status, 401);
});

test("recherche communautaire : limitée aux salons réellement accessibles", async () => {
  const { account, community } = await newCommunity();
  const shared = await newChannel(account.token, community.id);
  const secret = await newChannel(account.token, community.id, {
    name: `prive-${uniqueSuffix()}`,
    isPrivate: true,
  });

  await sendMessage(account.token, shared.id, {
    content: "mot-clé partagé côté public",
  });
  await sendMessage(account.token, secret.id, {
    content: "mot-clé partagé côté privé",
  });

  const member = await newAccount("curieux");
  await addMember(community.id, account, member, ROLES.MEMBER);

  const result = await api(
    `/api/communities/${community.id}/messages/search?q=${encodeURIComponent("mot-clé partagé")}`,
    { token: member.token }
  );

  assert.equal(result.status, 200, result.text);

  const channelIds = result.body.messages.map((item) => item.channelId);

  assert.ok(channelIds.includes(shared.id));
  assert.equal(
    channelIds.includes(secret.id),
    false,
    "un salon privé non autorisé ne doit jamais être fouillé"
  );

  // Un responsable du staff voit les deux salons.
  const asOwner = await api(
    `/api/communities/${community.id}/messages/search?q=${encodeURIComponent("mot-clé partagé")}`,
    { token: account.token }
  );

  assert.ok(asOwner.body.messages.map((item) => item.channelId).includes(secret.id));
  assert.ok(Array.isArray(asOwner.body.channels), "les salons sont nommables");
});

test("recherche communautaire interdite à un non-membre d'une communauté privée", async () => {
  const { account, community } = await newCommunity();
  const channel = await newChannel(account.token, community.id);
  await sendMessage(account.token, channel.id, { content: "contenu interne" });

  const stranger = await newAccount("etranger");

  const refused = await api(
    `/api/communities/${community.id}/messages/search?q=${encodeURIComponent("contenu")}`,
    { token: stranger.token }
  );

  assert.equal(refused.status, 403, refused.text);
});

// -----------------------------------------------------------------------------
// Temps réel
// -----------------------------------------------------------------------------

test("temps réel : une réaction est diffusée aux participants du salon", async () => {
  const { account, community } = await newCommunity();
  const channel = await newChannel(account.token, community.id);
  const message = await sendMessage(account.token, channel.id, {
    content: "À réagir en direct.",
  });

  const { socket } = await connectSocket(account.token);

  try {
    const subscribed = await emitWithAck(socket, "channel:subscribe", {
      channel: channel.id,
    });

    assert.equal(subscribed.success, true, JSON.stringify(subscribed));

    const received = waitFor(socket, "message:reaction");

    await api(`/api/channels/${channel.id}/messages/${message.id}/reactions`, {
      method: "POST",
      token: account.token,
      body: { emoji: "🔥" },
    });

    const payload = await received;

    assert.equal(payload.messageId, message.id);
    assert.equal(payload.emoji, "🔥");
    assert.equal(payload.added, true);
    assert.equal(payload.reactions[0].count, 1);
  } finally {
    socket.close();
  }
});
