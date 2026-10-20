import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  GripVertical,
  Hash,
  Headphones,
  Home,
  Lock,
  LogIn,
  LogOut,
  Mic,
  MicOff,
  MoreHorizontal,
  Plus,
  Search,
  Settings as SettingsIcon,
  UserPlus,
  X,
} from "lucide-react";

import { CHANNEL_ICONS, useWorkspace } from "./workspace";

/**
 * Deuxième colonne de l'espace de travail : l'arborescence des catégories et
 * des salons, puis le panneau utilisateur.
 *
 * Principés tenus ici :
 *   - l'ordre se change au **glisser-déposer** (poignée, souris et clavier) et
 *     par les entrées « Monter / Descendre » des menus contextuels — les deux
 *     passent par les mêmes méthodes du shell, donc par la même API ;
 *   - une catégorie se replie (état conservé par communauté) ;
 *   - les menus contextuels et les modales appartiennent au shell : cette
 *     colonne ne fait que les déclencher avec la bonne cible ;
 *   - aucune donnée codée en dur : tout vient du contexte `useWorkspace`.
 */

/** Libellés des annonces de glisser-déposer (lecteurs d'écran). */
const DND_I18N = {
  announcements: {
    onDragStart: () =>
      "Élément saisi. Utilisez les flèches haut et bas pour le déplacer, Espace pour déposer, Échap pour annuler.",
    onDragOver: () => "Nouvelle position.",
    onDragEnd: () => "Élément déposé.",
    onDragCancel: () => "Déplacement annulé.",
  },
};

/** État du micro / du casque, partagé avec le salon vocal en cours. */
function readAudioPrefs() {
  try {
    const raw = window.localStorage.getItem("devmeet.audio");
    return raw ? JSON.parse(raw) : { muted: false, deafened: false };
  } catch {
    return { muted: false, deafened: false };
  }
}

function persistAudioPrefs(prefs) {
  try {
    window.localStorage.setItem("devmeet.audio", JSON.stringify(prefs));
  } catch {
    // Rien de bloquant : les préférences valent pour la session.
  }
}

/** Poignée de déplacement : révélée au survol, utilisable au clavier. */
function DragHandle({ attributes, listeners, label }) {
  return (
    <button
      className="ws-drag-handle"
      type="button"
      title={label}
      aria-label={label}
      {...attributes}
      {...listeners}
    >
      <GripVertical size={16} />
    </button>
  );
}

/**
 * Une ligne de salon : icône selon le type, verrou, non-lus, état actif,
 * poignée de déplacement et menu d'options.
 */
function ChannelRow({ channel, groupKey, active, sortable, canManage, onOpen, onMenu }) {
  const id = `ch-${groupKey}-${channel.id}`;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !sortable });

  const Icon = CHANNEL_ICONS[channel.type] || Hash;
  const unread = Number(channel.unreadCount) || 0;

  return (
    <div
      ref={setNodeRef}
      className={`ws-channel${active ? " active" : ""}${unread > 0 ? " unread" : ""}${
        isDragging ? " ws-dragging" : ""
      }`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {sortable && (
        <DragHandle
          attributes={attributes}
          listeners={listeners}
          label={`Déplacer le salon ${channel.name}`}
        />
      )}

      <button className="ws-channel-main" type="button" onClick={onOpen}>
        <Icon size={18} className="ws-channel-icon" />

        <span className="ws-channel-name">{channel.name}</span>

        {(channel.isPrivate || channel.hasAccessCode) && (
          <Lock size={14} className="ws-channel-lock" />
        )}

        {unread > 0 && (
          <span className="ws-count-badge" title={`${unread} message(s) non lu(s)`}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {canManage && (
        <button
          className="ws-row-action ws-channel-more"
          type="button"
          title="Options du salon"
          aria-label={`Options du salon ${channel.name}`}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();

            onMenu({ x: rect.left, y: rect.bottom + 4 });
          }}
        >
          <MoreHorizontal size={17} />
        </button>
      )}
    </div>
  );
}

/**
 * Un groupe : l'en-tête de catégorie (repliable, déplaçable) puis ses salons.
 * Le groupe « Sans catégorie » réutilise la même structure avec `category`
 * à `null` : son en-tête est statique et n'est pas déplaçable.
 */
function CategoryGroup({
  category,
  channels,
  activeChannelId,
  collapsed,
  filterActive,
  onToggleCollapse,
  onOpenCategoryMenu,
  onOpenChannelMenu,
  onOpenChannel,
  onCreateChannel,
}) {
  const {
    canManageCategories,
    canManageChannels,
  } = useWorkspace();

  const isStatic = category === null;
  const groupKey = isStatic ? "none" : String(category.id);
  const sortable = canManageChannels && !filterActive;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `cat-${groupKey}`,
    disabled: !sortable || isStatic || !canManageCategories,
  });

  return (
    <div
      ref={setNodeRef}
      className={`ws-channels-group${isDragging ? " ws-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="ws-category">
        {isStatic ? (
          <span className="ws-category-toggle static">
            <span className="ws-category-name">Sans catégorie</span>
          </span>
        ) : (
          <button
            className={`ws-category-toggle${collapsed ? " collapsed" : ""}`}
            type="button"
            title={
              collapsed
                ? `Déplier « ${category.name} »`
                : `Replier « ${category.name} »`
            }
            aria-expanded={!collapsed}
            onClick={() => onToggleCollapse(category.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              onOpenCategoryMenu(category, {
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            <ChevronDown size={15} className="ws-category-chevron" />
            <span className="ws-category-name">{category.name}</span>
            {category.description && (
              <span className="ws-category-desc" title={category.description}>
                · {category.description}
              </span>
            )}
          </button>
        )}

        <div className="ws-category-actions">
          {canManageChannels && (
            <button
              className="ws-row-action"
              type="button"
              title="Créer un salon dans cette catégorie"
              aria-label="Créer un salon dans cette catégorie"
              onClick={() => onCreateChannel(category ? category.id : null)}
            >
              <Plus size={16} />
            </button>
          )}

          {!isStatic && (canManageCategories || canManageChannels) && (
            <DragHandle
              attributes={attributes}
              listeners={listeners}
              label={`Déplacer la catégorie ${category.name}`}
            />
          )}

          {!isStatic && (canManageCategories || canManageChannels) && (
            <button
              className="ws-row-action"
              type="button"
              title="Options de la catégorie"
              aria-label={`Options de la catégorie ${category.name}`}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();

                onOpenCategoryMenu(category, {
                  x: rect.left,
                  y: rect.bottom + 4,
                });
              }}
            >
              <MoreHorizontal size={17} />
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
          {channels.length === 0 && !filterActive && (
            <p className="ws-channels-empty small">Aucun salon.</p>
          )}

          <SortableContext
            items={channels.map((channel) => `ch-${groupKey}-${channel.id}`)}
            strategy={verticalListSortingStrategy}
          >
            {channels.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                groupKey={groupKey}
                active={Number(channel.id) === Number(activeChannelId)}
                sortable={sortable}
                canManage={canManageChannels}
                onOpen={() => onOpenChannel(channel)}
                onMenu={(position) => onOpenChannelMenu(channel, position)}
              />
            ))}
          </SortableContext>
        </>
      )}
    </div>
  );
}

/**
 * Panneau utilisateur : identité, commandes audio (relayées au salon vocal),
 * réglages et déconnexion. Pour un visiteur sans compte (page d'invitation),
 * seul un accès à la connexion est proposé.
 */
function UserPanel({ user, onOpenSettings, onLogout, onLogin }) {
  const [audio, setAudio] = useState(readAudioPrefs);

  /** Micro / casque : le vrai flux appartient au salon vocal (VoiceChannel). */
  function sendAudioCommand(command) {
    window.dispatchEvent(
      new CustomEvent("devmeet:audio-command", { detail: { command } })
    );
  }

  function toggleMute() {
    const next = { ...audio, muted: !audio.muted };
    setAudio(next);
    persistAudioPrefs(next);
    sendAudioCommand("toggle-mute");
  }

  function toggleDeafen() {
    const next = {
      ...audio,
      deafened: !audio.deafened,
      // Couper le son entrant coupe aussi la sortie : mêmes boutons physiques.
      muted: !audio.deafened ? true : audio.muted,
    };
    setAudio(next);
    persistAudioPrefs(next);
    sendAudioCommand("toggle-deafen");
  }

  const displayName = user?.name || "Invité";
  const initials =
    displayName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "DM";

  return (
    <div className="ws-user-panel">
      <div className="ws-user-panel-main">
        <span className="ws-user-panel-avatar ws-avatar-wrap">
          {initials}

          {/* Présence posée dans l'angle bas-droit de l'avatar. */}
          {user ? (
            <span className="ws-presence-dot ws-presence-online" />
          ) : null}
        </span>

        {/* Nom et statut côte à côte, alignés sur la même ligne. */}
        <div className="ws-user-panel-info">
          <div className="ws-user-panel-name">{displayName}</div>

          <div className="ws-user-panel-status">
            {user ? "En ligne" : "Aperçu public"}
          </div>
        </div>
      </div>

      <div className="ws-user-panel-controls">
        {user ? (
          <>
            <button
              className={`ws-user-panel-button ws-tip-up${audio.muted ? " danger" : ""}`}
              type="button"
              data-tip={audio.muted ? "Réactiver le micro" : "Couper le micro"}
              aria-label={audio.muted ? "Réactiver le micro" : "Couper le micro"}
              onClick={toggleMute}
            >
              {audio.muted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>

            <button
              className={`ws-user-panel-button ws-tip-up${audio.deafened ? " danger" : ""}`}
              type="button"
              data-tip={audio.deafened ? "Réactiver le son" : "Couper le son entrant"}
              aria-label={audio.deafened ? "Réactiver le son" : "Couper le son entrant"}
              onClick={toggleDeafen}
            >
              <Headphones size={18} />
            </button>

            <button
              className="ws-user-panel-button ws-tip-up"
              type="button"
              data-tip="Paramètres"
              aria-label="Paramètres"
              onClick={onOpenSettings}
            >
              <SettingsIcon size={18} />
            </button>

            <button
              className="ws-user-panel-button ws-tip-up"
              type="button"
              data-tip="Se déconnecter"
              aria-label="Se déconnecter"
              onClick={onLogout}
            >
              <LogOut size={18} />
            </button>
          </>
        ) : (
          <button
            className="ws-user-panel-button ws-tip-up"
            type="button"
            data-tip="Se connecter"
            aria-label="Se connecter"
            onClick={onLogin}
          >
            <LogIn size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

function CommunitySidebar({
  communityId,
  channelId,
  onOpenHeaderMenu,
  onOpenCategoryMenu,
  onOpenChannelMenu,
}) {
  const navigate = useNavigate();
  const workspace = useWorkspace();

  const {
    community,
    categories,
    grouped,
    uncategorized,
    role,
    loading,
    treeError,
    canManageCategories,
    canInvite,
    canUpdateCommunity,
    collapsed,
    toggleCategory,
    openCreateCategory,
    openCreateChannel,
    reorderCategories,
    reorderChannels,
    drawerOpen,
    unreadDmCount,
    closeDrawer,
    user,
    onLogout,
  } = workspace;

  const [filter, setFilter] = useState("");
  const filterRef = useRef(null);

  const filterActive = Boolean(filter.trim());

  // « / » amène au filtre, comme dans les outils de suivi de tickets ; la
  // touche reste neutre pendant la saisie (champ, zone de texte, contenu
  // éditable), où le caractère doit s'écrire normalement.
  useEffect(() => {
    function handleKey(event) {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (event.key === "/" && !typing) {
        event.preventDefault();
        filterRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleKey);

    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  /** Filtre appliqué aux noms de salons (simple et local). */
  function matches(channel) {
    if (!filterActive) {
      return true;
    }

    return channel.name.toLowerCase().includes(filter.trim().toLowerCase());
  }

  const visibleGrouped = useMemo(() => {
    const map = new Map();

    for (const category of categories) {
      map.set(category.id, (grouped.get(category.id) || []).filter(matches));
    }

    return map;
    // `matches` ne dépend que de `filter`, déjà dans la liste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped, categories, filter]);

  const visibleUncategorized = useMemo(
    () => uncategorized.filter(matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uncategorized, filter]
  );

  // --- Glisser-déposer ------------------------------------------------------

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  /**
   * Une seule surface de dépôt pour toute la colonne. Les identifiants portent
   * leur groupe (`cat-<id>`, `ch-<catégorie|none>-<id>`) : le calcul de
   * collision ne compare donc que des éléments comparables — une catégorie ne
   * peut pas être déposée au milieu d'une liste de salons, et un salon ne peut
   * pas changer de catégorie par accident (cela passe par « Déplacer vers… »).
   */
  function restrictCollisions(args) {
    const activeId = String(args.active.id);

    const droppableContainers = args.droppableContainers.filter((container) => {
      const overId = String(container.id);

      if (activeId.startsWith("cat-")) {
        return overId.startsWith("cat-");
      }

      const group = activeId.split("-")[1];

      return overId.startsWith(`ch-${group}-`);
    });

    return closestCenter({ ...args, droppableContainers });
  }

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) {
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId.startsWith("cat-")) {
      const oldIndex = categories.findIndex((item) => `cat-${item.id}` === activeId);
      const newIndex = categories.findIndex((item) => `cat-${item.id}` === overId);

      if (oldIndex === -1 || newIndex === -1) {
        return;
      }

      reorderCategories(arrayMove(categories, oldIndex, newIndex));
      return;
    }

    const [, group] = activeId.split("-");
    const categoryId = group === "none" ? null : Number(group);
    const list = categoryId === null ? uncategorized : grouped.get(categoryId) || [];

    const oldIndex = list.findIndex((item) => `ch-${group}-${item.id}` === activeId);
    const newIndex = list.findIndex((item) => `ch-${group}-${item.id}` === overId);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    reorderChannels(categoryId, arrayMove(list, oldIndex, newIndex));
  }

  function openChannel(channel) {
    navigate(`/c/${communityId}/${channel.id}`);
    closeDrawer();
  }

  const hasCommunity = Boolean(communityId);

  return (
    <aside className={`ws-channels${drawerOpen ? " open" : ""}`}>
      {hasCommunity ? (
        <>
          <header className="ws-channels-header">
            <button
              className="ws-channels-title"
              type="button"
              title="Options de la communauté"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();

                onOpenHeaderMenu({
                  x: rect.left,
                  y: rect.bottom + 6,
                });
              }}
            >
              <span className="ws-channels-title-text">
                {community ? community.name : "Chargement…"}
                {unreadDmCount > 0 ? (
                  <span className="ws-count-badge">
                    {unreadDmCount > 99 ? "99+" : unreadDmCount}
                  </span>
                ) : null}
              </span>
              <ChevronDown size={17} />
            </button>

            <div className="ws-channels-header-actions">
              {canInvite && (
                <button
                  className="ws-row-action ws-tip-end"
                  type="button"
                  data-tip="Inviter des membres"
                  aria-label="Inviter des membres"
                  onClick={() => navigate(`/c/${communityId}?tab=invitations`)}
                >
                  <UserPlus size={17} />
                </button>
              )}

              {canUpdateCommunity && (
                <button
                  className="ws-row-action ws-tip-end"
                  type="button"
                  data-tip="Réglages de la communauté"
                  aria-label="Réglages de la communauté"
                  onClick={() => navigate(`/c/${communityId}?tab=reglages`)}
                >
                  <SettingsIcon size={17} />
                </button>
              )}
            </div>
          </header>

          <div className="ws-channels-search">
            <Search size={16} />

            <input
              ref={filterRef}
              type="text"
              placeholder="Filtrer les salons"
              aria-label="Filtrer les salons"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />

            <kbd className="ws-kbd">/</kbd>

            {filterActive && (
              <button
                className="ws-channels-search-clear"
                type="button"
                title="Effacer le filtre"
                onClick={() => setFilter("")}
              >
                <X size={15} />
              </button>
            )}
          </div>

          <div className="ws-channels-scroll">
            {loading && (
              <div className="ws-skeletons" aria-hidden="true">
                <span className="ws-skeleton" style={{ width: "58%" }} />
                <span className="ws-skeleton" style={{ width: "76%" }} />
                <span className="ws-skeleton" style={{ width: "46%" }} />
              </div>
            )}
            {treeError && <p className="ws-channels-empty">{treeError}</p>}

            {!loading && !treeError && !role && (
              <p className="ws-channels-empty">
                Communauté publique : lecture seule tant que vous n'en êtes pas
                membre.
              </p>
            )}

            <DndContext
              id="ws-channels-dnd"
              sensors={sensors}
              collisionDetection={restrictCollisions}
              onDragEnd={handleDragEnd}
              accessibility={DND_I18N}
            >
              <SortableContext
                items={categories.map((category) => `cat-${category.id}`)}
                strategy={verticalListSortingStrategy}
              >
                {categories.map((category) => {
                  const list = visibleGrouped.get(category.id) || [];

                  if (filterActive && list.length === 0) {
                    return null;
                  }

                  return (
                    <CategoryGroup
                      key={category.id}
                      category={category}
                      channels={list}
                      activeChannelId={channelId}
                      collapsed={collapsed.has(category.id)}
                      filterActive={filterActive}
                      onToggleCollapse={toggleCategory}
                      onOpenCategoryMenu={onOpenCategoryMenu}
                      onOpenChannelMenu={onOpenChannelMenu}
                      onOpenChannel={openChannel}
                      onCreateChannel={openCreateChannel}
                    />
                  );
                })}
              </SortableContext>

              {(visibleUncategorized.length > 0 || categories.length === 0) && (
                <CategoryGroup
                  category={null}
                  channels={visibleUncategorized}
                  activeChannelId={channelId}
                  collapsed={false}
                  filterActive={filterActive}
                  onToggleCollapse={() => {}}
                  onOpenCategoryMenu={() => {}}
                  onOpenChannelMenu={onOpenChannelMenu}
                  onOpenChannel={openChannel}
                  onCreateChannel={openCreateChannel}
                />
              )}
            </DndContext>

            {canManageCategories && (
              <button
                className="ws-channels-create"
                type="button"
                onClick={openCreateCategory}
              >
                <Plus size={16} /> Nouvelle catégorie
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="ws-channels-scroll">
          <div className="ws-channels-placeholder">
            <div className="ws-channels-placeholder-icon">
              <span className="ws-home-icon-wrap">
                <Home size={21} />
                {unreadDmCount > 0 ? (
                  <span className="ws-home-badge">
                    {unreadDmCount > 99 ? "99+" : unreadDmCount}
                  </span>
                ) : null}
              </span>
            </div>

            <p className="ws-channels-placeholder-title">Ouvrez une communauté</p>

            <p className="ws-channels-empty small">
              Choisissez une pastille dans la barre de gauche : ses catégories et
              ses salons s'afficheront ici.
            </p>
          </div>
        </div>
      )}

      <UserPanel
        user={user}
        onOpenSettings={() => navigate("/parametres")}
        onLogout={onLogout ? () => onLogout() : undefined}
        onLogin={() => navigate("/login")}
      />
    </aside>
  );
}

export default CommunitySidebar;
