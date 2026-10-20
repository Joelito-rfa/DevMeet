import { useState } from "react";
import { Crown, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";

import { apiFetch } from "../../services/api";
import {
  PERMISSION_GROUPS,
  ROLES,
  permissionLabel,
  roleKey,
  roleLabel,
} from "../../permissions";

/** Rangs déjà attribués aux rôles système, refusés à la création (409). */
const RESERVED_RANKS = [100, 75, 50, 10];

/** Borne de rang propre à la communauté (le serveur refuse le reste). */
const RANK_MIN = 1;
const RANK_MAX = 99;

/**
 * Onglet « Rôles » : liste, création, modification et suppression des rôles
 * d'une communauté.
 *
 * Ce composant n'affiche que ce que le SERVEUR a décidé de permettre :
 *   - `canManage` décide si la création est proposée ;
 *   - `editableRoleIds` décide quels rôles ouvrent un formulaire ;
 *   - `permissionCatalog.grantable` décide quelles cases sont cochables.
 *
 * Aucune règle n'est réimplémentée ici : masquer un bouton n'empêche rien, le
 * serveur répond 403 et `fail()` l'affiche.
 */
export default function RolesPanel({
  token,
  communityId,
  roles,
  canManage,
  assignableRoleIds,
  editableRoleIds,
  permissionCatalog,
  draft,
  setDraft,
  flash,
  fail,
  onChanged,
}) {
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  function startCreate() {
    setConfirmDeleteId(null);
    setDraft({
      roleId: null,
      name: "",
      description: "",
      color: "#d2a8ff",
      rank: defaultRank(roles, permissionCatalog),
      permissions: [],
    });
  }

  function startEdit(role) {
    setConfirmDeleteId(null);
    setDraft({
      roleId: role.id,
      name: role.name || "",
      description: role.description || "",
      color: role.color || "#d2a8ff",
      rank: role.rank,
      permissions: [...(role.permissions || [])],
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);

    const creating = draft.roleId === null;

    const result = await apiFetch(
      creating
        ? `/api/communities/${communityId}/roles`
        : `/api/communities/${communityId}/roles/${draft.roleId}`,
      {
        method: creating ? "POST" : "PATCH",
        token,
        body: {
          name: draft.name.trim(),
          description: draft.description.trim(),
          color: draft.color,
          rank: Number(draft.rank),
          permissions: draft.permissions,
        },
      }
    );

    setBusy(false);

    if (!result.ok) {
      fail(result);
      return;
    }

    flash(creating ? "Rôle créé." : "Rôle mis à jour.");
    setDraft(null);
    onChanged();
  }

  async function handleDelete(role) {
    setBusy(true);

    const result = await apiFetch(
      `/api/communities/${communityId}/roles/${role.id}`,
      { method: "DELETE", token }
    );

    setBusy(false);

    if (!result.ok) {
      fail(result);
      return;
    }

    flash(`Rôle « ${role.name} » supprimé.`);
    setConfirmDeleteId(null);
    onChanged();
  }

  return (
    <div>
      <div className="ws-section-header">
        <h2 className="ws-section-title">Rôles</h2>

        {canManage && !draft && (
          <button
            className="ws-button ws-button-small ws-button-primary"
            type="button"
            onClick={startCreate}
          >
            <Plus size={15} /> Nouveau rôle
          </button>
        )}
      </div>

      <p className="ws-muted" style={{ marginBottom: 14 }}>
        Chaque rôle porte ses propres permissions, appliquées partout dans la
        communauté. Un membre n'en a qu'un : c'est le plus élevé de ses rôles qui
        décide.
      </p>

      {roles.length === 0 ? (
        <div className="ws-empty">Aucun rôle à afficher.</div>
      ) : (
        <div className="ws-list">
          {roles.map((role) => {
            const editable = editableRoleIds.includes(role.id);
            const assignable = assignableRoleIds.includes(role.id);

            return (
              <RoleRow
                key={role.id ?? role.key}
                role={role}
                editable={editable}
                assignable={assignable}
                confirming={confirmDeleteId === role.id}
                busy={busy}
                onEdit={() => startEdit(role)}
                onConfirmDelete={() => setConfirmDeleteId(role.id)}
                onCancelDelete={() => setConfirmDeleteId(null)}
                onDelete={() => handleDelete(role)}
              />
            );
          })}
        </div>
      )}

      {draft && (
        <RoleForm
          draft={draft}
          setDraft={setDraft}
          permissionCatalog={permissionCatalog}
          reservedRanks={RESERVED_RANKS}
          busy={busy}
          onSubmit={handleSubmit}
          onCancel={() => setDraft(null)}
        />
      )}
    </div>
  );
}

/**
 * Une ligne de rôle : libellé, rang, permissions, et actions.
 *
 * Le propriétaire et les rôles système ne proposent AUCUNE action — ils ne sont
 * ni modifiables ni supprimables, et le serveur refuse de toute façon.
 */
function RoleRow({
  role,
  editable,
  assignable,
  confirming,
  busy,
  onEdit,
  onConfirmDelete,
  onCancelDelete,
  onDelete,
}) {
  const isOwner = Boolean(role.isOwner) || role.key === ROLES.OWNER;
  const permissions = role.permissions || [];
  const isAll = permissions.includes("*");
  const customColor = !isOwner && role.color ? { color: role.color } : null;

  return (
    <div className="ws-list-row">
      <span className={`ws-badge ws-badge-${roleKey(role)}`} style={customColor}>
        {isOwner ? <Crown size={13} /> : <ShieldCheck size={13} />}
        {roleLabel(role)}
      </span>

      <div className="ws-list-row-main">
        <div className="ws-list-row-name">
          {role.name || roleLabel(role)}

          {role.isSystem && !isOwner && (
            <span className="ws-badge">Rôle système</span>
          )}

          {!assignable && !isOwner && (
            <span className="ws-badge">Non attribuable</span>
          )}
        </div>

        {role.description && (
          <div className="ws-list-row-sub">{role.description}</div>
        )}

        <div className="ws-list-row-sub">
          Rang {role.rank} ·{" "}
          {isAll
            ? "toutes les permissions"
            : `${permissions.length} permission(s)`}
          {!isAll && permissions.length > 0 && (
            <>
              {" — "}
              {permissions.map(permissionLabel).join(", ")}
            </>
          )}
        </div>
      </div>

      <div className="ws-list-row-actions">
        {editable && !confirming && (
          <button
            className="ws-button ws-button-small"
            type="button"
            onClick={onEdit}
          >
            <Pencil size={14} /> Modifier
          </button>
        )}

        {editable && !confirming && (
          <button
            className="ws-button ws-button-small ws-button-danger"
            type="button"
            onClick={onConfirmDelete}
          >
            <Trash2 size={14} />
          </button>
        )}

        {confirming && (
          <span className="ws-inline">
            <button
              className="ws-button ws-button-small ws-button-danger"
              type="button"
              disabled={busy}
              onClick={onDelete}
            >
              Confirmer
            </button>

            <button
              className="ws-button ws-button-small ws-button-ghost"
              type="button"
              onClick={onCancelDelete}
            >
              Annuler
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Formulaire de création / modification.
 *
 * Les permissions non accordables à l'acteur sont proposées mais GRISÉES, avec
 * l'explication : mieux vaut montrer pourquoi une case est inutilisable que de
 * faire disparaître une option sans raison.
 */
function RoleForm({
  draft,
  setDraft,
  permissionCatalog,
  reservedRanks,
  busy,
  onSubmit,
  onCancel,
}) {
  const permissions = permissionCatalog?.permissions || [];
  const grantable = permissionCatalog?.grantable || [];
  const maxRank = Math.min(
    RANK_MAX,
    permissionCatalog?.maxAssignableRank ?? RANK_MAX
  );
  const creating = draft.roleId === null;

  function groupsOf(list) {
    const used = new Set();
    const groups = PERMISSION_GROUPS.map(([label, prefixes]) => {
      const items = list.filter((permission) => {
        const matches = prefixes.some((prefix) => permission.startsWith(prefix));

        if (matches) {
          used.add(permission);
        }

        return matches;
      });

      return [label, items];
    }).filter(([, items]) => items.length > 0);

    const rest = list.filter((permission) => !used.has(permission));

    if (rest.length > 0) {
      groups.push(["Autres", rest]);
    }

    return groups;
  }

  return (
    <form className="ws-card" style={{ marginTop: 18 }} onSubmit={onSubmit}>
      <div className="ws-card-title">
        {creating ? "Nouveau rôle" : `Modifier « ${draft.name || "sans nom"} »`}
      </div>

      <div className="ws-form-group">
        <label className="ws-form-label" htmlFor="role-name">
          Nom
        </label>
        <input
          id="role-name"
          className="ws-form-input"
          type="text"
          value={draft.name}
          minLength={2}
          maxLength={60}
          required
          placeholder="Ex. Animateur"
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </div>

      <div className="ws-form-group">
        <label className="ws-form-label" htmlFor="role-description">
          Description
        </label>
        <textarea
          id="role-description"
          className="ws-form-textarea"
          value={draft.description}
          maxLength={300}
          placeholder="Ce que fait ce rôle, en une phrase."
          onChange={(event) =>
            setDraft({ ...draft, description: event.target.value })
          }
        />
      </div>

      <div className="ws-form-group">
        <label className="ws-form-label" htmlFor="role-rank">
          Rang
        </label>
        <input
          id="role-rank"
          className="ws-form-input"
          type="number"
          min={RANK_MIN}
          max={maxRank}
          value={draft.rank}
          required
          onChange={(event) => setDraft({ ...draft, rank: event.target.value })}
        />

        <p className="ws-muted" style={{ marginTop: 6 }}>
          Plus le rang est élevé, plus le rôle est puissant. Il doit rester
          strictement inférieur au vôtre : au maximum{" "}
          <strong>{maxRank}</strong>. Les rangs {reservedRanks.join(", ")} sont
          réservés aux rôles système.
        </p>
      </div>

      <div className="ws-form-group">
        <span className="ws-form-label">Couleur</span>
        <input
          type="color"
          value={draft.color}
          aria-label="Couleur du rôle"
          onChange={(event) => setDraft({ ...draft, color: event.target.value })}
        />
      </div>

      <fieldset className="ws-form-group" style={{ border: 0, padding: 0 }}>
        <legend className="ws-form-label">Permissions</legend>

        {permissions.length === 0 ? (
          <p className="ws-muted">
            Le catalogue des permissions n'a pas pu être chargé.
          </p>
        ) : (
          groupsOf(permissions).map(([label, items]) => (
            <div key={label} style={{ marginTop: 10 }}>
              <div className="ws-muted" style={{ marginBottom: 4 }}>
                {label}
              </div>

              {items.map((permission) => {
                const allowed = grantable.includes(permission);

                return (
                  <label
                    className="ws-checkbox-row"
                    key={permission}
                    style={{ opacity: allowed ? 1 : 0.5 }}
                  >
                    <input
                      type="checkbox"
                      disabled={!allowed}
                      checked={draft.permissions.includes(permission)}
                      onChange={() => togglePermission(draft, setDraft, permission)}
                    />
                    {permissionLabel(permission)}
                    {!allowed && (
                      <span className="ws-muted"> — non déléguable</span>
                    )}
                  </label>
                );
              })}
            </div>
          ))
        )}
      </fieldset>

      <div className="ws-form-actions">
        <button
          className="ws-button ws-button-primary"
          type="submit"
          disabled={busy}
        >
          {creating ? "Créer le rôle" : "Enregistrer"}
        </button>

        <button
          className="ws-button ws-button-ghost"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Annuler
        </button>
      </div>
    </form>
  );
}

/** Bascule une permission dans le brouillon courant. */
function togglePermission(draft, setDraft, permission) {
  const current = draft.permissions;

  setDraft({
    ...draft,
    permissions: current.includes(permission)
      ? current.filter((value) => value !== permission)
      : [...current, permission],
  });
}

/**
 * Rang proposé par défaut à la création : le plus haut rang libre sous celui de
 * l'acteur, en évitant les rangs système réservés.
 */
function defaultRank(roles, permissionCatalog) {
  const maxRank = Math.min(
    RANK_MAX,
    permissionCatalog?.maxAssignableRank ?? RANK_MAX
  );
  const taken = new Set(roles.map((role) => Number(role.rank)));

  for (let candidate = maxRank; candidate >= RANK_MIN; candidate -= 1) {
    if (!taken.has(candidate) && !RESERVED_RANKS.includes(candidate)) {
      return candidate;
    }
  }

  return RANK_MIN;
}
