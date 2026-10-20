import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, MessageSquare, Trash2 } from "lucide-react";

import socket from "../../services/socket";
import { apiFetch } from "../../services/api";
import { useAsyncEffect } from "../../hooks/useAsyncEffect";

/**
 * Cloche de notifications réelles.
 *
 * La liste vient de la base (`GET /api/notifications`) : une notification reçue
 * hors connexion est donc toujours là au retour. Les nouvelles arrivent en
 * direct par l'événement `notification:new` (chambre `user:<id>`).
 */
function Notifications({ token }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);

    const result = await apiFetch("/api/notifications", { token });

    setLoading(false);

    if (!result.ok) {
      setError(result.data?.message || "Notifications indisponibles.");
      return;
    }

    setError("");
    setItems(result.data.notifications || []);
    setUnreadCount(result.data.unreadCount ?? 0);
  }, [token]);

  useAsyncEffect(async () => {
    await load();
  }, [load]);

  useEffect(() => {
    function handleNew(payload) {
      const notification = payload?.notification;

      if (!notification) {
        return;
      }

      setItems((current) => {
        if (current.some((item) => item.id === notification.id)) {
          return current;
        }

        return [notification, ...current];
      });

      if (!notification.readAt) {
        setUnreadCount((count) => count + 1);
      }
    }

    socket.on("notification:new", handleNew);

    return () => socket.off("notification:new", handleNew);
  }, []);

  async function markRead(notification) {
    if (notification.readAt) {
      return;
    }

    const result = await apiFetch(
      `/api/notifications/${notification.id}/read`,
      { method: "POST", token }
    );

    if (!result.ok) {
      return;
    }

    setItems((current) =>
      current.map((item) =>
        item.id === notification.id
          ? { ...item, readAt: new Date().toISOString() }
          : item
      )
    );
    setUnreadCount((count) => Math.max(0, count - 1));
  }

  async function markAllRead() {
    const result = await apiFetch("/api/notifications/read-all", {
      method: "POST",
      token,
    });

    if (!result.ok) {
      return;
    }

    const now = new Date().toISOString();
    setItems((current) =>
      current.map((item) => ({ ...item, readAt: item.readAt || now }))
    );
    setUnreadCount(0);
  }

  /**
   * Ouvre la conversation privée liée à une notification de message, en la
   * marquant comme lue au passage.
   */
  async function openNotification(notification) {
    const conversationId = notification.payload?.conversationId;

    if (!conversationId) {
      return;
    }

    await markRead(notification);
    setOpen(false);
    navigate(`/messages/${conversationId}`);
  }

  async function remove(notification) {
    const result = await apiFetch(`/api/notifications/${notification.id}`, {
      method: "DELETE",
      token,
    });

    if (!result.ok) {
      return;
    }

    setItems((current) => current.filter((item) => item.id !== notification.id));

    if (!notification.readAt) {
      setUnreadCount((count) => Math.max(0, count - 1));
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        className="ws-button ws-icon-button ws-tip-end"
        type="button"
        data-tip="Notifications"
        aria-label={`Notifications${
          unreadCount > 0 ? ` (${unreadCount} non lues)` : ""
        }`}
        onClick={() => {
          setOpen((value) => !value);

          if (!open) {
            load();
          }
        }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 20,
              height: 20,
              padding: "0 4px",
              borderRadius: 999,
              background: "#5865f2",
              color: "#ffffff",
              fontSize: 11,
              fontWeight: 700,
              lineHeight: "20px",
              textAlign: "center",
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="ws-notifications"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            <div className="ws-section-header" style={{ marginBottom: 10 }}>
              <strong style={{ fontSize: 13 }}>Notifications</strong>

              {unreadCount > 0 && (
                <button
                  className="ws-button ws-button-small"
                  type="button"
                  onClick={markAllRead}
                >
                  <Check size={15} /> Tout lire
                </button>
              )}
            </div>

            {error && <div className="ws-alert ws-alert-error">{error}</div>}

            {!error && items.length === 0 && (
              <p className="ws-muted" style={{ padding: "10px 2px" }}>
                {loading ? "Chargement…" : "Aucune notification pour le moment."}
              </p>
            )}

            {items.map((notification) => (
              <div
                className={`ws-notification${notification.readAt ? "" : " unread"}`}
                key={notification.id}
              >
                <div className="ws-notification-text">{notification.title}</div>

                {notification.body && (
                  <div className="ws-muted" style={{ marginTop: 4 }}>
                    {notification.body}
                  </div>
                )}

                <div className="ws-inline" style={{ marginTop: 8 }}>
                  <span className="ws-notification-date">
                    {notification.createdAt
                      ? new Date(notification.createdAt).toLocaleString()
                      : ""}
                  </span>

                  {notification.payload?.conversationId ? (
                    <button
                      className="ws-button ws-button-small"
                      type="button"
                      onClick={() => openNotification(notification)}
                    >
                      <MessageSquare size={15} />
                      Ouvrir
                    </button>
                  ) : null}

                  {!notification.readAt && (
                    <button
                      className="ws-button ws-button-small"
                      type="button"
                      onClick={() => markRead(notification)}
                    >
                      Marquer comme lue
                    </button>
                  )}

                  <button
                    className="ws-button ws-button-small ws-button-ghost"
                    type="button"
                    title="Supprimer"
                    onClick={() => remove(notification)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default Notifications;
