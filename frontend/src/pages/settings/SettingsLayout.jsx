import { NavLink, Outlet } from "react-router-dom";

import WorkspaceShell from "../../components/layout/WorkspaceShell";
import {
  Bell,
  Info,
  MonitorCog,
  Palette,
  Shield,
  SlidersHorizontal,
  User,
  UserCog,
} from "lucide-react";

const NAV_GROUPS = [
  {
    title: "Paramètres utilisateur",
    items: [
      { to: "/parametres/compte", label: "Mon compte", icon: UserCog },
      { to: "/parametres/profil", label: "Mon profil", icon: User },
      { to: "/parametres/apparence", label: "Apparence", icon: Palette },
      {
        to: "/parametres/profil/personnalisation",
        label: "Personnalisation du profil",
        icon: SlidersHorizontal,
      },
      { to: "/parametres/presence", label: "Présence et activité", icon: MonitorCog },
      { to: "/parametres/notifications", label: "Notifications", icon: Bell },
      { to: "/parametres/confidentialite", label: "Confidentialité et sécurité", icon: Shield },
    ],
  },
  {
    title: "Application",
    items: [{ to: "/parametres/a-propos", label: "À propos", icon: Info }],
  },
];

function SettingsLayout({ token, user, onLogout, onUserUpdated }) {
  return (
    <WorkspaceShell
      token={token}
      user={user}
      onLogout={onLogout}
      headerTitle="Paramètres"
      headerSubtitle="Votre compte, votre profil et l'apparence de DevMeet."
    >
      <div className="ws-settings-layout">
        <nav className="ws-settings-nav" aria-label="Navigation des paramètres">
          {NAV_GROUPS.map((group) => (
            <div className="ws-settings-nav-group" key={group.title}>
              <p className="ws-settings-nav-title">{group.title}</p>
              <ul className="ws-settings-nav-list">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        className={({ isActive }) =>
                          `ws-settings-nav-item${isActive ? " is-active" : ""}`
                        }
                      >
                        <Icon size={17} aria-hidden="true" />
                        <span>{item.label}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="ws-settings-content">
          <Outlet context={{ token, user, onLogout, onUserUpdated }} />
        </div>
      </div>
    </WorkspaceShell>
  );
}

export default SettingsLayout;