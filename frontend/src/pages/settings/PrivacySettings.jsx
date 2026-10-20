import { Shield } from "lucide-react";

function PrivacySettings() {
  return (
    <section className="ws-settings-section" aria-labelledby="settings-privacy">
      <header className="ws-settings-head">
        <span className="ws-settings-icon" aria-hidden="true">
          <Shield size={19} />
        </span>
        <div className="ws-settings-head-text">
          <h2 className="ws-settings-title" id="settings-privacy">
            Confidentialité et sécurité
          </h2>
          <p className="ws-settings-sub">
            Vos données restent privées.
          </p>
        </div>
      </header>

      <div className="ws-settings-body">
        <p className="ws-settings-note">
          Les paramètres de confidentialité avancés ne sont pas encore
          disponibles. Votre e-mail, votre thème et vos préférences de compte
          ne sont jamais affichés sur votre profil public.
        </p>
      </div>
    </section>
  );
}

export default PrivacySettings;