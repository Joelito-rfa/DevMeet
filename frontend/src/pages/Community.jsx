import { useCallback, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Hash, MessageSquare, Plus, QrCode, Trash2, Users } from "lucide-react";

import WorkspaceShell from "../components/layout/WorkspaceShell";
import RolesPanel from "../components/community/RolesPanel";
import {
  CHANNEL_ICONS,
  CHANNEL_TYPES,
  useWorkspace,
} from "../components/layout/workspace";
import { apiFetch } from "../services/api";
import { useAsyncEffect } from "../hooks/useAsyncEffect";
import {
  PERMISSIONS,
  ROLES,
  assignableRoles,
  canManageMember,
  hasPermission,
  roleKey,
  roleLabel,
} from "../permissions";

// `roleKey` sert aux classes CSS des badges (`ws-badge-owner`, …) : le rôle
// étant un objet, il ne peut plus être concaténé tel quel dans une classe.

/** Onglets du tableau de bord : l'onglet vit dans l'URL (`?tab=…`). */
const TABS = [
  ["salons", "Salons"],
  ["membres", "Membres"],
  ["roles", "Rôles"],
  ["invitations", "Invitations"],
  ["reglages", "Réglages"],
];

/**
 * Écran de gestion d'une communauté.
 *
 * L'arborescence vit dans la sidebar du shell (`WorkspaceShell`), qui
 * centralise aussi ses modales : cette page présente la fiche de synthèse, puis
 * quatre onglets — structure des salons, membres, invitations, réglages.
 *
 * Les données de communauté, de catégories et de salons viennent du contexte du
 * shell (aucune requête en double) ; seuls les membres et les invitations sont
 * chargés ici, à l'ouverture de l'onglet correspondant.
 */
function Community({ token, user, onLogout }) {
  const { communityId } = useParams();

  // Le contexte du shell n'est lisible que depuis un composant rendu à
  // l'intérieur de `WorkspaceShell` : cette enveloppe pose l'ossature, et le
  // contenu comme l'en-tête (qui lisent le contexte) sont ses enfants.
  return (
    <WorkspaceShell
      user={user}
      token={token}
      onLogout={onLogout}
      communityId={communityId}
      headerIcon={<Users size={22} />}
      headerTitle={<CommunityHeaderTitle />}
      headerSubtitle={<CommunityHeaderSubtitle />}
      headerActions={<CommunityHeaderActions />}
    >
      <CommunityBody token={token} user={user} communityId={communityId} />
    </WorkspaceShell>
  );
}

function CommunityBody({ token, user, communityId }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const workspace = useWorkspace();

  const {
    community,
    categories,
    grouped,
    uncategorized,
    channels,
    role,
    loading,
    treeError,
    canManageCategories,
    canManageChannels,
    canInvite,
    flash,
    fail,
    refresh,
    openCreateCategory,
    openCreateChannel,
    openRenameCategory,
    openDeleteCategory,
    openRenameChannel,
    openMoveChannel,
    openDeleteChannel,
  } = workspace;

  // L'URL est la seule source de vérité de l'onglet : les liens de la sidebar
  // (« ?tab=invitations »), le bouton Retour et les liens directs mènent tous au
  // bon endroit, sans état intermédiaire à synchroniser.
  const requested = searchParams.get("tab") || "salons";
  const tab = TABS.some(([value]) => value === requested) ? requested : "salons";

  function selectTab(value) {
    setSearchParams(value === "salons" ? {} : { tab: value }, { replace: true });
  }

  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);

  // Rôles de la communauté, chargés avec les membres : les sélecteurs de rôle
  // proposent les rôles PERSONNALISÉS aussi, pas seulement les quatre systèmes.
  const [roles, setRoles] = useState([]);
  const [canManageRoles, setCanManageRoles] = useState(false);
  const [editableRoleIds, setEditableRoleIds] = useState([]);
  const [assignableRoleIds, setAssignableRoleIds] = useState([]);

  // Catalogue des permissions, pour griser ce que le serveur refuserait.
  const [permissionCatalog, setPermissionCatalog] = useState(null);

  const [roleDraft, setRoleDraft] = useState(null);

  const [candidateSearch, setCandidateSearch] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [candidateRoleId, setCandidateRoleId] = useState("");

  const [inviteForm, setInviteForm] = useState({
    expiresInHours: "",
    maxUses: "",
  });
  const [qrInvite, setQrInvite] = useState(null);

  const canManageMembers = hasPermission(role, PERMISSIONS.MANAGE_MEMBERS);
  const canUpdate = hasPermission(role, PERMISSIONS.UPDATE_COMMUNITY);
  const canDelete = hasPermission(role, PERMISSIONS.MANAGE_COMMUNITY);

  /** Identifiant du rôle « membre » (repli de toute attribution). */
  const memberDefaultRoleId =
    roles.find((option) => option.key === ROLES.MEMBER)?.id ?? null;

  const channelActions = {
    rename: openRenameChannel,
    move: openMoveChannel,
    remove: openDeleteChannel,
  };

  const loadMembers = useCallback(async () => {
    const result = await apiFetch(`/api/communities/${communityId}/members`, {
      token,
    });

    if (result.ok) {
      setMembers(result.data.members || []);
    }
  }, [communityId, token]);

  const loadInvitations = useCallback(async () => {
    const result = await apiFetch(`/api/communities/${communityId}/invitations`, {
      token,
    });

    if (result.ok) {
      setInvitations(result.data.invitations || []);
    }
  }, [communityId, token]);

  /**
   * Rôles de la communauté.
   *
   * Chargés dès l'ouverture de l'écran : les sélecteurs de rôle des membres
   * en ont besoin, et le serveur y renvoie aussi ce que l'utilisateur courant
   * a le droit d'attribuer ou de modifier.
   */
  const loadRoles = useCallback(async () => {
    const result = await apiFetch(`/api/communities/${communityId}/roles`, { token });

    if (!result.ok) {
      setRoles([]);
      setCanManageRoles(false);
      setAssignableRoleIds([]);
      setEditableRoleIds([]);
      return;
    }

    setRoles(result.data.roles || []);
    setCanManageRoles(Boolean(result.data.canManage));
    setAssignableRoleIds(result.data.assignableRoleIds || []);
    setEditableRoleIds(result.data.editableRoleIds || []);

    if (result.data.canManage) {
      const catalog = await apiFetch(
        `/api/communities/${communityId}/roles/permissions`,
        { token }
      );

      setPermissionCatalog(
        catalog.ok
          ? {
              permissions: catalog.data.permissions || [],
              grantable: catalog.data.grantable || [],
              maxAssignableRank: catalog.data.maxAssignableRank ?? null,
            }
          : null
      );
    } else {
      setPermissionCatalog(null);
    }
  }, [communityId, token]);

  useAsyncEffect(async () => {
    await loadRoles();
  }, [loadRoles, community?.updatedAt]);

  useAsyncEffect(async () => {
    if (tab === "membres" || tab === "invitations") {
      await loadMembers();
    }

    if (tab === "invitations") {
      await loadInvitations();
    }
  }, [tab, loadMembers, loadInvitations]);

  // --- Membres ------------------------------------------------------------

  async function searchCandidates(value) {
    setCandidateSearch(value);

    if (value.trim().length < 2) {
      setCandidates([]);
      return;
    }

    const result = await apiFetch(
      `/api/communities/${communityId}/member-candidates?search=${encodeURIComponent(
        value.trim()
      )}`,
      { token }
    );

    setCandidates(result.ok ? result.data.users || [] : []);
  }

  async function addMember(candidate) {
    // Un rôle est identifié par son identifiant (rôle personnalisé OU système).
    // Une valeur vide signifie « le rôle par défaut » (membre).
    const result = await apiFetch(`/api/communities/${communityId}/members`, {
      method: "POST",
      token,
      body: {
        userId: candidate.id,
        roleId: candidateRoleId ? Number(candidateRoleId) : undefined,
      },
    });

    if (!result.ok) {
      fail(result);
      return;
    }

    flash(
      `${candidate.name} a été ajouté(e) comme ${roleLabel(
        result.data.member?.role
      )}.`
    );
    setCandidates([]);
    setCandidateSearch("");
    loadMembers();
  }

  async function changeMemberRole(member, newRoleId) {
    const result = await apiFetch(
      `/api/communities/${communityId}/members/${member.userId}`,
      { method: "PATCH", token, body: { roleId: Number(newRoleId) } }
    );

    if (!result.ok) {
      fail(result);
      return;
    }

    flash(`Rôle de ${member.name} : ${roleLabel(result.data.member?.role)}.`);
    loadMembers();
  }

  async function removeMember(member) {
    const result = await apiFetch(
      `/api/communities/${communityId}/members/${member.userId}`,
      { method: "DELETE", token }
    );

    if (!result.ok) {
      fail(result);
      return;
    }

    flash(`${member.name} a été retiré(e) de la communauté.`);
    loadMembers();
  }

  /**
   * Ouvre (ou retrouve) la conversation privée avec un membre et y mène.
   * La conversation vit en base : le serveur renvoie sa ligne, pas un lien
   * fabriqué côté navigateur.
   */
  async function openDirectMessage(member) {
    const result = await apiFetch("/api/dms", {
      method: "POST",
      token,
      body: { userId: member.userId },
    });

    if (!result.ok) {
      fail(result);
      return;
    }

    navigate(`/messages/${result.data.conversation.id}`);
  }

  // --- Invitations ----------------------------------------------------------

  async function showQrCode(invitationId) {
    const result = await apiFetch(
      `/api/communities/${communityId}/invitations/${invitationId}/qrcode`,
      { token }
    );

    if (!result.ok) {
      fail(result);
      return;
    }

    setQrInvite(result.data);
  }

  async function handleCreateInvitation(event) {
    event.preventDefault();

    const body = {};

    if (inviteForm.expiresInHours !== "") {
      body.expiresInHours = Number(inviteForm.expiresInHours);
    }

    if (inviteForm.maxUses !== "") {
      body.maxUses = Number(inviteForm.maxUses);
    }

    const result = await apiFetch(
      `/api/communities/${communityId}/invitations`,
      { method: "POST", token, body }
    );

    if (!result.ok) {
      fail(result);
      return;
    }

    setInviteForm({ expiresInHours: "", maxUses: "" });
    flash("Invitation créée.");
    loadInvitations();
    await showQrCode(result.data.invitation.id);
  }

  async function revokeInvitation(invitation) {
    const result = await apiFetch(
      `/api/communities/${communityId}/invitations/${invitation.id}`,
      { method: "DELETE", token }
    );

    if (!result.ok) {
      fail(result);
      return;
    }

    if (Number(qrInvite?.invitation?.id) === Number(invitation.id)) {
      setQrInvite(null);
    }

    flash("Invitation révoquée.");
    loadInvitations();
  }

  /** Copie le lien de la dernière invitation affichée (QR ouvert). */
  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(qrInvite.url);
      flash("Lien copié dans le presse-papiers.");
    } catch {
      fail({ data: { message: "Copie impossible : sélectionnez le lien à la main." } });
    }
  }

  // --- Rendu ----------------------------------------------------------------

  if (loading) {
    return (
      <div className="ws-skeletons" style={{ maxWidth: 560 }}>
        <span className="ws-skeleton" style={{ height: 18, width: "44%" }} />
        <span className="ws-skeleton" style={{ width: "78%" }} />
        <span className="ws-skeleton" style={{ width: "62%" }} />
        <span className="ws-skeleton" style={{ width: "70%" }} />
      </div>
    );
  }

  if (!community) {
    return (
      <div className="ws-alert ws-alert-error">
        {treeError || "Communauté introuvable."}
      </div>
    );
  }

  return (
    <>
      <CommunitySummary community={community} role={role} />

      <div className="ws-tabs">
        {TABS.map(([value, label]) => (
          <button
            className={`ws-tab${tab === value ? " active" : ""}`}
            key={value}
            type="button"
            onClick={() => selectTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "salons" && (
        <div>
          <div className="ws-section-header">
            <h2 className="ws-section-title">Structure des salons</h2>

            <div className="ws-inline">
              {canManageCategories && (
                <button
                  className="ws-button ws-button-small"
                  type="button"
                  onClick={openCreateCategory}
                >
                  <Plus size={15} /> Catégorie
                </button>
              )}

              {canManageChannels && (
                <button
                  className="ws-button ws-button-small ws-button-primary"
                  type="button"
                  onClick={() => openCreateChannel(null)}
                >
                  <Plus size={15} /> Salon
                </button>
              )}
            </div>
          </div>

          {channels.length === 0 && (
            <div className="ws-empty">
              Aucun salon dans cette communauté.
              {canManageChannels &&
                " Utilisez le bouton « Salon » pour créer le premier."}
            </div>
          )}

          {categories.map((category) => {
            const list = grouped.get(category.id) || [];

            return (
              <div className="ws-section" key={category.id}>
                <div className="ws-section-header">
                  <h3 className="ws-section-title">
                    {category.name} <span className="ws-badge">{list.length}</span>
                  </h3>

                  <div className="ws-inline">
                    {canManageChannels && (
                      <button
                        className="ws-button ws-button-small ws-button-ghost"
                        type="button"
                        title={`Créer un salon dans « ${category.name} »`}
                        onClick={() => openCreateChannel(category.id)}
                      >
                        <Plus size={15} /> Salon
                      </button>
                    )}

                    {canManageCategories && (
                      <button
                        className="ws-button ws-button-small ws-button-ghost"
                        type="button"
                        onClick={() => openRenameCategory(category)}
                      >
                        Renommer
                      </button>
                    )}

                    {canManageCategories && (
                      <button
                        className="ws-button ws-button-small ws-button-ghost"
                        type="button"
                        title={`Supprimer la catégorie « ${category.name} »`}
                        aria-label={`Supprimer la catégorie « ${category.name} »`}
                        onClick={() => openDeleteCategory(category)}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                {category.description && (
                  <p className="ws-muted" style={{ marginBottom: 10 }}>
                    {category.description}
                  </p>
                )}

                <ChannelList
                  list={list}
                  communityId={communityId}
                  canManage={canManageChannels}
                  onManage={channelActions}
                />
              </div>
            );
          })}

          {uncategorized.length > 0 && (
            <div className="ws-section">
              <div className="ws-section-header">
                <h3 className="ws-section-title">
                  Sans catégorie <span className="ws-badge">{uncategorized.length}</span>
                </h3>

                {canManageChannels && (
                  <button
                    className="ws-button ws-button-small ws-button-ghost"
                    type="button"
                    onClick={() => openCreateChannel(null)}
                  >
                    <Plus size={15} /> Salon
                  </button>
                )}
              </div>

              <ChannelList
                list={uncategorized}
                communityId={communityId}
                canManage={canManageChannels}
                onManage={channelActions}
              />
            </div>
          )}
        </div>
      )}

      {tab === "membres" && (
        <div>
          <div className="ws-section-header">
            <h2 className="ws-section-title">
              Membres {members.length > 0 ? `(${members.length})` : ""}
            </h2>
          </div>

          {!role && (
            <p className="ws-muted" style={{ marginBottom: 12 }}>
              Vous consultez cette communauté publique sans en être membre : la
              liste peut être partielle.
            </p>
          )}

          {members.length === 0 ? (
            <div className="ws-empty">
              {role
                ? "Aucun membre à afficher."
                : "Rejoignez la communauté pour voir la liste des membres."}
            </div>
          ) : (
            <div className="ws-list">
              {members.map((member) => (
                <div className="ws-list-row" key={member.userId}>
                  <Users size={18} style={{ color: "#7985ff" }} />

                  <div className="ws-list-row-main">
                    <div className="ws-list-row-name">
                      {member.name}{" "}
                      <span
                        className={`ws-badge ws-badge-${roleKey(member.role)}`}
                      >
                        {roleLabel(member.role)}
                      </span>
                    </div>

                    <div className="ws-list-row-sub">
                      {member.email || "—"}
                      {member.joinedAt
                        ? ` · depuis le ${new Date(
                            member.joinedAt
                          ).toLocaleDateString()}`
                        : ""}
                    </div>
                  </div>

                  <div className="ws-list-row-actions">
                    {Number(member.userId) === Number(user?.id) ? null : (
                      <button
                        className="ws-button ws-button-small"
                        type="button"
                        title="Ouvrir une conversation privée"
                        onClick={() => openDirectMessage(member)}
                      >
                        <MessageSquare size={16} />
                        Message privé
                      </button>
                    )}

                    {canManageMembers &&
                      canManageMember(role, member.role) &&
                      !member.role?.isOwner && (
                        <>
                          <select
                            className="ws-form-select"
                            style={{ width: 160, minHeight: 30, height: 30 }}
                            value={member.role?.id ?? ""}
                            aria-label={`Rôle de ${member.name}`}
                            onChange={(event) =>
                              changeMemberRole(member, event.target.value)
                            }
                          >
                            {assignableRoles(role, roles).map((option) => (
                              <option key={option.id ?? option.key} value={option.id ?? ""}>
                                {option.name || roleLabel(option)}
                              </option>
                            ))}
                          </select>

                          <button
                            className="ws-button ws-button-small ws-button-danger"
                            type="button"
                            onClick={() => removeMember(member)}
                          >
                            Retirer
                          </button>
                        </>
                      )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {canManageMembers && (
            <div className="ws-section">
              <div className="ws-section-header">
                <h2 className="ws-section-title">Ajouter un membre</h2>
              </div>

              <p className="ws-muted" style={{ marginBottom: 10 }}>
                Recherchez un compte existant par son nom (2 caractères minimum).
              </p>

              <div className="ws-inline">
                <input
                  className="ws-form-input"
                  style={{ maxWidth: 280 }}
                  type="text"
                  placeholder="Nom du compte…"
                  value={candidateSearch}
                  onChange={(event) => searchCandidates(event.target.value)}
                />

                <select
                  className="ws-form-select"
                  style={{ width: 170 }}
                  value={candidateRoleId}
                  aria-label="Rôle du membre ajouté"
                  onChange={(event) => setCandidateRoleId(event.target.value)}
                >
                  <option value="">Membre (par défaut)</option>
                  {/* Le rôle « membre » est proposé par défaut ci-dessus :
                      on ne le liste pas deux fois. */}
                  {assignableRoles(role, roles)
                    .filter((option) => option.id !== memberDefaultRoleId)
                    .map((option) => (
                      <option key={option.id ?? option.key} value={option.id ?? ""}>
                        {option.name || roleLabel(option)}
                      </option>
                    ))}
                </select>
              </div>

              {candidates.length > 0 && (
                <div className="ws-list" style={{ marginTop: 12 }}>
                  {candidates.map((candidate) => (
                    <div className="ws-list-row" key={candidate.id}>
                      <div className="ws-list-row-main">
                        <div className="ws-list-row-name">{candidate.name}</div>
                        <div className="ws-list-row-sub">
                          {candidate.status || "Compte DevMeet"}
                        </div>
                      </div>

                      <button
                        className="ws-button ws-button-small ws-button-primary"
                        type="button"
                        onClick={() => addMember(candidate)}
                      >
                        Ajouter
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "roles" && (
        <RolesPanel
          token={token}
          communityId={communityId}
          roles={roles}
          canManage={canManageRoles}
          assignableRoleIds={assignableRoleIds}
          editableRoleIds={editableRoleIds}
          permissionCatalog={permissionCatalog}
          draft={roleDraft}
          setDraft={setRoleDraft}
          flash={flash}
          fail={fail}
          onChanged={loadRoles}
        />
      )}

      {tab === "invitations" && (
        <div>
          {!canInvite ? (
            <div className="ws-empty">
              Votre rôle ne permet pas de gérer les invitations.
            </div>
          ) : (
            <>
              <div className="ws-section-header">
                <h2 className="ws-section-title">Créer une invitation</h2>
              </div>

              <form onSubmit={handleCreateInvitation}>
                <div className="ws-inline">
                  <div className="ws-form-group" style={{ marginBottom: 0 }}>
                    <label className="ws-form-label" htmlFor="invite-hours">
                      Expiration (heures, facultatif)
                    </label>
                    <input
                      id="invite-hours"
                      className="ws-form-input"
                      style={{ maxWidth: 190 }}
                      type="number"
                      min={1}
                      max={2160}
                      value={inviteForm.expiresInHours}
                      onChange={(event) =>
                        setInviteForm({
                          ...inviteForm,
                          expiresInHours: event.target.value,
                        })
                      }
                      placeholder="Jamais"
                    />
                  </div>

                  <div className="ws-form-group" style={{ marginBottom: 0 }}>
                    <label className="ws-form-label" htmlFor="invite-uses">
                      Utilisations maximales (facultatif)
                    </label>
                    <input
                      id="invite-uses"
                      className="ws-form-input"
                      style={{ maxWidth: 190 }}
                      type="number"
                      min={1}
                      max={10000}
                      value={inviteForm.maxUses}
                      onChange={(event) =>
                        setInviteForm({ ...inviteForm, maxUses: event.target.value })
                      }
                      placeholder="Illimité"
                    />
                  </div>

                  <button
                    className="ws-button ws-button-primary"
                    type="submit"
                    style={{ marginTop: 20 }}
                  >
                    <QrCode size={17} /> Créer et afficher le QR
                  </button>
                </div>
              </form>

              {qrInvite && (
                <div className="ws-card" style={{ marginTop: 18 }}>
                  <div className="ws-section-header" style={{ marginBottom: 6 }}>
                    <div className="ws-card-title">
                      Invitation <span className="ws-code">{qrInvite.invitation.code}</span>

                      <span className="ws-badge">
                        {qrInvite.invitation.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>

                    <button
                      className="ws-button ws-button-small ws-button-ghost"
                      type="button"
                      title="Fermer l'aperçu"
                      aria-label="Fermer l'aperçu de l'invitation"
                      onClick={() => setQrInvite(null)}
                    >
                      ×
                    </button>
                  </div>

                  <div className="ws-card-description">
                    Partagez ce lien : il ouvre la page d'aperçu de la communauté.
                  </div>

                  <div className="ws-invite-link">
                    <code>{qrInvite.url}</code>
                    <button
                      className="ws-button ws-button-small"
                      type="button"
                      onClick={copyInviteLink}
                    >
                      Copier
                    </button>
                  </div>

                  {qrInvite.qrcode && (
                    <img
                      className="ws-qrcode"
                      src={qrInvite.qrcode}
                      alt="QR code de l'invitation"
                    />
                  )}
                </div>
              )}

              <div className="ws-section">
                <div className="ws-section-header">
                  <h2 className="ws-section-title">
                    Invitations ({invitations.length})
                  </h2>
                </div>

                {invitations.length === 0 ? (
                  <div className="ws-empty">Aucune invitation pour l'instant.</div>
                ) : (
                  <div className="ws-list">
                    {invitations.map((invitation) => (
                      <div className="ws-list-row" key={invitation.id}>
                        <div className="ws-list-row-main">
                          <div className="ws-list-row-name">
                            <span className="ws-code">{invitation.code}</span>{" "}
                            <span className="ws-badge">
                              {invitation.isActive ? "Active" : "Inactive"}
                            </span>
                          </div>

                          <div className="ws-list-row-sub">
                            {invitation.uses ?? 0}
                            {invitation.maxUses ? ` / ${invitation.maxUses}` : ""}{" "}
                            utilisation(s)
                            {invitation.expiresAt
                              ? ` · expire le ${new Date(
                                  invitation.expiresAt
                                ).toLocaleString()}`
                              : " · sans expiration"}
                          </div>
                        </div>

                        <div className="ws-list-row-actions">
                          <button
                            className="ws-button ws-button-small"
                            type="button"
                            onClick={() => showQrCode(invitation.id)}
                          >
                            <QrCode size={15} /> QR
                          </button>

                          <button
                            className="ws-button ws-button-small ws-button-danger"
                            type="button"
                            onClick={() => revokeInvitation(invitation)}
                          >
                            Révoquer
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "reglages" && (
        <SettingsTab
          token={token}
          communityId={communityId}
          community={community}
          role={role}
          canUpdate={canUpdate}
          canDelete={canDelete}
          onRefresh={refresh}
        />
      )}
    </>
  );
}

/**
 * Fiche de synthèse : visibilité, rôle, description et compteurs — le « qui
 * sommes-nous » de la communauté, au-dessus des onglets.
 */
function CommunitySummary({ community, role }) {
  const { channels, categories } = useWorkspace();

  return (
    <div className="ws-card" style={{ marginBottom: 18 }}>
      <div className="ws-card-title">
        {community.name}

        <span className="ws-badge">
          {community.isPublic ? "Publique" : "Privée"}
        </span>

        <span className={role ? `ws-badge ws-badge-${roleKey(role)}` : "ws-badge"}>
          {roleLabel(role)}
        </span>

        {community.isSystem && <span className="ws-badge">Communauté historique</span>}
      </div>

      <div className="ws-card-description">
        {community.description || "Aucune description pour l'instant."}
      </div>

      <div className="ws-meta">
        <span>{community.memberCount ?? 0} membre(s)</span>
        <span>{channels.length} salon(s)</span>
        <span>{categories.length} catégorie(s)</span>

        {community.createdAt && (
          <span>
            créée le {new Date(community.createdAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Liste des salons d'un groupe (« Sans catégorie » compris) : type, verrou,
 * description et actions de gestion (les modales appartiennent au shell).
 */
function ChannelList({ list, communityId, canManage, onManage }) {
  const navigate = useNavigate();

  if (list.length === 0) {
    return <p className="ws-channels-empty small">Aucun salon dans ce groupe.</p>;
  }

  return (
    <div className="ws-list">
      {list.map((channel) => {
        const Icon = CHANNEL_ICONS[channel.type] || Hash;
        const typeLabel =
          CHANNEL_TYPES.find((item) => item.value === channel.type)?.label ||
          channel.type;

        return (
          <div className="ws-list-row" key={channel.id}>
            <Icon size={18} style={{ color: "#7985ff" }} />

            <div className="ws-list-row-main">
              <div className="ws-list-row-name">
                {channel.name} <span className="ws-badge">{typeLabel}</span>
                {channel.isPrivate && <span className="ws-badge">Privé</span>}
                {channel.hasAccessCode && (
                  <span className="ws-badge">Code d'accès</span>
                )}
              </div>

              <div className="ws-list-row-sub">
                {channel.description || "Aucune description."}
              </div>
            </div>

            <div className="ws-list-row-actions">
              <button
                className="ws-button ws-button-small ws-button-primary"
                type="button"
                onClick={() => navigate(`/c/${communityId}/${channel.id}`)}
              >
                Ouvrir
              </button>

              {canManage && (
                <>
                  <button
                    className="ws-button ws-button-small"
                    type="button"
                    onClick={() => onManage.rename(channel)}
                  >
                    Renommer
                  </button>

                  <button
                    className="ws-button ws-button-small"
                    type="button"
                    onClick={() => onManage.move(channel)}
                  >
                    Déplacer
                  </button>

                  <button
                    className="ws-button ws-button-small ws-button-danger"
                    type="button"
                    onClick={() => onManage.remove(channel)}
                  >
                    Supprimer
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Onglet Réglages : identité de la communauté puis zone sensible. La
 * suppression se confirme dans la page (recopie du nom), sans `window.prompt` :
 * le serveur réserve de toute façon l'opération au propriétaire.
 */
function SettingsTab({
  token,
  communityId,
  community,
  role,
  canUpdate,
  canDelete,
  onRefresh,
}) {
  const navigate = useNavigate();
  const { flash, fail } = useWorkspace();

  // Initialisé à l'ouverture de l'onglet : la communauté est déjà chargée.
  const [form, setForm] = useState(() => ({
    name: community.name,
    description: community.description || "",
    isPublic: community.isPublic,
  }));

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSaveSettings(event) {
    event.preventDefault();

    const result = await apiFetch(`/api/communities/${communityId}`, {
      method: "PATCH",
      token,
      body: {
        name: form.name.trim(),
        description: form.description.trim() || null,
        isPublic: form.isPublic,
      },
    });

    if (!result.ok) {
      fail(result);
      return;
    }

    flash("Communauté mise à jour.");
    onRefresh();
  }

  async function handleLeaveCommunity() {
    const result = await apiFetch(`/api/communities/${communityId}/leave`, {
      method: "POST",
      token,
    });

    if (!result.ok) {
      fail(result);
      return;
    }

    navigate("/");
  }

  async function handleDeleteCommunity() {
    setBusy(true);

    const result = await apiFetch(`/api/communities/${communityId}`, {
      method: "DELETE",
      token,
    });

    setBusy(false);

    if (!result.ok) {
      fail(result);
      return;
    }

    navigate("/");
  }

  const nameMatches = confirmName.trim() === community.name;

  return (
    <div>
      {canUpdate ? (
        <form onSubmit={handleSaveSettings} style={{ maxWidth: 520 }}>
          <div className="ws-form-group">
            <label className="ws-form-label" htmlFor="settings-name">
              Nom
            </label>
            <input
              id="settings-name"
              className="ws-form-input"
              type="text"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              minLength={2}
              maxLength={80}
              required
            />
          </div>

          <div className="ws-form-group">
            <label className="ws-form-label" htmlFor="settings-description">
              Description
            </label>
            <textarea
              id="settings-description"
              className="ws-form-textarea"
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
              maxLength={300}
            />
          </div>

          <label className="ws-checkbox-row">
            <input
              type="checkbox"
              checked={form.isPublic}
              onChange={(event) =>
                setForm({ ...form, isPublic: event.target.checked })
              }
            />
            Communauté publique (visible dans la découverte ; les non-membres
            peuvent lire mais pas écrire)
          </label>

          <div className="ws-form-actions">
            <button className="ws-button ws-button-primary" type="submit">
              Enregistrer
            </button>
          </div>
        </form>
      ) : (
        <div className="ws-empty">
          Votre rôle ne permet pas de modifier cette communauté.
        </div>
      )}

      <div className="ws-section">
        <div className="ws-section-header">
          <h2 className="ws-section-title">Zone sensible</h2>
        </div>

        <div className="ws-inline">
          {/* Le propriétaire ne quitte pas sa communauté : il la transfère ou la
              supprime. Un simple `role !== "owner"` ne suffit plus, le rôle est
              un objet. */}
          {role && !role.isOwner && (
            <button
              className="ws-button"
              type="button"
              onClick={handleLeaveCommunity}
            >
              Quitter la communauté
            </button>
          )}

          {canDelete && !confirmOpen && (
            <button
              className="ws-button ws-button-danger"
              type="button"
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 size={17} /> Supprimer définitivement
            </button>
          )}
        </div>

        <p className="ws-muted" style={{ marginTop: 10 }}>
          Quitter la communauté efface votre adhésion (vous pourrez la rejoindre
          si elle est publique). La suppression, réservée au propriétaire, détruit
          catégories, salons, messages, fichiers et tableaux blancs.
        </p>

        {canDelete && confirmOpen && (
          <div className="ws-card" style={{ marginTop: 14 }}>
            <div className="ws-card-title">
              <Trash2 size={17} /> Supprimer « {community.name} » ?
            </div>

            <div className="ws-card-description">
              Cette action est définitive et sans retour. Recopiez le nom exact de
              la communauté pour activer la suppression.
            </div>

            <div className="ws-form-group" style={{ marginTop: 12 }}>
              <label className="ws-form-label" htmlFor="confirm-community-name">
                Nom de la communauté
              </label>
              <input
                id="confirm-community-name"
                className="ws-form-input"
                type="text"
                value={confirmName}
                placeholder={community.name}
                onChange={(event) => setConfirmName(event.target.value)}
              />
            </div>

            <div className="ws-form-actions">
              <button
                className="ws-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmName("");
                }}
              >
                Annuler
              </button>

              <button
                className="ws-button ws-button-danger"
                type="button"
                disabled={busy || !nameMatches}
                onClick={handleDeleteCommunity}
              >
                {busy ? "Suppression…" : "Supprimer définitivement"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Titre de l'en-tête : nom de la communauté, ou état de chargement. */
function CommunityHeaderTitle() {
  const workspace = useWorkspace();

  if (workspace?.loading) {
    return <span>Chargement…</span>;
  }

  if (!workspace?.community) {
    return <span>Communauté</span>;
  }

  return <span>{workspace.community.name}</span>;
}

/** Sous-titre de l'en-tête : visibilité, rôle et nombre de salons. */
function CommunityHeaderSubtitle() {
  const workspace = useWorkspace();
  const community = workspace?.community;

  if (!community) {
    return null;
  }

  return (
    <span>
      {community.isPublic ? "Publique" : "Privée"} ·{" "}
      {workspace.role ? roleLabel(workspace.role) : "Visiteur"} ·{" "}
      {workspace.channels?.length ?? 0} salon(s)
    </span>
  );
}

/**
 * Boutons « Inviter » / « Réglages » : ils basculent l'onglet en écrivant
 * `?tab=…`, la même source de vérité que les liens de la sidebar.
 */
function CommunityHeaderActions() {
  const workspace = useWorkspace();
  const [, setSearchParams] = useSearchParams();

  if (!workspace?.community) {
    return null;
  }

  const canInvite = hasPermission(workspace.role, PERMISSIONS.INVITE_MEMBERS);
  const canUpdate = hasPermission(workspace.role, PERMISSIONS.UPDATE_COMMUNITY);

  if (!canInvite && !canUpdate) {
    return null;
  }

  return (
    <>
      {canInvite && (
        <button
          className="ws-button ws-button-small"
          type="button"
          onClick={() =>
            setSearchParams({ tab: "invitations" }, { replace: true })
          }
        >
          Inviter
        </button>
      )}

      {canUpdate && (
        <button
          className="ws-button ws-button-small"
          type="button"
          onClick={() =>
            setSearchParams({ tab: "reglages" }, { replace: true })
          }
        >
          Réglages
        </button>
      )}
    </>
  );
}

export default Community;
