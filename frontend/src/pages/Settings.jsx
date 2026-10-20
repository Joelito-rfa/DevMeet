import { useState } from "react";
import { Save, UserCog } from "lucide-react";

import WorkspaceShell from "../components/layout/WorkspaceShell";
import { apiFetch, storeSession } from "../services/api";

/**
 * Paramètres du compte : les valeurs enregistrées ici sont écrites en base
 * (`PATCH /api/auth/me`) — elles ne vivent pas seulement dans le navigateur.
 */
function Settings({ token, user, onLogout, onUserUpdated }) {
  const [form, setForm] = useState({
    name: user?.name || "",
    bio: user?.bio || "",
    avatarUrl: user?.avatarUrl || "",
    status: user?.status || "online",
    theme: user?.theme || "dark",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    const result = await apiFetch("/api/auth/me", {
      method: "PATCH",
      token,
      body: {
        name: form.name,
        bio: form.bio,
        avatarUrl: form.avatarUrl,
        status: form.status,
        theme: form.theme,
      },
    });

    setSaving(false);

    if (!result.ok) {
      setError(result.data?.message || "Enregistrement impossible.");
      return;
    }

    storeSession(token, result.data.user);

    if (onUserUpdated) {
      onUserUpdated(result.data.user);
    }

    setMessage("Profil enregistré en base.");
  }

  return (
    <WorkspaceShell
      token={token}
      user={user}
      onLogout={onLogout}
      headerTitle="Paramètres"
      headerSubtitle="Votre profil, tel qu'il est enregistré côté serveur."
    >
      <div className="ws-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)", maxWidth: 640 }}>
        <form className="ws-card" onSubmit={handleSubmit}>
          <div className="ws-card-title">
            <UserCog size={17} /> Profil
          </div>

          <div className="ws-form-group">
            <label className="ws-form-label" htmlFor="profile-name">
              Nom affiché
            </label>
            <input
              id="profile-name"
              className="ws-form-input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
              minLength={2}
              maxLength={60}
            />
            <p className="ws-form-help">
              C'est ce nom qui apparaît comme auteur de vos messages.
            </p>
          </div>

          <div className="ws-form-group">
            <label className="ws-form-label" htmlFor="profile-bio">
              Bio
            </label>
            <textarea
              id="profile-bio"
              className="ws-form-textarea"
              value={form.bio}
              onChange={(event) => setForm({ ...form, bio: event.target.value })}
              maxLength={500}
            />
          </div>

          <div className="ws-form-group">
            <label className="ws-form-label" htmlFor="profile-avatar">
              URL d'avatar
            </label>
            <input
              id="profile-avatar"
              className="ws-form-input"
              value={form.avatarUrl}
              onChange={(event) =>
                setForm({ ...form, avatarUrl: event.target.value })
              }
              maxLength={500}
              placeholder="https://…"
            />
          </div>

          <div className="ws-inline">
            <div className="ws-form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="ws-form-label" htmlFor="profile-status">
                Statut
              </label>
              <select
                id="profile-status"
                className="ws-form-select"
                value={form.status}
                onChange={(event) =>
                  setForm({ ...form, status: event.target.value })
                }
              >
                <option value="online">En ligne</option>
                <option value="away">Absent</option>
                <option value="busy">Occupé</option>
                <option value="invisible">Invisible</option>
                <option value="offline">Hors ligne</option>
              </select>
            </div>

            <div className="ws-form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="ws-form-label" htmlFor="profile-theme">
                Thème
              </label>
              <select
                id="profile-theme"
                className="ws-form-select"
                value={form.theme}
                onChange={(event) =>
                  setForm({ ...form, theme: event.target.value })
                }
              >
                <option value="dark">Sombre</option>
                <option value="light">Clair</option>
              </select>
            </div>
          </div>

          {error ? <div className="ws-alert ws-alert-error">{error}</div> : null}
          {message ? (
            <div className="ws-alert ws-alert-success">{message}</div>
          ) : null}

          <div className="ws-form-actions">
            <button
              className="ws-button ws-button-primary"
              type="submit"
              disabled={saving}
            >
              <Save size={17} />
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>

          <p className="ws-form-help">
            Le thème et le statut sont enregistrés dans votre profil mais
            l'interface n'applique pas encore le thème clair : c'est une limite
            connue, annoncée comme telle.
          </p>
        </form>
      </div>
    </WorkspaceShell>
  );
}

export default Settings;
