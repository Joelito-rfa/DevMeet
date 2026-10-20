import { Bell } from "lucide-react";

function NotificationSettings() {
  return (
    <section className="ws-settings-section" aria-labelledby="settings-notifications">
      <header className="ws-settings-head">
        <span className="ws-settings-icon" aria-hidden="true">
          <Bell size={19} />
        </span>
        <div className="ws-settings-head-text">
          <h2 className="ws-settings-title" id="settings-notifications">
            Notifications
          </h2>
          <p className="ws-settings-sub">Gérez vos préférences de notification.</p>
        </div>
      </header>

      <div className="ws-settings-body">
        <p className="ws-settings-note">
          Les préférences de notification détaillées ne sont pas encore
          disponibles dans cette version. Les notifications existantes (mentions,
          messages) restent actives par défaut.
        </p>
      </div>
    </section>
  );
}

export default NotificationSettings;