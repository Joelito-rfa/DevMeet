# DevMeet 2.0 — interface

Application React + Vite. Aucun framework CSS, aucun TypeScript, aucun Konva :
les styles sont écrits à la main (`src/styles/workspace.css` pour l'espace de
travail, blocs `<style>` locaux pour les écrans historiques) et Fabric.js reste
le moteur du tableau blanc.

## Lancement

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # vérification avant livraison
npm run lint
```

L'API doit tourner en parallèle (`../backend`, port 3000). L'URL est
configurable sans toucher au code :

```bash
# .env.local
VITE_API_URL=http://localhost:3000
```

`src/services/api.js` centralise `API_URL` (défaut `http://localhost:3000`),
`SOCKET_URL`, la clé de jeton (`devmeet.token`), `apiFetch` (JSON) et
`apiUpload` (multipart). Aucun écran n'appelle `fetch` directement, sauf la
récupération d'un fichier protégé qui a besoin de l'en-tête `Authorization`.

## Routes

| Chemin | Écran | Accès |
| --- | --- | --- |
| `/login` | `pages/Login.jsx` | public |
| `/register` | `pages/Register.jsx` | public |
| `/` | `pages/Dashboard.jsx` — tableau de bord : communautés, messages privés, activité | connecté |
| `/decouvrir` | `pages/Discover.jsx` — recherche de communautés publiques | connecté |
| `/notifications` | `pages/NotificationsPage.jsx` — historique complet | connecté |
| `/messages` | `pages/DirectMessages.jsx` — liste des conversations privées | connecté |
| `/messages/:conversationId` | `pages/DirectMessages.jsx` — fil ouvert | connecté + participant |
| `/parametres` | `pages/Settings.jsx` — profil (`PATCH /api/auth/me`) | connecté |
| `/invite/:code` | `pages/Invite.jsx` — aperçu public, adhésion avec compte | aperçu public |
| `/c/:communityId` | `pages/Community.jsx` — synthèse + onglets salons, membres, invitations, réglages | connecté |
| `/c/:communityId/:channelId` | `pages/Channel.jsx` — salon (chat, tableau blanc, vocal, annonces) | connecté + accès au salon |

`App.jsx` restaure la session : le jeton stocké est **vérifié** auprès de
`GET /api/auth/me` avant d'afficher quoi que ce soit. Un jeton périmé renvoie
vers `/login` sans écran blanc. Le socket est connecté avec le même jeton
(`connectSocket`), et déconnecté à la sortie (`disconnectSocket`).

## Ce que l'interface fait réellement

- **Accueil** : un tableau de bord en un écran. Bandeau de bienvenue avec
  recherche de communautés, quatre tuiles de synthèse (communautés, salons,
  messages privés non lus, activité), cartes de communautés (visibilité, rôle,
  nombre de membres et de salons), liste de découverte publique, puis deux
  panneaux latéraux — **messages privés** (onglets Tous / Non lus / En ligne,
  pastille de présence du correspondant, aperçu du dernier message, horodatage
  relatif) et **activité** (dernières notifications, « Tout lire »). Les
  événements `dm:new`, `dm:read` et `notification:new` rafraîchissent les listes
  en direct, sans squelette clignotant. « Nouvelle conversation » ouvre un
  sélecteur de contact alimenté par `GET /api/dms/candidates`.
- **Communautés** : création, liste, découverte, adhésion. Chaque carte est
  affichée à partir des données de l'API (nombre de membres et de salons
  compris) — aucune liste codée en dur.
- **Découvrir** : la liste vient de `GET /api/communities/discover` (communautés
  publiques dont on n'est pas encore membre ; les privées n'y figurent jamais).
  Les états sont distincts — chargement, résultats, liste vide **expliquée** avec
  un accès à la création, recherche sans résultat avec réinitialisation, serveur
  injoignable, erreur serveur — et une erreur d'API n'est jamais affichée comme
  une liste vide. La recherche part au clic (jamais à chaque frappe), les
  espaces superflus sont ignorés et un identifiant de requête empêche une
  réponse tardive d'écraser un résultat plus récent. Pendant une adhésion, le
  bouton est désactivé pour éviter les doubles clics.
- **Catégories et salons** : création, renommage, suppression, déplacement et
  réordonnancement depuis la **barre latérale de l'espace de travail** —
  glisser-déposer `@dnd-kit` avec poignées (souris **et** clavier, annonces aux
  lecteurs d'écran) et entrées « Monter / Descendre » des menus contextuels. Un
  salon change de catégorie par « Déplacer vers… » : jamais par dépôt accidentel.
  L'onglet « Salons » de l'écran de communauté rejoue les mêmes actions,
  groupées par catégorie, avec un bouton « Salon » par groupe.
- **Écran de communauté** : une fiche de synthèse (visibilité, votre rôle,
  compteurs) puis quatre onglets dont l'onglet actif vit dans l'URL (`?tab=…`,
  partageable et compatible avec le bouton Retour). La suppression de la
  communauté se confirme **dans la page** (recopie du nom) au lieu d'une boîte
  native ; le serveur la réserve de toute façon au propriétaire.
- **Suppression de catégorie** : une fenêtre demande explicitement quoi faire des
  salons (« conserver sans catégorie » ou « supprimer aussi les salons et leur
  contenu »). L'interface refuse de deviner, comme le serveur (`strategy`
  obligatoire).
- **Membres** : ajout par recherche de compte, changement de rôle, exclusion.
  Les rôles proposés dépendent du rang de l'acteur : l'interface ne propose
  jamais un rôle qu'elle se verrait refuser (la décision reste serveur —
  `src/permissions.js` n'est qu'un miroir d'ergonomie, documenté comme tel).
- **Invitations** : création avec expiration et nombre d'utilisations, affichage
  du **QR code** (PNG renvoyé par l'API), copie du lien, révocation.
- **Salons protégés** : si le serveur refuse l'accès faute de code, l'écran
  demande le code et appelle `POST /api/channels/:id/unlock`. Le code n'est jamais
  renvoyé par l'API (`hasAccessCode` seulement) et l'accès obtenu est durable.
- **Pièces jointes** : le bouton trombone envoie vraiment le fichier
  (`POST /api/channels/:id/attachments`), l'affiche en attente avant l'envoi, le
  rattache au message, et le téléchargement passe par une requête authentifiée.
- **Modération des messages** : l'auteur peut retirer son propre message, et les
  rôles disposant de `message:moderate` (propriétaire, administrateur,
  modérateur) peuvent retirer celui d'un autre. Une confirmation explicite est
  toujours demandée — jamais de suppression sur simple clic. La suppression est
  annoncée à tout le salon (`message:deleted`) et laisse la place du message avec
  la mention « Message supprimé » : la ligne n'est pas effacée en base.
- **Notifications** : cloche avec compteur dans l'en-tête, panneau déroulant,
  page d'historique. Les nouvelles arrivent par l'événement `notification:new`.
  Une notification de message privé propose « Ouvrir », qui mène directement à la
  conversation (et la marque comme lue).
- **Messages privés** : écran à deux colonnes (`/messages`). La liste vient de
  `GET /api/dms` (non-lus et extrait du dernier message compris) et le fil de
  `GET /api/dms/:id/messages`. L'envoi passe par l'API, mais le message s'affiche
  aussi en direct pour les deux participants (`dm:new`) : il est dédoublonné par
  identifiant, jamais ajouté deux fois. Une pastille sur « Messages » dans la
  barre latérale compte les non-lus (`GET /api/dms/unread-count`). « Lu »
  s'affiche sur vos derniers messages d'après la position de lecture du
  partenaire (`dm:read`). La suppression est réservée à l'auteur (aucune
  modération possible dans une conversation privée) et reste logique.
- **Démarrer une conversation** : le bouton « Nouvelle conversation » cherche
  dans `GET /api/dms/candidates`, qui ne propose que des comptes d'une
  **communauté partagée** — aucune annuaire global de la plateforme n'est exposé.
- **Salon** : chat temps réel, tableau blanc partagé, vocal — inchangés depuis le
  DevMeet d'origine, désormais rattachés à de vrais salons en base.
- **Réactions** : un bouton ouvre un sélecteur de 14 emojis (la même liste
  blanche que le serveur), les réactions sont affichées avec leur compteur et les
  comptes ayant réagi, et un clic bascule la sienne
  (`POST`/`DELETE …/reactions`). Les réactions des autres arrivent en direct
  (`message:reaction`).
- **Épinglage** : le bouton n'apparaît qu'avec `message:pin` (modérateur et
  au-dessus) ; le panneau « Messages épinglés » est chargé depuis
  `GET …/pins` et se met à jour en direct (`message:pinned` / `message:unpinned`).
- **Fils de discussion** : le bouton de chaque message ouvre un panneau latéral
  qui liste les réponses chargées depuis l'API, permet d'en écrire une
  (`send-message` avec `replyToId`) et affiche le compteur de réponses du message
  parent.
- **Mentions** : taper `@` propose les **membres réels** de la communauté
  (annuaire `GET /api/communities/:id/members`) et un clic insère `@Nom` ; les
  mentions reconnues par le serveur sont mises en gras et un message qui vous
  mentionne est encadré. L'autocomplétion ne fait que proposer : c'est le serveur
  qui décide, à partir du texte, qui est réellement mentionné.
- **Recherche** : un bouton ouvre un panneau avec deux portées — « ce salon »
  ou « toute la communauté » (`GET …/messages/search`). Les résultats viennent de
  l'API, jamais d'un filtrage local.

## Structure

```
src/
  App.jsx                 routes, session, socket
  pages/                  un écran par route (Dashboard, Community, Channel,
                          Invite, DirectMessages, Settings, Discover…)
  components/
    layout/               ossature de l'espace de travail :
                            WorkspaceShell   3 colonnes + contexte partagé
                                             (données, modales, menus)
                            CommunitySidebar arborescence catégories/salons
                                             (glisser-déposer, panneau compte)
                            CommunitiesBar   barre des communautés
                            ContextMenu, Background, workspace.js
                                             (contexte + constantes partagées)
    auth/                 AuthShowcase, BrandIcons (écrans de connexion)
    common/               Notifications (cloche), motion.jsx (variantes Framer)
    chat/Chat.jsx         messages, pièces jointes, réactions, épingles, fils,
                          mentions, recherche
    board/Whiteboard.jsx  tableau blanc (Fabric.js)
    voice/                vocal WebRTC (VoiceChannel, VoiceStage)
    channel/              ChannelView — cadre des salons textuels/annonces
  hooks/useAsyncEffect.js effets asynchrones sans rendu en cascade
  services/
    api.js                API_URL, jeton, apiFetch, apiUpload
    oauth.js              flux OAuth (Google / GitHub)
    socket.js             socket unique, connectSocket / disconnectSocket
  permissions.js          miroir d'ergonomie de la matrice serveur
                          (+ REACTION_EMOJIS, la liste blanche des réactions)
  styles/                 workspace.css (espace de travail, préfixe ws-) et
                          animations.css ; pages/Login.css pour la connexion
```

## Limites connues

- L'interface charge **une seule page** d'historique de messages alors que l'API
  est paginée. Les messages privés ne chargent pas non plus de page
  supplémentaires (`?before=` existe côté serveur, mais aucun bouton ne l'appelle).
- Les messages privés n'acceptent ni pièces jointes, ni réactions, ni édition, ni
  réponse citée : le texte seul est enregistré.
- La recherche de contacts des messages privés interroge le serveur à chaque
  frappe et n'affiche que 30 comptes au maximum.
- Le thème clair est enregistré dans le profil mais n'est pas appliqué : tout est
  stylé en sombre (c'est dit dans l'écran Paramètres).
- L'appel vidéo n'existe pas ; le bouton a été retiré plutôt que laissé inerte.
- `npm run lint` signale 2 avertissements `react-hooks/exhaustive-deps`
  préexistants dans `Whiteboard.jsx` (effets de synchronisation du tableau).
- Le bundle dépasse 500 kB (Fabric.js et Framer Motion) : rien n'est découpé pour
  l'instant.
- La recherche interroge le serveur à chaque validation (pas de recherche « au fil
  de la frappe »), affiche au plus 25 résultats et ne les pagine pas : un terme
  très fréquent est tronqué sans indication de « résultats suivants ».
- Les panneaux du salon (recherche, épingles, fil) s'affichent **un seul à la
  fois** et se superposent à droite du chat sur petit écran plutôt que de
  s'empiler.
- L'autocomplétion des mentions n'existe que dans la zone de saisie principale
  du salon, pas dans la zone de réponse d'un fil ; l'annuaire est rechargé à
  l'ouverture du salon.
- Les réactions sont limitées aux 14 emojis proposés : aucun sélecteur d'emojis
  complet.
