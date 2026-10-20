/**
 * M3 — temps réel.
 *
 * Ce fichier teste précisément les bugs décrits dans le cahier des charges :
 *   - une connexion Socket.IO non authentifiée doit être refusée ;
 *   - l'auteur d'un message doit être le COMPTE, jamais l'identifiant de socket ;
 *   - une reconnexion ne doit pas dupliquer les messages ni faire perdre les
 *     droits (l'ancien `isMember()` comparait `socket.id`) ;
 *   - un salon privé ou protégé par un code n'est pas joignable en devinant son
 *     identifiant ;
 *   - la signalisation vocale ne peut pas viser un socket hors du salon vocal.
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
  connectSocket,
  waitFor,
  emitWithAck,
  cleanupCommunity,
  cleanupUsers,
  countRows,
  query,
  queryOne,
} = require("./helpers");

const { ROLES } = require("../src/permissions");

let ready = false;
const accounts = [];
const communities = [];
const sockets = [];

before(async () => {
  await startTestServer();
  ready = true;
});

after(async () => {
  for (const socket of sockets) {
    if (socket.connected) {
      socket.close();
    }
  }

  for (const communityId of communities) {
    await cleanupCommunity(communityId);
  }

  await cleanupUsers(accounts);
  await stopTestServer();
});

async function account(label) {
  const created = await createAccount(label);
  accounts.push(created);
  return created;
}

async function community(ownerAccount, overrides = {}) {
  const created = await createCommunity(ownerAccount, overrides);
  communities.push(created.id);
  return created;
}

async function channel(token, communityId, body) {
  const result = await api(`/api/communities/${communityId}/channels`, {
    method: "POST",
    token,
    body,
  });

  assert.equal(result.status, 201, result.text);
  return result.body.channel;
}

async function openSocket(token) {
  const opened = await connectSocket(token);
  sockets.push(opened.socket);
  return opened;
}

// -----------------------------------------------------------------------------
// Authentification de la connexion
// -----------------------------------------------------------------------------

test("une connexion sans jeton est refusée", async () => {
  assert.ok(ready);

  await assert.rejects(
    () => connectSocket(undefined),
    (error) => {
      assert.match(String(error.message), /auth|Authentification|jeton/i);
      return true;
    }
  );
});

test("une connexion avec un jeton invalide est refusée", async () => {
  await assert.rejects(() => connectSocket("jeton.completement.invalide"));
});

test("une connexion authentifiée reçoit l'identité du compte, pas celle du socket", async () => {
  const user = await account("rt-identite");
  const { socket, ready: session } = await openSocket(user.token);

  assert.equal(session.user.id, user.id, "l'id doit être celui du COMPTE");
  assert.equal(session.user.email, user.email);
  assert.ok(socket.id, "le socket possède bien son propre identifiant");
  assert.notEqual(session.user.id, socket.id);
  assert.equal(typeof session.user.id, "number");
});

// -----------------------------------------------------------------------------
// Messagerie
// -----------------------------------------------------------------------------

test("un message envoyé par socket est persisté avec l'auteur réel", async () => {
  const ownerAccount = await account("rt-owner");
  const memberAccount = await account("rt-member");
  const created = await community(ownerAccount, { isPublic: false });

  await addMember(created.id, ownerAccount, memberAccount, ROLES.MEMBER);

  const textChannel = await channel(ownerAccount.token, created.id, {
    name: "socket-chat",
    type: "text",
  });

  const ownerSocket = await openSocket(ownerAccount.token);
  const memberSocket = await openSocket(memberAccount.token);

  const subscribeOwner = await emitWithAck(ownerSocket.socket, "channel:subscribe", {
    channel: textChannel.id,
  });

  const subscribeMember = await emitWithAck(
    memberSocket.socket,
    "channel:subscribe",
    { channel: textChannel.id }
  );

  assert.equal(subscribeOwner.success, true);
  assert.equal(subscribeMember.success, true);

  const incoming = waitFor(memberSocket.socket, "message:new");

  const sent = await emitWithAck(ownerSocket.socket, "message:send", {
    channel: textChannel.id,
    content: "Message envoyé par socket.",
    // Le client tente d'imposer une fausse identité : elle doit être ignorée.
    senderId: 999999,
    userName: "Usurpateur",
  });

  assert.equal(sent.success, true);

  const row = await queryOne("SELECT * FROM messages WHERE id = ?", [
    sent.message.id,
  ]);

  assert.equal(Number(row.author_id), ownerAccount.id);
  assert.equal(row.content, "Message envoyé par socket.");

  const received = await incoming;

  assert.equal(received.message.id, sent.message.id);
  assert.equal(received.message.author.id, ownerAccount.id);
  assert.equal(received.message.author.name, ownerAccount.name);
  assert.notEqual(received.message.author.name, "Usurpateur");
});

test("un socket non abonné ne reçoit pas les messages du salon", async () => {
  const ownerAccount = await account("rt-iso-owner");
  const otherAccount = await account("rt-iso-other");

  const first = await community(ownerAccount, { isPublic: true });
  const second = await community(otherAccount, { isPublic: true });

  const firstChannel = await channel(ownerAccount.token, first.id, {
    name: "salon-un",
    type: "text",
  });
  const secondChannel = await channel(otherAccount.token, second.id, {
    name: "salon-deux",
    type: "text",
  });

  const ownerSocket = await openSocket(ownerAccount.token);
  const otherSocket = await openSocket(otherAccount.token);

  await emitWithAck(ownerSocket.socket, "channel:subscribe", {
    channel: firstChannel.id,
  });
  await emitWithAck(otherSocket.socket, "channel:subscribe", {
    channel: secondChannel.id,
  });

  let leaked = false;
  otherSocket.socket.on("message:new", () => {
    leaked = true;
  });

  await emitWithAck(ownerSocket.socket, "message:send", {
    channel: firstChannel.id,
    content: "Ne doit pas fuiter.",
  });

  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(leaked, false, "aucune fuite entre salons");
});

test("les accusés de lecture visent le bon compte", async () => {
  const ownerAccount = await account("rt-read-owner");
  const readerAccount = await account("rt-read-reader");
  const created = await community(ownerAccount, { isPublic: false });

  await addMember(created.id, ownerAccount, readerAccount, ROLES.MEMBER);

  const textChannel = await channel(ownerAccount.token, created.id, {
    name: "lecture",
    type: "text",
  });

  const readerSocket = await openSocket(readerAccount.token);
  await emitWithAck(readerSocket.socket, "channel:subscribe", {
    channel: textChannel.id,
  });

  const sent = await emitWithAck(readerSocket.socket, "message:send", {
    channel: textChannel.id,
    content: "À lire.",
  });

  const read = await emitWithAck(readerSocket.socket, "message:read", {
    channel: textChannel.id,
    messageId: sent.message.id,
  });

  assert.equal(read.success, true);

  const correct = await queryOne(
    "SELECT * FROM message_reads WHERE message_id = ? AND user_id = ?",
    [sent.message.id, readerAccount.id]
  );
  const wrong = await queryOne(
    "SELECT * FROM message_reads WHERE message_id = ? AND user_id = ?",
    [sent.message.id, ownerAccount.id]
  );

  assert.ok(correct, "l'accusé doit appartenir au lecteur");
  assert.equal(wrong, null);
});

test("les indicateurs de frappe utilisent le pseudo du compte", async () => {
  const ownerAccount = await account("rt-typing-owner");
  const peerAccount = await account("rt-typing-peer");
  const created = await community(ownerAccount, { isPublic: false });

  await addMember(created.id, ownerAccount, peerAccount, ROLES.MEMBER);

  const textChannel = await channel(ownerAccount.token, created.id, {
    name: "frappe",
    type: "text",
  });

  const ownerSocket = await openSocket(ownerAccount.token);
  const peerSocket = await openSocket(peerAccount.token);

  await emitWithAck(ownerSocket.socket, "channel:subscribe", {
    channel: textChannel.id,
  });
  await emitWithAck(peerSocket.socket, "channel:subscribe", {
    channel: textChannel.id,
  });

  const typing = waitFor(peerSocket.socket, "typing:update");

  ownerSocket.socket.emit("typing:start", { channelId: textChannel.id });

  const payload = await typing;

  assert.equal(payload.userName, ownerAccount.name);
  assert.notEqual(payload.userName, "Utilisateur");
  assert.equal(payload.userId, ownerAccount.id);
});

// -----------------------------------------------------------------------------
// Reconnexion : le bug central
// -----------------------------------------------------------------------------

test("une reconnexion ne duplique pas les messages et conserve les droits", async () => {
  const ownerAccount = await account("rt-reconnect");
  const created = await community(ownerAccount, { isPublic: false });

  const textChannel = await channel(ownerAccount.token, created.id, {
    name: "reconnexion",
    type: "text",
  });

  const firstConnection = await openSocket(ownerAccount.token);

  await emitWithAck(firstConnection.socket, "channel:subscribe", {
    channel: textChannel.id,
  });

  const total = 3;

  for (let index = 1; index <= total; index += 1) {
    const ack = await emitWithAck(firstConnection.socket, "message:send", {
      channel: textChannel.id,
      content: `Message ${index}`,
    });

    assert.equal(ack.success, true);
  }

  assert.equal(
    await countRows("messages", "channel_id = ?", [textChannel.id]),
    total,
    "un message envoyé = une ligne en base"
  );

  // Coupure puis reconnexion : nouvel identifiant de socket, même compte.
  const oldSocketId = firstConnection.socket.id;
  firstConnection.socket.close();

  await new Promise((resolve) => setTimeout(resolve, 150));

  const secondConnection = await openSocket(ownerAccount.token);

  assert.notEqual(secondConnection.socket.id, oldSocketId);

  // Les droits survivent : c'est l'appartenance par COMPTE qui compte.
  const resubscribe = await emitWithAck(secondConnection.socket, "channel:subscribe", {
    channel: textChannel.id,
  });

  assert.equal(
    resubscribe.success,
    true,
    "l'abonnement doit fonctionner après reconnexion"
  );

  // L'historique est renvoyé une seule fois, sans doublon.
  const history = await emitWithAck(secondConnection.socket, "message:history", {
    channel: textChannel.id,
  });

  assert.equal(history.success, true);
  assert.equal(
    history.messages.length,
    total,
    "aucun message dupliqué à la reconnexion"
  );

  const contents = history.messages.map((message) => message.content);
  assert.deepEqual(contents, ["Message 1", "Message 2", "Message 3"]);

  const ids = history.messages.map((message) => message.id);
  assert.equal(new Set(ids).size, ids.length, "les identifiants sont uniques");

  assert.equal(
    await countRows("messages", "channel_id = ?", [textChannel.id]),
    total,
    "la reconnexion n'écrit rien en base"
  );

  // Et l'envoi fonctionne toujours après reconnexion.
  const afterReconnect = await emitWithAck(secondConnection.socket, "message:send", {
    channel: textChannel.id,
    content: "Message après reconnexion",
  });

  assert.equal(afterReconnect.success, true);
  assert.equal(
    await countRows("messages", "channel_id = ?", [textChannel.id]),
    total + 1
  );

  // L'événement `session:resume` renvoie l'état attendu.
  const resumed = await emitWithAck(secondConnection.socket, "session:resume", {});

  assert.equal(resumed.success, true);
  assert.equal(resumed.user.id, ownerAccount.id);
  assert.ok(resumed.communityIds.includes(created.id));
  assert.ok(
    resumed.channelIds.includes(textChannel.id),
    "session:resume doit rappeler les salons réellement abonnés"
  );
});

// -----------------------------------------------------------------------------
// Contrôle d'accès par socket
// -----------------------------------------------------------------------------

test("un socket ne peut pas s'abonner à un salon privé sans autorisation", async () => {
  const ownerAccount = await account("rt-private-owner");
  const memberAccount = await account("rt-private-member");
  const created = await community(ownerAccount, { isPublic: false });

  await addMember(created.id, ownerAccount, memberAccount, ROLES.MEMBER);

  const privateChannel = await channel(ownerAccount.token, created.id, {
    name: "prive",
    type: "text",
    isPrivate: true,
  });

  const memberSocket = await openSocket(memberAccount.token);

  const denied = emitWithAck(memberSocket.socket, "channel:subscribe", {
    channel: privateChannel.id,
  });

  const forbidden = waitFor(memberSocket.socket, "channel:forbidden");

  const ack = await denied;

  assert.equal(ack.success, false);
  assert.equal(ack.code, "channel_forbidden");
  assert.equal((await forbidden).code, "channel_forbidden");

  // Envoi direct également refusé, même sans abonnement préalable.
  const send = await emitWithAck(memberSocket.socket, "message:send", {
    channel: privateChannel.id,
    content: "intrusion",
  });

  assert.equal(send.success, false);
  assert.equal(
    await countRows("messages", "channel_id = ?", [privateChannel.id]),
    0
  );

  // Après autorisation explicite, l'accès fonctionne.
  await api(`/api/channels/${privateChannel.id}/members`, {
    method: "POST",
    token: ownerAccount.token,
    body: { userId: memberAccount.id },
  });

  const allowed = await emitWithAck(memberSocket.socket, "channel:subscribe", {
    channel: privateChannel.id,
  });

  assert.equal(allowed.success, true);
});

test("un socket sans droit d'écriture est refusé côté serveur", async () => {
  const ownerAccount = await account("rt-noright-owner");
  const created = await community(ownerAccount, { isPublic: false });

  // Salon d'annonces : un simple membre ne peut pas y publier.
  const announcement = await channel(ownerAccount.token, created.id, {
    name: "annonces-test",
    type: "announcement",
  });

  const memberAccount = await account("rt-noright-member");
  await addMember(created.id, ownerAccount, memberAccount, ROLES.MEMBER);

  const memberSocket = await openSocket(memberAccount.token);

  const denied = await emitWithAck(memberSocket.socket, "message:send", {
    channel: announcement.id,
    content: "Je ne devrais pas pouvoir publier.",
  });

  assert.equal(denied.success, false);
  assert.equal(denied.code, "missing_permission");
  assert.equal(
    await countRows("messages", "channel_id = ?", [announcement.id]),
    0
  );

  // Le propriétaire, lui, publie.
  const ownerSocket = await openSocket(ownerAccount.token);

  const allowed = await emitWithAck(ownerSocket.socket, "message:send", {
    channel: announcement.id,
    content: "Annonce officielle.",
  });

  assert.equal(allowed.success, true);
});

// -----------------------------------------------------------------------------
// Salons historiques (ancien protocole) et tableau blanc
// -----------------------------------------------------------------------------

test("un salon historique se crée en base, exige son code et restaure son tableau", async () => {
  const creator = await account("rt-legacy-creator");
  const visitor = await account("rt-legacy-visitor");

  const creatorSocket = await openSocket(creator.token);

  const success = waitFor(creatorSocket.socket, "room-success");

  creatorSocket.socket.emit("create-room", {
    name: "Salon Historique Test",
    password: "code-secret-42",
  });

  await success;

  const row = await queryOne(
    "SELECT * FROM channels WHERE name = ? ORDER BY id DESC LIMIT 1",
    ["Salon Historique Test"]
  );

  assert.ok(row, "le salon doit être persisté en base");
  assert.equal(row.access_code, "code-secret-42");
  assert.equal(Number(row.creator_id), creator.id);

  const roomsList = waitFor(creatorSocket.socket, "rooms-list");
  creatorSocket.socket.emit("get-rooms");

  const rooms = await roomsList;

  assert.ok(
    rooms.some((room) => room.channelId === Number(row.id)),
    "le salon doit apparaître dans la liste"
  );

  // Mauvais code → refus.
  const visitorSocket = await openSocket(visitor.token);

  const wrongCode = await emitWithAck(visitorSocket.socket, "join-room", {
    roomId: String(row.id),
    accessCode: "mauvais-code",
  });

  assert.equal(wrongCode.success, false);
  assert.equal(
    wrongCode.code,
    "access_code_invalid",
    "un code erroné doit être distingué d'un salon réellement privé"
  );

  // Code correct → autorisation durable en base.
  const goodCode = await emitWithAck(visitorSocket.socket, "join-room", {
    roomId: String(row.id),
    accessCode: "code-secret-42",
  });

  assert.equal(goodCode.success, true);

  const explicitAccess = await queryOne(
    "SELECT * FROM channel_members WHERE channel_id = ? AND user_id = ?",
    [row.id, visitor.id]
  );

  assert.ok(
    explicitAccess,
    "valider le code doit créer un accès durable (et non dépendre du socket)"
  );

  // Écriture d'un tableau blanc au format historique.
  const canvas = {
    version: "6.7.0",
    objects: [{ type: "circle", left: 5, top: 5, radius: 25 }],
  };

  const saved = await emitWithAck(creatorSocket.socket, "canvas-update", {
    roomId: String(row.id),
    data: canvas,
  });

  assert.equal(saved.success, true);

  const boardRow = await queryOne(
    "SELECT * FROM board_states WHERE channel_id = ?",
    [row.id]
  );

  assert.ok(boardRow, "le tableau doit être persisté");

  // Un nouveau participant reçoit le tableau restauré en rejoignant.
  const latecomer = await account("rt-legacy-late");
  const lateSocket = await openSocket(latecomer.token);

  const restored = waitFor(lateSocket.socket, "canvas-update");

  const joined = await emitWithAck(lateSocket.socket, "join-room", {
    roomId: String(row.id),
    accessCode: "code-secret-42",
  });

  assert.equal(joined.success, true);

  const restoredCanvas = await restored;

  assert.deepEqual(restoredCanvas.objects, canvas.objects);
});

test("les messages historiques sont persistés et relus une seule fois", async () => {
  const user = await account("rt-legacy-messages");
  const created = await community(user, { isPublic: false });

  const textChannel = await channel(user.token, created.id, {
    name: "historique-legacy",
    type: "text",
  });

  const { socket } = await openSocket(user.token);

  await emitWithAck(socket, "join-room", { roomId: String(textChannel.id) });

  const ack = await emitWithAck(socket, "send-message", {
    roomId: String(textChannel.id),
    message: "Bonjour depuis l'ancien client.",
    userName: "Faux Nom",
    senderId: "socket-id-bidon",
  });

  assert.equal(ack.success, true);

  const row = await queryOne("SELECT * FROM messages WHERE id = ?", [ack.id]);

  assert.equal(Number(row.author_id), user.id, "l'auteur doit être le compte");
  assert.equal(row.content, "Bonjour depuis l'ancien client.");

  const received = waitFor(socket, "receive-message");
  const history = waitFor(socket, "chat-history");

  socket.emit("get-chat-history", String(textChannel.id));

  const message = await received.catch(() => null);
  const list = await history;

  const stored = list.filter((item) => item.id === String(row.id));

  assert.equal(stored.length, 1, "aucun doublon dans l'historique");
  assert.equal(stored[0].userName, user.name);
  assert.equal(stored[0].senderId, user.id);

  if (message) {
    assert.equal(message.userName, user.name);
  }
});

test("un accès à un salon privé est refusé par identifiant deviné", async () => {
  const ownerAccount = await account("rt-guess-owner");
  const outsider = await account("rt-guess-outsider");
  const created = await community(ownerAccount, { isPublic: false });

  const privateChannel = await channel(ownerAccount.token, created.id, {
    name: "devine",
    type: "text",
    isPrivate: true,
  });

  const outsiderSocket = await openSocket(outsider.token);

  const denied = await emitWithAck(outsiderSocket.socket, "channel:subscribe", {
    channel: privateChannel.id,
  });

  assert.equal(denied.success, false);
  assert.equal(denied.code, "channel_forbidden");

  const history = await emitWithAck(outsiderSocket.socket, "message:history", {
    channel: privateChannel.id,
  });

  assert.equal(history.success, false);
});

// -----------------------------------------------------------------------------
// Vocal
// -----------------------------------------------------------------------------

test("le vocal refuse un salon non vocal et isole la signalisation", async () => {
  const ownerAccount = await account("rt-voice-owner");
  const guestAccount = await account("rt-voice-guest");
  const outsiderAccount = await account("rt-voice-outsider");

  const created = await community(ownerAccount, { isPublic: true });

  // Une communauté publique est consultable sans adhésion, mais participer
  // (donc entrer dans un salon vocal) exige d'en être membre.
  const guestJoinCommunity = await api(`/api/communities/${created.id}/join`, {
    method: "POST",
    token: guestAccount.token,
  });

  const outsiderJoinCommunity = await api(`/api/communities/${created.id}/join`, {
    method: "POST",
    token: outsiderAccount.token,
  });

  assert.equal(guestJoinCommunity.status, 200);
  assert.equal(outsiderJoinCommunity.status, 200);

  const voiceChannel = await channel(ownerAccount.token, created.id, {
    name: "salon-vocal-test",
    type: "voice",
  });

  const announcementChannel = await channel(ownerAccount.token, created.id, {
    name: "annonces-test",
    type: "announcement",
  });

  const textChannel = await channel(ownerAccount.token, created.id, {
    name: "salon-texte-test",
    type: "text",
  });

  const ownerSocket = await openSocket(ownerAccount.token);
  const guestSocket = await openSocket(guestAccount.token);
  const outsiderSocket = await openSocket(outsiderAccount.token);

  // Un salon d'annonces n'accueille pas de vocal : refusé.
  const wrongType = await emitWithAck(ownerSocket.socket, "voice:join", {
    channelId: announcementChannel.id,
  });

  assert.equal(wrongType.success, false);
  assert.equal(wrongType.code, "not_a_voice_channel");

  // Un salon de discussion historique reste utilisable pour le vocal (la
  // fonctionnalité existante est préservée).
  const textJoin = await emitWithAck(guestSocket.socket, "voice:join", {
    channelId: textChannel.id,
  });

  assert.equal(textJoin.success, true);

  await emitWithAck(guestSocket.socket, "voice:leave", {
    channelId: textChannel.id,
  });

  // Entrée dans le salon vocal.
  const ownerJoin = await emitWithAck(ownerSocket.socket, "voice:join", {
    channelId: voiceChannel.id,
  });

  assert.equal(ownerJoin.success, true);
  assert.equal(ownerJoin.participants.length, 1);
  assert.equal(ownerJoin.participants[0].userId, ownerAccount.id);

  const guestJoin = await emitWithAck(guestSocket.socket, "voice:join", {
    channelId: voiceChannel.id,
  });

  assert.equal(guestJoin.success, true);
  assert.equal(guestJoin.participants.length, 2);

  // Signalisation entre participants du même salon : autorisée.
  const relayed = emitWithAck(ownerSocket.socket, "voice-offer", {
    to: guestSocket.socket.id,
    offer: { type: "offer", sdp: "v=0" },
  });

  const receivedOffer = waitFor(guestSocket.socket, "voice-offer");

  assert.equal((await relayed).success, true);

  const offerPayload = await receivedOffer;

  // Format attendu par le composant vocal existant : { from, offer }.
  assert.equal(offerPayload.offer.sdp, "v=0");
  assert.equal(offerPayload.from, ownerSocket.socket.id);
  assert.equal(offerPayload.fromUserId, ownerAccount.id);

  // Signalisation vers un socket hors du salon vocal : refusée.
  const blocked = await emitWithAck(ownerSocket.socket, "voice-offer", {
    to: outsiderSocket.socket.id,
    offer: { type: "offer", sdp: "v=0" },
  });

  assert.equal(blocked.success, false);
  assert.equal(blocked.code, "peer_not_in_channel");

  // Signalisation vers un socket inexistant : refusée.
  const unknown = await emitWithAck(ownerSocket.socket, "voice-offer", {
    to: "socket-qui-nexiste-pas",
    offer: { type: "offer", sdp: "v=0" },
  });

  assert.equal(unknown.success, false);
  assert.equal(unknown.code, "peer_not_found");

  // Sortie : l'état est nettoyé.
  const leave = await emitWithAck(guestSocket.socket, "voice:leave", {
    channelId: voiceChannel.id,
  });

  assert.equal(leave.success, true);

  const state = await emitWithAck(ownerSocket.socket, "voice:state", {
    channelId: voiceChannel.id,
  });

  assert.equal(state.participants.length, 1);
});

test("un participant vocal est retiré quand sa dernière connexion se ferme", async () => {
  const firstUser = await account("rt-voice-cleanup-a");
  const secondUser = await account("rt-voice-cleanup-b");
  const created = await community(firstUser, { isPublic: true });

  await api(`/api/communities/${created.id}/join`, {
    method: "POST",
    token: secondUser.token,
  });

  const voiceChannel = await channel(firstUser.token, created.id, {
    name: "vocal-nettoyage",
    type: "voice",
  });

  const first = await openSocket(firstUser.token);
  const second = await openSocket(secondUser.token);

  await emitWithAck(first.socket, "voice:join", { channelId: voiceChannel.id });
  await emitWithAck(second.socket, "voice:join", { channelId: voiceChannel.id });

  const { voiceParticipantsOf } = require("../src/realtime/registry");

  assert.deepEqual(
    voiceParticipantsOf(voiceChannel.id)
      .map((participant) => participant.userId)
      .sort((a, b) => a - b),
    [firstUser.id, secondUser.id].sort((a, b) => a - b),
    "les deux comptes sont dans le salon"
  );

  // Fermeture de la connexion du premier compte : seul ce compte est retiré.
  first.socket.close();

  await new Promise((resolve) => setTimeout(resolve, 400));

  const remaining = voiceParticipantsOf(voiceChannel.id);

  assert.equal(remaining.length, 1, "aucun participant fantôme");
  assert.equal(remaining[0].userId, secondUser.id);

  // Deux onglets du même compte ne comptent que pour un participant.
  const secondTab = await openSocket(secondUser.token);

  await emitWithAck(secondTab.socket, "voice:join", { channelId: voiceChannel.id });

  assert.equal(voiceParticipantsOf(voiceChannel.id).length, 1, "une entrée par compte");

  // La dernière connexion se ferme : l'entrée vocale disparaît.
  second.socket.close();
  secondTab.socket.close();

  await new Promise((resolve) => setTimeout(resolve, 400));

  assert.equal(
    voiceParticipantsOf(voiceChannel.id).length,
    0,
    "plus aucune entrée fantôme après fermeture de toutes les connexions"
  );
});

test("un non-membre d'une communauté publique peut lire mais pas écrire", async () => {
  const ownerAccount = await account("rt-public-owner");
  const visitorAccount = await account("rt-public-visitor");
  const created = await community(ownerAccount, { isPublic: true });

  const textChannel = await channel(ownerAccount.token, created.id, {
    name: "lecture-publique",
    type: "text",
  });

  const ownerSocket = await openSocket(ownerAccount.token);

  await emitWithAck(ownerSocket.socket, "channel:subscribe", {
    channel: textChannel.id,
  });

  const seeded = await emitWithAck(ownerSocket.socket, "message:send", {
    channel: textChannel.id,
    content: "Message lisible publiquement.",
  });

  assert.equal(seeded.success, true);

  const visitorSocket = await openSocket(visitorAccount.token);

  // Lecture autorisée (aperçu d'une communauté publique).
  const subscribe = await emitWithAck(visitorSocket.socket, "channel:subscribe", {
    channel: textChannel.id,
  });

  assert.equal(subscribe.success, true);

  const history = await emitWithAck(visitorSocket.socket, "message:history", {
    channel: textChannel.id,
  });

  assert.equal(history.success, true);
  assert.equal(history.messages.length, 1);

  // Écriture refusée tant que le compte n'a pas rejoint la communauté.
  const denied = await emitWithAck(visitorSocket.socket, "message:send", {
    channel: textChannel.id,
    content: "Je ne suis pas membre.",
  });

  assert.equal(denied.success, false);
  assert.equal(denied.code, "not_a_member");

  assert.equal(
    await countRows("messages", "channel_id = ?", [textChannel.id]),
    1,
    "rien ne doit être écrit par un non-membre"
  );

  // Après adhésion, l'écriture passe.
  await api(`/api/communities/${created.id}/join`, {
    method: "POST",
    token: visitorAccount.token,
  });

  const allowed = await emitWithAck(visitorSocket.socket, "message:send", {
    channel: textChannel.id,
    content: "Maintenant je suis membre.",
  });

  assert.equal(allowed.success, true);
});
