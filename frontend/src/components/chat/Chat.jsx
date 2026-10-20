import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Paperclip,
  Image,
  Send,
  X,
  LoaderCircle,
  Lock,
  Trash2,
  Smile,
  Pin,
  PinOff,
  MessagesSquare,
  Search,
} from "lucide-react";
import socket from "../../services/socket";
import { API_URL, apiFetch, apiUpload } from "../../services/api";
import { PERMISSIONS, REACTION_EMOJIS } from "../../permissions";

/** Référence stable : évite de recréer un tableau à chaque rendu. */
const EMPTY_MEMBERS = [];

function Chat({
  roomId,
  communityId,
  currentUserId,
  token,
  permissions = [],
  // Salon d'annonces consulté par un non-responsable : le composeur est masqué
  // (le serveur refuse de toute façon tout envoi sans la permission dédiée).
  readOnly = false,
  readOnlyNotice = "Seuls les responsables peuvent publier dans ce salon.",
}) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [typingUser, setTypingUser] = useState("");
  const [members, setMembers] = useState([]);
  const [activities, setActivities] = useState([]);
  // Pièce jointe déjà déposée sur le serveur, en attente d'être rattachée au
  // prochain message. Tant qu'elle n'est pas envoyée, elle n'appartient à aucun
  // message : c'est exactement ce que fait `attachments.message_id = NULL`.
  const [pendingFile, setPendingFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  // Modération. La permission vient du serveur (`GET /api/channels/:id` →
  // `permissions`) : elle sert uniquement à ne pas proposer une action qui
  // serait refusée. Le serveur revérifie tout de toute façon.
  const [moderationError, setModerationError] = useState("");
  const [confirmingId, setConfirmingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // --- Messagerie avancée (jalon 5) ---
  // Réactions : quel message a son sélecteur ouvert.
  const [pickerId, setPickerId] = useState(null);
  // Épinglage : panneau ouvert + contenu réel chargé depuis l'API.
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [pinned, setPinned] = useState([]);
  const [pinnedLoading, setPinnedLoading] = useState(false);
  // Fil de discussion : message parent affiché à droite + ses réponses.
  const [threadParent, setThreadParent] = useState(null);
  const [threadReplies, setThreadReplies] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  // Recherche.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchScope, setSearchScope] = useState("channel");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  // Mentions : annuaire de la communauté pour l'autocomplétion. Il est conservé
  // avec l'identifiant de sa communauté afin de ne jamais afficher l'annuaire
  // d'une communauté sur le salon d'une autre.
  const [directory, setDirectory] = useState({
    communityId: null,
    members: EMPTY_MEMBERS,
  });
  const [mentionQuery, setMentionQuery] = useState(null);

  const canModerate = permissions.includes(PERMISSIONS.MODERATE_MESSAGES);
  const canPin = permissions.includes(PERMISSIONS.PIN_MESSAGES);
  const canReact = permissions.includes(PERMISSIONS.REACT_MESSAGES);

  const typingTimeoutRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);
  // Identifiant du fil ouvert, lisible depuis les gestionnaires Socket.IO (qui
  // capturent les props du rendu où ils ont été posés).
  const threadParentRef = useRef(null);

  useEffect(() => {
    threadParentRef.current = threadParent ? String(threadParent.id) : null;
  }, [threadParent]);

  /** Annuaire réellement utilisable pour ce salon. */
  const communityMembers =
    directory.communityId !== null &&
    String(directory.communityId) === String(communityId)
      ? directory.members
      : EMPTY_MEMBERS;

  /** Nom lisible d'un compte mentionné, pour surligner `@nom` dans le texte. */
  const memberNameById = useMemo(() => {
    const map = new Map();

    for (const member of communityMembers) {
      map.set(Number(member.userId), member.name);
    }

    return map;
  }, [communityMembers]);

  /** Suggestions de mention correspondant à ce qui est tapé après « @ ». */
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) {
      return [];
    }

    const needle = mentionQuery.toLowerCase();

    return communityMembers
      .filter((member) => Number(member.userId) !== Number(currentUserId))
      .filter((member) =>
        member.name.toLowerCase().includes(needle)
      )
      .slice(0, 6);
  }, [mentionQuery, communityMembers, currentUserId]);

  useEffect(() => {
    if (!roomId) {
      return;
    }

    socket.emit("get-chat-history", roomId);

    function handleChatHistory(history) {
      setMessages(history);

      history.forEach((item) => {
        // L'auteur d'un message est l'identifiant de COMPTE : comparer avec
        // `socket.id` marquait chaque message comme « non lu », y compris les
        // siens, et les accusés partaient pour le mauvais utilisateur.
        if (item.authorId !== currentUserId) {
          socket.emit("message-read", {
            roomId,
            messageId: item.id,
          });
        }
      });
    }

    // Après une reconnexion, le serveur ne connaît plus les salons rejoints par
    // ce socket : on redemande l'historique pour repartir d'un état cohérent.
    function handleReconnect() {
      socket.emit("get-chat-history", roomId);
    }

    socket.on("connect", handleReconnect);

    function handleReceiveMessage(newMessage) {
      setMessages((current) => {
        // Un message déjà connu (réémission, reconnexion) ne doit pas être
        // ajouté deux fois.
        if (current.some((item) => item.id === newMessage.id)) {
          return current;
        }

        // Une réponse fait monter le compteur de son message parent.
        const withParent = newMessage.replyToId
          ? current.map((item) =>
              String(item.id) === String(newMessage.replyToId)
                ? {
                    ...item,
                    replyCount: (Number(item.replyCount) || 0) + 1,
                    lastReplyAt: newMessage.createdAt,
                  }
                : item
            )
          : current;

        return [...withParent, newMessage];
      });

      // Si le fil de ce message est ouvert, la réponse y apparaît tout de suite.
      if (
        newMessage.replyToId &&
        threadParentRef.current === String(newMessage.replyToId)
      ) {
        setThreadReplies((current) =>
          current.some((item) => item.id === newMessage.id)
            ? current
            : [...current, newMessage]
        );
      }

      setActivities((current) => [
        ...current.slice(-5),
        {
          id: `${newMessage.id}-activity`,
          text: `${newMessage.userName || "Un membre"} a envoyé un message`,
          time: newMessage.createdAt,
          type: "message",
        },
      ]);

      if (newMessage.authorId !== currentUserId) {
        socket.emit("message-read", {
          roomId,
          messageId: newMessage.id,
        });
      }
    }

    function handleMessageRead(data) {
      setMessages((current) =>
        current.map((item) => {
          if (item.id !== data.messageId) {
            return item;
          }

          const currentReadBy = item.readBy || [];

          if (
            currentReadBy.includes(data.readerId)
          ) {
            return item;
          }

          return {
            ...item,
            readBy: [
              ...currentReadBy,
              data.readerId,
            ],
          };
        })
      );
    }

    function handleUserTyping(data) {
      setTypingUser(
        data.userName || "Un membre"
      );
    }

    function handleUserStopTyping() {
      setTypingUser("");
    }

    function handleRoomMembers(memberList) {
      // Ancien format : une liste d'identifiants de connexion.
      setMembers(memberList);
    }

    function handleRoomParticipants(participants) {
      // Nouveau format : le nom de chaque participant est fourni par le serveur.
      setMembers(
        participants.map(
          (participant) => participant.name || "Membre"
        )
      );
    }

    /**
     * Un message supprimé (par son auteur ou par un modérateur) est signalé à
     * tout le salon. La suppression est douce côté base : la ligne et sa place
     * dans la conversation restent, seul le contenu disparaît.
     */
    function handleMessageDeleted(payload) {
      const deletedId = payload?.deletedId;

      if (!deletedId) {
        return;
      }

      setMessages((current) =>
        current.map((item) =>
          String(item.id) === String(deletedId)
            ? {
                ...item,
                message: "Message supprimé",
                deleted: true,
                attachments: [],
              }
            : item
        )
      );
    }

    // --- Messagerie avancée : réactions et épinglage diffusés en direct ---
    function handleReaction(payload) {
      setMessages((current) =>
        current.map((item) =>
          String(item.id) === String(payload.messageId)
            ? { ...item, reactions: payload.reactions || [] }
            : item
        )
      );
    }

    function handlePinned(payload) {
      setMessages((current) =>
        current.map((item) =>
          String(item.id) === String(payload.messageId)
            ? { ...item, pinned: true }
            : item
        )
      );
    }

    function handleUnpinned(payload) {
      setMessages((current) =>
        current.map((item) =>
          String(item.id) === String(payload.messageId)
            ? { ...item, pinned: false }
            : item
        )
      );
    }

    socket.on(
      "room-participants",
      handleRoomParticipants
    );

    socket.on("message:reaction", handleReaction);
    socket.on("message:pinned", handlePinned);
    socket.on("message:unpinned", handleUnpinned);

    socket.on(
      "message:deleted",
      handleMessageDeleted
    );

    socket.on(
      "chat-history",
      handleChatHistory
    );

    socket.on(
      "receive-message",
      handleReceiveMessage
    );

    socket.on(
      "message-read",
      handleMessageRead
    );

    socket.on(
      "user-typing",
      handleUserTyping
    );

    socket.on(
      "user-stop-typing",
      handleUserStopTyping
    );

    socket.on(
      "room-members",
      handleRoomMembers
    );

    return () => {
      socket.off(
        "chat-history",
        handleChatHistory
      );

      socket.off(
        "receive-message",
        handleReceiveMessage
      );

      socket.off(
        "message-read",
        handleMessageRead
      );

      socket.off(
        "user-typing",
        handleUserTyping
      );

      socket.off(
        "user-stop-typing",
        handleUserStopTyping
      );

      socket.off(
        "room-members",
        handleRoomMembers
      );

      socket.off(
        "room-participants",
        handleRoomParticipants
      );

      socket.off(
        "message:deleted",
        handleMessageDeleted
      );

      socket.off("message:reaction", handleReaction);
      socket.off("message:pinned", handlePinned);
      socket.off("message:unpinned", handleUnpinned);

      socket.off("connect", handleReconnect);

      if (typingTimeoutRef.current) {
        clearTimeout(
          typingTimeoutRef.current
        );
      }
    };
  }, [roomId, currentUserId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  /**
   * Annuaire de la communauté : il alimente l'autocomplétion des mentions et le
   * surlignage des `@nom`. Le surlignage ne fait que mettre en forme un texte
   * déjà accepté par le serveur — il ne crédite personne en droits.
   *
   * `setDirectory` est appelé après l'attente réseau : aucun état n'est posé
   * de façon synchrone dans le corps de l'effet.
   */
  useEffect(() => {
    if (!communityId || !token) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      const result = await apiFetch(`/api/communities/${communityId}/members`, {
        token,
      });

      if (cancelled) {
        return;
      }

      if (result.ok) {
        setDirectory({
          communityId,
          members: result.data?.members || [],
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [communityId, token]);

  function handleTyping(event) {
    const value = event.target.value;

    setMessage(value);
    setMentionQuery(detectMention(value, event.target.selectionStart));

    if (!value.trim()) {
      socket.emit(
        "stop-typing",
        roomId
      );
      return;
    }

    socket.emit("typing", {
      roomId,
    });

    if (typingTimeoutRef.current) {
      clearTimeout(
        typingTimeoutRef.current
      );
    }

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit(
        "stop-typing",
        roomId
      );
    }, 1500);
  }

  function sendMessage(event) {
    event.preventDefault();

    const text = message.trim();

    // Autorise l'envoi d'un fichier seul (sans texte).
    if (!text && !pendingFile) {
      return;
    }

    socket.emit("send-message", {
      roomId,
      message: text,
      attachmentIds: pendingFile ? [pendingFile.id] : undefined,
    });

    setMessage("");
    setPendingFile(null);
    setMentionQuery(null);

    socket.emit(
      "stop-typing",
      roomId
    );

    if (typingTimeoutRef.current) {
      clearTimeout(
        typingTimeoutRef.current
      );
    }
  }

  function handleFileClick() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];

    // On vide tout de suite le champ : sélectionner deux fois le même fichier
    // doit fonctionner.
    event.target.value = "";

    if (!file) {
      return;
    }

    setUploadError("");
    setUploading(true);

    // Le fichier part réellement sur le serveur (multipart) : il est écrit sur
    // le disque et enregistré en base avant même l'envoi du message.
    const result = await apiUpload(`/api/channels/${roomId}/attachments`, {
      token,
      file,
    });

    setUploading(false);

    if (!result.ok) {
      setUploadError(
        result.data?.message || "Dépôt du fichier refusé par le serveur."
      );
      return;
    }

    setPendingFile(result.data.attachment);
  }

  /**
   * Téléchargement authentifié : la route exige l'en-tête `Authorization`,
   * donc un simple `<a href>` ne suffit pas. On récupère le fichier avec le
   * jeton puis on ouvre l'URL d'objet obtenue.
   */
  async function openAttachment(attachment) {
    setUploadError("");

    const response = await fetch(
      `${API_URL}/api/channels/${roomId}/attachments/${attachment.id}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }
    );

    if (!response.ok) {
      setUploadError("Téléchargement impossible (accès refusé ou fichier absent).");
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    window.open(url, "_blank", "noopener");

    // L'URL d'objet est libérée plus tard : la fenêtre ouverte a eu le temps
    // de charger le contenu.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function formatSize(bytes) {
    const value = Number(bytes) || 0;

    if (value < 1024) {
      return `${value} o`;
    }

    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} Ko`;
    }

    return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
  }

  /**
   * Suppression d'un message, avec confirmation explicite : rien ne part sur
   * simple clic. Le serveur n'autorise que l'auteur du message — ou un rôle
   * disposant de `message:moderate` — et renvoie un motif lisible sinon.
   */
  function handleDelete(item) {
    if (deletingId) {
      return;
    }

    setModerationError("");
    setDeletingId(item.id);

    socket.emit(
      "message:delete",
      { channel: roomId, messageId: item.id },
      (ack) => {
        setDeletingId(null);
        setConfirmingId(null);

        if (!ack || ack.success === false) {
          setModerationError(ack?.message || "Suppression impossible.");
        }
      }
    );
  }

  function formatTime(timestamp) {
    if (!timestamp) {
      return "";
    }

    return new Date(
      timestamp
    ).toLocaleTimeString(
      "fr-FR",
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    );
  }

  function getInitial(index) {
    return String(index + 1).padStart(
      2,
      "0"
    );
  }

  // ---------------------------------------------------------------------------
  // Réactions
  // ---------------------------------------------------------------------------

  /** Ce compte a-t-il déjà réagi avec cet emoji ? */
  function hasMyReaction(reactions, emoji) {
    return (reactions || []).some(
      (entry) =>
        entry.emoji === emoji &&
        (entry.users || []).some(
          (id) => Number(id) === Number(currentUserId)
        )
    );
  }

  async function toggleReaction(item, emoji) {
    setModerationError("");
    setPickerId(null);

    const active = hasMyReaction(item.reactions, emoji);
    const base = `/api/channels/${roomId}/messages/${item.id}/reactions`;

    // Le serveur décide ; l'interface ne fait que proposer.
    const result = active
      ? await apiFetch(`${base}/${encodeURIComponent(emoji)}`, {
          method: "DELETE",
          token,
        })
      : await apiFetch(base, { method: "POST", token, body: { emoji } });

    if (!result.ok) {
      setModerationError(
        result.data?.message || "Réaction refusée par le serveur."
      );
      return;
    }

    const reactions = result.data?.reactions || [];

    setMessages((current) =>
      current.map((entry) =>
        String(entry.id) === String(item.id)
          ? { ...entry, reactions }
          : entry
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Épinglage
  // ---------------------------------------------------------------------------

  async function refreshPinned() {
    setPinnedLoading(true);

    const result = await apiFetch(`/api/channels/${roomId}/pins`, { token });

    setPinnedLoading(false);

    if (result.ok) {
      setPinned(result.data?.pins || []);
    }
  }

  async function togglePinnedPanel() {
    const next = !pinnedOpen;
    setPinnedOpen(next);

    if (next) {
      await refreshPinned();
    }
  }

  async function togglePin(item) {
    setModerationError("");

    const base = `/api/channels/${roomId}/messages/${item.id}/pin`;

    const result = item.pinned
      ? await apiFetch(base, { method: "DELETE", token })
      : await apiFetch(base, { method: "POST", token });

    if (!result.ok) {
      setModerationError(
        result.data?.message || "Épinglage refusé par le serveur."
      );
      return;
    }

    setMessages((current) =>
      current.map((entry) =>
        String(entry.id) === String(item.id)
          ? { ...entry, pinned: !item.pinned }
          : entry
      )
    );

    if (pinnedOpen) {
      await refreshPinned();
    }
  }

  // ---------------------------------------------------------------------------
  // Fil de discussion
  // ---------------------------------------------------------------------------

  async function openThread(item) {
    setPickerId(null);
    setThreadParent(item);
    setThreadReplies([]);
    setReplyText("");
    setThreadLoading(true);

    const result = await apiFetch(
      `/api/channels/${roomId}/messages/${item.id}/replies`,
      { token }
    );

    setThreadLoading(false);

    if (result.ok) {
      setThreadReplies(result.data?.replies || []);
    } else {
      setModerationError(result.data?.message || "Fil inaccessible.");
    }
  }

  function closeThread() {
    setThreadParent(null);
    setThreadReplies([]);
    setReplyText("");
  }

  function sendReply(event) {
    event.preventDefault();

    const text = replyText.trim();

    if (!text || !threadParent) {
      return;
    }

    // Même protocole que le salon : le serveur rattache la réponse au parent et
    // prévient son auteur.
    socket.emit("send-message", {
      roomId,
      message: text,
      replyToId: threadParent.id,
    });

    setReplyText("");
  }

  // ---------------------------------------------------------------------------
  // Recherche
  // ---------------------------------------------------------------------------

  async function runSearch(event) {
    event?.preventDefault();

    const term = searchTerm.trim();

    setSearchError("");

    if (term.length < 2) {
      setSearchError("Saisissez au moins deux caractères.");
      return;
    }

    setSearching(true);

    const path =
      searchScope === "community" && communityId
        ? `/api/communities/${communityId}/messages/search?q=${encodeURIComponent(term)}`
        : `/api/channels/${roomId}/messages/search?q=${encodeURIComponent(term)}`;

    const result = await apiFetch(path, { token });

    setSearching(false);

    if (!result.ok) {
      setSearchResults([]);
      setSearchError(result.data?.message || "Recherche impossible.");
      return;
    }

    setSearchResults(result.data?.messages || []);
  }

  // ---------------------------------------------------------------------------
  // Mentions
  // ---------------------------------------------------------------------------

  /** Mot en cours de frappe après un « @ » (null si aucun). */
  function detectMention(value, caret) {
    const before = value.slice(0, caret ?? value.length);
    const at = before.lastIndexOf("@");

    if (at === -1) {
      return null;
    }

    const token = before.slice(at + 1);

    // Un espace termine le mot : on ne devine pas « Jean Dupont » en entier.
    if (token.length > 40 || token.includes(" ")) {
      return null;
    }

    return token;
  }

  function insertMention(member) {
    const input = inputRef.current;
    const caret = input?.selectionStart ?? message.length;
    const at = message.slice(0, caret).lastIndexOf("@");

    if (at === -1) {
      return;
    }

    const next = `${message.slice(0, at)}@${member.name} ${message.slice(caret)}`;

    setMessage(next);
    setMentionQuery(null);
    input?.focus();
  }

  /**
   * Le texte d'un message, quelle que soit sa provenance : l'API REST renvoie
   * `content`, le protocole Socket.IO historique renvoie `message`.
   */
  function messageText(item) {
    return item.message ?? item.content ?? "";
  }

  /** Nom de l'auteur, quelle que soit la forme du message reçu. */
  function messageAuthorName(item) {
    return item.userName || item.author?.name || "Membre";
  }

  /**
   * Surligne les `@nom` reconnus par le serveur (`item.mentions` contient des
   * identifiants de comptes, jamais du texte deviné côté client).
   */
  function renderContent(item) {
    const names = (item.mentions || [])
      .map((id) => memberNameById.get(Number(id)))
      .filter(Boolean);

    if (names.length === 0) {
      return item.message;
    }

    const pattern = new RegExp(
      `(@(?:${names
        .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|")}))`,
      "g"
    );

    return String(item.message)
      .split(pattern)
      .map((part, index) =>
        names.some((name) => part === `@${name}`) ? (
          <strong className="devmeet-mention" key={`${item.id}-m-${index}`}>
            {part}
          </strong>
        ) : (
          part
        )
      );
  }

  return (
    <div className="devmeet-chat">
      <style>
        {`
          .devmeet-chat {
            width: 100%;
            height: calc(100vh - 185px);
            min-height: 500px;
            display: grid;
            grid-template-columns: minmax(0, 1fr) 250px;
            overflow: hidden;
            border: 1px solid #30363d;
            border-radius: 10px;
            background: #0d1117;
          }

          .devmeet-chat-center {
            position: relative;
            min-width: 0;
            min-height: 0;
            display: flex;
            flex-direction: column;
            background: #161b22;
          }

          .devmeet-chat-header {
            min-height: 62px;
            padding: 0 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            border-bottom: 1px solid #30363d;
          }

          .devmeet-chat-header-left {
            min-width: 0;
          }

          .devmeet-chat-header-title {
            margin: 0;
            color: #f0f6fc;
            font-size: 13px;
            font-weight: 650;
            letter-spacing: -0.2px;
          }

          .devmeet-chat-header-subtitle {
            margin: 4px 0 0;
            color: #8b949e;
            font-size: 9px;
          }

          .devmeet-chat-header-actions {
            display: flex;
            align-items: center;
            gap: 6px;
          }

          .devmeet-chat-icon-button {
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid #30363d;
            border-radius: 7px;
            background: #161b22;
            color: #8b949e;
            cursor: pointer;
            font-size: 11px;
          }

          .devmeet-chat-icon-button:hover {
            border-color: #5865f2;
            background: rgba(88,101,242,0.08);
            color: #f0f6fc;
          }

          .devmeet-chat-icon-button.active {
            border-color: #5865f2;
            background: rgba(88,101,242, 0.16);
            color: #f0f6fc;
          }

          .devmeet-chat-messages {
            flex: 1;
            min-height: 0;
            padding: 20px 18px;
            overflow-y: auto;
            background:
              radial-gradient(circle at 20% 0%, rgba(88,101,242,0.05), transparent 28%),
              #161b22;
          }

          .devmeet-chat-empty {
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #8b949e;
            font-size: 11px;
          }

          .devmeet-message-row {
            width: 100%;
            display: flex;
            margin-bottom: 17px;
          }

          .devmeet-message-row.received {
            justify-content: flex-start;
          }

          .devmeet-message-row.sent {
            justify-content: flex-end;
          }

          .devmeet-message-block {
            max-width: min(72%, 520px);
          }

          .devmeet-message-meta {
            display: flex;
            align-items: center;
            gap: 7px;
            margin-bottom: 5px;
            font-size: 8px;
          }

          .devmeet-message-row.received .devmeet-message-meta {
            justify-content: flex-start;
          }

          .devmeet-message-row.sent .devmeet-message-meta {
            justify-content: flex-end;
          }

          .devmeet-message-author {
            color: #8b949e;
            font-weight: 600;
          }

          .devmeet-message-time {
            color: #8b949e;
          }

          .devmeet-bubble {
            padding: 10px 12px;
            border-radius: 10px;
            font-size: 11px;
            line-height: 1.5;
            word-break: break-word;
          }

          .devmeet-message-row.received .devmeet-bubble {
            color: #b0bac6;
            background: #2d333b;
            border: 1px solid #30363d;
            border-top-left-radius: 4px;
          }

          .devmeet-message-row.sent .devmeet-bubble {
            color: #f0f6fc;
            background: linear-gradient(
              135deg,
              #4752c4,
              #4752c4
            );
            border: 1px solid #4752c4;
            border-top-right-radius: 4px;
          }

          .devmeet-message-status {
            margin-top: 4px;
            text-align: right;
            color: #8b949e;
            font-size: 8px;
          }

          .devmeet-message-row.sent .devmeet-message-status {
            color: #7985ff;
          }

          .devmeet-typing {
            min-height: 21px;
            padding: 0 17px 5px;
            color: #8b949e;
            font-size: 9px;
            font-style: italic;
          }

          .devmeet-composer {
            padding: 11px;
            border-top: 1px solid #30363d;
            background: #161b22;
          }

          .devmeet-composer-readonly {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #8b949e;
            font-size: 11px;
            font-style: italic;
          }

          .devmeet-composer-box {
            min-width: 0;
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 5px 6px;
            border: 1px solid #30363d;
            border-radius: 9px;
            background: #161b22;
          }

          .devmeet-composer-tool {
            width: 30px;
            height: 30px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            border: none;
            border-radius: 7px;
            background: transparent;
            color: #8b949e;
            cursor: pointer;
            font-size: 12px;
          }

          .devmeet-composer-tool:hover {
            background: rgba(88,101,242,0.1);
            color: #f0f6fc;
          }

          .devmeet-composer-input {
            flex: 1;
            min-width: 0;
            height: 32px;
            padding: 0 7px;
            border: none;
            outline: none;
            background: transparent;
            color: #f0f6fc;
            font-size: 11px;
          }

          .devmeet-composer-input::placeholder {
            color: #56647d;
          }

          .devmeet-send {
            width: 32px;
            height: 32px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            border: none;
            border-radius: 7px;
            background: linear-gradient(
              135deg,
              #5865f2,
              #5865f2
            );
            color: #f0f6fc;
            cursor: pointer;
            font-size: 12px;
          }

          .devmeet-chat-right {
            min-width: 0;
            display: flex;
            flex-direction: column;
            background: #161b22;
            border-left: 1px solid #30363d;
            overflow-y: auto;
          }

          .devmeet-right-section {
            padding: 15px;
            border-bottom: 1px solid #30363d;
          }

          .devmeet-right-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
            color: #f0f6fc;
            font-size: 11px;
            font-weight: 600;
          }

          .devmeet-right-count {
            color: #8b949e;
            font-size: 9px;
            font-weight: 400;
          }

          .devmeet-members {
            display: flex;
            flex-direction: column;
            gap: 7px;
          }

          .devmeet-member {
            display: flex;
            align-items: center;
            gap: 9px;
            padding: 7px;
            border-radius: 7px;
          }

          .devmeet-member:hover {
            background: rgba(255,255,255,0.025);
          }

          .devmeet-member-avatar {
            position: relative;
            width: 29px;
            height: 29px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            background: linear-gradient(
              135deg,
              #7985ff,
              #7985ff
            );
            color: #f0f6fc;
            font-size: 8px;
            font-weight: 700;
          }

          .devmeet-member-avatar::after {
            content: "";
            position: absolute;
            right: -1px;
            bottom: -1px;
            width: 7px;
            height: 7px;
            border: 2px solid #161b22;
            border-radius: 50%;
            background: #3fb950;
          }

          .devmeet-member-info {
            min-width: 0;
          }

          .devmeet-member-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: #b0bac6;
            font-size: 9px;
          }

          .devmeet-member-status {
            margin-top: 2px;
            color: #3fb950;
            font-size: 8px;
          }

          .devmeet-activities {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          .devmeet-activity {
            display: flex;
            align-items: flex-start;
            gap: 8px;
          }

          .devmeet-activity-icon {
            width: 25px;
            height: 25px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 7px;
            background: rgba(88,101,242,0.11);
            border: 1px solid rgba(88,101,242,0.15);
            color: #7985ff;
            font-size: 9px;
          }

          .devmeet-activity-text {
            color: #8b949e;
            font-size: 8px;
            line-height: 1.45;
          }

          .devmeet-activity-time {
            margin-top: 2px;
            color: #4f5d76;
            font-size: 7px;
          }

          .devmeet-no-data {
            color: #56647d;
            font-size: 8px;
            line-height: 1.5;
          }

          .devmeet-hidden-file {
            display: none;
          }

          .devmeet-attachments {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-top: 7px;
          }

          .devmeet-attachment {
            display: flex;
            align-items: center;
            gap: 7px;
            max-width: 100%;
            padding: 7px 9px;
            border: 1px solid #30363d;
            border-radius: 8px;
            background: #161b22;
            color: #b0bac6;
            font-size: 10px;
            text-align: left;
            cursor: pointer;
          }

          .devmeet-message-row.sent .devmeet-attachment {
            border-color: #4752c4;
            background: rgba(9, 16, 36, 0.55);
            color: #f0f6fc;
          }

          .devmeet-attachment:hover {
            border-color: #5865f2;
            color: #f0f6fc;
          }

          .devmeet-attachment-name {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .devmeet-attachment-size {
            flex-shrink: 0;
            color: #8b949e;
            font-size: 9px;
          }

          .devmeet-pending-file {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            padding: 7px 9px;
            border: 1px dashed #30363d;
            border-radius: 8px;
            background: rgba(88,101,242,0.07);
            color: #b0bac6;
            font-size: 10px;
          }

          .devmeet-pending-remove {
            width: 22px;
            height: 22px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            border: none;
            border-radius: 6px;
            background: transparent;
            color: #8b949e;
            cursor: pointer;
          }

          .devmeet-pending-remove:hover {
            background: rgba(255,255,255,0.06);
            color: #f0f6fc;
          }

          .devmeet-upload-error {
            margin-bottom: 8px;
            padding: 7px 9px;
            border: 1px solid #5a2a2d;
            border-radius: 8px;
            background: #2a1c1f;
            color: #f85149;
            font-size: 10px;
          }

          .devmeet-action-error {
            margin-bottom: 10px;
            padding: 8px 10px;
            border: 1px solid #5a2a2d;
            border-radius: 8px;
            background: #2a1c1f;
            color: #f85149;
            font-size: 10px;
          }

          .devmeet-bubble.deleted {
            border-style: dashed;
            background: transparent;
            color: #8b949e;
            font-style: italic;
          }

          .devmeet-message-actions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 6px;
            margin-top: 6px;
          }

          .devmeet-message-delete {
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid transparent;
            border-radius: 7px;
            background: transparent;
            color: #8b949e;
            cursor: pointer;
            opacity: 0.75;
          }

          .devmeet-message-delete:hover {
            border-color: #5a2a2d;
            background: #2a1c1f;
            color: #f85149;
            opacity: 1;
          }

          .devmeet-confirm-label {
            color: #8b949e;
            font-size: 10px;
          }

          .devmeet-confirm-yes,
          .devmeet-confirm-no {
            padding: 4px 9px;
            border-radius: 7px;
            font-size: 10px;
            cursor: pointer;
          }

          .devmeet-confirm-yes {
            border: 1px solid #5a2a2d;
            background: #332124;
            color: #f85149;
          }

          .devmeet-confirm-yes:disabled {
            opacity: 0.6;
            cursor: default;
          }

          .devmeet-confirm-no {
            border: 1px solid #30363d;
            background: transparent;
            color: #8b949e;
          }

          .devmeet-spin {
            animation: devmeet-spin 900ms linear infinite;
          }

          @keyframes devmeet-spin {
            to {
              transform: rotate(360deg);
            }
          }

          /* --- Messagerie avancée (jalon 5) --- */

          .devmeet-mention {
            color: #7985ff;
            font-weight: 650;
          }

          .devmeet-message-row.mentioned .devmeet-bubble {
            border-color: #7985ff;
            box-shadow: 0 0 0 1px rgba(88,101,242, 0.35);
          }

          .devmeet-message-toolbar {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 4px;
            margin-top: 6px;
          }

          .devmeet-message-row.sent .devmeet-message-toolbar {
            justify-content: flex-end;
          }

          .devmeet-tool {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            height: 24px;
            padding: 0 8px;
            border: 1px solid #30363d;
            border-radius: 7px;
            background: #161b22;
            color: #8b949e;
            font-size: 9px;
            cursor: pointer;
          }

          .devmeet-tool:hover {
            border-color: #5865f2;
            color: #f0f6fc;
          }

          .devmeet-tool.active {
            border-color: #5865f2;
            background: rgba(88,101,242, 0.16);
            color: #f0f6fc;
          }

          .devmeet-reactions {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-top: 6px;
          }

          .devmeet-reaction {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 8px;
            border: 1px solid #30363d;
            border-radius: 999px;
            background: #161b22;
            color: #b0bac6;
            font-size: 10px;
            cursor: pointer;
          }

          .devmeet-reaction.mine {
            border-color: #5865f2;
            background: rgba(88,101,242, 0.18);
            color: #f0f6fc;
          }

          .devmeet-reaction:hover {
            border-color: #5865f2;
          }

          .devmeet-emoji-picker {
            display: flex;
            flex-wrap: wrap;
            gap: 3px;
            max-width: 224px;
            margin-top: 6px;
            padding: 6px;
            border: 1px solid #30363d;
            border-radius: 9px;
            background: #161b22;
          }

          .devmeet-emoji-option {
            width: 26px;
            height: 26px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: none;
            border-radius: 6px;
            background: transparent;
            font-size: 14px;
            line-height: 1;
            cursor: pointer;
          }

          .devmeet-emoji-option:hover {
            background: rgba(255, 255, 255, 0.08);
          }

          .devmeet-panel {
            position: absolute;
            top: 62px;
            right: 0;
            bottom: 0;
            width: min(360px, 94%);
            display: flex;
            flex-direction: column;
            border-left: 1px solid #30363d;
            background: #161b22;
            box-shadow: -18px 0 30px rgba(0, 0, 0, 0.35);
            z-index: 6;
          }

          .devmeet-panel-header {
            min-height: 46px;
            padding: 0 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            border-bottom: 1px solid #30363d;
          }

          .devmeet-panel-title {
            margin: 0;
            color: #f0f6fc;
            font-size: 11px;
            font-weight: 650;
          }

          .devmeet-panel-close {
            width: 26px;
            height: 26px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid #30363d;
            border-radius: 7px;
            background: #161b22;
            color: #8b949e;
            cursor: pointer;
          }

          .devmeet-panel-close:hover {
            border-color: #5865f2;
            color: #f0f6fc;
          }

          .devmeet-panel-body {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            padding: 12px;
          }

          .devmeet-panel-item {
            margin-bottom: 8px;
            padding: 9px 10px;
            border: 1px solid #30363d;
            border-radius: 9px;
            background: #161b22;
          }

          .devmeet-panel-item-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 5px;
            color: #8b949e;
            font-size: 9px;
          }

          .devmeet-panel-item-text {
            color: #b0bac6;
            font-size: 10px;
            line-height: 1.5;
            word-break: break-word;
          }

          .devmeet-panel-empty {
            padding: 18px 6px;
            color: #8b949e;
            font-size: 10px;
            text-align: center;
          }

          .devmeet-search-form {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 12px;
            border-bottom: 1px solid #30363d;
          }

          .devmeet-search-row {
            display: flex;
            gap: 6px;
          }

          .devmeet-search-input {
            flex: 1;
            min-width: 0;
            height: 30px;
            padding: 0 9px;
            border: 1px solid #30363d;
            border-radius: 7px;
            background: #161b22;
            color: #f0f6fc;
            font-size: 11px;
          }

          .devmeet-search-input:focus {
            outline: none;
            border-color: #5865f2;
          }

          .devmeet-search-scopes {
            display: flex;
            gap: 4px;
          }

          .devmeet-search-submit {
            height: 30px;
            padding: 0 11px;
            border: 1px solid #5865f2;
            border-radius: 7px;
            background: rgba(88,101,242, 0.18);
            color: #f0f6fc;
            font-size: 10px;
            cursor: pointer;
          }

          .devmeet-search-submit:disabled {
            opacity: 0.6;
            cursor: default;
          }

          .devmeet-panel-hint {
            color: #8b949e;
            font-size: 9px;
          }

          .devmeet-thread-reply {
            cursor: default;
          }

          .devmeet-composer-box {
            position: relative;
          }

          .devmeet-mentions {
            position: absolute;
            bottom: calc(100% + 6px);
            left: 0;
            min-width: 200px;
            max-width: 260px;
            padding: 5px;
            border: 1px solid #30363d;
            border-radius: 9px;
            background: #161b22;
            box-shadow: 0 12px 26px rgba(0, 0, 0, 0.4);
            z-index: 8;
          }

          .devmeet-mention-option {
            display: block;
            width: 100%;
            padding: 6px 8px;
            border: none;
            border-radius: 6px;
            background: transparent;
            color: #b0bac6;
            font-size: 10px;
            text-align: left;
            cursor: pointer;
          }

          .devmeet-mention-option:hover {
            background: rgba(88,101,242, 0.15);
            color: #f0f6fc;
          }

          .devmeet-thread-form {
            display: flex;
            gap: 6px;
            padding: 10px 12px;
            border-top: 1px solid #30363d;
          }

          @media (max-width: 820px) {
            .devmeet-chat {
              grid-template-columns: 1fr;
            }

            .devmeet-chat-right {
              display: none;
            }
          }

          @media (max-width: 520px) {
            .devmeet-chat-header {
              padding: 0 10px;
            }

            .devmeet-chat-header-actions {
              gap: 4px;
            }

            .devmeet-chat-icon-button {
              width: 28px;
              height: 28px;
            }

            .devmeet-chat-messages {
              padding: 15px 12px;
            }

            .devmeet-message-block {
              max-width: 84%;
            }

            .devmeet-composer {
              padding: 8px;
            }
          }
        `}
      </style>

      <section className="devmeet-chat-center">
        <header className="devmeet-chat-header">
          <div className="devmeet-chat-header-left">
            <h2 className="devmeet-chat-header-title">
              Discussion
            </h2>

            <p className="devmeet-chat-header-subtitle">
              Échangez avec les membres du salon
            </p>
          </div>

          <div className="devmeet-chat-header-actions">
            <span className="devmeet-chat-header-subtitle">
              {members.length} participant
              {members.length > 1 ? "s" : ""}
            </span>

            <button
              type="button"
              className={`devmeet-chat-icon-button${
                searchOpen ? " active" : ""
              }`}
              title="Rechercher dans les messages"
              onClick={() => {
                setThreadParent(null);
                setPinnedOpen(false);
                setSearchOpen((value) => !value);
              }}
            >
              <Search size={13} />
            </button>

            <button
              type="button"
              className={`devmeet-chat-icon-button${
                pinnedOpen ? " active" : ""
              }`}
              title="Messages épinglés"
              onClick={async () => {
                setThreadParent(null);
                setSearchOpen(false);
                await togglePinnedPanel();
              }}
            >
              <Pin size={13} />
            </button>
          </div>
        </header>

        <div className="devmeet-chat-messages">
          {moderationError ? (
            <div className="devmeet-action-error">{moderationError}</div>
          ) : null}

          {messages.length === 0 ? (
            <div className="devmeet-chat-empty">
              Aucun message pour le moment.
            </div>
          ) : (
            messages.map(
              (item, index) => {
                const isSent =
                  (item.authorId ??
                    item.senderId) ===
                  currentUserId;

                return (
                  <motion.div
                    key={`${item.id}-${index}`}
                    className={`devmeet-message-row ${
                      isSent
                        ? "sent"
                        : "received"
                    }${
                      !isSent &&
                      Array.isArray(item.mentions) &&
                      item.mentions.some(
                        (id) =>
                          Number(id) ===
                          Number(currentUserId)
                      )
                        ? " mentioned"
                        : ""
                    }`}
                    initial={{ opacity: 0, y: 14, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div className="devmeet-message-block">
                      <div className="devmeet-message-meta">
                        <span className="devmeet-message-author">
                          {item.userName ||
                            "Membre"}
                        </span>

                        <span className="devmeet-message-time">
                          {formatTime(
                            item.createdAt
                          )}
                        </span>
                      </div>

                      {item.message ? (
                        <div
                          className={`devmeet-bubble${
                            item.deleted ? " deleted" : ""
                          }`}
                        >
                          {renderContent(item)}
                        </div>
                      ) : null}

                      {Array.isArray(item.attachments) &&
                      item.attachments.length > 0 ? (
                        <div className="devmeet-attachments">
                          {item.attachments.map((attachment) => (
                            <button
                              className="devmeet-attachment"
                              key={attachment.id}
                              type="button"
                              title="Ouvrir le fichier"
                              onClick={() => openAttachment(attachment)}
                            >
                              <Paperclip size={12} />
                              <span className="devmeet-attachment-name">
                                {attachment.fileName}
                              </span>
                              <span className="devmeet-attachment-size">
                                {formatSize(attachment.size)}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {isSent && !item.deleted && (
                        <div className="devmeet-message-status">
                          {item.readBy &&
                          item.readBy.length >
                            0
                            ? "✓ Lu"
                            : "✓ Envoyé"}
                        </div>
                      )}

                      {/* Réactions agrégées : compteurs et auteurs renvoyés
                          par le serveur, jamais calculés ici. */}
                      {!item.deleted &&
                      Array.isArray(item.reactions) &&
                      item.reactions.length > 0 ? (
                        <div className="devmeet-reactions">
                          {item.reactions.map((entry) => (
                            <button
                              key={`${item.id}-${entry.emoji}`}
                              type="button"
                              className={`devmeet-reaction${
                                hasMyReaction([entry], entry.emoji)
                                  ? " mine"
                                  : ""
                              }`}
                              title="Cliquer pour réagir"
                              disabled={!canReact}
                              onClick={() =>
                                toggleReaction(item, entry.emoji)
                              }
                            >
                              <span>{entry.emoji}</span>
                              <span>{entry.count}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {/* Barre d'actions : réagir, répondre, épingler. */}
                      {!item.deleted ? (
                        <div className="devmeet-message-toolbar">
                          {canReact ? (
                            <button
                              type="button"
                              className={`devmeet-tool${
                                String(pickerId) === String(item.id)
                                  ? " active"
                                  : ""
                              }`}
                              title="Ajouter une réaction"
                              onClick={() =>
                                setPickerId((current) =>
                                  String(current) === String(item.id)
                                    ? null
                                    : item.id
                                )
                              }
                            >
                              <Smile size={11} />
                            </button>
                          ) : null}

                          <button
                            type="button"
                            className="devmeet-tool"
                            title="Répondre dans un fil"
                            onClick={() => openThread(item)}
                          >
                            <MessagesSquare size={11} />

                            {item.replyCount > 0
                              ? ` ${item.replyCount}`
                              : ""}
                          </button>

                          {canPin ? (
                            <button
                              type="button"
                              className={`devmeet-tool${
                                item.pinned ? " active" : ""
                              }`}
                              title={
                                item.pinned
                                  ? "Détacher ce message"
                                  : "Épingler ce message"
                              }
                              onClick={() => togglePin(item)}
                            >
                              {item.pinned ? (
                                <PinOff size={11} />
                              ) : (
                                <Pin size={11} />
                              )}
                            </button>
                          ) : null}

                          {item.pinned && !canPin ? (
                            <span className="devmeet-panel-hint">
                              Épinglé
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      {!item.deleted &&
                      String(pickerId) === String(item.id) ? (
                        <div className="devmeet-emoji-picker">
                          {REACTION_EMOJIS.map((emoji) => (
                            <button
                              key={`${item.id}-pick-${emoji}`}
                              type="button"
                              className="devmeet-emoji-option"
                              title={`Réagir avec ${emoji}`}
                              onClick={() =>
                                toggleReaction(item, emoji)
                              }
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {!item.deleted &&
                      (isSent || canModerate) ? (
                        <div className="devmeet-message-actions">
                          {String(confirmingId) ===
                          String(item.id) ? (
                            <>
                              <span className="devmeet-confirm-label">
                                Supprimer pour tout le monde ?
                              </span>

                              <button
                                className="devmeet-confirm-yes"
                                type="button"
                                disabled={
                                  String(deletingId) ===
                                  String(item.id)
                                }
                                onClick={() => handleDelete(item)}
                              >
                                {String(deletingId) ===
                                String(item.id)
                                  ? "Suppression…"
                                  : "Supprimer"}
                              </button>

                              <button
                                className="devmeet-confirm-no"
                                type="button"
                                onClick={() => setConfirmingId(null)}
                              >
                                Annuler
                              </button>
                            </>
                          ) : (
                            <button
                              className="devmeet-message-delete"
                              type="button"
                              title={
                                isSent
                                  ? "Supprimer mon message"
                                  : "Supprimer ce message (modération)"
                              }
                              onClick={() => setConfirmingId(item.id)}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </motion.div>
                );
              }
            )
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="devmeet-typing">
          <AnimatePresence>
            {typingUser ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {`${typingUser} est en train d’écrire…`}
                <span className="dm-typing-dots"><span /><span /><span /></span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {readOnly ? (
          <div className="devmeet-composer devmeet-composer-readonly">
            <Lock size={13} style={{ color: "#8b949e", flexShrink: 0 }} />
            <span>{readOnlyNotice}</span>
          </div>
        ) : (
        <form
          className="devmeet-composer"
          onSubmit={sendMessage}
        >
          {uploadError ? (
            <div className="devmeet-upload-error">{uploadError}</div>
          ) : null}

          {pendingFile ? (
            <div className="devmeet-pending-file">
              <Paperclip size={12} />

              <span className="devmeet-attachment-name">
                {pendingFile.fileName}
              </span>

              <span className="devmeet-attachment-size">
                {formatSize(pendingFile.size)}
              </span>

              <button
                className="devmeet-pending-remove"
                type="button"
                title="Retirer le fichier"
                onClick={() => setPendingFile(null)}
              >
                <X size={12} />
              </button>
            </div>
          ) : null}

          <div className="devmeet-composer-box">
            <button
              type="button"
              className="devmeet-composer-tool"
              title="Joindre un fichier"
              onClick={handleFileClick}
              disabled={uploading}
            >
              {uploading ? (
                <LoaderCircle size={13} className="devmeet-spin" />
              ) : (
                <Paperclip size={13} />
              )}
            </button>

            <button
              type="button"
              className="devmeet-composer-tool"
              title="Joindre une image"
              onClick={handleFileClick}
              disabled={uploading}
            >
              <Image size={13} />
            </button>

            <input
              ref={fileInputRef}
              className="devmeet-hidden-file"
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.png,.jpg,.jpeg,.gif,.webp,.svg"
              onChange={handleFileChange}
            />

            {/* Autocomplétion des mentions : la liste vient des membres réels
                de la communauté. Le serveur revérifie de toute façon. */}
            {mentionSuggestions.length > 0 ? (
              <div className="devmeet-mentions">
                {mentionSuggestions.map((member) => (
                  <button
                    key={`mention-${member.userId}`}
                    type="button"
                    className="devmeet-mention-option"
                    onClick={() => insertMention(member)}
                  >
                    {`@${member.name}`}
                  </button>
                ))}
              </div>
            ) : null}

            <input
              ref={inputRef}
              className="devmeet-composer-input"
              type="text"
              value={message}
              onChange={handleTyping}
              placeholder={
                pendingFile
                  ? "Ajouter un commentaire (facultatif)…"
                  : "Écrire un message..."
              }
            />

            <motion.button
              type="submit"
              className="devmeet-send"
              title="Envoyer"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
            >
              <Send size={14} />
            </motion.button>
          </div>
        </form>
        )}

        {/* Panneau de recherche : résultats renvoyés par le serveur. */}
        {searchOpen && !threadParent ? (
          <motion.aside
            className="devmeet-panel"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <div className="devmeet-panel-header">
              <h3 className="devmeet-panel-title">Rechercher</h3>

              <button
                type="button"
                className="devmeet-panel-close"
                title="Fermer la recherche"
                onClick={() => setSearchOpen(false)}
              >
                <X size={13} />
              </button>
            </div>

            <form className="devmeet-search-form" onSubmit={runSearch}>
              <div className="devmeet-search-scopes">
                <label className="devmeet-panel-hint">
                  <input
                    type="radio"
                    name="devmeet-search-scope"
                    checked={searchScope === "channel"}
                    onChange={() => setSearchScope("channel")}
                  />{" "}
                  Ce salon
                </label>

                {communityId ? (
                  <label className="devmeet-panel-hint">
                    <input
                      type="radio"
                      name="devmeet-search-scope"
                      checked={searchScope === "community"}
                      onChange={() => setSearchScope("community")}
                    />{" "}
                    Toute la communauté
                  </label>
                ) : null}
              </div>

              <div className="devmeet-search-row">
                <input
                  className="devmeet-search-input"
                  type="text"
                  value={searchTerm}
                  placeholder="Au moins 2 caractères…"
                  onChange={(event) =>
                    setSearchTerm(event.target.value)
                  }
                />

                <button
                  className="devmeet-search-submit"
                  type="submit"
                  disabled={searching}
                >
                  {searching ? "…" : "Chercher"}
                </button>
              </div>

              {searchError ? (
                <div className="devmeet-panel-hint">{searchError}</div>
              ) : null}
            </form>

            <div className="devmeet-panel-body">
              {searchResults.length === 0 ? (
                <div className="devmeet-panel-empty">
                  Aucun résultat.
                </div>
              ) : (
                searchResults.map((item) => (
                  <div
                    className="devmeet-panel-item"
                    key={`search-${item.id}`}
                  >
                    <div className="devmeet-panel-item-head">
                      <span>{messageAuthorName(item)}</span>
                      <span>{formatTime(item.createdAt)}</span>
                    </div>

                    <div className="devmeet-panel-item-text">
                      {messageText(item)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.aside>
        ) : null}

        {/* Panneau des messages épinglés. */}
        {pinnedOpen && !searchOpen && !threadParent ? (
          <motion.aside
            className="devmeet-panel"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <div className="devmeet-panel-header">
              <h3 className="devmeet-panel-title">
                Messages épinglés
              </h3>

              <button
                type="button"
                className="devmeet-panel-close"
                title="Fermer"
                onClick={() => setPinnedOpen(false)}
              >
                <X size={13} />
              </button>
            </div>

            <div className="devmeet-panel-body">
              {pinnedLoading ? (
                <div className="devmeet-panel-empty">
                  Chargement…
                </div>
              ) : pinned.length === 0 ? (
                <div className="devmeet-panel-empty">
                  Aucun message épinglé dans ce salon.
                </div>
              ) : (
                pinned.map((item) => (
                  <div
                    className="devmeet-panel-item"
                    key={`pin-${item.id}`}
                  >
                    <div className="devmeet-panel-item-head">
                      <span>{messageAuthorName(item)}</span>

                      {canPin ? (
                        <button
                          type="button"
                          className="devmeet-tool"
                          title="Détacher ce message"
                          onClick={() => togglePin(item)}
                        >
                          <PinOff size={11} />
                        </button>
                      ) : (
                        <span>{formatTime(item.createdAt)}</span>
                      )}
                    </div>

                    <div className="devmeet-panel-item-text">
                      {messageText(item)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.aside>
        ) : null}

        {/* Fil de discussion ouvert. */}
        {threadParent ? (
          <motion.aside
            className="devmeet-panel"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <div className="devmeet-panel-header">
              <h3 className="devmeet-panel-title">
                Fil de discussion
              </h3>

              <button
                type="button"
                className="devmeet-panel-close"
                title="Fermer le fil"
                onClick={closeThread}
              >
                <X size={13} />
              </button>
            </div>

            <div className="devmeet-panel-body">
              <div className="devmeet-panel-item devmeet-thread-reply">
                <div className="devmeet-panel-item-head">
                  <span>
                    {messageAuthorName(threadParent)}
                  </span>
                  <span>{formatTime(threadParent.createdAt)}</span>
                </div>

                <div className="devmeet-panel-item-text">
                  {messageText(threadParent)}
                </div>
              </div>

              {threadLoading ? (
                <div className="devmeet-panel-empty">
                  Chargement…
                </div>
              ) : threadReplies.length === 0 ? (
                <div className="devmeet-panel-empty">
                  Aucune réponse pour le moment.
                </div>
              ) : (
                threadReplies.map((item) => (
                  <div
                    className="devmeet-panel-item"
                    key={`reply-${item.id}`}
                  >
                    <div className="devmeet-panel-item-head">
                      <span>{messageAuthorName(item)}</span>
                      <span>{formatTime(item.createdAt)}</span>
                    </div>

                    <div className="devmeet-panel-item-text">
                      {messageText(item)}
                    </div>
                  </div>
                ))
              )}
            </div>

            <form className="devmeet-thread-form" onSubmit={sendReply}>
              <input
                className="devmeet-search-input"
                type="text"
                value={replyText}
                placeholder="Répondre dans le fil…"
                onChange={(event) => setReplyText(event.target.value)}
              />

              <button
                className="devmeet-search-submit"
                type="submit"
              >
                Envoyer
              </button>
            </form>
          </motion.aside>
        ) : null}
      </section>

      <aside className="devmeet-chat-right">
        <div className="devmeet-right-section">
          <div className="devmeet-right-title">
            <span>Membres</span>

            <span className="devmeet-right-count">
              {members.length}
            </span>
          </div>

          {members.length === 0 ? (
            <div className="devmeet-no-data">
              Aucun membre connecté.
            </div>
          ) : (
            <div className="devmeet-members">
              {members.map(
                (member, index) => (
                  <div
                    className="devmeet-member"
                    key={`${member}-${index}`}
                  >
                    <div className="devmeet-member-avatar">
                      {getInitial(index)}
                    </div>

                    <div className="devmeet-member-info">
                      <div className="devmeet-member-name">
                        {member}
                      </div>

                      <div className="devmeet-member-status">
                        En ligne
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>

        <div className="devmeet-right-section">
          <div className="devmeet-right-title">
            <span>Activité récente</span>
          </div>

          {activities.length === 0 ? (
            <div className="devmeet-no-data">
              Aucune activité récente.
            </div>
          ) : (
            <div className="devmeet-activities">
              {activities
                .slice()
                .reverse()
                .map(
                  (activity) => (
                    <motion.div
                      className="devmeet-activity"
                      key={activity.id}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                    >
                      <div className="devmeet-activity-icon">
                        {activity.type ===
                        "message"
                          ? "●"
                          : "○"}
                      </div>

                      <div>
                        <div className="devmeet-activity-text">
                          {activity.text}
                        </div>

                        <div className="devmeet-activity-time">
                          {formatTime(
                            activity.time
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )
                )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export default Chat;