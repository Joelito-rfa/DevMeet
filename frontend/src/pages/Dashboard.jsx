import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AtSign,
  Bell,
  Check,
  ChevronRight,
  Compass,
  Globe,
  Hash,
  Home,
  MessageSquare,
  Plus,
  Reply,
  Search,
  Shield,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import WorkspaceShell from "../components/layout/WorkspaceShell";
import { useWorkspace } from "../components/layout/workspace";
import socket from "../services/socket";
import { apiFetch } from "../services/api";
import { useAsyncEffect } from "../hooks/useAsyncEffect";
import { roleKey, roleLabel } from "../permissions";
import { fadeUp, staggerParent } from "../components/common/motion";

/**
 * Accueil : tableau de bord de l'utilisateur.
 *
 * Trois zones, toutes alimentées par l'API (aucune donnée codée en dur) :
 * les communautés rejointes et celles à découvrir, les messages privés (avec
 * présence des correspondants) et le flux d'activité. Les événements temps
 * réel (`dm:new`, `dm:read`, `notification:new`) rafraîchissent les listes
 * sans recharger la page.
 */

/** Statuts de présence renvoyés par l'API, traduits pour l'interface. */
const PRESENCE = {
  online: { label: "En ligne", tone: "ws-presence-online" },
  away: { label: "Absent", tone: "ws-presence-away" },
  busy: { label: "Ne pas déranger", tone: "ws-presence-busy" },
  invisible: { label: "Hors ligne", tone: "ws-presence-offline" },
  offline: { label: "Hors ligne", tone: "ws-presence-offline" },
};

function presenceOf(status) {
  return PRESENCE[status] || PRESENCE.offline;
}

/** Repère temporel lisible : « à l'instant », « il y a 5 min », « hier »… */
function relativeTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);

  if (minutes < 1) {
    return "à l'instant";
  }

  if (minutes < 60) {
    return `il y a ${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `il y a ${hours} h`;
  }

  const days = Math.floor(hours / 24);

  if (days === 1) {
    return "hier";
  }

  if (days < 7) {
    return `il y a ${days} j`;
  }

  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** Initiales d'un nom (1 à 2 caractères), pour l'avatar de contact. */
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

/** Aperçu d'une conversation : dernier message, supprimé, ou pièce jointe. */
function previewOf(conversation) {
  const last = conversation.lastMessage;

  if (!last) {
    return "Nouvelle conversation";
  }

  if (last.deleted) {
    return "Message supprimé";
  }

  return last.content || "Pièce jointe";
}

/** Type de communauté (système, publique, privée) et badge associé. */
function typeBadgeOf(community) {
  if (community.isSystem) {
    return { label: "Communauté DevMeet", className: "ws-home-badge-system" };
  }

  if (community.isPublic) {
    return { label: "Publique", className: "ws-home-badge-public" };
  }

  return { label: "Privée", className: "ws-home-badge-private" };
}

/** Icône d'une notification, selon le type émis par le serveur. */
function notificationIcon(type) {
  if (type === "message:mention") {
    return <AtSign size={17} />;
  }

  if (type === "message:reply") {
    return <Reply size={17} />;
  }

  if (type === "dm:message") {
    return <MessageSquare size={17} />;
  }

  if (type === "channel:created") {
    return <Hash size={17} />;
  }

  if (
    type === "invite:created" ||
    type === "invitation_accepted" ||
    type === "community:member:joined"
  ) {
    return <UserPlus size={17} />;
  }

  if (type?.startsWith("role:")) {
    return <Shield size={17} />;
  }

  return <Bell size={17} />;
}

function Dashboard({ token, user, onLogout }) {
  const navigate = useNavigate();

  const [communities, setCommunities] = useState([]);
  const [discover, setDiscover] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const [conversations, setConversations] = useState([]);
  const [dmsLoading, setDmsLoading] = useState(true);
  const [dmTab, setDmTab] = useState("all");

  const [notifications, setNotifications] = useState([]);
  const [notificationUnread, setNotificationUnread] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(true);

  const [composerOpen, setComposerOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState("");
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [composerError, setComposerError] = useState("");
  const [openingId, setOpeningId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);

    const [mine, publicOnes] = await Promise.all([
      apiFetch("/api/communities", { token }),
      apiFetch("/api/communities/discover", { token }),
    ]);

    setLoading(false);

    if (!mine.ok) {
      setError(mine.data?.message || "Impossible de charger vos communautés.");
      return;
    }

    setError("");
    setCommunities(mine.data.communities || []);
    setDiscover(publicOnes.ok ? publicOnes.data.communities || [] : []);
  }, [token]);

  /** Conversations privées, la plus récemment active en tête. */
  const loadDms = useCallback(async (options = {}) => {
    const silent = options.silent === true;

    if (!silent) {
      setDmsLoading(true);
    }

    const result = await apiFetch("/api/dms", { token });

    if (!silent) {
      setDmsLoading(false);
    }

    if (result.ok) {
      setConversations(result.data?.conversations || []);
    }
  }, [token]);

  /** Flux d'activité : dernières notifications du compte. */
  const loadNotifications = useCallback(async (options = {}) => {
    const silent = options.silent === true;

    if (!silent) {
      setNotificationsLoading(true);
    }

    const result = await apiFetch("/api/notifications?limit=12", { token });

    if (!silent) {
      setNotificationsLoading(false);
    }

    if (result.ok) {
      setNotifications(result.data?.notifications || []);
      setNotificationUnread(result.data?.unreadCount ?? 0);
    }
  }, [token]);

  useAsyncEffect(async () => {
    await load();
    await loadDms();
    await loadNotifications();
  }, [load, loadDms, loadNotifications]);

  // Mise à jour en direct : les listes suivent les événements du serveur.
  useEffect(() => {
    function refreshConversations() {
      loadDms({ silent: true });
    }

    function refreshNotifications() {
      loadNotifications({ silent: true });
    }

    socket.on("dm:new", refreshConversations);
    socket.on("dm:read", refreshConversations);
    socket.on("notification:new", refreshNotifications);

    return () => {
      socket.off("dm:new", refreshConversations);
      socket.off("dm:read", refreshConversations);
      socket.off("notification:new", refreshNotifications);
    };
  }, [loadDms, loadNotifications]);

  // Contacts proposés : uniquement des comptes de communautés partagées.
  useAsyncEffect(
    async (isCancelled) => {
      if (!composerOpen) {
        return;
      }

      const term = contactQuery.trim();
      const suffix = term ? `?search=${encodeURIComponent(term)}` : "";
      const result = await apiFetch(`/api/dms/candidates${suffix}`, { token });

      if (isCancelled() || !result.ok) {
        return;
      }

      setContacts(result.data?.candidates || []);
      setContactsLoading(false);
    },
    [composerOpen, contactQuery, token]
  );

  // Échap referme la modale de nouvelle conversation.
  useEffect(() => {
    if (!composerOpen) {
      return undefined;
    }

    function handleKey(event) {
      if (event.key === "Escape") {
        setComposerOpen(false);
      }
    }

    window.addEventListener("keydown", handleKey);

    return () => window.removeEventListener("keydown", handleKey);
  }, [composerOpen]);

  const unreadDmCount = conversations.reduce(
    (sum, conversation) => sum + (conversation.unreadCount || 0),
    0
  );

  const unreadConversationCount = conversations.filter(
    (conversation) => conversation.unreadCount > 0
  ).length;

  /** Conversations affichées selon l'onglet (Tous / Non lus / En ligne). */
  const dmRows = useMemo(() => {
    const filtered = conversations.filter((conversation) => {
      if (dmTab === "unread") {
        return conversation.unreadCount > 0;
      }

      if (dmTab === "online") {
        return conversation.participant?.status === "online";
      }

      return true;
    });

    return filtered.slice(0, 8);
  }, [conversations, dmTab]);

  async function handleJoin(community) {
    setBusyId(community.id);
    setError("");

    const result = await apiFetch(`/api/communities/${community.id}/join`, {
      method: "POST",
      token,
    });

    setBusyId(null);

    if (!result.ok) {
      setError(result.data?.message || "Adhésion impossible.");
      return;
    }

    setMessage(`Vous avez rejoint « ${community.name} ».`);
    navigate(`/c/${community.id}`);
  }

  function openComposer() {
    setComposerError("");
    setContactQuery("");
    setContactsLoading(true);
    setComposerOpen(true);
  }

  async function handleStartConversation(contact) {
    setOpeningId(contact.id);
    setComposerError("");

    const result = await apiFetch("/api/dms", {
      method: "POST",
      token,
      body: { userId: contact.id },
    });

    setOpeningId(null);

    if (!result.ok) {
      setComposerError(
        result.data?.message || "Impossible d'ouvrir la conversation."
      );
      return;
    }

    const conversation = result.data?.conversation;

    setComposerOpen(false);

    if (conversation) {
      navigate(`/messages/${conversation.id}`);
    }
  }

  async function handleMarkAllRead() {
    const result = await apiFetch("/api/notifications/read-all", {
      method: "POST",
      token,
    });

    if (result.ok) {
      await loadNotifications({ silent: true });
    }
  }

  const filtered = communities.filter((community) => {
    if (!search.trim()) {
      return true;
    }

    const needle = search.trim().toLowerCase();

    return (
      community.name.toLowerCase().includes(needle) ||
      (community.description || "").toLowerCase().includes(needle)
    );
  });

  const mine = filtered.filter(
    (community) => community.role || community.isSystem
  );

  const hasSearch = search.trim().length > 0;

  const memberCount = communities.filter((community) => community.role).length;
  const channelCount = communities.reduce(
    (total, community) => total + (community.channelCount || 0),
    0
  );

  const stats = [
    {
      key: "communities",
      icon: <Compass size={20} />,
      label: "Communautés",
      value: communities.length,
      caption: `${memberCount} rejointe(s)`,
    },
    {
      key: "channels",
      icon: <Hash size={20} />,
      label: "Salons",
      value: channelCount,
      caption: "sur vos communautés",
    },
    {
      key: "dms",
      icon: <MessageSquare size={20} />,
      label: "Messages privés",
      value: unreadDmCount,
      caption:
        unreadDmCount > 0
          ? `${unreadConversationCount} conversation(s) en attente`
          : "aucun message non lu",
    },
    {
      key: "activity",
      icon: <Bell size={20} />,
      label: "Activité",
      value: notificationUnread,
      caption: notificationUnread > 0 ? "non lue" : "tout est à jour",
    },
  ];

  return (
    <WorkspaceShell
      user={user}
      token={token}
      onLogout={onLogout}
      headerIcon={
        <span className="ws-home-icon-wrap">
          <Home size={22} />
          {unreadDmCount > 0 ? (
            <span className="ws-home-badge">
              {unreadDmCount > 99 ? "99+" : unreadDmCount}
            </span>
          ) : null}
        </span>
      }
      headerTitle="Accueil"
      headerSubtitle="Votre tableau de bord : communautés, messages privés et activité."
      headerActions={<CreateCommunityButton onBeforeOpen={() => setError("")} />}
    >
      {/* --- Bandeau : accueil, recherche et raccourci de discussion --- */}
      <section className="ws-home-hero">
        <div className="ws-home-hero-text">
          <span className="ws-home-eyebrow">Tableau de bord</span>
          <h1 className="ws-home-title">
            Bonjour {(user?.name || "").split(" ")[0] || ""} 👋
          </h1>
          <p className="ws-home-subtitle">
            Retrouvez vos communautés, créez des salons et collaborez.
          </p>
        </div>

        <div className="ws-home-hero-side">
          <div className="ws-home-search">
            <Search size={18} />
            <input
              type="text"
              placeholder="Rechercher une communauté…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Rechercher une communauté"
            />

            {search ? (
              <button
                className="ws-home-search-clear"
                type="button"
                aria-label="Effacer la recherche"
                onClick={() => setSearch("")}
              >
                <X size={16} />
              </button>
            ) : null}
          </div>

          <motion.button
            className="ws-button ws-button-primary"
            type="button"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={openComposer}
          >
            <UserPlus size={17} /> Nouvelle conversation
          </motion.button>
        </div>
      </section>

      {error && <div className="ws-alert ws-alert-error">{error}</div>}
      {message && <div className="ws-alert ws-alert-success">{message}</div>}

      {/* --- Tuiles de synthèse --- */}
      <motion.div
        className="ws-home-stats"
        initial="hidden"
        animate="show"
        variants={staggerParent}
      >
        {stats.map((tile) => (
          <motion.div className="ws-home-tile" key={tile.key} variants={fadeUp}>
            <span className="ws-home-tile-icon">{tile.icon}</span>

            <div className="ws-home-tile-body">
              <div className="ws-home-tile-label">{tile.label}</div>
              <div className="ws-home-tile-value">{tile.value}</div>
              <div className="ws-home-tile-caption">{tile.caption}</div>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* --- Deux colonnes : communautés à gauche, panneaux à droite --- */}
      <div className="ws-home-columns">
        <div className="ws-home-main">
          <section className="ws-section">
            <div className="ws-section-header">
              <h2 className="ws-section-title">Mes communautés</h2>
              <span className="ws-muted">{mine.length} affichée(s)</span>
            </div>

            {loading ? (
              <div className="ws-home-grid">
                {[0, 1, 2].map((index) => (
                  <span
                    className="ws-skeleton ws-home-skel-card"
                    key={index}
                  />
                ))}
              </div>
            ) : mine.length === 0 ? (
              hasSearch ? (
                <div className="ws-home-empty">
                  <span className="ws-home-empty-icon">
                    <Search size={22} />
                  </span>
                  <div className="ws-home-empty-title">
                    Aucun résultat pour « {search.trim()} »
                  </div>
                  <p className="ws-home-empty-text">
                    Vérifiez le nom de la communauté ou essayez un autre mot
                    clé.
                  </p>
                  <div className="ws-home-empty-actions">
                    <button
                      className="ws-button ws-button-small"
                      type="button"
                      onClick={() => setSearch("")}
                    >
                      <X size={15} /> Effacer la recherche
                    </button>
                  </div>
                </div>
              ) : (
                <div className="ws-home-empty">
                  <span className="ws-home-empty-icon">
                    <Compass size={22} />
                  </span>
                  <div className="ws-home-empty-title">
                    Aucune communauté pour l'instant
                  </div>
                  <p className="ws-home-empty-text">
                    Créez votre première communauté ou rejoignez-en une depuis
                    la liste des communautés publiques.
                  </p>
                  <div className="ws-home-empty-actions">
                    <CreateCommunityButton onBeforeOpen={() => setError("")} />
                  </div>
                </div>
              )
            ) : (
              <div className="ws-home-grid">
                {mine.map((community) => {
                  const badge = typeBadgeOf(community);

                  return (
                    <motion.div
                      className="ws-home-card"
                      key={community.id}
                      layout
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileHover={{ y: -3 }}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/c/${community.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          navigate(`/c/${community.id}`);
                        }
                      }}
                    >
                      <div className="ws-home-card-top">
                        <span className="ws-home-avatar">
                          {initialsOf(community.name)}
                        </span>

                        <span className={`ws-badge ${badge.className}`}>
                          {badge.label}
                        </span>

                        {community.role && !community.isSystem ? (
                          <span
                            className={`ws-badge ws-badge-${roleKey(
                              community.role
                            )}`}
                          >
                            {roleLabel(community.role)}
                          </span>
                        ) : null}
                      </div>

                      <h3 className="ws-home-card-name">{community.name}</h3>

                      <p className="ws-home-card-desc">
                        {community.description ||
                          "Espace de travail collaboratif pour échanger et travailler ensemble."}
                      </p>

                      <div className="ws-home-card-foot">
                        <span className="ws-home-meta">
                          <Users size={15} /> {community.memberCount ?? 0}
                        </span>
                        <span className="ws-home-meta">
                          <Hash size={15} /> {community.channelCount ?? 0}
                        </span>
                        <span className="ws-home-card-open">
                          Ouvrir <ChevronRight size={16} />
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="ws-section">
            <div className="ws-section-header">
              <h2 className="ws-section-title">
                Découvrir des communautés publiques
              </h2>
              <span className="ws-muted">{discover.length} ouverte(s)</span>
            </div>

            {loading ? (
              <div className="ws-skeletons">
                <span className="ws-skeleton ws-home-skel-row" />
                <span className="ws-skeleton ws-home-skel-row" />
              </div>
            ) : discover.length === 0 ? (
              <div className="ws-home-empty">
                <span className="ws-home-empty-icon">
                  <Globe size={22} />
                </span>
                <div className="ws-home-empty-title">
                  Aucune communauté publique à découvrir
                </div>
                <p className="ws-home-empty-text">
                  Les nouvelles communautés publiques apparaîtront ici dès
                  qu'elles seront créées.
                </p>
              </div>
            ) : (
              <div className="ws-list">
                {discover.map((community) => (
                  <div className="ws-list-row" key={community.id}>
                    <span className="ws-home-row-icon">
                      <Globe size={20} />
                    </span>

                    <div className="ws-list-row-main">
                      <div className="ws-list-row-name">{community.name}</div>
                      <div className="ws-list-row-sub">
                        {community.description || "Communauté publique"}
                      </div>

                      <div className="ws-home-row-chips">
                        <span className="ws-home-chip">
                          <Users size={13} /> {community.memberCount ?? 0}{" "}
                          membre(s)
                        </span>
                        <span className="ws-home-chip">
                          <Hash size={13} /> {community.channelCount ?? 0}{" "}
                          salon(s)
                        </span>
                        <span className="ws-home-chip">
                          <Globe size={13} /> Lecture publique
                        </span>
                      </div>
                    </div>

                    <div className="ws-list-row-actions">
                      <button
                        className="ws-button ws-button-small"
                        type="button"
                        onClick={() => navigate(`/c/${community.id}`)}
                      >
                        Aperçu
                      </button>

                      <button
                        className="ws-button ws-button-small ws-button-primary"
                        type="button"
                        disabled={busyId === community.id}
                        onClick={() => handleJoin(community)}
                      >
                        {busyId === community.id ? "…" : "Rejoindre"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="ws-home-aside">
          {/* --- Messages privés : présence, non-lus, accès direct --- */}
          <section className="ws-card ws-home-panel">
            <div className="ws-home-panel-head">
              <h3 className="ws-home-panel-title">
                <MessageSquare size={18} /> Messages privés
                {unreadDmCount > 0 ? (
                  <span className="ws-count-badge">
                    {unreadDmCount > 99 ? "99+" : unreadDmCount}
                  </span>
                ) : null}
              </h3>

              <button
                className="ws-button ws-icon-button ws-tip-end"
                type="button"
                data-tip="Nouvelle conversation"
                aria-label="Nouvelle conversation"
                onClick={openComposer}
              >
                <UserPlus size={17} />
              </button>
            </div>

            <div className="ws-tabs ws-dm-tabs" role="tablist">
              {[
                ["all", "Tous"],
                ["unread", "Non lus"],
                ["online", "En ligne"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={`ws-tab${dmTab === key ? " active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={dmTab === key}
                  onClick={() => setDmTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {dmsLoading ? (
              <div className="ws-skeletons">
                <span className="ws-skeleton ws-skeleton-tall" />
                <span className="ws-skeleton ws-skeleton-tall" />
                <span className="ws-skeleton ws-skeleton-tall" />
              </div>
            ) : dmRows.length === 0 ? (
              <p className="ws-home-panel-empty">
                {dmTab === "unread"
                  ? "Aucun message non lu, tout est à jour."
                  : dmTab === "online"
                  ? "Aucun contact en ligne pour le moment."
                  : "Aucune conversation. Écrivez à un membre de vos communautés."}
              </p>
            ) : (
              <div className="ws-dm-list">
                {dmRows.map((conversation) => (
                  <button
                    className={`ws-dm-row${
                      conversation.unreadCount > 0 ? " unread" : ""
                    }`}
                    key={conversation.id}
                    type="button"
                    onClick={() => navigate(`/messages/${conversation.id}`)}
                  >
                    <span className="ws-mp-avatar ws-avatar-wrap">
                      {initialsOf(conversation.participant.name)}
                      <span
                        className={`ws-presence-dot ${
                          presenceOf(conversation.participant.status).tone
                        }`}
                      />
                    </span>

                    <span className="ws-dm-body">
                      <span className="ws-dm-line">
                        <span className="ws-dm-name">
                          {conversation.participant.name}
                        </span>
                        <span className="ws-home-row-when">
                          {relativeTime(
                            conversation.lastMessage?.createdAt ||
                              conversation.updatedAt
                          )}
                        </span>
                      </span>

                      <span className="ws-dm-line">
                        <span className="ws-dm-preview">
                          {previewOf(conversation)}
                        </span>

                        {conversation.unreadCount > 0 ? (
                          <span className="ws-count-badge">
                            {conversation.unreadCount > 99
                              ? "99+"
                              : conversation.unreadCount}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="ws-home-panel-foot">
              <button
                className="ws-button ws-button-small"
                type="button"
                onClick={() => navigate("/messages")}
              >
                Ouvrir la messagerie <ChevronRight size={15} />
              </button>
            </div>
          </section>

          {/* --- Activité : dernières notifications, tout marquer comme lu --- */}
          <section className="ws-card ws-home-panel">
            <div className="ws-home-panel-head">
              <h3 className="ws-home-panel-title">
                <Bell size={18} /> Activité
              </h3>

              <button
                className="ws-button ws-button-small"
                type="button"
                disabled={notificationUnread === 0}
                onClick={handleMarkAllRead}
              >
                <Check size={15} /> Tout lire
              </button>
            </div>

            {notificationsLoading ? (
              <div className="ws-skeletons">
                <span className="ws-skeleton ws-skeleton-tall" />
                <span className="ws-skeleton ws-skeleton-tall" />
              </div>
            ) : notifications.length === 0 ? (
              <p className="ws-home-panel-empty">
                Aucune activité pour le moment. Les mentions, réponses et
                invitations apparaîtront ici.
              </p>
            ) : (
              <div className="ws-activity-list">
                {notifications.slice(0, 6).map((item) => (
                  <button
                    className={`ws-activity-item${
                      item.readAt ? "" : " unread"
                    }`}
                    key={item.id}
                    type="button"
                    onClick={() => navigate("/notifications")}
                  >
                    <span className="ws-activity-icon">
                      {notificationIcon(item.type)}
                    </span>

                    <span className="ws-activity-body">
                      <span className="ws-activity-title">{item.title}</span>

                      {item.body ? (
                        <span className="ws-activity-text">{item.body}</span>
                      ) : null}

                      <span className="ws-activity-meta">
                        {relativeTime(item.createdAt)}
                      </span>
                    </span>

                    {item.readAt ? null : <span className="ws-activity-dot" />}
                  </button>
                ))}
              </div>
            )}

            <div className="ws-home-panel-foot">
              <button
                className="ws-button ws-button-small"
                type="button"
                onClick={() => navigate("/notifications")}
              >
                Toutes les notifications <ChevronRight size={15} />
              </button>
            </div>
          </section>
        </aside>
      </div>

      {/* --- Modale : nouvelle conversation privée --- */}
      <AnimatePresence>
        {composerOpen ? (
          <motion.div
            className="ws-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setComposerOpen(false)}
          >
            <motion.div
              className="ws-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Nouvelle conversation"
              initial={{ opacity: 0, scale: 0.94, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="ws-modal-header">
                <div>
                  <h2 className="ws-modal-title">Nouvelle conversation</h2>
                  <p className="ws-modal-subtitle">
                    Choisissez un membre de vos communautés pour discuter en
                    privé.
                  </p>
                </div>

                <button
                  className="ws-button ws-icon-button"
                  type="button"
                  aria-label="Fermer"
                  onClick={() => setComposerOpen(false)}
                >
                  ×
                </button>
              </div>

              <div className="ws-home-search">
                <Search size={18} />
                <input
                  type="text"
                  autoFocus
                  placeholder="Rechercher un membre…"
                  value={contactQuery}
                  onChange={(event) => setContactQuery(event.target.value)}
                  aria-label="Rechercher un membre"
                />

                {contactQuery ? (
                  <button
                    className="ws-home-search-clear"
                    type="button"
                    aria-label="Effacer la recherche"
                    onClick={() => setContactQuery("")}
                  >
                    <X size={16} />
                  </button>
                ) : null}
              </div>

              {composerError ? (
                <div
                  className="ws-alert ws-alert-error"
                  style={{ marginTop: 14 }}
                >
                  {composerError}
                </div>
              ) : null}

              <div className="ws-contact-list">
                {contactsLoading ? (
                  <div className="ws-skeletons">
                    <span className="ws-skeleton ws-skeleton-tall" />
                    <span className="ws-skeleton ws-skeleton-tall" />
                  </div>
                ) : contacts.length === 0 ? (
                  <p className="ws-home-panel-empty">
                    Aucun membre trouvé. Les contacts proposés sont les
                    personnes de vos communautés.
                  </p>
                ) : (
                  contacts.map((contact) => (
                    <div className="ws-contact-row" key={contact.id}>
                      <span className="ws-mp-avatar ws-avatar-wrap">
                        {initialsOf(contact.name)}
                        <span
                          className={`ws-presence-dot ${
                            presenceOf(contact.status).tone
                          }`}
                        />
                      </span>

                      <div className="ws-contact-body">
                        <div className="ws-contact-name">{contact.name}</div>
                        <div className="ws-contact-sub">
                          {presenceOf(contact.status).label}
                        </div>
                      </div>

                      <button
                        className="ws-button ws-button-small ws-button-primary"
                        type="button"
                        disabled={openingId === contact.id}
                        onClick={() => handleStartConversation(contact)}
                      >
                        {openingId === contact.id ? "…" : "Écrire"}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </WorkspaceShell>
  );
}

/**
 * Bouton d'en-tête de la page : il lit le contexte du shell, dans lequel il est
 * rendu — l'appel à `useWorkspace()` est donc valide ici (contrairement au
 * corps de `Dashboard`, qui est au-dessus du provider).
 */
function CreateCommunityButton({ onBeforeOpen }) {
  const workspace = useWorkspace();

  return (
    <motion.button
      className="ws-button ws-button-primary"
      type="button"
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => {
        onBeforeOpen();
        workspace?.openCreateCommunity();
      }}
    >
      <Plus size={17} /> Créer une communauté
    </motion.button>
  );
}

export default Dashboard;
