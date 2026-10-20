import { useCallback, useEffect, useState } from "react";
import { Check, Trash2 } from "lucide-react";

import WorkspaceShell from "../components/layout/WorkspaceShell";
import socket from "../services/socket";
import { apiFetch } from "../services/api";
import { useAsyncEffect } from "../hooks/useAsyncEffect";

/** Historique complet des notifications du compte (lues et non lues). */
function NotificationsPage({ token, user, onLogout }) {
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const result = await apiFetch("/api/notifications?limit=50", { token });

    if (result.ok) {
      setItems(result.data?.notifications || []);
      setUnreadCount(result.data?.unreadCount ?? 0);
    }

    setLoading(false);
  }, [token]);

  useAsyncEffect(async () => {
    await load();
  }, [load]);

  useEffect(() => {
    function handleNew() {
      load();
    }

    socket.on("notification:new", handleNew);

    return () => socket.off("notification:new", handleNew);
  }, [load]);

  async function markRead(notification) {
    await apiFetch(`/api/notifications/${notification.id}/read`, {
      method: "POST",
      token,
    });

    await load();
  }

  async function markAllRead() {
    await apiFetch("/api/notifications/read-all", { method: "POST", token });
    await load();
  }

  async function remove(notification) {
    await apiFetch(`/api/notifications/${notification.id}`, {
      method: "DELETE",
      token,
    });

    await load();
  }

  return (
    <WorkspaceShell
      token={token}
      user={user}
      onLogout={onLogout}
      headerTitle="Notifications"
      headerSubtitle={`${unreadCount} non lue(s) sur ${items.length} affichée(s).`}
      headerActions={
        <button
          className="ws-button ws-button-small"
          type="button"
          onClick={markAllRead}
          disabled={unreadCount === 0}
        >
          <Check size={16} />
          Tout marquer comme lu
        </button>
      }
    >
      {loading ? <p className="ws-empty">Chargement…</p> : null}

      {!loading && items.length === 0 ? (
        <p className="ws-empty">Aucune notification pour le moment.</p>
      ) : null}

      <div className="ws-list">
        {items.map((notification) => (
          <div className="ws-list-row" key={notification.id}>
            <div className="ws-list-row-main">
              <div className="ws-list-row-name">
                {notification.title}
                {notification.readAt ? null : (
                  <span className="ws-badge ws-badge-admin">Nouvelle</span>
                )}
              </div>

              {notification.body ? (
                <div className="ws-list-row-sub">{notification.body}</div>
              ) : null}

              <div className="ws-notification-date">
                {notification.type} ·{" "}
                {new Date(notification.createdAt).toLocaleString("fr-FR")}
              </div>
            </div>

            <div className="ws-list-row-actions">
              {notification.readAt ? null : (
                <button
                  className="ws-button ws-button-small"
                  type="button"
                  onClick={() => markRead(notification)}
                >
                  <Check size={16} />
                  Lue
                </button>
              )}

              <button
                className="ws-button ws-button-small ws-button-danger"
                type="button"
                onClick={() => remove(notification)}
              >
                <Trash2 size={16} />
                Supprimer
              </button>
            </div>
          </div>
        ))}
      </div>
    </WorkspaceShell>
  );
}

export default NotificationsPage;
