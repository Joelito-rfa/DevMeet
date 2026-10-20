/**
 * Modération des messages.
 *
 * Le chemin réellement utilisé par l'interface est l'événement Socket.IO
 * `message:delete` (l'écran de salon parle le protocole historique) ; la route
 * REST `DELETE /api/channels/:channelId/messages/:messageId` applique la même
 * règle. On vérifie donc les deux, ainsi que les refus.
 *
 * Règles contrôlées ici :
 *   - l'auteur peut supprimer son propre message ;
 *   - un membre simple ne peut PAS supprimer celui d'un autre ;
 *   - un modérateur le peut ;
 *   - la suppression est DOUCE : la ligne reste, le contenu est vidé, l'auteur
 *     est conservé, et la pièce jointe n'est plus servie (mais reste en base).
 */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test, before, after } = require("node:test");

const {
  startTestServer,
  stopTestServer,
  api,
  createAccount,
  createCommunity,
  addMember,
  connectSocket,
  emitWithAck,
  waitFor,
  cleanupCommunity,
  cleanupUsers,
  query,
  queryOne,
  getBaseUrl,
} = require("./helpers");

const config = require("../src/config");

let ready = false;
const communities = [];
const accounts = [];

before(async () => {
  const started = await startTestServer();
  ready = Boolean(started.baseUrl);
});

after(async () => {
  for (const communityId of communities) {
    const rows = await query(
      `SELECT a.storage_key
         FROM attachments a
         JOIN channels c ON c.id = a.channel_id
        WHERE c.community_id = ?`,
      [communityId]
    );

    for (const row of rows) {
      await fs
        .rm(path.join(config.uploads.dir, row.storage_key), { force: true })
        .catch(() => null);
    }
  }

  for (const communityId of communities) {
    await cleanupCommunity(communityId);
  }

  await cleanupUsers(accounts);
  await stopTestServer();
});

const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
  "hex"
);

/** Communauté privée + un salon textuel, dont l'appelant est propriétaire. */
async function setup() {
  const owner = await createAccount("mod-owner");
  accounts.push(owner);

  const community = await createCommunity(owner);
  communities.push(community.id);

  const created = await api(`/api/communities/${community.id}/channels`, {
    method: "POST",
    token: owner.token,
    body: { name: "salon-moderation", type: "text" },
  });

  assert.equal(created.status, 201);

  return { owner, community, channel: created.body.channel };
}

/** Écrit un message et renvoie son identifiant. */
async function writeMessage(channelId, author, content, extra = {}) {
  const result = await api(`/api/channels/${channelId}/messages`, {
    method: "POST",
    token: author.token,
    body: { content, ...extra },
  });

  assert.equal(result.status, 201);

  return result.body.data;
}

test("un salon expose le rôle et les permissions de l'appelant", async () => {
  assert.ok(ready);

  const { owner, channel } = await setup();

  const detail = await api(`/api/channels/${channel.id}`, { token: owner.token });

  assert.equal(detail.status, 200);
  // Le rôle est renvoyé comme objet résolu (clés, libellé, rang,
  // permissions) : l'interface n'a plus à deviner la matrice des droits.
  assert.equal(detail.body.role.key, "owner");
  assert.equal(detail.body.role.rank, 100);
  assert.ok(detail.body.permissions.includes("message:moderate"));
  assert.ok(detail.body.permissions.includes("message:send"));
});

test("l'auteur supprime son message et tout le salon est prévenu", async () => {
  assert.ok(ready);

  const { owner, channel } = await setup();
  const message = await writeMessage(channel.id, owner, "Message à retirer");

  const { socket } = await connectSocket(owner.token);
  await emitWithAck(socket, "join-room", { roomId: channel.id });

  const broadcastPromise = waitFor(socket, "message:deleted", 8000);

  const ack = await emitWithAck(socket, "message:delete", {
    channel: channel.id,
    messageId: message.id,
  });

  assert.equal(ack.success, true);
  assert.equal(String(ack.deletedId), String(message.id));

  const broadcast = await broadcastPromise;

  assert.equal(String(broadcast.deletedId), String(message.id));
  assert.equal(broadcast.channelId, channel.id);

  // Suppression douce : la ligne est conservée, seul le contenu disparaît.
  const row = await queryOne(
    "SELECT content, deleted_at, author_id FROM messages WHERE id = ?",
    [message.id]
  );

  assert.equal(row.content, "");
  assert.ok(row.deleted_at);
  assert.equal(Number(row.author_id), owner.id);

  // L'historique rejoué depuis la base porte le marqueur explicite.
  const history = await api(`/api/channels/${channel.id}/messages`, {
    token: owner.token,
  });

  const stored = history.body.messages.find((item) => item.id === message.id);

  assert.equal(stored.deleted, true);
  assert.equal(stored.content, "");

  socket.close();
});

test("un membre ne peut pas supprimer le message d'un autre", async () => {
  assert.ok(ready);

  const { owner, community, channel } = await setup();

  const member = await createAccount("mod-membre");
  accounts.push(member);
  await addMember(community.id, owner, member, "member");

  const message = await writeMessage(channel.id, owner, "Message du propriétaire");

  const { socket } = await connectSocket(member.token);
  await emitWithAck(socket, "join-room", { roomId: channel.id });

  const ack = await emitWithAck(socket, "message:delete", {
    channel: channel.id,
    messageId: message.id,
  });

  assert.equal(ack.success, false);
  assert.equal(ack.code, "not_author");

  // Le message est intact : rien n'a été supprimé en douce.
  const row = await queryOne(
    "SELECT content, deleted_at FROM messages WHERE id = ?",
    [message.id]
  );

  assert.equal(row.content, "Message du propriétaire");
  assert.equal(row.deleted_at, null);

  socket.close();
});

test("un modérateur peut supprimer le message d'un membre (REST)", async () => {
  assert.ok(ready);

  const { owner, community, channel } = await setup();

  const member = await createAccount("mod-auteur");
  const moderator = await createAccount("mod-modo");
  accounts.push(member, moderator);

  await addMember(community.id, owner, member, "member");
  await addMember(community.id, owner, moderator, "moderator");

  const message = await writeMessage(channel.id, member, "Message du membre");

  const detail = await api(`/api/channels/${channel.id}`, {
    token: moderator.token,
  });

  assert.equal(detail.body.role.key, "moderator");
  assert.equal(detail.body.role.rank, 50);
  assert.ok(detail.body.permissions.includes("message:moderate"));

  const removed = await api(
    `/api/channels/${channel.id}/messages/${message.id}`,
    { method: "DELETE", token: moderator.token }
  );

  assert.equal(removed.status, 200);
  assert.equal(String(removed.body.deletedId), String(message.id));

  // L'auteur du message reste inchangé : on n'efface pas l'historique.
  const row = await queryOne(
    "SELECT content, deleted_at, author_id FROM messages WHERE id = ?",
    [message.id]
  );

  assert.equal(row.content, "");
  assert.ok(row.deleted_at);
  assert.equal(Number(row.author_id), member.id);
});

test("un message supprimé ne réexpose plus sa pièce jointe", async () => {
  assert.ok(ready);

  const { owner, channel } = await setup();

  const form = new FormData();
  form.append(
    "file",
    new Blob([PNG_BYTES], { type: "image/png" }),
    "note-interne.png"
  );

  const uploaded = await fetch(
    `${getBaseUrl()}/api/channels/${channel.id}/attachments`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${owner.token}` },
      body: form,
    }
  );

  assert.equal(uploaded.status, 201);

  const attachment = (await uploaded.json()).attachment;

  const message = await writeMessage(channel.id, owner, "Note interne", {
    attachmentIds: [attachment.id],
  });

  assert.equal(message.attachments.length, 1);

  const removed = await api(
    `/api/channels/${channel.id}/messages/${message.id}`,
    { method: "DELETE", token: owner.token }
  );

  assert.equal(removed.status, 200);

  const history = await api(`/api/channels/${channel.id}/messages`, {
    token: owner.token,
  });

  const stored = history.body.messages.find((item) => item.id === message.id);

  assert.equal(stored.deleted, true);
  assert.deepEqual(stored.attachments, []);

  // La métadonnée existe toujours : rien n'a été effacé en silence.
  const rows = await query(
    "SELECT message_id, file_name FROM attachments WHERE id = ?",
    [attachment.id]
  );

  assert.equal(rows.length, 1);
  assert.equal(String(rows[0].message_id), String(message.id));
  assert.equal(rows[0].file_name, "note-interne.png");
});

test("supprimer un message inexistant répond 404", async () => {
  assert.ok(ready);

  const { owner, channel } = await setup();

  const result = await api(
    `/api/channels/${channel.id}/messages/999999999`,
    { method: "DELETE", token: owner.token }
  );

  assert.equal(result.status, 404);
});
