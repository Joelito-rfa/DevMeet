/**
 * Pièces jointes : dépôt réel d'un fichier (multipart), rattachement à un
 * message, restitution dans l'historique et téléchargement protégé.
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
  cleanupCommunity,
  cleanupUsers,
  countRows,
  query,
  queryOne,
  getBaseUrl,
} = require("./helpers");

const { ROLES } = require("../src/permissions");
const config = require("../src/config");

/** Requête renvoyant plusieurs lignes (nettoyage des fichiers sur disque). */
async function queryRows(sql, params = []) {
  const rows = await query(sql, params);
  return rows;
}

let ready = false;
const communities = [];
const accounts = [];

before(async () => {
  const started = await startTestServer();
  ready = Boolean(started.baseUrl);
});

after(async () => {
  // Les tests déposent de vrais fichiers : on les retire du disque avant de
  // supprimer les communautés (sinon il resterait des orphelins).
  for (const communityId of communities) {
    const rows = await queryRows(
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

/** Envoi multipart réel (aucun en-tête Content-Type manuel). */
async function uploadFile(urlPath, { token, bytes, fileName, mimeType }) {
  const form = new FormData();

  form.append("file", new Blob([bytes], { type: mimeType }), fileName);

  const response = await fetch(`${getBaseUrl()}${urlPath}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  const text = await response.text();

  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  return { status: response.status, body, text };
}

async function setup() {
  const owner = await createAccount("att-owner");
  accounts.push(owner);

  const community = await createCommunity(owner);
  communities.push(community.id);

  const channel = await api(`/api/communities/${community.id}/channels`, {
    method: "POST",
    token: owner.token,
    body: { name: "fichiers", type: "text" },
  });

  assert.equal(channel.status, 201);

  return { owner, community, channel: channel.body.channel };
}

const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
  "hex"
);

test("un fichier déposé est écrit sur le disque et rattaché au message", async () => {
  assert.ok(ready);

  const { owner, channel } = await setup();

  const uploaded = await uploadFile(`/api/channels/${channel.id}/attachments`, {
    token: owner.token,
    bytes: PNG_BYTES,
    fileName: "capture écran.png",
    mimeType: "image/png",
  });

  assert.equal(uploaded.status, 201, uploaded.text);
  assert.equal(uploaded.body.attachment.fileName, "capture écran.png");
  assert.equal(uploaded.body.attachment.mimeType, "image/png");
  assert.equal(uploaded.body.attachment.size, PNG_BYTES.length);
  assert.equal(uploaded.body.attachment.messageId, null);
  assert.equal(
    JSON.stringify(uploaded.body).includes("storage_key"),
    false,
    "le nom réel sur le disque ne doit jamais être exposé"
  );

  // Les octets sont réellement présents sur le disque.
  const row = await queryOne("SELECT * FROM attachments WHERE id = ?", [
    uploaded.body.attachment.id,
  ]);

  assert.ok(row, "les métadonnées doivent être en base");

  const stored = await fs.readFile(
    path.join(config.uploads.dir, row.storage_key)
  );

  assert.equal(stored.length, PNG_BYTES.length);

  // Le message référence la pièce jointe.
  const posted = await api(`/api/channels/${channel.id}/messages`, {
    method: "POST",
    token: owner.token,
    body: {
      content: "Voici la capture.",
      attachmentIds: [uploaded.body.attachment.id],
    },
  });

  assert.equal(posted.status, 201);
  assert.equal(posted.body.data.attachments.length, 1);
  assert.equal(
    posted.body.data.attachments[0].messageId,
    posted.body.data.id,
    "la pièce jointe doit être rattachée au message"
  );

  // L'historique la restitue.
  const history = await api(`/api/channels/${channel.id}/messages`, {
    token: owner.token,
  });

  assert.equal(history.status, 200);
  assert.equal(history.body.messages.at(-1).attachments.length, 1);

  // Téléchargement authentifié : mêmes octets.
  const download = await fetch(
    `${getBaseUrl()}/api/channels/${channel.id}/attachments/${uploaded.body.attachment.id}`,
    { headers: { Authorization: `Bearer ${owner.token}` } }
  );

  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "image/png");
  assert.match(
    download.headers.get("content-disposition") || "",
    /attachment/
  );

  const downloaded = Buffer.from(await download.arrayBuffer());
  assert.equal(downloaded.length, PNG_BYTES.length);
});

test("une pièce jointe est inaccessible sans droit sur le salon", async () => {
  assert.ok(ready);

  const { owner, community, channel } = await setup();

  const outsider = await createAccount("att-outsider");
  accounts.push(outsider);

  const uploaded = await uploadFile(`/api/channels/${channel.id}/attachments`, {
    token: owner.token,
    bytes: PNG_BYTES,
    fileName: "prive.png",
    mimeType: "image/png",
  });

  assert.equal(uploaded.status, 201);

  const attachmentId = uploaded.body.attachment.id;

  // Un compte hors communauté : refus.
  const request = (token) =>
    fetch(`${getBaseUrl()}/api/channels/${channel.id}/attachments/${attachmentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

  const refused = await request(outsider.token);
  assert.equal(refused.status, 403);

  // Sans jeton : refus.
  const anonymous = await fetch(
    `${getBaseUrl()}/api/channels/${channel.id}/attachments/${attachmentId}`
  );

  assert.equal(anonymous.status, 401);

  // Un membre du salon, lui, y accède.
  const member = await createAccount("att-member");
  accounts.push(member);
  await addMember(community.id, owner, member, ROLES.MEMBER);

  const allowed = await request(member.token);
  assert.equal(allowed.status, 200);
});

test("un type de fichier refusé est rejeté et n'écrit rien", async () => {
  assert.ok(ready);

  const { owner, channel } = await setup();

  const before = await countRows("attachments", "channel_id = ?", [channel.id]);

  const uploaded = await uploadFile(`/api/channels/${channel.id}/attachments`, {
    token: owner.token,
    bytes: Buffer.from("#!/bin/sh\necho bonjour\n"),
    fileName: "script.sh",
    mimeType: "application/x-sh",
  });

  assert.equal(uploaded.status, 400);
  assert.equal(uploaded.body.code, "file_type_not_allowed");
  assert.equal(
    await countRows("attachments", "channel_id = ?", [channel.id]),
    before,
    "aucune ligne ne doit être créée pour un fichier refusé"
  );
});

test("un membre ne peut pas rattacher la pièce jointe d'un autre", async () => {
  assert.ok(ready);

  const { owner, community, channel } = await setup();

  const member = await createAccount("att-thief");
  accounts.push(member);
  await addMember(community.id, owner, member, ROLES.MEMBER);

  const uploaded = await uploadFile(`/api/channels/${channel.id}/attachments`, {
    token: owner.token,
    bytes: PNG_BYTES,
    fileName: "a-moi.png",
    mimeType: "image/png",
  });

  assert.equal(uploaded.status, 201);

  // Le membre tente de rattacher le fichier déposé par le propriétaire.
  const posted = await api(`/api/channels/${channel.id}/messages`, {
    method: "POST",
    token: member.token,
    body: {
      content: "Je récupère ton fichier.",
      attachmentIds: [uploaded.body.attachment.id],
    },
  });

  assert.equal(posted.status, 201);
  assert.equal(
    posted.body.data.attachments.length,
    0,
    "rattacher la pièce jointe d'un autre doit être impossible"
  );

  const row = await queryOne("SELECT * FROM attachments WHERE id = ?", [
    uploaded.body.attachment.id,
  ]);

  assert.equal(row.message_id, null, "elle reste non rattachée");
});

test("le dépôt est refusé à un non-membre d'une communauté privée", async () => {
  assert.ok(ready);

  const { channel } = await setup();

  const outsider = await createAccount("att-intruder");
  accounts.push(outsider);

  const uploaded = await uploadFile(`/api/channels/${channel.id}/attachments`, {
    token: outsider.token,
    bytes: PNG_BYTES,
    fileName: "intrusion.png",
    mimeType: "image/png",
  });

  assert.equal(uploaded.status, 403);
  assert.equal(uploaded.body.code, "not_a_member");
});
