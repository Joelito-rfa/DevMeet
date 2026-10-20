/**
 * Messagerie privée entre comptes.
 *
 * Point le plus sensible : un message privé ne doit atteindre QUE ses deux
 * participants. C'est vérifié avec trois connexions simultanées — l'auteur, le
 * destinataire, et un tiers qui ne doit rien recevoir.
 */
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");

const {
  startTestServer,
  stopTestServer,
  api,
  createAccount,
  connectSocket,
  waitFor,
  cleanupUsers,
  query,
} = require("./helpers");

let ready = false;
const accounts = [];

before(async () => {
  const started = await startTestServer();
  ready = Boolean(started.baseUrl);
});

after(async () => {
  // Supprimer les comptes suffit : `dm_conversations` et `dm_messages` sont en
  // cascade sur `users`.
  await cleanupUsers(accounts);
  await stopTestServer();
});

/** Ouvre (ou retrouve) la conversation entre deux comptes. */
async function openConversation(actor, other) {
  const result = await api("/api/dms", {
    method: "POST",
    token: actor.token,
    body: { userId: other.id },
  });

  assert.ok(result.status === 200 || result.status === 201, result.text);

  return result.body.conversation;
}

async function send(conversationId, author, content) {
  return api(`/api/dms/${conversationId}/messages`, {
    method: "POST",
    token: author.token,
    body: { content },
  });
}

/** Résout à `true` si AUCUN événement n'arrive pendant le délai. */
function expectSilence(socket, event, timeoutMs = 900) {
  return new Promise((resolve) => {
    function handler() {
      socket.off(event, handler);
      resolve(false);
    }

    socket.on(event, handler);

    setTimeout(() => {
      socket.off(event, handler);
      resolve(true);
    }, timeoutMs);
  });
}

/** Trois comptes, dont un tiers hors conversation. */
async function threeAccounts() {
  const author = await createAccount("dm-auteur");
  const partner = await createAccount("dm-partenaire");
  const stranger = await createAccount("dm-tiers");
  accounts.push(author, partner, stranger);

  const conversation = await openConversation(author, partner);

  return { author, partner, stranger, conversation };
}

test("la conversation est unique par paire, quel que soit l'ordre", async () => {
  assert.ok(ready);

  const first = await createAccount("dm-pair-un");
  const second = await createAccount("dm-pair-deux");
  accounts.push(first, second);

  const created = await api("/api/dms", {
    method: "POST",
    token: first.token,
    body: { userId: second.id },
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.conversation.participant.id, second.id);
  assert.equal(created.body.conversation.unreadCount, 0);
  assert.equal(created.body.conversation.lastMessage, null);

  const mirrored = await api("/api/dms", {
    method: "POST",
    token: second.token,
    body: { userId: first.id },
  });

  assert.equal(mirrored.status, 200);
  assert.equal(mirrored.body.conversation.id, created.body.conversation.id);
  assert.equal(mirrored.body.conversation.participant.id, first.id);

  const rows = await query(
    `SELECT id FROM dm_conversations
      WHERE (user_a_id = ? AND user_b_id = ?)
         OR (user_a_id = ? AND user_b_id = ?)`,
    [first.id, second.id, second.id, first.id]
  );

  assert.equal(rows.length, 1);
});

test("un message privé n'atteint que ses deux participants", async () => {
  assert.ok(ready);

  const { author, partner, stranger, conversation } = await threeAccounts();

  const sockets = [];

  try {
    const { socket: authorSocket } = await connectSocket(author.token);
    const { socket: partnerSocket } = await connectSocket(partner.token);
    const { socket: strangerSocket } = await connectSocket(stranger.token);

    sockets.push(authorSocket, partnerSocket, strangerSocket);

    const forAuthor = waitFor(authorSocket, "dm:new", 8000);
    const forPartner = waitFor(partnerSocket, "dm:new", 8000);
    const silenceForStranger = expectSilence(strangerSocket, "dm:new", 900);

    const sent = await send(conversation.id, author, "Bonjour en privé");

    assert.equal(sent.status, 201);
    assert.equal(sent.body.data.content, "Bonjour en privé");
    assert.equal(sent.body.data.author.id, author.id);

    const receivedAuthor = await forAuthor;
    const receivedPartner = await forPartner;

    assert.equal(receivedAuthor.conversationId, conversation.id);
    assert.equal(receivedPartner.conversationId, conversation.id);
    assert.equal(receivedPartner.message.content, "Bonjour en privé");
    assert.equal(receivedPartner.message.author.id, author.id);

    assert.equal(
      await silenceForStranger,
      true,
      "un tiers ne doit jamais recevoir un message privé"
    );
  } finally {
    for (const socket of sockets) {
      socket.close();
    }
  }
});

test("un tiers ne peut ni lire ni écrire ni supprimer dans une conversation privée", async () => {
  assert.ok(ready);

  const { author, partner, stranger, conversation } = await threeAccounts();

  const sent = await send(conversation.id, author, "Message privé");
  const messageId = sent.body.data.id;

  const read = await api(`/api/dms/${conversation.id}/messages`, {
    token: stranger.token,
  });

  assert.equal(read.status, 404);
  assert.equal(read.body.code, "conversation_not_found");

  const write = await send(conversation.id, stranger, "Intrusion");

  assert.equal(write.status, 404);
  assert.equal(write.body.code, "conversation_not_found");

  const remove = await api(
    `/api/dms/${conversation.id}/messages/${messageId}`,
    { method: "DELETE", token: stranger.token }
  );

  assert.equal(remove.status, 404);

  // La conversation n'apparaît pas non plus dans sa liste.
  const list = await api("/api/dms", { token: stranger.token });

  assert.equal(list.status, 200);
  assert.equal(
    list.body.conversations.some((item) => item.id === conversation.id),
    false
  );

  // Et le message est intact.
  const rows = await query(
    "SELECT deleted_at FROM dm_messages WHERE id = ?",
    [messageId]
  );

  assert.equal(rows[0].deleted_at, null);

  const partnerRead = await api(`/api/dms/${conversation.id}/messages`, {
    token: partner.token,
  });

  assert.equal(partnerRead.status, 200);
});

test("les non-lus se comptent côté destinataire et retombent à zéro une fois lus", async () => {
  assert.ok(ready);

  const { author, partner, conversation } = await threeAccounts();

  await send(conversation.id, author, "Premier");
  const second = await send(conversation.id, author, "Deuxième");

  const partnerList = await api("/api/dms", { token: partner.token });
  const seenByPartner = partnerList.body.conversations.find(
    (item) => item.id === conversation.id
  );

  assert.equal(seenByPartner.unreadCount, 2);
  assert.equal(seenByPartner.participant.id, author.id);
  assert.equal(seenByPartner.lastMessage.content, "Deuxième");
  assert.equal(seenByPartner.lastMessage.authorId, author.id);

  // Ses propres messages ne comptent jamais comme non lus.
  const authorList = await api("/api/dms", { token: author.token });
  const seenByAuthor = authorList.body.conversations.find(
    (item) => item.id === conversation.id
  );

  assert.equal(seenByAuthor.unreadCount, 0);

  const badgeBefore = await api("/api/dms/unread-count", { token: partner.token });
  assert.ok(badgeBefore.body.unreadCount >= 2);

  const read = await api(`/api/dms/${conversation.id}/read`, {
    method: "POST",
    token: partner.token,
  });

  assert.equal(read.status, 200);
  assert.equal(read.body.messageId, second.body.data.id);

  const after = await api("/api/dms", { token: partner.token });
  const updated = after.body.conversations.find(
    (item) => item.id === conversation.id
  );

  assert.equal(updated.unreadCount, 0);
  assert.equal(updated.lastReadMessageId, second.body.data.id);
  // La position de lecture de l'AUTRE participant n'est pas la sienne.
  assert.equal(updated.partnerLastReadMessageId, null);

  // Vu par l'auteur : c'est bien la lecture du partenaire qui remonte.
  const seenByAuthorAfter = await api("/api/dms", { token: author.token });
  const authorView = seenByAuthorAfter.body.conversations.find(
    (item) => item.id === conversation.id
  );

  assert.equal(authorView.partnerLastReadMessageId, second.body.data.id);
  assert.equal(authorView.lastReadMessageId, null);
});

test("seul l'auteur peut supprimer son message privé, et la suppression est logique", async () => {
  assert.ok(ready);

  const { author, partner, conversation } = await threeAccounts();

  const sent = await send(conversation.id, author, "À retirer");
  const messageId = sent.body.data.id;

  const refused = await api(
    `/api/dms/${conversation.id}/messages/${messageId}`,
    { method: "DELETE", token: partner.token }
  );

  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, "not_author");

  const { socket } = await connectSocket(partner.token);
  const broadcastPromise = waitFor(socket, "dm:deleted", 8000);

  const removed = await api(
    `/api/dms/${conversation.id}/messages/${messageId}`,
    { method: "DELETE", token: author.token }
  );

  assert.equal(removed.status, 200);
  assert.equal(removed.body.deletedId, messageId);

  const broadcast = await broadcastPromise;

  assert.equal(broadcast.deletedId, messageId);
  assert.equal(broadcast.conversationId, conversation.id);

  const history = await api(`/api/dms/${conversation.id}/messages`, {
    token: author.token,
  });

  const stored = history.body.messages.find((item) => item.id === messageId);

  assert.equal(stored.deleted, true);
  assert.equal(stored.content, "");

  // La ligne et l'auteur restent en base : rien n'est effacé en silence.
  const rows = await query(
    "SELECT author_id, content, deleted_at FROM dm_messages WHERE id = ?",
    [messageId]
  );

  assert.equal(Number(rows[0].author_id), author.id);
  assert.equal(rows[0].content, "");
  assert.ok(rows[0].deleted_at);

  socket.close();
});

test("un message privé notifie le destinataire, et lui seul", async () => {
  assert.ok(ready);

  const { author, partner, stranger, conversation } = await threeAccounts();

  await send(conversation.id, author, "Coucou");

  const forPartner = await api("/api/notifications", { token: partner.token });
  const forStranger = await api("/api/notifications", { token: stranger.token });

  const mine = (forPartner.body.notifications || []).filter(
    (item) => item.type === "dm:message"
  );

  assert.equal(mine.length, 1);
  assert.equal(mine[0].payload.conversationId, conversation.id);

  assert.equal(
    (forStranger.body.notifications || []).filter(
      (item) => item.type === "dm:message"
    ).length,
    0
  );

  // L'auteur n'est pas notifié de son propre message.
  const forAuthor = await api("/api/notifications", { token: author.token });

  assert.equal(
    (forAuthor.body.notifications || []).filter(
      (item) => item.type === "dm:message"
    ).length,
    0
  );
});

test("une conversation privée n'est pas ouverte n'importe comment", async () => {
  assert.ok(ready);

  const solo = await createAccount("dm-solo");
  accounts.push(solo);

  const withSelf = await api("/api/dms", {
    method: "POST",
    token: solo.token,
    body: { userId: solo.id },
  });

  assert.equal(withSelf.status, 400);
  assert.equal(withSelf.body.code, "self_conversation");

  const withGhost = await api("/api/dms", {
    method: "POST",
    token: solo.token,
    body: { userId: 999999999 },
  });

  assert.equal(withGhost.status, 404);
  assert.equal(withGhost.body.code, "user_not_found");

  const unauthenticated = await api("/api/dms");

  assert.equal(unauthenticated.status, 401);
});

test("la liste de contacts reste limitée aux communautés partagées", async () => {
  assert.ok(ready);

  const me = await createAccount("dm-contact-moi");
  const mate = await createAccount("dm-contact-voisin");
  accounts.push(me, mate);

  const list = await api("/api/dms/candidates", { token: me.token });

  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body.candidates));
  assert.equal(
    list.body.candidates.some((item) => item.id === me.id),
    false,
    "on ne se propose pas soi-même"
  );

  const searched = await api(
    `/api/dms/candidates?search=${encodeURIComponent(mate.name)}`,
    { token: me.token }
  );

  assert.equal(searched.status, 200);
  assert.ok(
    searched.body.candidates.some((item) => item.id === mate.id && item.name === mate.name)
  );

  const anonymous = await api("/api/dms/candidates");

  assert.equal(anonymous.status, 401);
});

test("un message privé vide est refusé", async () => {
  assert.ok(ready);

  const { author, conversation } = await threeAccounts();

  const empty = await send(conversation.id, author, "   ");

  assert.equal(empty.status, 400);

  const missing = await api(`/api/dms/${conversation.id}/messages`, {
    method: "POST",
    token: author.token,
    body: {},
  });

  assert.equal(missing.status, 400);
});
