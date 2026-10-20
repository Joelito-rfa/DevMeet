import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  FolderPlus,
  Globe,
  Hash,
  Info,
  Lock,
  Menu,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";

import CommunitiesBar from "./CommunitiesBar";
import CommunitySidebar from "./CommunitySidebar";
import ContextMenu from "./ContextMenu";
import Notifications from "../common/Notifications";
import socket from "../../services/socket";
import { apiFetch } from "../../services/api";
import { useAsyncEffect } from "../../hooks/useAsyncEffect";
import { PERMISSIONS, hasPermission, roleLabel } from "../../permissions";
import { CHANNEL_ICONS, CHANNEL_TYPES, WorkspaceContext } from "./workspace";

/** Mémorise les catégories repliées par communauté, entre deux sessions. */
function readCollapsed(communityId) {
  try {
    const raw = window.localStorage.getItem(`devmeet.collapsed.${communityId}`);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function persistCollapsed(communityId, collapsed) {
  try {
    window.localStorage.setItem(
      `devmeet.collapsed.${communityId}`,
      JSON.stringify(Array.from(collapsed))
    );
  } catch {
    // Stockage indisponible : le repli reste valable pour la session.
  }
}

/**
 * Ossature de l'espace de travail, en trois colonnes façon Discord :
 *
 *   1. barre des communautés ;
 *   2. sidebar des catégories et des salons (avec le panneau utilisateur) ;
 *   3. zone principale (en-tête + contenu de la page).
 *
 * Elle centralise le chargement de la communauté, de ses catégories et de ses
 * salons, les modales de gestion et les abonnements temps réel : les pages
 * n'ont plus qu'à fournir leur contenu.
 */
function WorkspaceShell({
  user,
  token,
  onLogout,
  communityId: communityIdProp,
  channelId: channelIdProp,
  headerIcon,
  headerTitle,
  headerSubtitle,
  headerActions,
  children,
}) {
  const navigate = useNavigate();
  const routeParams = useParams();

  const communityId = communityIdProp ?? routeParams.communityId ?? null;
  const channelId = channelIdProp ?? routeParams.channelId ?? null;

  const [communities, setCommunities] = useState([]);
  const [community, setCommunity] = useState(null);
  const [categories, setCategories] = useState([]);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(Boolean(communityId));
  const [treeError, setTreeError] = useState("");

  const [collapsed, setCollapsed] = useState(() => readCollapsed(communityId));
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Repères des ajustements d'état pendant le rendu (voir plus bas) : ils
  // suivent le changement de salon ouvert et de communauté.
  const [lastOpenChannel, setLastOpenChannel] = useState(channelId);
  const [collapsedFor, setCollapsedFor] = useState(communityId);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [unreadDmCount, setUnreadDmCount] = useState(0);

  // --- Modales ------------------------------------------------------------
  const [categoryModal, setCategoryModal] = useState(null);
  const [channelModal, setChannelModal] = useState(null);
  const [moveChannel, setMoveChannel] = useState(null);
  const [categoryToDelete, setCategoryToDelete] = useState(null);
  const [channelToDelete, setChannelToDelete] = useState(null);
  const [createCommunityOpen, setCreateCommunityOpen] = useState(false);
  const [creatingCommunity, setCreatingCommunity] = useState(false);
  const [newCommunity, setNewCommunity] = useState({
    name: "",
    description: "",
    isPublic: true,
  });
  const [communityError, setCommunityError] = useState("");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherQuery, setSwitcherQuery] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);

  // --- Menus contextuels --------------------------------------------------
  const [categoryMenu, setCategoryMenu] = useState(null);
  const [channelMenu, setChannelMenu] = useState(null);
  const [headerMenu, setHeaderMenu] = useState(null);

  const role = community?.role || null;
  const canManageCategories = hasPermission(role, PERMISSIONS.MANAGE_CATEGORIES);
  const canManageChannels = hasPermission(role, PERMISSIONS.MANAGE_CHANNELS);
  const canManageRoles = hasPermission(role, PERMISSIONS.MANAGE_ROLES);
  const canInvite = hasPermission(role, PERMISSIONS.INVITE_MEMBERS);
  const canUpdateCommunity = hasPermission(role, PERMISSIONS.UPDATE_COMMUNITY);
  const canDeleteCommunity = hasPermission(role, PERMISSIONS.MANAGE_COMMUNITY);

  /** Petit toast de confirmation (4 s). */
  const flash = useCallback((text) => {
    setError("");
    setMessage(text);
    window.setTimeout(() => setMessage(""), 4000);
  }, []);

  /** Affiche l'échec d'une requête API. */
  const fail = useCallback((request) => {
    setError(request?.data?.message || "L'opération a échoué.");
    setMessage("");
  }, []);

  // --- Chargement ---------------------------------------------------------

  const loadCommunities = useCallback(async () => {
    const result = await apiFetch("/api/communities", { token });

    if (result.ok) {
      setCommunities(result.data.communities || []);
    }
  }, [token]);

  const loadTree = useCallback(async () => {
    if (!communityId) {
      setCommunity(null);
      setCategories([]);
      setChannels([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const [detail, categoryList, channelList] = await Promise.all([
      apiFetch(`/api/communities/${communityId}`, { token }),
      apiFetch(`/api/communities/${communityId}/categories`, { token }),
      apiFetch(`/api/communities/${communityId}/channels`, { token }),
    ]);

    setLoading(false);

    if (!detail.ok) {
      setCommunity(null);
      setTreeError(detail.data?.message || "Communauté introuvable.");
      return;
    }

    setTreeError("");
    setCommunity(detail.data.community);
    setCategories(categoryList.ok ? categoryList.data.categories || [] : []);
    setChannels(channelList.ok ? channelList.data.channels || [] : []);
  }, [communityId, token]);

  useAsyncEffect(async () => {
    await loadCommunities();
  }, [loadCommunities]);

  useAsyncEffect(async () => {
    await loadTree();
  }, [loadTree]);

  /** Charge le total des messages privés non lus depuis l'API. */
  const loadUnreadDmCount = useCallback(async () => {
    if (!token) {
      setUnreadDmCount(0);
      return;
    }

    const result = await apiFetch("/api/dms", { token });

    if (result.ok) {
      const conversations = result.data?.conversations || [];
      const total = conversations.reduce(
        (sum, conversation) => sum + (conversation.unreadCount || 0),
        0
      );
      setUnreadDmCount(total);
    }
  }, [token]);

  useAsyncEffect(async () => {
    await loadUnreadDmCount();
  }, [loadUnreadDmCount]);

  /** Joue une courte sonnerie (bip) via l'API Web Audio, sans fichier externe. */
  function playDmSound() {
    try {
      const AudioContext =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContext) {
        return;
      }

      const context = new AudioContext();
      const now = context.currentTime;

      // Deux bips montants pour une notification discrète.
      [440, 554].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, now + index * 0.08);

        gain.gain.setValueAtTime(0, now + index * 0.08);
        gain.gain.linearRampToValueAtTime(0.12, now + index * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.08 + 0.2);

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(now + index * 0.08);
        oscillator.stop(now + index * 0.08 + 0.2);
      });

      context.close();
    } catch {
      // Audio bloqué par le navigateur ou indisponible : on ignore silencieusement.
    }
  }

  // Un nouveau message privé arrive en direct : met à jour le compteur et
  // joue une petite sonnerie de notification.
  useEffect(() => {
    function handleDmNew() {
      loadUnreadDmCount();
      playDmSound();
    }

    socket.on("dm:new", handleDmNew);

    return () => socket.off("dm:new", handleDmNew);
  }, [loadUnreadDmCount]);

  // Toute modification faite par un autre membre arrive en direct.
  useEffect(() => {
    if (!communityId) {
      return undefined;
    }

    const events = [
      "channel:created",
      "channel:updated",
      "channel:deleted",
      "channel:moved",
      "channel:reordered",
      "category:created",
      "category:updated",
      "category:deleted",
      "category:reordered",
    ];

    function refresh() {
      loadTree();
    }

    events.forEach((event) => socket.on(event, refresh));

    return () => events.forEach((event) => socket.off(event, refresh));
  }, [communityId, loadTree]);

  // Un message non lu dans un AUTRE salon fait pulser son pastillage. Le
  // salon ouvert remet son compteur à zéro localement (le serveur est déjà à
  // jour via les accusés de lecture du chat).
  useEffect(() => {
    function handleNewMessage(payload) {
      if (!payload?.channelId || Number(payload.channelId) === Number(channelId)) {
        return;
      }

      setChannels((current) =>
        current.map((channel) =>
          Number(channel.id) === Number(payload.channelId)
            ? { ...channel, unreadCount: (channel.unreadCount || 0) + 1 }
            : channel
        )
      );
    }

    socket.on("message:new", handleNewMessage);

    return () => socket.off("message:new", handleNewMessage);
  }, [channelId]);

  // Ouvrir un salon remet son compteur de non-lus à zéro : le serveur est déjà
  // à jour via les accusés de lecture du chat, on ajuste donc l'affichage
  // pendant le rendu, sans attendre un effet ni un rechargement de l'arbre.
  if (lastOpenChannel !== channelId) {
    setLastOpenChannel(channelId);

    if (channelId) {
      setChannels((current) =>
        current.map((channel) =>
          Number(channel.id) === Number(channelId)
            ? { ...channel, unreadCount: 0 }
            : channel
        )
      );
    }
  }

  // Le repli des catégories est conservé par communauté : en changeant de
  // communauté, la préférence est relue pendant le rendu.
  if (collapsedFor !== communityId) {
    setCollapsedFor(communityId);
    setCollapsed(readCollapsed(communityId));
  }

  useEffect(() => {
    if (communityId) {
      persistCollapsed(communityId, collapsed);
    }
  }, [communityId, collapsed]);

  function toggleCategory(categoryId) {
    setCollapsed((current) => {
      const next = new Set(current);

      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }

      return next;
    });
  }

  // --- Regroupement des salons --------------------------------------------

  const grouped = useMemo(() => {
    const map = new Map();

    for (const category of categories) {
      map.set(
        category.id,
        channels
          .filter((channel) => channel.categoryId === category.id)
          .sort((a, b) => a.position - b.position)
      );
    }

    return map;
  }, [categories, channels]);

  const uncategorized = useMemo(
    () =>
      channels
        .filter((channel) => !channel.categoryId)
        .sort((a, b) => a.position - b.position),
    [channels]
  );

  // --- Catégories ---------------------------------------------------------

  async function submitCategory(event) {
    event.preventDefault();

    const editing = categoryModal.mode === "rename" ? categoryModal.category : null;
    const url = editing
      ? `/api/communities/${communityId}/categories/${editing.id}`
      : `/api/communities/${communityId}/categories`;

    const result = await apiFetch(url, {
      method: editing ? "PATCH" : "POST",
      token,
      body: {
        name: categoryModal.form.name.trim(),
        description: categoryModal.form.description.trim() || undefined,
      },
    });

    if (!result.ok) {
      fail(result);
      return;
    }

    setCategoryModal(null);
    flash(
      editing
        ? `Catégorie renommée « ${result.data.category.name} ».`
        : `Catégorie « ${result.data.category.name} » créée.`
    );
    loadTree();
  }

  function openCreateCategory() {
    setError("");
    setCategoryModal({
      mode: "create",
      category: null,
      form: { name: "", description: "" },
    });
  }

  function openRenameCategory(category) {
    setError("");
    setCategoryModal({
      mode: "rename",
      category,
      form: {
        name: category.name,
        description: category.description || "",
      },
    });
  }

  async function deleteCategory(category, strategy) {
    const result = await apiFetch(
      `/api/communities/${communityId}/categories/${category.id}?strategy=${strategy}`,
      { method: "DELETE", token }
    );

    if (!result.ok) {
      fail(result);
      return;
    }

    const affected = result.data.affectedChannels || [];
    setCategoryToDelete(null);
    flash(
      strategy === "keep"
        ? `Catégorie supprimée. ${affected.length} salon(s) conservé(s) sans catégorie.`
        : `Catégorie supprimée, ainsi que ${affected.length} salon(s) et leur contenu.`
    );
    loadTree();
  }

  /** Décale une catégorie d'un cran (haut/bas) et enregistre le nouvel ordre. */
  async function moveCategoryBy(category, direction) {
    const index = categories.findIndex((item) => item.id === category.id);
    const target = index + direction;

    if (index === -1 || target < 0 || target >= categories.length) {
      return;
    }

    const ordered = [...categories];
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved);
    setCategories(ordered);

    const result = await apiFetch(
      `/api/communities/${communityId}/categories/reorder`,
      {
        method: "PATCH",
        token,
        body: { order: ordered.map((item) => item.id) },
      }
    );

    if (!result.ok) {
      fail(result);
      loadTree();
    }
  }

  /**
   * Enregistre l'ordre des catégories (glisser-déposer de la sidebar).
   * L'affichage change tout de suite, l'API tranche ensuite ; en cas de refus,
   * l'état est rechargé depuis le serveur pour ne pas laisser une vue fausse.
   */
  async function reorderCategories(ordered) {
    setCategories(ordered);

    const result = await apiFetch(
      `/api/communities/${communityId}/categories/reorder`,
      {
        method: "PATCH",
        token,
        body: { order: ordered.map((item) => item.id) },
      }
    );

    if (!result.ok) {
      fail(result);
      loadTree();
      return;
    }

    setCategories(result.data.categories || ordered);
  }

  // --- Salons -------------------------------------------------------------

  function openCreateChannel(categoryId = null) {
    setError("");
    setChannelModal({
      mode: "create",
      channel: null,
      form: {
        name: "",
        type: "text",
        categoryId: categoryId === null || categoryId === undefined ? "" : String(categoryId),
        description: "",
        isPrivate: false,
        accessCode: "",
      },
    });
  }

  function openRenameChannel(channel) {
    setError("");
    setChannelModal({
      mode: "rename",
      channel,
      form: {
        name: channel.name,
        type: channel.type,
        categoryId: channel.categoryId === null ? "" : String(channel.categoryId),
        description: channel.description || "",
        isPrivate: channel.isPrivate,
        accessCode: "",
      },
    });
  }

  async function submitChannel(event) {
    event.preventDefault();

    const editing = channelModal.mode === "rename" ? channelModal.channel : null;

    const body = {
      name: channelModal.form.name.trim(),
      description: channelModal.form.description.trim() || undefined,
    };

    if (!editing) {
      body.type = channelModal.form.type;
      body.categoryId =
        channelModal.form.categoryId === "" ? null : Number(channelModal.form.categoryId);
      body.isPrivate = channelModal.form.isPrivate;
      body.accessCode = channelModal.form.accessCode.trim() || undefined;
    }

    const result = await apiFetch(
      editing
        ? `/api/channels/${editing.id}`
        : `/api/communities/${communityId}/channels`,
      { method: editing ? "PATCH" : "POST", token, body }
    );

    if (!result.ok) {
      fail(result);
      return;
    }

    setChannelModal(null);
    flash(
      editing
        ? `Salon renommé « ${result.data.channel.name} ».`
        : `Salon « ${result.data.channel.name} » créé.`
    );
    loadTree();
  }

  async function submitMoveChannel(event) {
    event.preventDefault();

    const target = event.currentTarget.elements.namedItem("move-category");
    const value = target ? target.value : "";

    const result = await apiFetch(`/api/channels/${moveChannel.id}/move`, {
      method: "POST",
      token,
      body: { categoryId: value === "" ? null : Number(value) },
    });

    if (!result.ok) {
      fail(result);
      return;
    }

    flash(`Salon « ${moveChannel.name} » déplacé.`);
    setMoveChannel(null);
    loadTree();
  }

  async function deleteChannel(channel) {
    const result = await apiFetch(`/api/channels/${channel.id}`, {
      method: "DELETE",
      token,
    });

    if (!result.ok) {
      fail(result);
      return;
    }

    setChannelToDelete(null);
    flash(`Salon « ${channel.name} » supprimé.`);

    if (Number(channelId) === Number(channel.id)) {
      navigate(`/c/${communityId}`);
    }

    loadTree();
  }

  /** Décale un salon d'un cran dans son groupe. */
  async function moveChannelBy(channel, direction) {
    const list = channel.categoryId
      ? grouped.get(channel.categoryId) || []
      : uncategorized;

    const index = list.findIndex((item) => item.id === channel.id);
    const target = index + direction;

    if (index === -1 || target < 0 || target >= list.length) {
      return;
    }

    const ordered = [...list];
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved);

    const result = await apiFetch(
      `/api/communities/${communityId}/channels/reorder`,
      {
        method: "PATCH",
        token,
        body: {
          categoryId: channel.categoryId || null,
          order: ordered.map((item) => item.id),
        },
      }
    );

    if (!result.ok) {
      fail(result);
    }

    loadTree();
  }

  /**
   * Enregistre l'ordre des salons d'un groupe (glisser-déposer de la sidebar).
   * Les positions locales sont recalculées pour que le rendu soit immédiat.
   */
  async function reorderChannels(categoryId, ordered) {
    setChannels((current) =>
      current.map((channel) => {
        const index = ordered.findIndex((item) => item.id === channel.id);

        return index === -1 ? channel : { ...channel, position: index };
      })
    );

    const result = await apiFetch(
      `/api/communities/${communityId}/channels/reorder`,
      {
        method: "PATCH",
        token,
        body: {
          categoryId: categoryId === null ? null : Number(categoryId),
          order: ordered.map((item) => item.id),
        },
      }
    );

    if (!result.ok) {
      fail(result);
    }

    loadTree();
  }

  // --- Communauté ---------------------------------------------------------

  /** Réinitialise et ouvre la modale de création de communauté. */
  const openCreateCommunity = useCallback(() => {
    setNewCommunity({ name: "", description: "", isPublic: true });
    setCommunityError("");
    setCreatingCommunity(false);
    setCreateCommunityOpen(true);
  }, []);

  /** Ferme la modale (sauf pendant l'envoi, pour éviter de perdre la saisie). */
  const closeCreateCommunity = useCallback(() => {
    if (creatingCommunity) return;
    setCreateCommunityOpen(false);
    setCommunityError("");
  }, [creatingCommunity]);

  /** Échap ferme la modale. */
  useEffect(() => {
    if (!createCommunityOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") closeCreateCommunity();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createCommunityOpen, closeCreateCommunity]);

  /** Nom valide : au moins 2 caractères. */
  const communityNameError = useMemo(() => {
    const name = newCommunity.name.trim();
    if (name && name.length < 2) {
      return "Le nom doit contenir au moins 2 caractères.";
    }
    return "";
  }, [newCommunity.name]);

  /** Initiales de l'aperçu (2 lettres max). */
  const communityInitials = useMemo(() => {
    const words = newCommunity.name.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";

    return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2))
      .toUpperCase();
  }, [newCommunity.name]);

  async function submitCreateCommunity(event) {
    event.preventDefault();

    const name = newCommunity.name.trim();

    if (name.length < 2) {
      setCommunityError("Le nom doit contenir au moins 2 caractères.");
      return;
    }

    setCommunityError("");
    setCreatingCommunity(true);

    const result = await apiFetch("/api/communities", {
      method: "POST",
      token,
      body: {
        name,
        description: newCommunity.description.trim() || undefined,
        isPublic: newCommunity.isPublic,
      },
    });

    setCreatingCommunity(false);

    if (!result.ok) {
      setCommunityError(result?.data?.message || "L'opération a échoué.");
      return;
    }

    setCreateCommunityOpen(false);
    flash(`Communauté « ${result.data.community.name} » créée.`);
    loadCommunities();
    navigate(`/c/${result.data.community.id}`);
  }

  async function leaveCommunity() {
    const result = await apiFetch(`/api/communities/${communityId}/leave`, {
      method: "POST",
      token,
    });

    if (!result.ok) {
      fail(result);
      return;
    }

    flash("Vous avez quitté la communauté.");
    loadCommunities();
    navigate("/");
  }

  // --- Commutateur de salons (recherche) ----------------------------------

  const switcherResults = useMemo(() => {
    const needle = switcherQuery.trim().toLowerCase();

    if (!needle) {
      return channels.slice(0, 12);
    }

    return channels
      .filter((channel) => channel.name.toLowerCase().includes(needle))
      .slice(0, 12);
  }, [channels, switcherQuery]);

  const openSwitcher = useCallback(() => {
    setSwitcherQuery("");
    setSwitcherOpen(true);
  }, []);

  // Raccourcis clavier du bureau : Ctrl/Cmd + K ouvre « Aller à… », Échap
  // referme les panneaux flottants (commutateur de salons, informations).
  useEffect(() => {
    function handleKey(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSwitcher();
        return;
      }

      if (event.key === "Escape") {
        setSwitcherOpen(false);
        setInfoOpen(false);
      }
    }

    window.addEventListener("keydown", handleKey);

    return () => window.removeEventListener("keydown", handleKey);
  }, [openSwitcher]);

  // --- Contexte -----------------------------------------------------------

  const contextValue = useMemo(
    () => ({
      token,
      user,
      onLogout,
      community,
      communities,
      categories,
      channels,
      grouped,
      uncategorized,
      role,
      loading,
      treeError,
      canManageCategories,
      canManageChannels,
      canInvite,
      canUpdateCommunity,
      canDeleteCommunity,
      collapsed,
      toggleCategory,
      flash,
      fail,
      refresh: loadTree,
      refreshCommunities: loadCommunities,
      openCreateCategory,
      openRenameCategory,
      openDeleteCategory: setCategoryToDelete,
      openCreateChannel,
      openRenameChannel,
      openMoveChannel: setMoveChannel,
      openDeleteChannel: setChannelToDelete,
      reorderCategories,
      reorderChannels,
      openCreateCommunity,
      openSwitcher,
      // Permet aux pages de savoir si le tiroir latéral est ouvert (mobile).
      drawerOpen,
      unreadDmCount,
      closeDrawer: () => setDrawerOpen(false),
    }),
    // Les fonctions sont recréées à chaque rendu : seul l'objet livré compte
    // pour les consommateurs, et il est reconstruit de toute façon.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      token,
      user,
      onLogout,
      community,
      communities,
      categories,
      channels,
      grouped,
      uncategorized,
      role,
      loading,
      treeError,
      canManageCategories,
      canManageChannels,
      canInvite,
      canUpdateCommunity,
      canDeleteCommunity,
      collapsed,
      drawerOpen,
      unreadDmCount,
    ]
  );

  // --- Menus contextuels (items) ------------------------------------------

  function categoryMenuItems(category) {
    const list = grouped.get(category.id) || [];

    return [
      {
        label: "Créer un salon ici",
        icon: <Plus size={16} />,
        disabled: !canManageChannels,
        onClick: () => openCreateChannel(category.id),
      },
      {
        label: "Renommer",
        disabled: !canManageCategories,
        onClick: () => openRenameCategory(category),
      },
      { separator: true, label: "sep-1" },
      {
        label: "Monter",
        disabled: !canManageCategories || categories[0]?.id === category.id,
        onClick: () => moveCategoryBy(category, -1),
      },
      {
        label: "Descendre",
        disabled:
          !canManageCategories ||
          categories[categories.length - 1]?.id === category.id,
        onClick: () => moveCategoryBy(category, 1),
      },
      { separator: true, label: "sep-2" },
      {
        label: `Supprimer (${list.length} salon(s))`,
        icon: <Trash2 size={16} />,
        danger: true,
        disabled: !canManageCategories,
        onClick: () => setCategoryToDelete(category),
      },
    ];
  }

  function channelMenuItems(channel) {
    const list = channel.categoryId
      ? grouped.get(channel.categoryId) || []
      : uncategorized;

    return [
      {
        label: "Ouvrir",
        onClick: () => navigate(`/c/${communityId}/${channel.id}`),
      },
      {
        label: "Renommer",
        disabled: !canManageChannels,
        onClick: () => openRenameChannel(channel),
      },
      {
        label: "Déplacer vers…",
        disabled: !canManageChannels,
        onClick: () => setMoveChannel(channel),
      },
      { separator: true, label: "sep-1" },
      {
        label: "Monter",
        disabled: !canManageChannels || list[0]?.id === channel.id,
        onClick: () => moveChannelBy(channel, -1),
      },
      {
        label: "Descendre",
        disabled: !canManageChannels || list[list.length - 1]?.id === channel.id,
        onClick: () => moveChannelBy(channel, 1),
      },
      { separator: true, label: "sep-2" },
      {
        label: "Supprimer",
        danger: true,
        disabled: !canManageChannels,
        onClick: () => setChannelToDelete(channel),
      },
    ];
  }

  const activeChannel = channels.find(
    (channel) => Number(channel.id) === Number(channelId)
  );

  return (
    <WorkspaceContext.Provider value={contextValue}>
      <div className="ws-discord">
        <CommunitiesBar
          communities={communities}
          token={token}
          onCreateCommunity={openCreateCommunity}
        />

        <AnimatePresence>
          {drawerOpen && (
            <motion.div
              className="ws-drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
            />
          )}
        </AnimatePresence>

        <div className={`ws-discord-side${drawerOpen ? " open" : ""}`}>
          <CommunitySidebar
            communityId={communityId}
            channelId={channelId}
            onOpenHeaderMenu={(position) =>
              setHeaderMenu({ x: position.x, y: position.y })
            }
            onOpenCategoryMenu={(category, position) =>
              setCategoryMenu({ category, x: position.x, y: position.y })
            }
            onOpenChannelMenu={(channel, position) =>
              setChannelMenu({ channel, x: position.x, y: position.y })
            }
          />
        </div>

        <main className="ws-discord-main">
          <header className="ws-discord-header">
            <button
              className="ws-discord-burger ws-tip-start"
              type="button"
              data-tip="Afficher les salons"
              aria-label="Afficher les salons"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu size={21} />
            </button>

            <span className="ws-discord-header-icon">
              {headerIcon || <Hash size={22} />}
            </span>

            <div className="ws-discord-header-titles">
              <h1 className="ws-discord-header-title">{headerTitle}</h1>
              {headerSubtitle && (
                <p className="ws-discord-header-subtitle">{headerSubtitle}</p>
              )}
            </div>

            <div className="ws-discord-header-actions">
              {headerActions}

              {channelId && (
                <button
                  className="ws-icon-button ws-discord-tool"
                  type="button"
                  data-tip="Informations sur le salon"
                  aria-label="Informations sur le salon"
                  onClick={() => setInfoOpen((value) => !value)}
                >
                  <Info size={19} />
                </button>
              )}

              <button
                className="ws-icon-button ws-discord-tool ws-tip-end"
                type="button"
                data-tip="Rechercher un salon · Ctrl K"
                aria-label="Rechercher un salon"
                onClick={openSwitcher}
              >
                <Search size={19} />
              </button>

              <Notifications token={token} />
            </div>
          </header>

          {(message || error) && (
            <div className="ws-discord-banner">
              {error ? (
                <div className="ws-alert ws-alert-error" style={{ margin: 0 }}>
                  {error}
                </div>
              ) : (
                <div className="ws-alert ws-alert-success" style={{ margin: 0 }}>
                  {message}
                </div>
              )}
            </div>
          )}

          <div className="ws-discord-content">{children}</div>
        </main>

        {/* --- Panneau d'informations du salon --- */}
        <AnimatePresence>
          {infoOpen && activeChannel && (
            <motion.div
              className="ws-info-panel"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <div className="ws-section-header" style={{ marginBottom: 10 }}>
                <strong style={{ fontSize: 13 }}>À propos du salon</strong>
                <button
                  className="ws-button ws-button-small ws-button-ghost"
                  type="button"
                  onClick={() => setInfoOpen(false)}
                >
                  ×
                </button>
              </div>

              <p className="ws-muted" style={{ marginBottom: 8 }}>
                {activeChannel.description || "Aucune description pour ce salon."}
              </p>

              <div className="ws-inline" style={{ gap: 6 }}>
                <span className="ws-badge">
                  {CHANNEL_TYPES.find((item) => item.value === activeChannel.type)
                    ?.label || activeChannel.type}
                </span>

                <span className="ws-badge">
                  {categories.find((cat) => cat.id === activeChannel.categoryId)
                    ?.name || "Sans catégorie"}
                </span>

                {activeChannel.isPrivate && (
                  <span className="ws-badge">Privé</span>
                )}

                {activeChannel.hasAccessCode && (
                  <span className="ws-badge">Code d'accès</span>
                )}

                <span className="ws-badge">{roleLabel(role || "member")}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Commutateur de salons --- */}
        <AnimatePresence>
          {switcherOpen && (
            <motion.div
              className="ws-modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSwitcherOpen(false)}
            >
              <motion.div
                className="ws-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Aller à un salon"
                initial={{ opacity: 0, scale: 0.94, y: 14 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="ws-modal-header">
                  <div>
                    <h2 className="ws-modal-title">Aller à…</h2>
                    <p className="ws-modal-subtitle">
                      Les salons de{" "}
                      {community ? `« ${community.name} »` : "cette communauté"}.
                    </p>
                  </div>

                  <button
                    className="ws-button ws-icon-button"
                    type="button"
                    onClick={() => setSwitcherOpen(false)}
                  >
                    ×
                  </button>
                </div>

                <input
                  className="ws-form-input"
                  type="text"
                  autoFocus
                  placeholder="Nom du salon…"
                  value={switcherQuery}
                  onChange={(event) => setSwitcherQuery(event.target.value)}
                />

                <div className="ws-list" style={{ marginTop: 14 }}>
                  {switcherResults.length === 0 ? (
                    <p className="ws-muted">Aucun salon correspondant.</p>
                  ) : (
                    switcherResults.map((channel) => {
                      const Icon = CHANNEL_ICONS[channel.type] || Hash;

                      return (
                        <button
                          className="ws-list-row"
                          key={channel.id}
                          type="button"
                          style={{ cursor: "pointer", textAlign: "left" }}
                          onClick={() => {
                            setSwitcherOpen(false);
                            navigate(`/c/${communityId}/${channel.id}`);
                          }}
                        >
                          <Icon size={18} style={{ color: "#7985ff" }} />
                          <div className="ws-list-row-main">
                            <div className="ws-list-row-name">{channel.name}</div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                <p className="ws-form-help" style={{ marginTop: 12 }}>
                  <kbd className="ws-kbd">Ctrl K</kbd> ouvre cette recherche à
                  tout moment · <kbd className="ws-kbd">Échap</kbd> la referme.
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Modale : catégorie (création / renommage) --- */}
        <AnimatePresence>
          {categoryModal && (
            <motion.div
              className="ws-modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setCategoryModal(null)}
            >
              <motion.div
                className="ws-modal"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="ws-modal-header">
                  <div>
                    <h2 className="ws-modal-title">
                      {categoryModal.mode === "rename"
                        ? "Renommer la catégorie"
                        : "Nouvelle catégorie"}
                    </h2>
                    <p className="ws-modal-subtitle">
                      Les catégories regroupent les salons et se replient d'un
                      clic.
                    </p>
                  </div>

                  <button
                    className="ws-button ws-icon-button"
                    type="button"
                    onClick={() => setCategoryModal(null)}
                  >
                    ×
                  </button>
                </div>

                <form onSubmit={submitCategory}>
                  <div className="ws-form-group">
                    <label className="ws-form-label" htmlFor="category-name">
                      Nom
                    </label>
                    <input
                      id="category-name"
                      className="ws-form-input"
                      type="text"
                      value={categoryModal.form.name}
                      onChange={(event) =>
                        setCategoryModal({
                          ...categoryModal,
                          form: { ...categoryModal.form, name: event.target.value },
                        })
                      }
                      maxLength={80}
                      autoFocus
                      required
                    />
                  </div>

                  <div className="ws-form-group">
                    <label className="ws-form-label" htmlFor="category-description">
                      Description (facultative)
                    </label>
                    <input
                      id="category-description"
                      className="ws-form-input"
                      type="text"
                      value={categoryModal.form.description}
                      onChange={(event) =>
                        setCategoryModal({
                          ...categoryModal,
                          form: {
                            ...categoryModal.form,
                            description: event.target.value,
                          },
                        })
                      }
                      maxLength={300}
                    />
                  </div>

                  <div className="ws-form-actions">
                    <button
                      className="ws-button"
                      type="button"
                      onClick={() => setCategoryModal(null)}
                    >
                      Annuler
                    </button>
                    <button className="ws-button ws-button-primary" type="submit">
                      {categoryModal.mode === "rename" ? "Enregistrer" : "Créer"}
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Modale : salon (création / renommage) --- */}
        <AnimatePresence>
          {channelModal && (
            <motion.div
              className="ws-modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setChannelModal(null)}
            >
              <motion.div
                className="ws-modal"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="ws-modal-header">
                  <div>
                    <h2 className="ws-modal-title">
                      {channelModal.mode === "rename"
                        ? "Renommer le salon"
                        : "Créer un salon"}
                    </h2>
                    <p className="ws-modal-subtitle">
                      Le salon est enregistré en base immédiatement.
                    </p>
                  </div>

                  <button
                    className="ws-button ws-icon-button"
                    type="button"
                    onClick={() => setChannelModal(null)}
                  >
                    ×
                  </button>
                </div>

                <form onSubmit={submitChannel}>
                  <div className="ws-form-group">
                    <label className="ws-form-label" htmlFor="channel-name">
                      Nom
                    </label>
                    <input
                      id="channel-name"
                      className="ws-form-input"
                      type="text"
                      value={channelModal.form.name}
                      onChange={(event) =>
                        setChannelModal({
                          ...channelModal,
                          form: { ...channelModal.form, name: event.target.value },
                        })
                      }
                      placeholder="Ex. revue-de-code"
                      maxLength={80}
                      autoFocus
                      required
                    />
                    <p className="ws-form-help">
                      Pour un salon textuel, le nom est converti en minuscules
                      avec des tirets (convention Discord).
                    </p>
                  </div>

                  {channelModal.mode !== "rename" && (
                    <>
                      <div className="ws-form-group">
                        <label className="ws-form-label" htmlFor="channel-type">
                          Type
                        </label>
                        <select
                          id="channel-type"
                          className="ws-form-select"
                          value={channelModal.form.type}
                          onChange={(event) =>
                            setChannelModal({
                              ...channelModal,
                              form: {
                                ...channelModal.form,
                                type: event.target.value,
                              },
                            })
                          }
                        >
                          {CHANNEL_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="ws-form-group">
                        <label
                          className="ws-form-label"
                          htmlFor="channel-category"
                        >
                          Catégorie
                        </label>
                        <select
                          id="channel-category"
                          className="ws-form-select"
                          value={channelModal.form.categoryId}
                          onChange={(event) =>
                            setChannelModal({
                              ...channelModal,
                              form: {
                                ...channelModal.form,
                                categoryId: event.target.value,
                              },
                            })
                          }
                        >
                          <option value="">Sans catégorie</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <label className="ws-checkbox-row">
                        <input
                          type="checkbox"
                          checked={channelModal.form.isPrivate}
                          onChange={(event) =>
                            setChannelModal({
                              ...channelModal,
                              form: {
                                ...channelModal.form,
                                isPrivate: event.target.checked,
                              },
                            })
                          }
                        />
                        Salon privé (visible uniquement par les membres autorisés)
                      </label>

                      <div className="ws-form-group">
                        <label className="ws-form-label" htmlFor="channel-code">
                          Code d'accès (facultatif)
                        </label>
                        <input
                          id="channel-code"
                          className="ws-form-input"
                          type="text"
                          value={channelModal.form.accessCode}
                          onChange={(event) =>
                            setChannelModal({
                              ...channelModal,
                              form: {
                                ...channelModal.form,
                                accessCode: event.target.value,
                              },
                            })
                          }
                          placeholder="Ex. equipe-2026"
                          maxLength={120}
                        />
                        <p className="ws-form-help">
                          Le code n'est jamais renvoyé par l'API : il se saisit,
                          il ne se lit pas.
                        </p>
                      </div>
                    </>
                  )}

                  <div className="ws-form-group">
                    <label className="ws-form-label" htmlFor="channel-description">
                      Description (facultative)
                    </label>
                    <input
                      id="channel-description"
                      className="ws-form-input"
                      type="text"
                      value={channelModal.form.description}
                      onChange={(event) =>
                        setChannelModal({
                          ...channelModal,
                          form: {
                            ...channelModal.form,
                            description: event.target.value,
                          },
                        })
                      }
                      maxLength={300}
                    />
                  </div>

                  <div className="ws-form-actions">
                    <button
                      className="ws-button"
                      type="button"
                      onClick={() => setChannelModal(null)}
                    >
                      Annuler
                    </button>
                    <button className="ws-button ws-button-primary" type="submit">
                      {channelModal.mode === "rename" ? "Enregistrer" : "Créer"}
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Modale : déplacer un salon --- */}
        <AnimatePresence>
          {moveChannel && (
            <motion.div
              className="ws-modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMoveChannel(null)}
            >
              <motion.div
                className="ws-modal"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="ws-modal-header">
                  <div>
                    <h2 className="ws-modal-title">
                      Déplacer « {moveChannel.name} »
                    </h2>
                    <p className="ws-modal-subtitle">
                      Choisissez la catégorie de destination.
                    </p>
                  </div>
                </div>

                <form onSubmit={submitMoveChannel}>
                  <div className="ws-form-group">
                    <label className="ws-form-label" htmlFor="move-category">
                      Catégorie
                    </label>
                    <select
                      id="move-category"
                      className="ws-form-select"
                      defaultValue={
                        moveChannel.categoryId === null
                          ? ""
                          : String(moveChannel.categoryId)
                      }
                    >
                      <option value="">Sans catégorie</option>
                      {categories
                        .filter((category) => category.id !== moveChannel.categoryId)
                        .map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="ws-form-actions">
                    <button
                      className="ws-button"
                      type="button"
                      onClick={() => setMoveChannel(null)}
                    >
                      Annuler
                    </button>
                    <button className="ws-button ws-button-primary" type="submit">
                      Déplacer
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Modale : suppression de catégorie (choix explicite) --- */}
        <AnimatePresence>
          {categoryToDelete && (
            <motion.div
              className="ws-modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setCategoryToDelete(null)}
            >
              <motion.div
                className="ws-modal"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="ws-modal-header">
                  <div>
                    <h2 className="ws-modal-title">
                      Supprimer « {categoryToDelete.name} »
                    </h2>
                    <p className="ws-modal-subtitle">
                      Rien n'est supprimé sans votre choix. Que faire des salons
                      de cette catégorie ?
                    </p>
                  </div>
                </div>

                <p className="ws-muted">
                  {(grouped.get(categoryToDelete.id) || []).length} salon(s) et
                  leurs messages sont concernés.
                </p>

                <div
                  className="ws-form-actions"
                  style={{ flexDirection: "column" }}
                >
                  <button
                    className="ws-button"
                    type="button"
                    onClick={() => deleteCategory(categoryToDelete, "keep")}
                  >
                    Conserver les salons (ils deviennent « sans catégorie »)
                  </button>

                  <button
                    className="ws-button ws-button-danger"
                    type="button"
                    onClick={() => deleteCategory(categoryToDelete, "delete")}
                  >
                    Supprimer aussi les salons et leurs messages
                  </button>

                  <button
                    className="ws-button ws-button-ghost"
                    type="button"
                    onClick={() => setCategoryToDelete(null)}
                  >
                    Annuler
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Modale : suppression d'un salon --- */}
        <AnimatePresence>
          {channelToDelete && (
            <motion.div
              className="ws-modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setChannelToDelete(null)}
            >
              <motion.div
                className="ws-modal"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="ws-modal-header">
                  <div>
                    <h2 className="ws-modal-title">
                      Supprimer « {channelToDelete.name} » ?
                    </h2>
                    <p className="ws-modal-subtitle">
                      Les messages, pièces jointes et tableaux blancs de ce salon
                      seront supprimés avec lui.
                    </p>
                  </div>
                </div>

                <div
                  className="ws-form-actions"
                  style={{ flexDirection: "column" }}
                >
                  <button
                    className="ws-button ws-button-danger"
                    type="button"
                    onClick={() => deleteChannel(channelToDelete)}
                  >
                    Supprimer définitivement
                  </button>

                  <button
                    className="ws-button ws-button-ghost"
                    type="button"
                    onClick={() => setChannelToDelete(null)}
                  >
                    Annuler
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Modale : création de communauté --- */}
        <AnimatePresence>
          {createCommunityOpen && (
            <motion.div
              className="ws-modal-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeCreateCommunity}
            >
              <motion.div
                className="ws-modal ws-modal-community"
                role="dialog"
                aria-modal="true"
                aria-labelledby="create-community-title"
                initial={{ opacity: 0, scale: 0.92, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 14 }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="ws-modal-header">
                  <div className="ws-modal-heading">
                    <span className="ws-modal-heading-icon">
                      <Users size={19} />
                    </span>
                    <div>
                      <h2
                        id="create-community-title"
                        className="ws-modal-title"
                      >
                        Créer une communauté
                      </h2>
                      <p className="ws-modal-subtitle">
                        Vous en devenez propriétaire. Une catégorie « GÉNÉRAL »
                        et un premier salon sont créés automatiquement.
                      </p>
                    </div>
                  </div>

                  <button
                    className="ws-button ws-icon-button"
                    type="button"
                    onClick={closeCreateCommunity}
                    disabled={creatingCommunity}
                    aria-label="Fermer"
                  >
                    <X size={18} />
                  </button>
                </div>

                <form onSubmit={submitCreateCommunity}>
                  {/* Aperçu en direct */}
                  <div className="ws-community-preview" aria-hidden="true">
                    <div className="ws-community-avatar">
                      {communityInitials}
                    </div>
                    <div className="ws-community-preview-body">
                      <span className="ws-community-preview-name">
                        {newCommunity.name.trim() || "Nouvelle communauté"}
                      </span>
                      <span className="ws-community-preview-desc">
                        {newCommunity.description.trim() ||
                          "Aucune description pour le moment"}
                      </span>
                    </div>
                  </div>

                  <div className="ws-form-group">
                    <label
                      className="ws-form-label"
                      htmlFor="new-community-name"
                    >
                      Nom de la communauté
                    </label>
                    <input
                      id="new-community-name"
                      name="new-community-name"
                      className="ws-form-input"
                      type="text"
                      placeholder="Ex. Équipe produit"
                      autoFocus
                      minLength={2}
                      maxLength={80}
                      value={newCommunity.name}
                      onChange={(event) =>
                        setNewCommunity((previous) => ({
                          ...previous,
                          name: event.target.value,
                        }))
                      }
                      aria-invalid={Boolean(communityNameError)}
                      aria-describedby="new-community-name-help"
                      required
                    />
                    <div className="ws-form-foot" id="new-community-name-help">
                      {communityNameError ? (
                        <span className="ws-form-error">
                          {communityNameError}
                        </span>
                      ) : (
                        <span className="ws-form-help">
                          Affiché dans la barre latérale et en haut de l'espace.
                        </span>
                      )}
                      <span className="ws-form-count">
                        {newCommunity.name.length}/80
                      </span>
                    </div>
                  </div>

                  <div className="ws-form-group">
                    <label
                      className="ws-form-label"
                      htmlFor="new-community-description"
                    >
                      Description{" "}
                      <span className="ws-form-label-optional">facultative</span>
                    </label>
                    <textarea
                      id="new-community-description"
                      name="new-community-description"
                      className="ws-form-textarea"
                      placeholder="À quoi sert cet espace ?"
                      maxLength={300}
                      value={newCommunity.description}
                      onChange={(event) =>
                        setNewCommunity((previous) => ({
                          ...previous,
                          description: event.target.value,
                        }))
                      }
                    />
                    <div className="ws-form-foot">
                      <span className="ws-form-help">
                        Visible sur la page de découverte.
                      </span>
                      <span className="ws-form-count">
                        {newCommunity.description.length}/300
                      </span>
                    </div>
                  </div>

                  <fieldset className="ws-visibility">
                    <legend className="ws-form-label">Visibilité</legend>
                    <div className="ws-visibility-options">
                      <label className="ws-visibility-option">
                        <input
                          type="radio"
                          name="new-community-visibility"
                          value="public"
                          checked={newCommunity.isPublic}
                          onChange={() =>
                            setNewCommunity((previous) => ({
                              ...previous,
                              isPublic: true,
                            }))
                          }
                        />
                        <span className="ws-visibility-icon">
                          <Globe size={17} />
                        </span>
                        <span className="ws-visibility-text">
                          <span className="ws-visibility-name">Publique</span>
                          <span className="ws-visibility-desc">
                            Visible dans la découverte, lecture ouverte aux
                            non-membres
                          </span>
                        </span>
                      </label>

                      <label className="ws-visibility-option">
                        <input
                          type="radio"
                          name="new-community-visibility"
                          value="private"
                          checked={!newCommunity.isPublic}
                          onChange={() =>
                            setNewCommunity((previous) => ({
                              ...previous,
                              isPublic: false,
                            }))
                          }
                        />
                        <span className="ws-visibility-icon">
                          <Lock size={17} />
                        </span>
                        <span className="ws-visibility-text">
                          <span className="ws-visibility-name">Privée</span>
                          <span className="ws-visibility-desc">
                            Accessible uniquement sur invitation
                          </span>
                        </span>
                      </label>
                    </div>
                  </fieldset>

                  {communityError && (
                    <p className="ws-form-banner" role="alert">
                      {communityError}
                    </p>
                  )}

                  <div className="ws-form-actions">
                    <button
                      className="ws-button"
                      type="button"
                      onClick={closeCreateCommunity}
                      disabled={creatingCommunity}
                    >
                      Annuler
                    </button>
                    <button
                      className="ws-button ws-button-primary"
                      type="submit"
                      disabled={creatingCommunity || Boolean(communityNameError)}
                    >
                      {creatingCommunity ? "Création en cours..." : "Créer"}
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Menus contextuels --- */}
        <AnimatePresence>
          {categoryMenu && (
            <ContextMenu
              x={categoryMenu.x}
              y={categoryMenu.y}
              items={categoryMenuItems(categoryMenu.category)}
              onClose={() => setCategoryMenu(null)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {channelMenu && (
            <ContextMenu
              x={channelMenu.x}
              y={channelMenu.y}
              items={channelMenuItems(channelMenu.channel)}
              onClose={() => setChannelMenu(null)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {headerMenu && (
            <ContextMenu
              x={headerMenu.x}
              y={headerMenu.y}
              items={[
                {
                  label: "Vue d'ensemble",
                  icon: <Info size={16} />,
                  onClick: () => navigate(`/c/${communityId}`),
                },
                {
                  label: "Inviter des membres",
                  icon: <Users size={16} />,
                  disabled: !canInvite,
                  onClick: () => navigate(`/c/${communityId}?tab=invitations`),
                },
                {
                  label: "Réglages de la communauté",
                  icon: <Settings size={16} />,
                  disabled: !canUpdateCommunity,
                  onClick: () => navigate(`/c/${communityId}?tab=reglages`),
                },
                {
                  label: "Gérer les rôles",
                  icon: <ShieldCheck size={16} />,
                  disabled: !canManageRoles,
                  onClick: () => navigate(`/c/${communityId}?tab=roles`),
                },
                { separator: true, label: "sep-structure" },

                // Création directe depuis le menu du serveur : on n'a pas à
                // rejoindre l'onglet « Salons » pour poser un salon.
                {
                  label: "Créer une catégorie",
                  icon: <FolderPlus size={16} />,
                  disabled: !canManageCategories,
                  onClick: () => openCreateCategory(),
                },
                {
                  label: "Créer un salon",
                  icon: <Hash size={16} />,
                  disabled: !canManageChannels,
                  onClick: () => openCreateChannel(null),
                },
                { separator: true, label: "sep-quitter" },
                {
                  label: "Quitter la communauté",
                  danger: true,
                  disabled: !role || role.isOwner,
                  onClick: leaveCommunity,
                },
              ]}
              onClose={() => setHeaderMenu(null)}
            />
          )}
        </AnimatePresence>
      </div>
    </WorkspaceContext.Provider>
  );
}

export default WorkspaceShell;
