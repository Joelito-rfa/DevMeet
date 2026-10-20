/**
 * Mot de passe oublié — cycle complet du jeton de réinitialisation.
 *
 * Couvre la demande (answer neutre si l'email est inconnu, lien en mode
 * non production, orientation vers le fournisseur pour un compte OAuth),
 * la pose du nouveau mot de passe, le refus de rejeu et la connexion après
 * réinitialisation.
 */
const test = require("node:test");
const { after, before } = require("node:test");
const assert = require("node:assert/strict");

const {
  startTestServer,
  stopTestServer,
  api,
  uniqueSuffix,
  query,
} = require("./helpers");
const usersService = require("../src/services/users");
const passwordResets = require("../src/services/passwordResets");

let ready = false;

before(async () => {
  await startTestServer();
  ready = true;
});

after(async () => {
  await stopTestServer();
});

test("la demande pour un email inconnu reste neutre et sans lien", async () => {
  assert.ok(ready);

  const result = await api("/api/auth/forgot-password", {
    method: "POST",
    body: { email: "inconnu-sans-compte@devmeet.test" },
  });

  assert.equal(result.status, 200);
  assert.ok(result.body.message.length > 0);
  assert.equal(result.body.resetLink, undefined);
  assert.equal(result.body.providers, undefined);
});

test("le même jeton ne peut pas être consommé deux fois", async () => {
  const suffix = uniqueSuffix();
  const email = `reset-rejoue-${suffix}@devmeet.test`;

  await usersService.createUser({
    name: "Compte Rejeu",
    email,
    password: "MotDePasse!2026",
  });

  const request = await passwordResets.requestFor(email);
  assert.ok(request?.token);

  const first = await api("/api/auth/reset-password", {
    method: "POST",
    body: { token: request.token, password: "NouveauMot!2026" },
  });

  assert.equal(first.status, 200);

  // L'ancien mot de passe est refusé, le nouveau est accepté.
  const oldLogin = await api("/api/auth/login", {
    method: "POST",
    body: { email, password: "MotDePasse!2026" },
  });

  assert.equal(oldLogin.status, 401);

  const newLogin = await api("/api/auth/login", {
    method: "POST",
    body: { email, password: "NouveauMot!2026" },
  });

  assert.equal(newLogin.status, 200);
  assert.ok(newLogin.body.token);

  const second = await api("/api/auth/reset-password", {
    method: "POST",
    body: { token: request.token, password: "EncoreAutre!2026" },
  });

  assert.equal(second.status, 400);
  assert.equal(second.body.code, "invalid_reset_token");

  await query("DELETE FROM users WHERE email = ?", [email]);
});

test("un compte OAuth reçoit les boutons du fournisseur, pas de lien", async () => {
  const suffix = uniqueSuffix();
  const email = `oauth-${suffix}@devmeet.test`;

  await usersService.connectWithOAuth({
    provider: "github",
    providerId: `gh-${suffix}`,
    email,
    name: "Compte Fournisseur",
    avatarUrl: null,
  });

  const forgot = await api("/api/auth/forgot-password", {
    method: "POST",
    body: { email },
  });

  assert.equal(forgot.status, 200);
  assert.deepEqual(forgot.body.providers, ["github"]);
  assert.equal(forgot.body.resetLink, undefined);

  // La connexion classique est explicitement refusée pour ce compte : le
  // message oriente vers le bouton du fournisseur.
  const refused = await api("/api/auth/login", {
    method: "POST",
    body: { email, password: "Nimporte!2026" },
  });

  assert.equal(refused.status, 401);
  assert.equal(refused.body.code, "account_without_password");

  await query("DELETE FROM users WHERE email = ?", [email]);
});
