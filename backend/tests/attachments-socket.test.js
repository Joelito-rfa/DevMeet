/**
 * Pièces jointes envoyées par le protocole de salon (Socket.IO).
 *
 * L'interface existante (`Room` + `Chat`) envoie ses messages par
 * `send-message` : ce chemin doit donc accepter les fichiers exactement comme
 * `POST /api/channels/:id/messages`. On vérifie aussi les refus.
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
  connectSocket,
  emitWithAck,
  waitFor,
  cleanupCommunity,
  cleanupUsers,
  query,
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

/** Communauté privée + salon textuel + pièce jointe déjà déposée. */
async function setup() {
  const owner = await createAccount("pj-socket");
  accounts.push(owner);

  const community = await createCommunity(owner);
  communities.push(community.id);

  const created = await api(`/api/communities/${community.id}/channels`, {
    method: "POST",
    token: owner.token,
    body: { name: "fichiers", type: "text" },
  });

  assert.equal(created.status, 201);

  const channel = created.body.channel;

  const form = new FormData();
  form.append(
    "file",
    new Blob([PNG_BYTES], { type: "image/png" }),
    "capture.png"
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

  const uploadBody = await uploaded.json();

  return { owner, community, channel, attachment: uploadBody.attachment };
}

test("un message de salon rattache la pièce jointe et la diffuse", async () => {
  assert.ok(ready);

  const { owner, channel, attachment } = await setup();
  const { socket } = await connectSocket(owner.token);

  const joined = await emitWithAck(socket, "join-room", { roomId: channel.id });
  assert.equal(joined.success, true);

  const broadcastPromise = waitFor(socket, "receive-message", 8000);

  const ack = await emitWithAck(socket, "send-message", {
    roomId: channel.id,
    message: "Voici le fichier",
    attachmentIds: [attachment.id],
  });

  assert.equal(ack.success, true);
  assert.equal(ack.attachmentCount, 1);

  const broadcast = await broadcastPromise;

  assert.equal(broadcast.attachments.length, 1);
  assert.equal(broadcast.attachments[0].id, attachment.id);
  assert.equal(broadcast.attachments[0].fileName, "capture.png");

  // L'auteur est le COMPTE authentifié, jamais l'identifiant de connexion.
  assert.equal(broadcast.authorId, owner.id);
  assert.equal(broadcast.senderId, owner.id);

  // Le rattachement est réellement écrit en base.
  const rows = await query("SELECT message_id FROM attachments WHERE id = ?", [
    attachment.id,
  ]);

  assert.equal(String(rows[0].message_id), String(broadcast.id));

  socket.close();
});

test("un message peut n'être qu'un fichier, sans texte", async () => {
  assert.ok(ready);

  const { owner, channel, attachment } = await setup();
  const { socket } = await connectSocket(owner.token);

  await emitWithAck(socket, "join-room", { roomId: channel.id });

  const broadcastPromise = waitFor(socket, "receive-message", 8000);

  const ack = await emitWithAck(socket, "send-message", {
    roomId: channel.id,
    message: "",
    attachmentIds: [attachment.id],
  });

  assert.equal(ack.attachmentCount, 1);

  const broadcast = await broadcastPromise;

  assert.equal(broadcast.message, "");
  assert.equal(broadcast.attachments.length, 1);

  socket.close();
});

test("un identifiant de pièce jointe inconnu est ignoré", async () => {
  assert.ok(ready);

  const { owner, channel } = await setup();
  const { socket } = await connectSocket(owner.token);

  await emitWithAck(socket, "join-room", { roomId: channel.id });

  const broadcastPromise = waitFor(socket, "receive-message", 8000);

  const ack = await emitWithAck(socket, "send-message", {
    roomId: channel.id,
    message: "Tentative de détournement",
    attachmentIds: [999999],
  });

  assert.equal(ack.success, true);
  assert.equal(ack.attachmentCount, 0);
  assert.equal((await broadcastPromise).attachments.length, 0);

  socket.close();
});

test("un message vide sans pièce jointe est refusé", async () => {
  assert.ok(ready);

  const { owner, channel } = await setup();
  const { socket } = await connectSocket(owner.token);

  await emitWithAck(socket, "join-room", { roomId: channel.id });

  const errorPromise = waitFor(socket, "room-error", 8000);

  socket.emit("send-message", { roomId: channel.id, message: "   " });

  assert.equal(await errorPromise, "Le message ne peut pas être vide.");

  socket.close();
});
