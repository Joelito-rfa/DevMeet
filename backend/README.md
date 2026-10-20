# DevMeet 2.0 — API

API REST + temps réel (Socket.IO) de DevMeet 2.0, avec **persistance MySQL réelle**.

Tout ce qui est décrit ici est utilisable tel quel : les comptes, communautés,
catégories, salons, messages, invitations, rôles et permissions sont enregistrés
en base et relus après redémarrage du serveur.

---

## 1. Prérequis

- **Node.js** 20 ou plus (testé avec Node 24).
- **MySQL 8** (testé avec MySQL 8.4.3 fourni par Laragon).

Aucun serveur MySQL n'est installé comme service Windows dans cet
environnement : il est lancé à la demande (voir ci-dessous).

---

## 2. Démarrage de MySQL

Base et utilisateur applicatif (voir `.env`) :

| Élément | Valeur par défaut |
| --- | --- |
| Hôte / port | `127.0.0.1:3306` |
| Base | `devmeet_db` |
| Utilisateur applicatif | `devmeet_user` (droits limités à `devmeet_db`) |

### Lancer le serveur MySQL (PowerShell)

```powershell
& 'C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysqld.exe' `
  --datadir='C:\laragon\data\mysql' `
  --port=3306 `
  --bind-address=127.0.0.1
```

Le laisser tourner dans sa propre fenêtre (ou comme tâche de fond). Pour
l'arrêter, fermez la fenêtre ou :

```powershell
& 'C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysqladmin.exe' -u root -h 127.0.0.1 -P 3306 shutdown
```

> L'API ne se connecte **jamais** en `root` : `root` ne sert qu'à la création
> initiale de la base et de l'utilisateur applicatif.

---

## 3. Installation

```bash
cd backend
npm install
```

Créez le fichier d'environnement :

```bash
cp .env.example .env      # puis adaptez les valeurs
```

### Créer la base et l'utilisateur (une seule fois)

```bash
npm run db:create
```

Variables reconnues par ce script : `DB_ROOT_USER` (défaut `root`),
`DB_ROOT_PASSWORD` (défaut vide). Il crée `devmeet_db` si besoin, crée
`devmeet_user` et lui accorde des droits **sur cette base uniquement**. Il ne
supprime rien et ne touche à aucune autre base.

### Appliquer les migrations

```bash
npm run db:migrate      # ou automatiquement au démarrage hors production
npm run db:status       # état des migrations et nombre de lignes par table
```

### Jeu de démonstration (facultatif)

```bash
npm run seed:demo
```

Crée la communauté « Démo DevMeet » avec les quatre rôles, des catégories et des
salons de chaque type. Idempotent : relancer le script ne fait rien si la
communauté existe déjà. Comptes créés (mot de passe commun `DevMeet!2026`) :

| Compte | Rôle |
| --- | --- |
| `proprietaire@devmeet.test` | Propriétaire |
| `admin@devmeet.test` | Administrateur |
| `moderateur@devmeet.test` | Modérateur |
| `membre@devmeet.test` | Membre |

---

## 4. Lancement

```bash
npm run dev     # développement (nodemon, redémarrage automatique)
npm start       # production / exécution simple
```

Vérification :

```bash
curl http://localhost:3000/api/health
# {"status":"ok","service":"devmeet-api","version":"2.0.0"}
```

`server.js` est un **bootstrap** : il charge la configuration, teste la
connexion MySQL (échec immédiat si la base est injoignable), applique les
migrations hors production, démarre le serveur HTTP + Socket.IO, puis gère
l'arrêt propre (`SIGINT` / `SIGTERM` : fermeture du pool MySQL et des sockets).
La composition HTTP est dans `src/app.js` (`createApp` / `createHttpServer`), ce
qui permet aux tests d'écouter sur un port libre.

---

## 5. Variables d'environnement

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `production` ou `test` |
| `PORT` | `3000` | Port HTTP et Socket.IO |
| `CLIENT_URL` | `http://localhost:5173` | Origine autorisée (CORS) et préfixe des liens d'invitation |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` | Serveur MySQL |
| `DB_USER` / `DB_PASSWORD` | `devmeet_user` / — | Compte applicatif (jamais `root`) |
| `DB_NAME` | `devmeet_db` | Base utilisée |
| `DB_CONNECTION_LIMIT` | `10` | Taille du pool |
| `JWT_SECRET` | — (**obligatoire**) | Clé de signature des jetons |
| `JWT_EXPIRES_IN` | `1h` | Durée de validité des jetons |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `600000` | Fenêtre de limitation (routes d'auth) |
| `AUTH_RATE_LIMIT_MAX` | `30` | Requêtes autorisées par fenêtre |
| `UPLOAD_DIR` | `uploads` | Dossier des pièces jointes (créé au démarrage, ignoré par git) |
| `MAX_UPLOAD_SIZE_MB` | `10` | Taille maximale d'un fichier envoyé |
| `SYSTEM_COMMUNITY_ID` | `1` | Communauté technique des salons historiques |

`JWT_SECRET` manquant = démarrage refusé avec un message explicite.
`NODE_ENV=test` désactive automatiquement la limitation de débit.

Générer une clé :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 6. Migrations

Fichiers SQL versionnés dans `src/migrations/`, appliqués par `src/db/migrate.js`
et tracés dans la table `schema_migrations` (nom, date d'application).

| Fichier | Contenu |
| --- | --- |
| `001_init.sql` | 16 tables : `users`, `communities`, `community_members`, `categories`, `channels`, `channel_members`, `messages`, `message_reads`, `channel_read_states`, `attachments`, `invitations`, `notifications`, `board_states`, `dm_conversations`, `dm_messages` |
| `002_system_seed.sql` | Communauté technique « DevMeet » (`is_system = 1`, `owner_id` NULL) et salon `general` (`legacy_room_id = 'general'`) qui hébergent les salons créés par l'ancien protocole |
| `003_default_category.sql` | Catégorie « GÉNÉRAL » pour les communautés qui ont des salons sans catégorie (dont la communauté technique) et rattachement de ces salons — aucune ligne supprimée, aucun salon déjà rangé déplacé |
| `004_chat_features.sql` | Messagerie avancée : `message_reactions` (une réaction par compte et par emoji), `message_pins` (clé primaire = `message_id`), `message_mentions` (clé primaire = message + compte). Uniquement des `CREATE TABLE IF NOT EXISTS` : aucune colonne de `messages` n'est modifiée (les fils utilisent `reply_to_id`, déjà présent depuis `001_init.sql`) |
| `005_dm_read_states.sql` | Suivi de lecture des messages privés : `dm_read_states` (`conversation_id` + `user_id` → `last_read_message_id`), qui rend possible un compteur de non-lus **réel** et l'accusé de lecture du partenaire. `CREATE TABLE IF NOT EXISTS` uniquement : aucune donnée `dm_*` existante n'est touchée |
| `006_oauth_users.sql` | Connexion Google / GitHub : `password_hash` devient nullable et `users` reçoit `oauth_provider` + `oauth_provider_id` (clé unique sur le couple — les comptes « habituels » restent libres, leurs deux colonnes étant NULL) |
| `007_password_resets.sql` | Mot de passe oublié : `password_reset_tokens` (empreinte SHA-256 du jeton, jamais le jeton lui-même), avec expiration, usage unique (`used_at`) et suppression en cascade avec le compte |

Règles tenues :

- **non destructif** : uniquement des `CREATE TABLE IF NOT EXISTS` / `INSERT … ON DUPLICATE KEY UPDATE` ;
- **idempotent** : relancer `npm run db:migrate` ne modifie rien ;
- **sans risque en production** : l'auto-migration au démarrage n'a lieu qu'hors
  `NODE_ENV=production` ; en production, lancez `npm run db:migrate` explicitement.

---

## 7. Rôles et permissions

Source de vérité unique : `src/permissions.js`, utilisée par le REST **et** par
Socket.IO. Masquer un bouton dans React ne protège rien : chaque opération
sensible appelle `hasPermission()` côté serveur.

Rôles, du plus fort au plus faible : `owner` (Propriétaire), `admin`
(Administrateur), `moderator` (Modérateur), `member` (Membre).

| Permission | Propriétaire | Administrateur | Modérateur | Membre |
| --- | :-: | :-: | :-: | :-: |
| `community:manage` (supprimer la communauté) | ✅ | — | — | — |
| `community:update` | ✅ | ✅ | — | — |
| `category:manage` | ✅ | ✅ | — | — |
| `channel:manage` | ✅ | ✅ | — | — |
| `member:invite` | ✅ | ✅ | ✅ | — |
| `member:manage` | ✅ | ✅ | — | — |
| `message:moderate` (supprimer le message d'autrui) | ✅ | ✅ | ✅ | — |
| `message:send` | ✅ | ✅ | ✅ | ✅ |
| `message:react` (réagir à un message) | ✅ | ✅ | ✅ | ✅ |
| `message:pin` (épingler / détacher) | ✅ | ✅ | ✅ | — |
| `voice:join` | ✅ | ✅ | ✅ | ✅ |
| `announcement:publish` | ✅ | ✅ | — | — |
| `board:access` | ✅ | ✅ | ✅ | ✅ |

Règles de rang :

- on n'agit que sur un rôle **strictement inférieur** au sien
  (`canManageRole`, `canAssignRole`) ;
- on n'attribue jamais un rôle égal ou supérieur au sien ;
- le **propriétaire** ne peut être ni rétrogradé, ni exclu, ni dupliqué : il n'y
  a jamais deux propriétaires.

---

## 8. Accès aux salons

`src/services/channels.js#assertChannelAccess` est l'unique règle d'accès,
appliquée pour le REST et pour Socket.IO.

- **Membre de la communauté** : accès selon le type du salon.
- **Salon privé** : accessible uniquement sur autorisation explicite
  (une ligne `channel_members`).
- **Salon protégé par un code** : un code valide crée une ligne
  `channel_members`, donc l'accès **persiste** après reconnexion. Deviner un
  identifiant de salon ne suffit pas. Deux voies, une seule règle partagée
  (`channelsService.unlock`) : `POST /api/channels/:id/unlock` ou l'événement
  historique `join-room`.
- **Communauté publique, non-membre** : aperçu en **lecture seule** — lecture et
  abonnement autorisés, écriture refusée avec le code `not_a_member`
  (« Rejoignez la communauté pour participer. »). Un seul compte est nécessaire :
  tout compte authentifié devient membre de la communauté technique « DevMeet »,
  ce qui préserve les salons historiques.

---

## 9. Surface HTTP

Toutes les routes sont préfixées par `/api`. Sauf mention contraire, un jeton
`Authorization: Bearer <token>` est exigé.

### Santé

| Méthode | Chemin | Description |
| --- | --- | --- |
| GET | `/health` | État du service |

### Authentification (`/api/auth`)

| Méthode | Chemin | Description |
| --- | --- | --- |
| POST | `/register` | Création de compte (`name`, `email`, `password`) |
| POST | `/login` | Connexion → `{ token, user }` |
| GET | `/me` | Profil du compte connecté |
| PATCH | `/me` | Mise à jour du profil |
| POST | `/logout` | Déconnexion (révocation de la présence temps réel) |
| POST | `/forgot-password` | Demande de réinitialisation (réponse neutre anti-énumération) |
| POST | `/reset-password` | Nouveau mot de passe à partir du jeton (usage unique) |
| GET | `/oauth/google` | Départ de la connexion Google (redirection vers le consentement) |
| GET | `/oauth/google/callback` | Retour Google → session → redirection `<CLIENT_URL>/oauth/callback` |
| GET | `/oauth/github` | Départ de la connexion GitHub (redirection vers le consentement) |
| GET | `/oauth/github/callback` | Retour GitHub → session → redirection `<CLIENT_URL>/oauth/callback` |

Les routes `register` et `login` sont limitées en débit.

#### Connexion Google / GitHub (OAuth 2.0)

Le flux est le classique « authorization code », entièrement géré par le
serveur (`src/routes/oauth.js`, échange de code via `fetch` natif — aucune
dépendance ajoutée) :

1. Les boutons « Google » / « GitHub » des écrans **Connexion** et
   **Inscription** pointent vers `/api/auth/oauth/:provider`.
2. Le serveur pose un état anti-CSRF en cookie `httpOnly` (`dm_oauth_state`)
   puis envoie la demande de consentement.
3. Le callback valide l'état, échange le code, récupère le profil
   (`email`, `name`, identifiant distant) puis :
   - relie le compte existant portant le même email ;
   - ou crée un compte **sans mot de passe** (`password_hash` devient
     nullable — migration `006_oauth_users.sql`).
4. La session est renvoyée au client sur `/oauth/callback#payload=…`
   (fragment : non journalisé, consommé et effacé par le navigateur). Le
   client vérifie le jeton via `/auth/me` avant d'ouvrir la session.

Les clés sont optionnelles : sans `GOOGLE_CLIENT_ID` / `GITHUB_CLIENT_ID`
(dans `backend/.env`), les boutons redirigent vers un message explicite et la
connexion email/mot de passe reste la façon normale d'entrer. Les URI de
redirection à déclarer chez Google et GitHub sont
`http://localhost:3000/api/auth/oauth/google/callback` et
`http://localhost:3000/api/auth/oauth/github/callback`.

Un compte OAuth sans mot de passe qui tente la connexion classique reçoit un
message l'invitant à repasser par le bouton du fournisseur.

#### Mot de passe oublié

- **Usage unique** : la table `password_reset_tokens` (migration
  `007_password_resets.sql`) ne conserve que l'empreinte SHA-256 du jeton —
  le jeton brut ne vit que dans le lien. Expire après 30 minutes ou un
  premier usage ; la clause `UPDATE … WHERE used_at IS NULL AND expires_at
  > NOW()` interdit toute double consommation.
- **Anti-énumération** : la réponse de `/forgot-password` est identique que
  l'email existe ou non.
- **Comptes Google/GitHub** : sans mot de passe à régénérer, la réponse liste
  `providers` — l'écran propose alors les boutons du fournisseur pour
  retrouver l'accès. Si l'utilisateur passe par la réinitialisation, ce mot
  de passe s'ajoute au compte (sans supprimer le lien OAuth) et la connexion
  email/mot de passe devient possible ; le serveur renvoie la session.
- **Mode local** : sans SMTP, le lien de réinitialisation est renvoyé dans la
  réponse (`resetLink`) hors production et affiché dans l'écran ; une fois un
  serveur d'email branché, la réponse redevient muette en production.

### Communautés (`/api/communities`)

| Méthode | Chemin | Permission | Description |
| --- | --- | --- | --- |
| GET | `/` | — | Communautés de l'utilisateur |
| GET | `/discover` | — | Communautés publiques dont l'utilisateur n'est pas membre ; `?search=` filtre par nom (casse et espaces superflus ignorés) |
| POST | `/` | — | Créer une communauté (l'auteur devient Propriétaire) ; la catégorie « GÉNÉRAL » et le salon `general` sont créés dans la même transaction |
| GET | `/:id` | lecture | Détail |
| PATCH | `/:id` | `community:update` | Renommer / modifier |
| DELETE | `/:id` | `community:manage` | Supprimer |
| POST | `/:id/join` | — | Rejoindre une communauté publique |
| POST | `/:id/leave` | — | Quitter (interdit au propriétaire) |
| GET | `/:id/members` | lecture | Membres et rôles |
| POST | `/:id/members` | `member:manage` | Ajouter un membre (`userId`, `role`) |
| PATCH | `/:id/members/:userId` | `member:manage` | Changer le rôle d'un membre existant |
| DELETE | `/:id/members/:userId` | `member:manage` | Exclure un membre |
| GET | `/:id/member-candidates` | — | Comptes à ajouter |
| GET | `/:id/messages/search` | lecture | Rechercher dans **tous les salons lisibles** par l'appelant (`?q=`, 2 à 120 caractères) |

### Catégories (`/api/communities/:communityId/categories`)

| Méthode | Chemin | Permission | Description |
| --- | --- | --- | --- |
| GET | `/` | lecture | Lister |
| POST | `/` | `category:manage` | Créer |
| PATCH | `/:categoryId` | `category:manage` | Renommer |
| PATCH | `/reorder` | `category:manage` | Réordonner (liste complète exigée) |
| DELETE | `/:categoryId` | `category:manage` | Supprimer — `strategy` **obligatoire** |

Suppression de catégorie : rien n'est supprimé silencieusement. `strategy=keep`
conserve les salons sans catégorie, `strategy=delete` supprime les salons **et**
leur contenu. Sans `strategy` : `400 strategy_required`. La réponse détaille le
sort de chaque salon (`kept_without_category` / `deleted`).

### Salons (`/api/communities/:communityId/channels` et `/api/channels`)

| Méthode | Chemin | Permission | Description |
| --- | --- | --- | --- |
| GET | `/communities/:id/channels` | lecture | Lister les salons |
| POST | `/communities/:id/channels` | `channel:manage` | Créer (`type` : `text`, `voice`, `announcement`, `board`) |
| GET | `/channels/:channelId` | accès salon | Détail (accepte aussi un identifiant historique) |
| PATCH | `/channels/:channelId` | `channel:manage` | Renommer / modifier |
| DELETE | `/channels/:channelId` | `channel:manage` | Supprimer |
| POST | `/channels/:channelId/move` | `channel:manage` | Changer de catégorie / position |
| GET | `/channels/:channelId/members` | accès salon | Autorisations d'accès |
| POST | `/channels/:channelId/members` | `channel:manage` | Autoriser un membre |
| DELETE | `/channels/:channelId/members/:userId` | `channel:manage` | Retirer une autorisation |
| POST | `/channels/:channelId/unlock` | — | Déverrouiller un salon protégé par son code d'accès (`{ accessCode }`) → autorisation **persistante** |

### Messages et lecture (`/api/channels/:channelId`)

| Méthode | Chemin | Permission | Description |
| --- | --- | --- | --- |
| GET | `/messages` | accès salon | Historique paginé |
| POST | `/messages` | `message:send` | Envoyer (`attachmentIds` pour rattacher des fichiers déjà déposés, `replyToId` pour répondre dans un fil) |
| DELETE | `/messages/:messageId` | auteur ou `message:moderate` | Supprimer |
| GET | `/messages/search` | accès salon | Rechercher dans ce salon (`?q=`, 2 à 120 caractères) |
| POST | `/messages/:messageId/reactions` | `message:react` | Ajouter une réaction (`{ emoji }`, liste blanche) |
| DELETE | `/messages/:messageId/reactions/:emoji` | `message:react` | Retirer **sa propre** réaction |
| GET | `/messages/:messageId/replies` | accès salon | Réponses du fil (`reply_to_id`) |
| GET | `/pins` | accès salon | Messages épinglés du salon |
| POST | `/messages/:messageId/pin` | `message:pin` | Épingler (idempotent) |
| DELETE | `/messages/:messageId/pin` | `message:pin` | Détacher |
| POST | `/read` | accès salon | Marquer comme lu (pour le compte connecté) |
| POST | `/attachments` | `message:send` | Déposer un fichier (`multipart/form-data`, champ `file`) → métadonnées renvoyées avec `isImage` |
| GET | `/attachments/:attachmentId` | accès salon | Télécharger le fichier (authentifié) |
| GET | `/board` | `board:access` | État du tableau blanc |
| PUT | `/board` | `board:access` | Enregistrer (`expectedVersion` → refus si version obsolète) |

L'auteur d'un message est **le compte authentifié** : le pseudo et
l'identifiant envoyés par le client sont ignorés. Le marquage « lu » est associé
au compte connecté, jamais au premier venu.

`GET /api/channels/:channelId` renvoie aussi `role` (rôle effectif de l'appelant
**dans ce salon**) et `permissions` (la liste qui en découle). L'interface s'en
sert uniquement pour ne pas proposer une action qui serait refusée : le serveur
revérifie chaque opération sensible.

### Messagerie avancée (réactions, épinglage, fils, mentions, recherche)

Ces fonctions sont servies par `src/services/reactions.js`,
`src/services/pins.js`, `src/services/mentions.js` et l'extension de
`src/services/messages.js`. L'historique d'un message est enrichi **en un nombre
fixe de requêtes groupées** (accusés de lecture, pièces jointes, réactions,
épinglage, mentions, compteurs de réponses) : il n'y a jamais une requête par
message affiché.

**Réactions.** L'emoji est validé contre une liste blanche
(`emoji_not_allowed` sinon) : il est affiché tel quel chez tous les
participants, un texte libre deviendrait un vecteur d'injection. La clé
`(message_id, user_id, emoji)` rend le rejeu sans effet ; la réponse contient
les réactions agrégées (`{ emoji, count, users }`) recalculées depuis la base.
Réagir à un message d'un **autre salon** renvoie `404 message_not_found`.

**Épinglage.** Un message est épinglé ou non (`message_pins.message_id` est clé
primaire), donc épingler deux fois n'est pas une erreur. Un message supprimé ne
peut pas être épinglé (`400 message_deleted`) et disparaît de la liste des
épinglés. L'épinglage exige `message:pin` (modérateur et au-dessus).

**Fils de discussion.** Aucune seconde table : un fil est l'ensemble des
messages dont `reply_to_id` désigne le message parent. Le parent expose
`replyCount` et `lastReplyAt`. Répondre à un message d'un **autre salon** est
refusé (`404`). `POST /messages` et l'événement `send-message` acceptent tous
deux `replyToId`.

**Mentions.** Le serveur ne croit jamais le client sur parole : il relit le texte
du message et le compare aux **noms réels des membres de la communauté**
(`src/utils/mentions.js`). Correspondance insensible à la casse et aux accents,
nom le plus long prioritaire (`@Jean Dupont` n'est pas tronqué en `@Jean`),
frontière de mot exigée (`@Jeanne` ne mentionne pas `Jean`). Une mention
d'`@inconnu` — ou d'un compte extérieur à la communauté — reste du texte : elle
ne crée ni `message_mentions`, ni notification. Les identifiants retenus sont
renvoyés dans `mentions` ; un compte n'est jamais notifié de sa propre mention.

**Recherche.** `LIKE` sur le contenu (`?q=`, 2 à 120 caractères), les caractères
`%` et `_` saisis par l'utilisateur sont neutralisés (ils ne se comportent pas
comme des jokers). Les salons concernés sont calculés par
`channelsService.listForUser` : un salon privé ou protégé par un code n'est
**jamais** fouillé pour quelqu'un qui n'y a pas accès — la recherche ne doit pas
devenir une fuite de contenu. Voir les limites au § 12.

### Modération

Supprimer un message exige d'en être **l'auteur**, ou de détenir
`message:moderate` (propriétaire, administrateur, modérateur). La suppression est
**logique** : la ligne reste, le contenu est vidé, l'auteur et la place du
message dans la conversation sont conservés. Les vues renvoient donc un marqueur
explicite (`deleted: true`, et `message: "Message supprimé"` sur le protocole
historique) plutôt qu'un vide ambigu.

Un message supprimé **ne réexpose plus sa pièce jointe** (les métadonnées restent
en base, le fichier reste sur le disque : rien n'est effacé en silence, mais plus
rien n'est servi au client).

Le chemin utilisé par l'interface est l'événement Socket.IO `message:delete`
(`{ channel, messageId }`) ; la route REST applique la même règle. Dans les deux
cas, tout le salon reçoit `message:deleted` avec le motif en cas de refus
(`not_author`).

### Pièces jointes

Les octets sont écrits sur le disque (`UPLOAD_DIR`), les métadonnées en base
(`attachments`). Le nom réel sur le disque (`storage_key`) est **aléatoire** et
n'est jamais renvoyé : le nom d'origine reste en base, mais ne sert jamais de
chemin (aucune traversée de répertoire possible). Le type MIME est vérifié
contre une liste blanche (images, PDF, texte, CSV, ZIP, documents bureautiques) ;
l'extension sur le disque est déduite du type MIME, jamais du nom fourni.

Le rattachement à un message n'est possible que si la pièce jointe a été déposée
**dans le même salon** et **par l'auteur du message**, et qu'elle n'est pas déjà
rattachée. Un compte ne peut donc pas s'approprier le fichier d'un autre.

La route de téléchargement est authentifiée et vérifie l'accès au salon : un
`<img src>` ne peut pas porter l'en-tête `Authorization`, c'est pourquoi
l'interface récupère le fichier en `fetch` puis en crée une URL locale. Le
serveur envoie `Content-Disposition: attachment`, ce qui n'exécute jamais un
fichier déposé dans le contexte de l'application.

### Invitations (`/api/communities/:communityId/invitations`)

| Méthode | Chemin | Permission | Description |
| --- | --- | --- | --- |
| POST | `/` | `member:invite` | Créer (`expiresInHours`, `maxUses`) et obtenir l'URL |
| DELETE | `/:invitationId` | `member:invite` | Révoquer |
| GET | `/:invitationId/qrcode` | `member:invite` | QR code PNG (data-URL, généré localement) |

### Invitations publiques (`/api/invitations`)

| Méthode | Chemin | Description |
| --- | --- | --- |
| GET | `/:code` | Aperçu de la communauté (sans compte) |
| POST | `/:code/accept` | Rejoindre (compte requis → `401 auth_required` sinon) |

### Notifications (`/api/notifications`)

| Méthode | Chemin | Description |
| --- | --- | --- |
| GET | `/` | Lister (avec `unreadCount`) |
| GET | `/unread-count` | Nombre de non-lues |
| POST | `/read-all` | Tout marquer comme lu |
| POST | `/:notificationId/read` | Marquer comme lue |
| DELETE | `/:notificationId` | Supprimer |

Elles sont **réellement créées** par les actions de l'application, jamais
simulées : ajout d'un membre, changement de rôle, arrivée d'un nouveau membre
(invitation ou adhésion), création d'un salon, création d'une invitation. La
ligne est écrite en base (elle survit donc à la déconnexion) **et** poussée au
compte concerné par l'événement `notification:new`. L'auteur d'une action n'est
jamais notifié de sa propre action.

`PATCH /api/auth/me` accepte `name`, `bio`, `avatarUrl`, `theme`, `status`.
`theme` et `status` sont validés contre des listes fermées
(`invalid_theme`, `invalid_status`) : le statut est affiché aux autres membres,
il ne peut donc pas être un texte libre.

### Messages privés (`/api/dms`)

| Méthode | Chemin | Description |
| --- | --- | --- |
| GET | `/` | Mes conversations, la plus récemment active en tête (participant, dernier message, non-lus, dernière lecture de chacun) |
| GET | `/unread-count` | Total des messages privés non lus (badge de navigation) |
| GET | `/candidates` | Contacts proposés (comptes d'une communauté partagée, `?search=`), jamais un annuaire global |
| POST | `/` | Ouvrir la conversation avec `{ userId }` — `201` si elle est créée, `200` si elle existait déjà |
| GET | `/:conversationId/messages` | Historique paginé (`?limit=`, `?before=`) |
| POST | `/:conversationId/messages` | Écrire `{ content }` |
| POST | `/:conversationId/read` | Marquer comme lu (`{ messageId }`, dernier message si absent) |
| DELETE | `/:conversationId/messages/:messageId` | Supprimer **son** message (suppression logique) |

Règles appliquées côté serveur :

- **Une seule conversation par paire de comptes.** La paire est ordonnée
  (`user_a_id` < `user_b_id`) pour respecter la clé unique `uq_dm_pair` : A→B et
  B→A désignent la même ligne. Deux créations simultanées sont départagées par la
  clé unique, sans erreur pour l'utilisateur.
- **Seuls les deux participants.** Un tiers reçoit le même `404
  conversation_not_found` qu'une conversation inexistante : il ne peut pas sonder
  l'existence d'une discussion privée entre deux autres personnes, ni en lire, ni
  y écrire, ni y supprimer quoi que ce soit.
- **Aucune modération extérieure.** Un message privé ne relève d'aucune
  communauté : même un propriétaire de communauté ne peut pas supprimer le
  message d'un autre. Seul l'auteur supprime (sinon `403 not_author`).
- **Non-lus réels** : comptés depuis `dm_read_states`, jamais ses propres
  messages. `partnerLastReadMessageId` expose la position de lecture de l'autre
  participant, ce qui permet l'accusé de lecture « Lu » sur le bon message.
- **Diffusion ciblée** : `dm:new`, `dm:deleted` et `dm:read` sont émis vers les
  chambres personnelles `user:<id>` des deux participants. Aucun salon n'est
  utilisé, donc aucun risque de fuite vers un non-participant.
- Ouvrir une conversation avec soi-même → `400 self_conversation` ; compte visé
  inexistant → `404 user_not_found` ; message vide → `400 invalid_field`.

### Codes d'erreur utiles

`400` entrée invalide · `400 strategy_required` suppression de catégorie non
tranchée · `400 invalid_order` liste de réordonnancement incomplète ·
`400 invalid_status` / `400 invalid_theme` profil hors liste ·
`400 file_type_not_allowed` / `400 file_too_large` dépôt de fichier refusé ·
`400 emoji_not_allowed` réaction hors liste blanche ·
`400 message_deleted` action sur un message supprimé ·
`401 auth_required` jeton absent ou invalide · `403 missing_permission`
rôle insuffisant · `403 not_a_member` écriture par un non-membre ·
`403 access_code_required` / `403 access_code_invalid` déverrouillage de salon ·
`404 channel_not_found` · `404 attachment_not_found` ·
`404 message_not_found` (message d'un autre salon, ou inexistant) ·
`409 channel_name_taken` · `429` limitation de débit.
Les codes propres au temps réel (`not_a_voice_channel`, `peer_not_in_channel`,
`not_a_member`) sont renvoyés dans l'acquittement des événements Socket.IO.

---

## 10. Temps réel (Socket.IO)

Authentification désactivée par défaut : le client doit appeler
`connectSocket(token)`, le jeton étant passé dans `handshake.auth.token`
(équivalent : `Authorization: Bearer <token>`).

### Protocole actuel

Événements écoutés par le serveur (client → serveur) :

| Événement | Rôle |
| --- | --- |
| `session:resume(payload, ack)` | Recalculer les chambres et renvoyer l'état à jour |
| `presence:ping` | Battement de présence (`presence:pong` en retour) |
| `channel:subscribe` / `channel:unsubscribe` | S'abonner / se désabonner d'un salon |
| `message:send`, `message:history`, `message:read`, `message:delete` | Messages |
| `typing:start` / `typing:stop` | Indicateur de saisie |
| `voice:join`, `voice:leave`, `voice:mute`, `voice:state` | Vocal |
| `voice-offer`, `voice-answer`, `voice-ice` | Signalisation WebRTC (relayée au pair ciblé) |
| `board:update`, `board:fetch` | Tableau blanc |

Événements émis par le serveur (serveur → client) :

| Famille | Événements |
| --- | --- |
| Session | `session:ready`, `session:resumed`, `socket:error`, `presence:pong` |
| Présence | `presence:update`, `room-members`, `room-participants` |
| Communautés | `community:created`, `community:updated`, `community:deleted`, `community:member:joined`, `community:member:left`, `community:member:added`, `community:member:updated`, `community:member:removed`, `community:invited` |
| Catégories | `category:created`, `category:updated`, `category:deleted`, `category:reordered`, `channel:list` |
| Salons | `channel:created`, `channel:updated`, `channel:deleted`, `channel:moved`, `channel:reordered`, `channel:access:granted`, `channel:access:revoked`, `channel:forbidden` |
| Messages | `message:new`, `message:history`, `message:read`, `message:deleted`, `message:reaction`, `message:pinned`, `message:unpinned`, `typing:update`, `typing:stop` |
| Vocal | `voice:user-joined`, `voice:user-left`, `voice:mute`, `voice-offer`, `voice-answer`, `voice-ice` |
| Tableau blanc | `board:state`, `board:update`, `board:conflict` |
| Invitations | `invite:created`, `invite:revoked` |
| Messages privés | `dm:new`, `dm:deleted`, `dm:read` (chambres `user:<id>` des **deux participants uniquement**) |
| Notifications | `notification:new` (chambre `user:<id>`) — types `message:mention`, `message:reply`, `dm:message`, plus les types de communautés et d'invitations |
| Salons historiques | `rooms-list`, `room-members`, `room-participants`, `room-success`, `room-error` |

Les réactions et l'épinglage sont diffusés aux participants du salon
(`message:reaction`, `message:pinned`, `message:unpinned`). Ces événements sont
émis par les routes REST correspondantes vers la chambre `channel:<id>` : un
client qui a rejoint le salon par le protocole historique les reçoit donc aussi.

Les refus (permission manquante, destinataire hors du salon vocal, écriture par
un non-membre) sont renvoyés dans l'acquittement (`ack`) avec un `code`
(`missing_permission`, `not_a_member`, `peer_not_in_channel`,
`not_a_voice_channel`) — ou via `channel:forbidden` / `socket:error` selon
l'événement.

### Compatibilité avec l'ancien protocole

Les événements historiques restent disponibles : `get-rooms`, `create-room`,
`join-room` (code d'accès), `leave-room`, `get-chat-history`, `send-message`,
`message-read`, `typing`, `stop-typing`, `cursor-move`, `canvas-update`,
`voice-join`, `voice-leave`, et leurs réponses `rooms-list`, `room-success`,
`room-error`, `chat-history`, `receive-message`, `message-read`,
`user-typing`, `user-stop-typing`, `voice-user-joined`, `voice-user-left`.
Les salons ainsi créés sont enregistrés dans la communauté technique
(`SYSTEM_COMMUNITY_ID`), pas dans une liste en mémoire.

`send-message` accepte en plus `attachmentIds` (tableau d'identifiants de
fichiers déjà déposés par `POST /api/channels/:channelId/attachments`) : le texte
devient facultatif dès qu'un fichier accompagne l'envoi, et l'accusé renvoie
`attachmentCount`. Le rattachement est revérifié en base (même salon, même
auteur, pièce jointe non déjà rattachée), donc un identifiant fourni par le
client ne peut pas détourner le fichier d'un autre compte.

`send-message` accepte également `replyToId` (fil de discussion) et résout les
`@mention` exactement comme la route REST : l'accusé renvoie `mentions` et
`replyToId`. Répondre à un message d'un autre salon est refusé et le client
reçoit `room-error`.

### Vocal

Vocal autorisé dans les salons `text` et `voice` (ce qui préserve le vocal des
salons historiques), refusé dans `announcement` et `board`. La signalisation est
échangée **uniquement entre les sockets du même salon vocal**. Le micro n'est
demandé qu'au clic sur « Rejoindre le vocal ».

---

## 11. Tests

```bash
npm test          # suite complète (nécessite MySQL démarré)
npm run test:watch
```

Les tests utilisent `node:test`, une **vraie** base MySQL (`devmeet_db`) et de
**vrais** sockets. Chaque scénario crée ses données avec un suffixe unique et
les nettoie ensuite ; `NODE_ENV=test` est forcé dans `tests/helpers.js`, ce qui
désactive la limitation de débit. Les fichiers :

| Fichier | Couverture |
| --- | --- |
| `tests/migrations.test.js` | Schéma : tables, colonnes, clés, idempotence |
| `tests/auth.test.js` | Inscription, connexion, `/me`, jeton invalide, doublons |
| `tests/permissions.test.js` | Matrice de rôles, rang, attribution de rôle |
| `tests/communities.test.js` | Communautés, catégories, salons, messages, lecture, invitations, notifications, tableau blanc — dont découverte : une communauté publique est découvrable et rejoignable, une privée ne l'est jamais, la recherche par nom ignore la casse et les espaces, un terme sans correspondance renvoie une liste vide (pas une erreur), et une communauté rejointe quitte la découverte tout en apparaissant dans « mes communautés » avec un rôle réel |
| `tests/attachments.test.js` | Pièces jointes : dépôt réel sur disque, rattachement, contrôle d'accès au téléchargement, types refusés, appropriation impossible |
| `tests/attachments-socket.test.js` | Pièces jointes par le protocole de salon : rattachement et diffusion, fichier seul sans texte, identifiant inconnu ignoré, message vide refusé |
| `tests/moderation.test.js` | Modération : rôle et permissions exposées, suppression par l'auteur, refus pour un membre, suppression par un modérateur, suppression douce, pièce jointe non réexposée, message inexistant |
| `tests/realtime.test.js` | Socket.IO : abonnements, messages, non-lus, vocal, tableau, compat historique |
| `tests/chat.test.js` | Chat avancé : mentions (membre réel, non-membre ignoré, notification, pas d'auto-notification), réactions (ajout, idempotence, liste blanche, retrait, isolation entre salons), épinglage (refus au membre, écriture réelle, unicité, message supprimé, message inexistant), fils (réponse reliée, compteur, notification, autre salon refusé), recherche (résultat réel, jokers neutralisés, terme trop court, anonyme refusé, périmètre des salons accessibles, non-membre refusé), diffusion temps réel d'une réaction |
| `tests/dms.test.js` | Messages privés : conversation unique par paire (quel que soit l'ordre), livraison aux **deux** participants et silence pour un tiers, refus de lecture/écriture/suppression à un tiers (404 indiscernable), non-lus côté destinataire et remise à zéro après lecture, suppression réservée à l'auteur, notification du seul destinataire, cas limites (soi-même, compte inexistant, message vide, anonyme), contacts limités aux communautés partagées |

Le résultat attendu pour cette version : **113 tests, 113 succès** (mesuré avec
MySQL 8.4.3 démarré). Les fichiers de test n'utilisent aucune doublure : la même
base et le même serveur que l'application.

`npm test` échoue avec `ECONNREFUSED 127.0.0.1:3306` si MySQL n'est pas lancé —
c'est volontaire : aucun test n'est simulé.

---

## 12. Limites connues (honnêtes)

- **Vocal non scalable** : maillage P2P entre navigateurs, confortable jusqu'à
  ~5 participants dans un salon. Au-delà, un serveur SFU (mediasoup, LiveKit)
  serait nécessaire — ce n'est pas implémenté.
- **Appel vidéo** : absent. Seul l'audio est géré par `VoiceChannel.jsx`. Le
  bouton vidéo a été retiré plutôt que laissé inerte.
- **Pièces jointes** : l'envoi et le téléchargement authentifiés sont
  fonctionnels (voir § 9). Limites assumées : un seul fichier par message, taille
  plafonnée par `MAX_UPLOAD_SIZE_MB`, aucun antivirus, aucune miniature générée
  et **aucune suppression des octets** lorsque le message ou la communauté est
  supprimé (la ligne `attachments` disparaît en cascade, le fichier reste sur le
  disque). Un nettoyage périodique de `UPLOAD_DIR` reste à écrire.
- **Notifications** : créées en base et diffusées en temps réel pour les
  événements listés au § 9. Aucune notification par email ni par navigateur
  (`Notification` Web) — hors périmètre.
- **Jetons** : conservation en `localStorage` avec en-tête `Authorization`, pas
  de cookie `httpOnly`. Un jeton volé reste exploitable jusqu'à son expiration
  (`JWT_EXPIRES_IN`) ; aucune révocation serveur n'est implémentée.
- **Thème clair** : la valeur est enregistrée dans le profil, mais l'interface ne
  l'applique pas — toute l'application est stylée en sombre. C'est annoncé dans
  l'écran Paramètres lui-même.
- **Messages privés** : fonctionnels de bout en bout (voir § 9). Limites
  assumées : texte seul (aucune pièce jointe, réaction, édition ni réponse citée),
  une seule page d'historique côté interface (`before` existe côté API), et
  aucune suppression de conversation (seuls les messages se suppriment
  individuellement, logiquement).
- **Pagination** : l'historique des messages est paginé côté API (`before` /
  `after`), mais l'interface charge une seule page.
- **Recherche** : implémentée avec `LIKE '%…%'`, sans index `FULLTEXT` ni moteur
  externe. Conséquences assumées : pas de recherche par mot entier ni par
  pertinence, pas de tolérance aux fautes de frappe, et un balayage complet du
  contenu des salons concernés (coût croissant avec le volume). Le terme doit
  faire au moins 2 caractères et la réponse est plafonnée à 25 résultats (100 au
  maximum via `?limit=`). Aucune pagination en profondeur dans l'interface : les
  résultats sont affichés en une liste.
- **Réactions** : limitées aux 14 emojis de la liste blanche (côté serveur **et**
  côté interface). Aucune réaction personnalisée ni importée d'un autre client.
- **Fils de discussion** : un fil n'a pas de participants propres, ni de
  notification d'abonnement, ni de compteur de non-lus : c'est une vue des
  messages dont `reply_to_id` désigne le parent, limitée à 100 réponses.
- **Mentions** : reconnues uniquement par le **nom affiché** du membre, à
  l'intérieur du texte. Aucune autocomplétion dans les fils de discussion (elle
  n'existe que dans la zone de saisie principale), et aucun `@tous` /
  `@ici` : une mention vise toujours un compte précis.
