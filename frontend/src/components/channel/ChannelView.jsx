import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Hash, LoaderCircle, Lock, ShieldAlert } from "lucide-react";

import Chat from "../chat/Chat";
import Whiteboard from "../board/Whiteboard";
import VoiceChannel from "../voice/VoiceChannel";
import VoiceStage from "../voice/VoiceStage";
import socket from "../../services/socket";
import { apiFetch } from "../../services/api";
import { useAsyncEffect } from "../../hooks/useAsyncEffect";
import { CHANNEL_ICONS, CHANNEL_TYPES, useWorkspace } from "../layout/workspace";
import { PERMISSIONS } from "../../permissions";

/**
 * Contenu de la zone principale pour un salon donné.
 *
 * Le type du salon choisit l'interface, comme sur Discord :
 *   - « text »         → chat (et vocal flottant, comme avant) ;
 *   - « announcement » → chat en lecture seule pour les non-responsables ;
 *   - « board »        → tableau blanc Fabric.js synchronisé ;
 *   - « voice »        → participants + commandes vocales.
 *
 * L'abonnement Socket.IO au salon (« join-room ») est fait ici, une seule fois
 * par salon, et rejoué après une reconnexion : c'est lui qui autorise la
 * réception des messages, du tableau et de la présence.
 */
function ChannelView({ token, user }) {
  const { community, flash } = useWorkspace();
  const { channelId } = useParams();

  const [channel, setChannel] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [announcementBlocked, setAnnouncementBlocked] = useState("");

  const load = useCallback(async () => {
    setLoading(true);

    const result = await apiFetch(`/api/channels/${channelId}`, { token });

    setLoading(false);

    if (result.ok) {
      setChannel(result.data.channel);
      setPermissions(result.data.permissions || []);
      setNeedsCode(false);
      setError("");
      return;
    }

    setChannel(null);
    setPermissions([]);
    setNeedsCode(result.status === 403);
    setError(result.data?.message || "Salon inaccessible.");
  }, [channelId, token]);

  useAsyncEffect(async () => {
    await load();
  }, [load]);

  // Abonnement au salon : messages, tableau blanc et présence temps réel.
  useEffect(() => {
    if (!channelId) {
      return undefined;
    }

    function joinRoom() {
      socket.emit(
        "join-room",
        { roomId: channelId, accessCode: "" },
        (response) => {
          if (response && !response.success) {
            setError(response.message || "Impossible de rejoindre le salon.");
          }
        }
      );
    }

    joinRoom();
    socket.on("connect", joinRoom);

    function handleRoomError(message) {
      // Une erreur d'envoi d'annonce revient ici : on la montre au lieu de la
      // laisser disparaître silencieusement.
      if (typeof message === "string" && message.toLowerCase().includes("annonce")) {
        setAnnouncementBlocked(message);
        window.setTimeout(() => setAnnouncementBlocked(""), 4000);
      }
    }

    socket.on("room-error", handleRoomError);

    return () => {
      socket.emit("leave-room", { roomId: channelId });
      socket.off("connect", joinRoom);
      socket.off("room-error", handleRoomError);
    };
  }, [channelId]);

  async function handleUnlock(event) {
    event.preventDefault();
    setUnlocking(true);
    setError("");

    const result = await apiFetch(`/api/channels/${channelId}/unlock`, {
      method: "POST",
      token,
      body: { accessCode: code.trim() },
    });

    setUnlocking(false);

    if (!result.ok) {
      setError(
        result.data?.code === "access_code_invalid"
          ? "Code d'accès incorrect."
          : result.data?.message || "Déverrouillage impossible."
      );
      return;
    }

    setCode("");
    flash("Salon déverrouillé : l'accès est enregistré pour votre compte.");
    load();
  }

  if (!channelId) {
    return (
      <div className="ws-empty" style={{ marginTop: 40 }}>
        Sélectionnez un salon dans la liste pour commencer.
      </div>
    );
  }

  if (loading) {
    return (
      <p className="ws-muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <LoaderCircle size={14} className="dm-spin" />
        Ouverture du salon…
      </p>
    );
  }

  if (!channel) {
    return (
      <div className="ws-card" style={{ maxWidth: 460, marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          {needsCode ? (
            <Lock size={16} style={{ color: "#7985ff" }} />
          ) : (
            <ShieldAlert size={16} style={{ color: "#f85149" }} />
          )}
          <strong style={{ fontSize: 14 }}>
            {needsCode ? "Salon protégé par un code" : "Accès refusé"}
          </strong>
        </div>

        <p className="ws-muted">{error}</p>

        {needsCode ? (
          <form onSubmit={handleUnlock} style={{ marginTop: 14 }}>
            <div className="ws-form-group">
              <label className="ws-form-label" htmlFor="access-code">
                Code d'accès
              </label>
              <input
                id="access-code"
                className="ws-form-input"
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoFocus
                required
              />
              <p className="ws-form-help">
                Un code valide accorde un accès durable à ce compte : il ne sera
                plus demandé après reconnexion.
              </p>
            </div>

            <button
              className="ws-button ws-button-primary"
              type="submit"
              disabled={unlocking}
            >
              {unlocking ? "Vérification…" : "Déverrouiller"}
            </button>
          </form>
        ) : null}
      </div>
    );
  }

  const Icon = CHANNEL_ICONS[channel.type] || Hash;
  const typeLabel =
    CHANNEL_TYPES.find((item) => item.value === channel.type)?.label ||
    channel.type;

  const canPublishAnnouncements = permissions.includes(
    PERMISSIONS.PUBLISH_ANNOUNCEMENTS
  );

  return (
    <div className="ws-channel-view">
      {announcementBlocked && (
        <div className="ws-alert ws-alert-error" style={{ marginBottom: 12 }}>
          {announcementBlocked}
        </div>
      )}

      {/* En-tête interne : nom, type et description du salon. */}
      <div className="ws-channel-view-header">
        <span className="ws-channel-view-icon">
          <Icon size={18} />
        </span>

        <div style={{ minWidth: 0 }}>
          <div className="ws-channel-view-title">{channel.name}</div>
          <div className="ws-channel-view-subtitle">
            {typeLabel}
            {channel.description ? ` · ${channel.description}` : ""}
            {community ? ` · ${community.name}` : ""}
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={channel.type}
          className="ws-channel-view-body"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          {channel.type === "board" ? (
            <Whiteboard roomId={channel.id} />
          ) : channel.type === "voice" ? (
            <VoiceStage channel={channel} />
          ) : (
            <Chat
              roomId={channel.id}
              communityId={channel.communityId}
              currentUserId={user?.id ?? null}
              token={token}
              permissions={permissions}
              readOnly={channel.type === "announcement" && !canPublishAnnouncements}
              readOnlyNotice="Seuls les responsables peuvent publier une annonce dans ce salon."
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Vocal flottant : conservé pour les salons textuels (fonctionnalité
          existante) et requis par le panneau vocal des salons de type « voice ». */}
      <VoiceChannel
        roomId={channel.id}
        enabled={channel.type === "text" || channel.type === "voice"}
        floating={channel.type === "text"}
      />
    </div>
  );
}

export default ChannelView;
