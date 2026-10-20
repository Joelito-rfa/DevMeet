import { LogOut, Mail, Shield } from "lucide-react";
import { useOutletContext } from "react-router-dom";

function AccountSettings() {
  const { user, onLogout } = useOutletContext();

  return (
    <section className="ws-settings-section" aria-labelledby="settings-account">
      <header className="ws-settings-head">
        <span className="ws-settings-icon" aria-hidden="true">
          <Shield size={19} />
        </span>
        <div className="ws-settings-head-text">
          <h2 className="ws-settings-title" id="settings-account">
            Mon compte
          </h2>
          <p className="ws-settings-sub">
            Informations générales et sécurité.
          </p>
        </div>
      </header>

      <div className="ws-settings-body">
        <div className="ws-form-group">
          <label className="ws-form-label">Adresse e-mail</label>
          <input
            className="ws-form-input"
            value={user?.email || ""}
            readOnly
            aria-readonly="true"
          />
          <p className="ws-form-help">
            L'adresse e-mail est liée à votre compte.
          </p>
        </div>

        <div className="ws-settings-summary">
          <span className="ws-settings-summary-label">Identifiant</span>
          <span className="ws-settings-summary-value">
            {user?.id ? `#${user.id}` : "—"}
          </span>
        </div>

        <div className="ws-settings-summary">
          <span className="ws-settings-summary-label">Membre depuis</span>
          <span className="ws-settings-summary-value">
            {user?.createdAt
              ? new Date(user.createdAt).toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })
              : "—"}
          </span>
        </div>

        <div className="ws-settings-foot">
          <div className="ws-settings-foot-info">
            <p className="ws-settings-note">
              <Mail size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
              Le mot de passe se réinitialise via « Mot de passe oublié » sur
              l'écran de connexion.
            </p>
          </div>
          <button
            type="button"
            className="ws-button ws-button-danger"
            onClick={onLogout}
          >
            <LogOut size={17} />
            Se déconnecter
          </button>
        </div>
      </div>
    </section>
  );
}

export default AccountSettings;