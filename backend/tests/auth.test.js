/**
 * Authentification et persistance réelle des comptes.
 *
 * Ces tests vérifient ce qui était cassé auparavant : les comptes vivaient dans
 * un tableau en mémoire et disparaissaient au redémarrage. Ils sont désormais
 * lus et écrits dans MySQL, et le mot de passe n'est jamais stocké en clair.
 */
const test = require("node:test");
const { after, before } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");

const {
  startTestServer,
  stopTestServer,
  api,
  createAccount,
  uniqueSuffix,
  query,
  queryOne,
} = require("./helpers");

let ready = false;
const created = [];

before(async () => {
  await startTestServer();
  ready = true;
});

after(async () => {
  await stopTestServer();
});

test("l'inscription crée un compte persistant", async () => {
  assert.ok(ready);

  const suffix = uniqueSuffix();
  const email = `persist-${suffix}@devmeet.test`;

  const result = await api("/api/auth/register", {
    method: "POST",
    body: { name: "Compte Persistant", email, password: "MotDePasse!2026" },
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.user.email, email);
  assert.ok(result.body.user.id > 0);
  assert.equal(result.body.user.password, undefined);
  assert.equal(result.body.user.password_hash, undefined);

  created.push({ id: result.body.user.id });

  // Le compte existe réellement en base, et le mot de passe est haché.
  const row = await queryOne("SELECT * FROM users WHERE email = ?", [email]);

  assert.ok(row, "le compte doit exister dans MySQL");
  assert.notEqual(row.password_hash, "MotDePasse!2026");
  assert.ok(
    await bcrypt.compare("MotDePasse!2026", row.password_hash),
    "le hash doit correspondre au mot de passe fourni"
  );

  // L'inscription donne accès à la communauté historique.
  const membership = await queryOne(
    "SELECT * FROM community_members WHERE user_id = ? AND community_id = 1",
    [row.id]
  );

  assert.ok(membership, "le compte doit rejoindre la communauté historique");
});

test("une adresse email déjà utilisée est refusée", async () => {
  const account = await createAccount("duplicate");
  created.push(account);

  const again = await api("/api/auth/register", {
    method: "POST",
    body: {
      name: "Doublon",
      email: account.email,
      password: "MotDePasse!2026",
    },
  });

  assert.equal(again.status, 409);
  assert.equal(again.body.code, "email_taken");

  const rows = await query("SELECT id FROM users WHERE email = ?", [account.email]);
  assert.equal(rows.length, 1, "aucun doublon ne doit être créé");
});

test("un mot de passe trop court est refusé avant toute écriture", async () => {
  const email = `court-${uniqueSuffix()}@devmeet.test`;

  const result = await api("/api/auth/register", {
    method: "POST",
    body: { name: "Mot Court", email, password: "court" },
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.code, "invalid_password");

  const rows = await query("SELECT id FROM users WHERE email = ?", [email]);
  assert.equal(rows.length, 0, "aucun compte ne doit être créé");
});

test("une adresse email invalide est refusée", async () => {
  const result = await api("/api/auth/register", {
    method: "POST",
    body: { name: "Email Invalide", email: "pas-un-email", password: "MotDePasse!2026" },
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.code, "invalid_email");
});

test("la connexion renvoie un jeton utilisable", async () => {
  const account = await createAccount("connexion");
  created.push(account);

  assert.ok(account.token);

  const parts = account.token.split(".");
  assert.equal(parts.length, 3, "le jeton doit être un JWT");

  const me = await api("/api/auth/me", { token: account.token });

  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, account.id);
  assert.equal(me.body.user.email, account.email);
  assert.ok(Array.isArray(me.body.permissions));
});

test("un mauvais mot de passe et un compte inexistant donnent le même message", async () => {
  const account = await createAccount("echec");
  created.push(account);

  const wrongPassword = await api("/api/auth/login", {
    method: "POST",
    body: { email: account.email, password: "MauvaisMotDePasse!2026" },
  });

  const unknownUser = await api("/api/auth/login", {
    method: "POST",
    body: { email: `absent-${uniqueSuffix()}@devmeet.test`, password: "MotDePasse!2026" },
  });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownUser.status, 401);
  assert.equal(
    wrongPassword.body.message,
    unknownUser.body.message,
    "le message ne doit pas révéler l'existence du compte"
  );
});

test("les routes protégées refusent l'absence de jeton et les jetons invalides", async () => {
  const noToken = await api("/api/auth/me");
  assert.equal(noToken.status, 401);

  const badToken = await api("/api/auth/me", { token: "jeton.bidon.inexistant" });
  assert.equal(badToken.status, 401);

  const badHeader = await api("/api/communities", {
    token: "encore.plus.bidon",
  });
  assert.equal(badHeader.status, 401);
});

test("le profil modifié est immédiatement relu depuis la base", async () => {
  const account = await createAccount("profil");
  created.push(account);

  const updated = await api("/api/auth/me", {
    method: "PATCH",
    token: account.token,
    body: { name: "Nouveau Pseudonyme", bio: "Bio de test" },
  });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.user.name, "Nouveau Pseudonyme");

  // Le jeton n'a pas changé : c'est bien la base qui fait foi.
  const me = await api("/api/auth/me", { token: account.token });

  assert.equal(me.status, 200);
  assert.equal(me.body.user.name, "Nouveau Pseudonyme");
  assert.equal(me.body.user.bio, "Bio de test");

  const row = await queryOne("SELECT name, bio FROM users WHERE id = ?", [account.id]);
  assert.equal(row.name, "Nouveau Pseudonyme");
});

test("le thème BADASS gratuit est enregistré et relu", async () => {
  const account = await createAccount("theme");
  created.push(account);

  const updated = await api("/api/auth/me", {
    method: "PATCH",
    token: account.token,
    body: { theme: "badass" },
  });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.user.theme, "badass");

  // Le choix survit à une relecture depuis la base.
  const me = await api("/api/auth/me", { token: account.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.theme, "badass");

  // Les thèmes ajoutés au catalogue sont également acceptés.
  const dark = await api("/api/auth/me", {
    method: "PATCH",
    token: account.token,
    body: { theme: "discord-dark" },
  });
  assert.equal(dark.status, 200);
  assert.equal(dark.body.user.theme, "discord-dark");

  // Un identifiant inconnu reste refusé.
  const invalid = await api("/api/auth/me", {
    method: "PATCH",
    token: account.token,
    body: { theme: "ultra" },
  });
  assert.equal(invalid.status, 400);
});

test("les décorations de profil sont validées, persistées et visibles publiquement", async () => {
  const owner = await createAccount("deco-owner");
  const viewer = await createAccount("deco-viewer");
  created.push(owner, viewer);

  const decorations = {
    profileBackground: "cosmic-space",
    profileBanner: "cosmic-nebula",
    avatarFrame: "purple-neon",
    profileEffects: ["halo", "holographic"],
  };

  const updated = await api("/api/auth/me", {
    method: "PATCH",
    token: owner.token,
    body: decorations,
  });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.user.profileBackground, decorations.profileBackground);
  assert.equal(updated.body.user.profileBanner, decorations.profileBanner);
  assert.equal(updated.body.user.avatarFrame, decorations.avatarFrame);
  assert.deepEqual(updated.body.user.profileEffects, decorations.profileEffects);

  // Les valeurs sont réellement enregistrées, pas seulement renvoyées.
  const row = await queryOne(
    "SELECT profile_background, profile_banner, avatar_frame, profile_effects FROM users WHERE id = ?",
    [owner.id]
  );
  assert.equal(row.profile_background, decorations.profileBackground);
  assert.equal(row.avatar_frame, decorations.avatarFrame);

  // Un autre utilisateur voit les décorations sur le profil public.
  const publicProfile = await api(`/api/users/${owner.id}/profile`, {
    token: viewer.token,
  });

  assert.equal(publicProfile.status, 200);
  assert.equal(publicProfile.body.profile.name, owner.name);
  assert.equal(
    publicProfile.body.profile.profileBackground,
    decorations.profileBackground
  );
  assert.deepEqual(
    publicProfile.body.profile.profileEffects,
    decorations.profileEffects
  );
  assert.equal(publicProfile.body.profile.email, undefined);

  // Le profil public reste protégé par l'authentification.
  const anonymous = await api(`/api/users/${owner.id}/profile`);
  assert.equal(anonymous.status, 401);

  // Une valeur hors catalogue est refusée et n'écrase pas l'existant.
  const invalidBackground = await api("/api/auth/me", {
    method: "PATCH",
    token: owner.token,
    body: { profileBackground: "url-distante" },
  });
  assert.equal(invalidBackground.status, 400);
  assert.equal(invalidBackground.body.code, "invalid_profile_decoration");

  const invalidEffect = await api("/api/auth/me", {
    method: "PATCH",
    token: owner.token,
    body: { profileEffects: ["halo", "explosion"] },
  });
  assert.equal(invalidEffect.status, 400);
  assert.equal(invalidEffect.body.code, "invalid_profile_effects");

  // Une remise à zéro efface bien les quatre préférences.
  const reset = await api("/api/auth/me", {
    method: "PATCH",
    token: owner.token,
    body: {
      profileBackground: null,
      profileBanner: null,
      avatarFrame: null,
      profileEffects: [],
    },
  });

  assert.equal(reset.status, 200);
  assert.equal(reset.body.user.profileBackground, null);
  assert.equal(reset.body.user.profileBanner, null);
  assert.equal(reset.body.user.avatarFrame, null);
  assert.deepEqual(reset.body.user.profileEffects, []);
});

test("un compte supprimé perd immédiatement son accès", async () => {
  const account = await createAccount("supprime");

  const before = await api("/api/auth/me", { token: account.token });
  assert.equal(before.status, 200);

  await query("DELETE FROM users WHERE id = ?", [account.id]);

  const afterDeletion = await api("/api/auth/me", { token: account.token });

  assert.equal(afterDeletion.status, 401);
  assert.equal(afterDeletion.body.code, "user_not_found");
});

test("un mot de passe n'est jamais renvoyé par l'API", async () => {
  const account = await createAccount("secret");
  created.push(account);

  const me = await api("/api/auth/me", { token: account.token });
  const members = await api("/api/communities/1/members", { token: account.token });

  assert.equal(me.body.user.password_hash, undefined);
  assert.equal(me.body.user.password, undefined);
  assert.equal(JSON.stringify(members.body).includes("password_hash"), false);
  assert.equal(JSON.stringify(members.body).includes("$2"), false);
});

test("la déconnexion est acceptée et trace la dernière activité", async () => {
  const account = await createAccount("deconnexion");
  created.push(account);

  const result = await api("/api/auth/logout", {
    method: "POST",
    token: account.token,
  });

  assert.equal(result.status, 200);

  const row = await queryOne("SELECT last_seen_at FROM users WHERE id = ?", [
    account.id,
  ]);

  assert.ok(row.last_seen_at, "last_seen_at doit être renseigné");
});
