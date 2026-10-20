/**
 * Jeu de démonstration : une communauté complète avec les quatre rôles, des
 * catégories réelles et des salons de chaque type.
 *
 *   npm run seed:demo
 *
 * Idempotent et non destructif : si la communauté de démonstration existe
 * déjà, le script ne fait rien. Il ne touche à aucune autre donnée.
 *
 * Les intitulés (catégories, salons) sont des DONNÉES créées par ce script,
 * pas des listes codées en dur dans l'application : l'application, elle, ne
 * présuppose aucune catégorie ni aucun salon.
 */
require("dotenv").config();

const usersService = require("../src/services/users");
const communities = require("../src/services/communities");
const categoriesService = require("../src/services/categories");
const channelsService = require("../src/services/channels");
const messagesService = require("../src/services/messages");
const boardsService = require("../src/services/boards");
const invitationsService = require("../src/services/invitations");
const { ROLES } = require("../src/permissions");
const { query, queryOne, closePool } = require("../src/db/pool");

const DEMO_COMMUNITY_NAME = "Démo DevMeet";
const DEMO_PASSWORD = "DevMeet!2026";

const ACCOUNTS = [
  { name: "Camille Propriétaire", email: "proprietaire@devmeet.test", role: ROLES.OWNER },
  { name: "Alex Administrateur", email: "admin@devmeet.test", role: ROLES.ADMIN },
  { name: "Sam Modératrice", email: "moderateur@devmeet.test", role: ROLES.MODERATOR },
  { name: "Léa Membre", email: "membre@devmeet.test", role: ROLES.MEMBER },
];

const STRUCTURE = [
  {
    category: { name: "INFORMATIONS", description: "Règles et annonces officielles." },
    channels: [
      { name: "annonces", type: "announcement", description: "Annonces officielles." },
      { name: "bienvenue", type: "text", description: "Présentez-vous ici." },
    ],
  },
  {
    category: { name: "TRAVAIL", description: "Espaces de collaboration." },
    channels: [
      { name: "general", type: "text", description: "Discussions générales." },
      { name: "revue-de-code", type: "text", description: "Partage et relecture de code." },
      { name: "tableau-blanc", type: "board", description: "Tableau blanc partagé." },
      { name: "vocal-general", type: "voice", description: "Salon vocal." },
      {
        name: "conseil",
        type: "text",
        description: "Salon privé du bureau.",
        isPrivate: true,
      },
    ],
  },
];

async function ensureAccounts() {
  const accounts = [];

  for (const account of ACCOUNTS) {
    let user = await usersService.findByEmail(account.email);

    if (!user) {
      user = await usersService.createUser({
        name: account.name,
        email: account.email,
        password: DEMO_PASSWORD,
      });
      console.log(`[seed] compte créé : ${account.email}`);
    }

    accounts.push({ ...account, user });
  }

  return accounts;
}

async function main() {
  const accounts = await ensureAccounts();

  const existing = await queryOne("SELECT * FROM communities WHERE name = ?", [
    DEMO_COMMUNITY_NAME,
  ]);

  if (existing) {
    console.log(
      `[seed] la communauté « ${DEMO_COMMUNITY_NAME} » existe déjà (id ${existing.id}) : rien à faire.`
    );
    console.log("[seed] données inchangées.");
    return;
  }

  const owner = accounts.find((account) => account.role === ROLES.OWNER);

  const community = await communities.create({
    name: DEMO_COMMUNITY_NAME,
    description: "Communauté de démonstration créée par `npm run seed:demo`.",
    isPublic: false,
    iconUrl: null,
    ownerId: owner.user.id,
  });

  console.log(`[seed] communauté créée : ${community.name} (id ${community.id})`);

  // Les autres comptes deviennent membres avec leur rôle respectif.
  for (const account of accounts) {
    if (account.role === ROLES.OWNER) {
      continue;
    }

    await communities.addMember(community.id, account.user.id, account.role);
    console.log(`[seed] ${account.email} ajouté comme ${account.role}`);
  }

  // Un salon « general » est créé automatiquement à la création : on le range
  // dans la catégorie de travail au lieu d'en créer un doublon.
  const autoChannel = await queryOne(
    "SELECT * FROM channels WHERE community_id = ? AND category_id IS NULL ORDER BY id ASC LIMIT 1",
    [community.id]
  );

  const created = [];
  const usedAutoChannel = { value: false };

  for (const block of STRUCTURE) {
    const category = await categoriesService.create({
      communityId: community.id,
      name: block.category.name,
      description: block.category.description,
      creatorId: owner.user.id,
    });

    for (const spec of block.channels) {
      // Le salon auto-généré sert de premier salon textuel du bloc TRAVAIL.
      if (
        !usedAutoChannel.value &&
        autoChannel &&
        spec.type === "text" &&
        !spec.isPrivate &&
        spec.name === "general"
      ) {
        usedAutoChannel.value = true;

        await channelsService.update(autoChannel.id, {
          name: spec.name,
          description: spec.description,
          categoryId: category.id,
        });

        created.push({ ...spec, id: autoChannel.id });
        continue;
      }

      const channel = await channelsService.create({
        communityId: community.id,
        categoryId: category.id,
        name: spec.name,
        description: spec.description,
        type: spec.type,
        isPrivate: Boolean(spec.isPrivate),
        accessCode: null,
        creatorId: owner.user.id,
      });

      created.push({ ...spec, id: channel.id });
    }
  }

  // Accès explicite au salon privé pour l'administrateur.
  const privateChannel = created.find((channel) => channel.isPrivate);

  if (privateChannel) {
    const admin = accounts.find((account) => account.role === ROLES.ADMIN);
    await channelsService.addMember(privateChannel.id, admin.user.id);
  }

  // Quelques messages, pour que l'historique soit réellement persisté.
  const general = created.find((channel) => channel.name === "general");
  const announcement = created.find((channel) => channel.name === "annonces");

  if (general) {
    await messagesService.create({
      channelId: general.id,
      authorId: owner.user.id,
      content: "Bienvenue sur DevMeet 2.0 — les messages sont désormais persistés en base.",
    });

    await messagesService.create({
      channelId: general.id,
      authorId: accounts[3].user.id,
      content: "Confirmé : je retrouve l'historique après reconnexion.",
    });
  }

  if (announcement) {
    await messagesService.create({
      channelId: announcement.id,
      authorId: owner.user.id,
      content: "Nouveauté : suppression de catégorie avec choix explicite (conserver ou supprimer les salons).",
    });
  }

  // Un tableau blanc initial.
  const board = created.find((channel) => channel.type === "board");

  if (board) {
    await boardsService.save(
      board.id,
      {
        version: "6.7.0",
        objects: [],
        background: "#0B0F19",
        note: "Tableau blanc de démonstration — persistant.",
      },
      owner.user.id
    );
  }

  // Une invitation permanente et une à usage limité.
  const permanent = await invitationsService.create({
    communityId: community.id,
    createdBy: owner.user.id,
  });

  const limited = await invitationsService.create({
    communityId: community.id,
    createdBy: owner.user.id,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    maxUses: 10,
  });

  const totals = await queryOne(
    `SELECT
       (SELECT COUNT(*) FROM categories WHERE community_id = ?) AS categories,
       (SELECT COUNT(*) FROM channels WHERE community_id = ?) AS channels,
       (SELECT COUNT(*) FROM messages m
          INNER JOIN channels ch ON ch.id = m.channel_id
        WHERE ch.community_id = ?) AS messages`,
    [community.id, community.id, community.id]
  );

  console.log("\n=== Jeu de démonstration prêt ===");
  console.log(`Communauté      : ${community.name} (id ${community.id})`);
  console.log(`Catégories      : ${totals.categories}`);
  console.log(`Salons          : ${totals.channels}`);
  console.log(`Messages        : ${totals.messages}`);
  console.log("\nComptes (mot de passe commun : " + DEMO_PASSWORD + ")");
  for (const account of ACCOUNTS) {
    console.log(`  ${account.role.padEnd(10)} ${account.email}`);
  }
  console.log(`\nInvitation permanente : ${permanent.code}`);
  console.log(`Invitation limitée    : ${limited.code} (10 usages, 7 jours)`);
  console.log("");
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[seed] erreur :", error.message);
    try {
      await closePool();
    } catch (closeError) {
      /* ignore */
    }
    process.exit(1);
  });
