import { Info } from "lucide-react";

function AboutSettings() {
  return (
    <section className="ws-settings-section" aria-labelledby="settings-about">
      <header className="ws-settings-head">
        <span className="ws-settings-icon" aria-hidden="true">
          <Info size={19} />
        </span>
        <div className="ws-settings-head-text">
          <h2 className="ws-settings-title" id="settings-about">
            À propos
          </h2>
          <p className="ws-settings-sub">Informations sur DevMeet.</p>
        </div>
      </header>

      <div className="ws-settings-body">
        <div className="ws-settings-summary">
          <span className="ws-settings-summary-label">Application</span>
          <span className="ws-settings-summary-value">DevMeet</span>
        </div>
        <div className="ws-settings-summary">
          <span className="ws-settings-summary-label">Version</span>
          <span className="ws-settings-summary-value">2.0</span>
        </div>
        <p className="ws-settings-note">
          DevMeet est un espace de communication et de collaboration pour
          développeurs.
        </p>
      </div>
    </section>
  );
}

export default AboutSettings;