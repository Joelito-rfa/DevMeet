import { useState } from "react";
import { Save, User } from "lucide-react";

import { apiFetch, storeSession } from "../../services/api";
import { useOutletContext } from "react-router-dom";

function AvatarPreview({ name, url }) {
  const [failedUrl, setFailedUrl] = useState("");
  const initials =
    (name || "DevMeet")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "DM";

  if (url && url !== failedUrl) {
    return (
      <img
        className="ws-settings-avatar"
        src={url}
        alt=""
        onError={() => setFailedUrl(url)}
      />
    );
  }

  return (
    <span className="ws-settings-avatar" aria-hidden="true">
      {initials}
    </span>
  );
}

function ProfileSettings() {
  const { token, user, onUserUpdated } = useOutletContext();
  const [form, setForm] = useState({
    name: user?.name || "",
    bio: user?.bio || "",
    avatarUrl: user?.avatarUrl || "",
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

    setMessage("Modifications enregistrées.");
  }

  return (
    <section className="ws-settings-section" aria-labelledby="settings-profile">
      <header className="ws-settings-head">
        <span className="ws-settings-icon" aria-hidden="true">
          <User size={19} />
        </span>
        <div className="ws-settings-head-text">
          <h2 className="ws-settings-title" id="settings-profile">
            Mon profil
          </h2>
          <p className="ws-settings-sub">
            Votre identité publique dans DevMeet.
          </p>
        </div>
        <AvatarPreview name={form.name} url={form.avatarUrl} />
      </header>

      <form className="ws-settings-body" onSubmit={handleSubmit}>
        <div className="ws-form-group">
          <label className="ws-form-label" htmlFor="profile-name">
            Nom affiché
          </label>
          <input
            id="profile-name"
            className="ws-form-input"
            value={form.name}
            onChange={(event) =>
              setForm({ ...form, name: event.target.value })
            }
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
            Bio (500 caractères max.)
          </label>
          <textarea
            id="profile-bio"
            className="ws-form-textarea"
            value={form.bio}
            onChange={(event) =>
              setForm({ ...form, bio: event.target.value })
            }
            maxLength={500}
          />
          <p className="ws-form-help">{form.bio.length}/500 caractères.</p>
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
          <p className="ws-form-help">
            Laissez vide pour conserver vos initiales. L'aperçu se met à jour au-dessus.
          </p>
        </div>

        <div className="ws-settings-foot">
          <div className="ws-settings-foot-info">
            {error ? (
              <div className="ws-alert ws-alert-error">{error}</div>
            ) : message ? (
              <div className="ws-alert ws-alert-success">{message}</div>
            ) : (
              <p className="ws-settings-note">
                Nom, bio et avatar sont enregistrés ensemble.
              </p>
            )}
          </div>
          <button
            className="ws-button ws-button-primary"
            type="submit"
            disabled={saving}
          >
            <Save size={17} />
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </section>
  );
}

export default ProfileSettings;