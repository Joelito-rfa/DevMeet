import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  Compass,
  Home,
  MessageSquare,
  Plus,
} from "lucide-react";

import socket from "../../services/socket";
import { apiFetch } from "../../services/api";
import { useAsyncEffect } from "../../hooks/useAsyncEffect";

/** Initiales d'une communauté (1 à 2 caractères), pour la pastille ronde. */
function communityInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "??";
  }

  return parts.map((part) => part[0].toUpperCase()).join("");
}

/**
 * Barre des communautés (première colonne, inspirée de Discord).
 *
 * Bouton Accueil, pastilles des communautés réelles de l'utilisateur (jamais
 * codées en dur), création, découverte, notifications et messages privés.
 * Le pastillage des non-lus provient des compteurs serveur.
 */
function CommunitiesBar({ communities, onCreateCommunity, token }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const refreshCounters = useCallback(async () => {
    // Les deux routes exigent une session : sans jeton, le serveur répond 401
    // (et le badge resterait faux). On n'interroge donc rien tant que la
    // session n'est pas disponible.
    if (!token) {
      return;
    }

    const [messages, notifications] = await Promise.all([
      apiFetch("/api/dms/unread-count", { token }),
      apiFetch("/api/notifications/unread-count", { token }),
    ]);

    if (messages.ok) {
      setUnreadMessages(messages.data?.unreadCount ?? 0);
    }

    if (notifications.ok) {
      setUnreadNotifications(notifications.data?.unreadCount ?? 0);
    }
  }, [token]);

  useAsyncEffect(async () => {
    await refreshCounters();
  }, [refreshCounters]);

  useEffect(() => {
    function refresh() {
      refreshCounters();
    }

    socket.on("dm:new", refresh);
    socket.on("dm:read", refresh);
    socket.on("notification:new", refresh);

    return () => {
      socket.off("dm:new", refresh);
      socket.off("dm:read", refresh);
      socket.off("notification:new", refresh);
    };
  }, [refreshCounters]);

  /** Communauté actuellement ouverte (page /c/...). */
  const activeCommunityId = location.pathname.startsWith("/c/")
    ? Number(location.pathname.split("/")[2])
    : null;

  return (
    <nav className="ws-rail" aria-label="Communautés">
      <button
        className={`ws-rail-item${
          location.pathname === "/" || location.pathname === "/decouvrir"
            ? " active"
            : ""
        }`}
        type="button"
        title="Accueil"
        onClick={() => navigate("/")}
      >
        <Home size={22} />
      </button>

      <span className="ws-rail-sep" />

      <div className="ws-rail-scroll">
        {communities.map((community) => (
          <Link
            className={`ws-rail-item community${
              Number(community.id) === activeCommunityId ? " active" : ""
            }`}
            key={community.id}
            to={`/c/${community.id}`}
            title={community.name}
          >
            {community.iconUrl ? (
              <img
                className="ws-rail-icon"
                src={community.iconUrl}
                alt={community.name}
              />
            ) : (
              <span className="ws-rail-letters">
                {communityInitials(community.name)}
              </span>
            )}

            <span className="ws-rail-pill" aria-hidden="true" />
          </Link>
        ))}
      </div>

      <button
        className="ws-rail-item add"
        type="button"
        title="Créer une communauté"
        onClick={onCreateCommunity}
      >
        <Plus size={22} />
      </button>

      <Link
        className={`ws-rail-item${location.pathname === "/decouvrir" ? " active" : ""}`}
        type="button"
        to="/decouvrir"
        title="Découvrir des communautés"
      >
        <Compass size={22} />
      </Link>

      <span className="ws-rail-sep" />

      <Link
        className="ws-rail-item"
        to="/messages"
        title={
          unreadMessages > 0
            ? `Messages privés (${unreadMessages} non lus)`
            : "Messages privés"
        }
      >
        <MessageSquare size={22} />
        {unreadMessages > 0 && (
          <span className="ws-rail-badge">
            {unreadMessages > 9 ? "9+" : unreadMessages}
          </span>
        )}
      </Link>

      <Link
        className="ws-rail-item"
        to="/notifications"
        title={
          unreadNotifications > 0
            ? `Notifications (${unreadNotifications} non lues)`
            : "Notifications"
        }
      >
        <Bell size={22} />
        {unreadNotifications > 0 && (
          <span className="ws-rail-badge">
            {unreadNotifications > 9 ? "9+" : unreadNotifications}
          </span>
        )}
      </Link>
    </nav>
  );
}

export default CommunitiesBar;
