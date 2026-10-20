import { useState } from "react";
import { MonitorCog, Save } from "lucide-react";
import { apiFetch, storeSession } from "../../services/api";
import { useOutletContext } from "react-router-dom";

const STATUS_OPTIONS = [
  { value: "online", label: "En ligne", tone: "ws-presence-online", description: "Vous êtes visible et disponible." },
  { value: "away", label: "Absent", tone: "ws-presence-away", description: "Vous êtes peut-être occupé." },
  { value: "busy", label: "Ne pas déranger", tone: "ws-presence-busy", description: "Aucune notification ne vous dérangera." },
  { value: "invisible", label: "Invisible", tone: "ws-presence-offline", description: "Vous apparaissez hors ligne aux autres." },
  { value: "offline", label: "Hors ligne", tone: "ws-presence-offline", description: "État réel de connexion." },
];

function PresenceSettings() {
  const { token, user, onUserUpdated } = useOutletContext();
  const [status, setStatus] = useState(user?.status || "online");
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
      body: { status },
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
    setMessage("Statut mis à jour.");
  }

  return (
    <section className="ws-settings-section" aria-labelledby="settings-presence">
      <header className="ws-settings-head">
        <span className="ws-settings-icon" aria-hidden="true">
          <MonitorCog size={19} />
        </span>
        <div className="ws-settings-head-text">
          <h2 className="ws-settings-title" id="settings-presence">
            Présence et activité
          </h2>
          <p className="ws-settings-sub">
            Gérez votre statut de présence.
          </p>
        </div>
      </header>

      <form className="ws-settings-body" onSubmit={handleSubmit}>
        <div className="ws-form-group">
          <label className="ws-form-label" htmlFor="presence-status">
            Statut
          </label>
          <div className="ws-presence-options">
            {STATUS_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`ws-presence-option${
                  status === option.value ? " is-selected" : ""
                }`}
              >
                <input
                  type="radio"
                  name="presence-status"
                  value={option.value}
                  checked={status === option.value}
                  onChange={() => setStatus(option.value)}
                />
                <span className={`ws-presence-dot ${option.tone}`} aria-hidden="true" />
                <span className="ws-presence-option-text">
                  <span className="ws-presence-option-label">{option.label}</span>
                  <span className="ws-presence-option-desc">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="ws-settings-foot">
          <div className="ws-settings-foot-info">
            {error ? (
              <div className="ws-alert ws-alert-error">{error}</div>
            ) : message ? (
              <div className="ws-alert ws-alert-success">{message}</div>
            ) : (
              <p className="ws-settings-note">
                Le statut est enregistré dans votre profil.
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

export default PresenceSettings;