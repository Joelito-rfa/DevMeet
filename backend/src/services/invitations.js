const crypto = require("crypto");

const { query, queryOne, withTransaction } = require("../db/pool");
const { notFound, forbidden, badRequest } = require("../utils/errors");
const { invitationDto, communityDto } = require("../utils/serialize");
const { ROLES } = require("../permissions");
const rolesService = require("./roles");
const communities = require("./communities");
const notifications = require("./notifications");

const CODE_BYTES = 9;

function generateCode() {
  return crypto.randomBytes(CODE_BYTES).toString("base64url");
}

async function getById(invitationId) {
  return queryOne("SELECT * FROM invitations WHERE id = ?", [invitationId]);
}

async function getByCode(code) {
  return queryOne("SELECT * FROM invitations WHERE code = ?", [code]);
}

async function create({ communityId, createdBy, expiresAt = null, maxUses = null }) {
  const code = generateCode();

  const result = await query(
    `INSERT INTO invitations (community_id, code, created_by, expires_at, max_uses)
     VALUES (?, ?, ?, ?, ?)`,
    [communityId, code, createdBy, expiresAt, maxUses]
  );

  const row = await getById(result.insertId);
  return invitationDto(row);
}

async function list(communityId) {
  const rows = await query(
    `SELECT * FROM invitations WHERE community_id = ? ORDER BY id DESC LIMIT 100`,
    [communityId]
  );

  return rows.map(invitationDto);
}

async function revoke(communityId, invitationId) {
  const invitation = await getById(invitationId);

  if (!invitation || Number(invitation.community_id) !== Number(communityId)) {
    throw notFound("Invitation introuvable.");
  }

  await query("UPDATE invitations SET revoked_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [
    invitationId,
  ]);

  return invitationDto(await getById(invitationId));
}

/**
 * Aperçu public d'une invitation (utilisé par la page /invite/:code et par la
 * génération du QR code). Ne révèle ni les salons privés ni la liste des membres.
 */
async function preview(code) {
  const invitation = await getByCode(code);

  if (!invitation) {
    throw notFound("Invitation introuvable ou expirée.", "invitation_invalid");
  }

  const dto = invitationDto(invitation);

  if (!dto.isActive) {
    throw notFound("Invitation expirée, révoquée ou déjà épuisée.", "invitation_invalid");
  }

  const community = await communities.getById(invitation.community_id);

  return {
    invitation: dto,
    community: communityDto(community),
  };
}

/**
 * Acceptation : dans une seule transaction, on vérifie que l'invitation est
 * encore valide, on consomme un usage et on ajoute le membre.
 */
async function accept(code, userId) {
  const invitation = await getByCode(code);

  if (!invitation) {
    throw notFound("Invitation introuvable.", "invitation_invalid");
  }

  const dto = invitationDto(invitation);

  if (!dto.isActive) {
    throw forbidden(
      "Cette invitation n'est plus valable.",
      "invitation_invalid"
    );
  }

  const existingMembership = await communities.getMembership(
    invitation.community_id,
    userId
  );

  if (existingMembership) {
    return {
      alreadyMember: true,
      community: await communities.getForUser(invitation.community_id, userId),
    };
  }

  await withTransaction(async (connection) => {
    // Verrou pessimiste : deux acceptations simultanées ne peuvent pas
    // dépasser la limite d'utilisations.
    const [rows] = await connection.execute(
      "SELECT * FROM invitations WHERE id = ? FOR UPDATE",
      [invitation.id]
    );

    const locked = rows[0];

    if (!locked) {
      throw notFound("Invitation introuvable.", "invitation_invalid");
    }

    const lockedDto = invitationDto(locked);

    if (!lockedDto.isActive) {
      throw forbidden("Cette invitation n'est plus valable.", "invitation_invalid");
    }

    await connection.execute(
      "UPDATE invitations SET uses = uses + 1 WHERE id = ?",
      [invitation.id]
    );

    // Une invitation donne le rôle de base, jamais plus : c'est ensuite un
    // responsable qui élève le membre s'il le mérite.
    const memberRoleId = await rolesService.systemRoleId(
      invitation.community_id,
      ROLES.MEMBER,
      connection
    );

    await connection.execute(
      `INSERT INTO community_members (community_id, user_id, role_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE role_id = role_id`,
      [invitation.community_id, userId, memberRoleId]
    );
  });

  const community = await communities.getForUser(invitation.community_id, userId);

  await notifications.create({
    userId,
    type: "invitation_accepted",
    title: `Vous avez rejoint ${community.name}`,
    body: "Bienvenue dans la communauté !",
    payload: { communityId: community.id },
  });

  return { alreadyMember: false, community };
}

module.exports = {
  generateCode,
  getById,
  getByCode,
  create,
  list,
  revoke,
  preview,
  accept,
};
