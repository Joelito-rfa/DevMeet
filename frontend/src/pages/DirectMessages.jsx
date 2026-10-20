import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MessageSquare, Search, Send, Trash2, UserPlus, X } from "lucide-react";

import WorkspaceShell from "../components/layout/WorkspaceShell";
import socket from "../services/socket";
import { apiFetch } from "../services/api";
import { useAsyncEffect } from "../hooks/useAsyncEffect";

/**
 * Messagerie privée entre membres.
 *
 * Tout passe par l'API (les conversations sont écrites en base) ; Socket.IO ne
 * sert qu'à la livraison immédiate des événements `dm:new`, `dm:deleted` et
 * `dm:read`. Un message envoyé depuis cet onglet revient par le socket : il est
 * donc dédoublonné par identifiant avant d'être ajouté au fil.
 */

/** Compare deux identifiants BIGINT (exposés sous forme de chaînes). */
function isIdAtLeast(candidate, reference) {
  if (!candidate || !reference) {
    return false;
  }

  try {
    return BigInt(candidate) >= BigInt(reference);
  } catch {
    return false;
  }
}

function initialsOf(name) {
  return (
    (name || "?")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "?"
  );
}

function formatTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("fr-FR");
}

function DirectMessages({ token, user, onLogout }) {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const myId = Number(user?.id);

  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [partnerReadId, setPartnerReadId] = useState(null);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contacts, setContacts] = useState([]);

  const activeId =
    conversationId && /^\d+$/.test(conversationId)
      ? Number(conversationId)
      : null;

  const active = conversations.find((item) => item.id === activeId) || null;
  const lastMessageId =
    messages.length > 0 ? messages[messages.length - 1].id : null;
  const activePartnerReadId = active ? active.partnerLastReadMessageId : null;

  const loadConversations = useCallback(async () => {
    const result = await apiFetch("/api/dms", { token });

    if (result.ok) {
      setConversations(result.data?.conversations || []);
    }

    setLoading(false);
  }, [token]);

  useAsyncEffect(async () => {
    await loadConversations();
  }, [loadConversations]);

  // Historique de la conversation ouverte.
  useAsyncEffect(
    async (isCancelled) => {
      if (!activeId) {
        setMessages([]);
        return;
      }

      const result = await apiFetch(`/api/dms/${activeId}/messages`, { token });

      if (isCancelled()) {
        return;
      }

      if (result.ok) {
        setMessages(result.data?.messages || []);
        setError("");
      } else {
        setMessages([]);
        setError(result.data?.message || "Conversation inaccessible.");
      }
    },
    [activeId, token]
  );

  // Position de lecture du partenaire, telle que connue au chargement.
  useAsyncEffect(
    async () => {
      setPartnerReadId(activePartnerReadId || null);
    },
    [activePartnerReadId]
  );

  // Le dernier message affiché est marqué comme lu dès qu'il change.
  useAsyncEffect(
    async () => {
      if (!activeId || !lastMessageId) {
        return;
      }

      await apiFetch(`/api/dms/${activeId}/read`, {
        method: "POST",
        token,
        body: { messageId: lastMessageId },
      });

      await loadConversations();
    },
    [activeId, lastMessageId, loadConversations, token]
  );

  // Contacts proposés : uniquement des comptes de communautés partagées.
  useAsyncEffect(
    async (isCancelled) => {
      if (!contactsOpen) {
        return;
      }

      const term = contactSearch.trim();
      const suffix = term ? `?search=${encodeURIComponent(term)}` : "";
      const result = await apiFetch(`/api/dms/candidates${suffix}`, { token });

      if (isCancelled() || !result.ok) {
        return;
      }

      setContacts(result.data?.candidates || []);
    },
    [contactsOpen, contactSearch, token]
  );

  useEffect(() => {
    function handleNew(payload) {
      const incomingId = Number(payload?.conversationId);
      const message = payload?.message;

      if (message && incomingId === activeId) {
        setMessages((previous) =>
          previous.some((item) => item.id === message.id)
            ? previous
            : [...previous, message]
        );
      }

      loadConversations();
    }

    function handleDeleted(payload) {
      if (Number(payload?.conversationId) === activeId) {
        setMessages((previous) =>
          previous.map((item) =>
            item.id === payload.deletedId
              ? { ...item, deleted: true, content: "" }
              : item
          )
        );
      }

      loadConversations();
    }

    function handleRead(payload) {
      if (
        Number(payload?.conversationId) === activeId &&
        Number(payload?.readerId) !== myId
      ) {
        setPartnerReadId(payload.messageId || null);
      }
    }

    socket.on("dm:new", handleNew);
    socket.on("dm:deleted", handleDeleted);
    socket.on("dm:read", handleRead);

    return () => {
      socket.off("dm:new", handleNew);
      socket.off("dm:deleted", handleDeleted);
      socket.off("dm:read", handleRead);
    };
  }, [activeId, loadConversations, myId]);

  async function startConversation(contact) {
    const result = await apiFetch("/api/dms", {
      method: "POST",
      token,
      body: { userId: contact.id },
    });

    if (!result.ok) {
      setError(result.data?.message || "Impossible d'ouvrir la conversation.");
      return;
    }

    const conversation = result.data?.conversation;

    setContactsOpen(false);
    setContactSearch("");
    await loadConversations();

    if (conversation) {
      navigate(`/messages/${conversation.id}`);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();

    const content = draft.trim();

    if (!content || !activeId || sending) {
      return;
    }

    setSending(true);
    setError("");

    const result = await apiFetch(`/api/dms/${activeId}/messages`, {
      method: "POST",
      token,
      body: { content },
    });

    if (result.ok) {
      const created = result.data?.data;

      setDraft("");

      if (created) {
        setMessages((previous) =>
          previous.some((item) => item.id === created.id)
            ? previous
            : [...previous, created]
        );
      }

      await loadConversations();
    } else {
      setError(result.data?.message || "Envoi impossible.");
    }

    setSending(false);
  }

  async function removeMessage(message) {
    const result = await apiFetch(
      `/api/dms/${activeId}/messages/${message.id}`,
      { method: "DELETE", token }
    );

    setPendingDelete(null);

    if (result.ok) {
      setMessages((previous) =>
        previous.map((item) =>
          item.id === message.id
            ? { ...item, deleted: true, content: "" }
            : item
        )
      );

      await loadConversations();
    } else {
      setError(result.data?.message || "Suppression impossible.");
    }
  }

  return (
    <WorkspaceShell
      token={token}
      user={user}
      onLogout={onLogout}
      headerTitle="Messages privés"
      headerSubtitle="Conversations directes entre membres, enregistrées en base."
      headerActions={
        <button
          className="ws-button ws-button-small"
          type="button"
          onClick={() => setContactsOpen((open) => !open)}
        >
          <UserPlus size={16} />
          Nouvelle conversation
        </button>
      }
    >
      {error ? <div className="ws-alert ws-alert-error">{error}</div> : null}

      {contactsOpen ? (
        <div className="ws-card" style={{ marginBottom: 16 }}>
          <div className="ws-section-title">Choisir un contact</div>

          <div className="ws-inline" style={{ marginTop: 10 }}>
            <Search size={16} />

            <input
              className="ws-form-input"
              type="text"
              placeholder="Rechercher un nom…"
              value={contactSearch}
              onChange={(event) => setContactSearch(event.target.value)}
            />

            <button
              className="ws-button ws-button-small"
              type="button"
              onClick={() => {
                setContactsOpen(false);
                setContactSearch("");
              }}
            >
              <X size={16} />
              Fermer
            </button>
          </div>

          {contacts.length === 0 ? (
            <p className="ws-empty">
              Aucun contact trouvé dans vos communautés.
            </p>
          ) : (
            <div className="ws-list" style={{ marginTop: 12 }}>
              {contacts.map((contact) => (
                <div className="ws-list-row" key={contact.id}>
                  <span className="ws-mp-avatar">
                    {initialsOf(contact.name)}
                  </span>

                  <div className="ws-list-row-main">
                    <div className="ws-list-row-name">{contact.name}</div>
                    <div className="ws-list-row-sub">{contact.status}</div>
                  </div>

                  <button
                    className="ws-button ws-button-small"
                    type="button"
                    onClick={() => startConversation(contact)}
                  >
                    <MessageSquare size={16} />
                    Discuter
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div className="ws-mp-layout">
        <section className="ws-mp-list">
          {loading ? <p className="ws-empty">Chargement…</p> : null}

          {!loading && conversations.length === 0 ? (
            <p className="ws-empty">Aucune conversation pour le moment.</p>
          ) : null}

          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className={`ws-mp-contact${
                conversation.id === activeId ? " active" : ""
              }`}
              onClick={() => navigate(`/messages/${conversation.id}`)}
            >
              <span className="ws-mp-avatar">
                {initialsOf(conversation.participant.name)}
              </span>

              <span className="ws-mp-contact-main">
                <span className="ws-mp-contact-name">
                  {conversation.participant.name}
                </span>

                <span className="ws-mp-contact-sub">
                  {conversation.lastMessage
                    ? `${
                        conversation.lastMessage.authorId === myId
                          ? "Vous : "
                          : ""
                      }${
                        conversation.lastMessage.deleted
                          ? "Message supprimé"
                          : conversation.lastMessage.content
                      }`
                    : "Nouvelle conversation"}
                </span>
              </span>

              {conversation.unreadCount > 0 ? (
                <span className="ws-count-badge">
                  {conversation.unreadCount > 99
                    ? "99+"
                    : conversation.unreadCount}
                </span>
              ) : null}
            </button>
          ))}
        </section>

        <section className="ws-mp-thread">
          {!active ? (
            <p className="ws-empty" style={{ margin: "auto" }}>
              Sélectionnez une conversation, ou lancez-en une nouvelle.
            </p>
          ) : (
            <>
              <header className="ws-mp-thread-header">
                <span className="ws-mp-avatar">
                  {initialsOf(active.participant.name)}
                </span>

                <div>
                  <div className="ws-list-row-name">
                    {active.participant.name}
                  </div>
                  <div className="ws-list-row-sub">
                    {active.participant.status}
                  </div>
                </div>
              </header>

              <div className="ws-mp-messages">
                {messages.length === 0 ? (
                  <p className="ws-empty">
                    Aucun message. Écrivez le premier.
                  </p>
                ) : null}

                {messages.map((message) => {
                  const mine = Number(message.author?.id) === myId;

                  return (
                    <div
                      key={message.id}
                      className={`ws-mp-bubble${mine ? " mine" : ""}${
                        message.deleted ? " deleted" : ""
                      }`}
                    >
                      {message.deleted ? "Message supprimé" : message.content}

                      <div className="ws-mp-bubble-meta">
                        <span>{message.author?.name || "Compte supprimé"}</span>
                        <span>{formatTime(message.createdAt)}</span>

                        {mine &&
                        !message.deleted &&
                        isIdAtLeast(partnerReadId, message.id) ? (
                          <span>Lu</span>
                        ) : null}

                        {mine && !message.deleted ? (
                          pendingDelete === message.id ? (
                            <span className="ws-inline">
                              <span>Supprimer ?</span>

                              <button
                                className="ws-button ws-button-small ws-button-danger"
                                type="button"
                                onClick={() => removeMessage(message)}
                              >
                                <Trash2 size={15} />
                                Oui
                              </button>

                              <button
                                className="ws-button ws-button-small"
                                type="button"
                                onClick={() => setPendingDelete(null)}
                              >
                                Annuler
                              </button>
                            </span>
                          ) : (
                            <button
                              className="ws-button ws-button-small"
                              type="button"
                              aria-label="Supprimer le message"
                              onClick={() => setPendingDelete(message.id)}
                            >
                              <Trash2 size={15} />
                            </button>
                          )
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <form className="ws-mp-composer" onSubmit={sendMessage}>
                <textarea
                  className="ws-form-textarea ws-mp-input"
                  placeholder={`Écrire à ${active.participant.name}…`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      sendMessage(event);
                    }
                  }}
                />

                <button
                  className="ws-button ws-button-primary"
                  type="submit"
                  disabled={sending || !draft.trim()}
                >
                  <Send size={16} />
                  Envoyer
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </WorkspaceShell>
  );
}

export default DirectMessages;
