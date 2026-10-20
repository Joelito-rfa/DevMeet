import { useCallback, useEffect, useState } from "react";
import { Headphones, LoaderCircle, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";

import socket from "../../services/socket";

/**
 * Salon vocal : la scène principale (participants + commandes).
 *
 * Le moteur WebRTC reste dans `VoiceChannel` (monté par ChannelView) : ce
 * composant lui commande l'entrée / la sortie via des événements DOM et
 * reflète l'état qu'il publie. Il n'y a donc qu'un seul flux audio par client.
 *
 * Les participants viennent de `voice:state` (au montage) puis des événements
 * `voice:user-joined` / `voice:user-left` / `voice:mute` du serveur.
 */
function VoiceStage({ channel }) {
  const [participants, setParticipants] = useState([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);

  const channelId = channel.id;

  /** Demande l'état actuel du salon vocal au serveur. */
  const refreshState = useCallback(() => {
    socket.emit("voice:state", { channelId }, (response) => {
      if (response && response.success !== false) {
        setParticipants(response.participants || []);
      }
    });
  }, [channelId]);

  useEffect(() => {
    refreshState();

    function handleJoined(payload) {
      if (Number(payload?.channelId) !== Number(channelId)) {
        return;
      }

      setParticipants((current) => {
        if (current.some((item) => item.userId === payload.userId)) {
          return current;
        }

        return [
          ...current,
          {
            userId: payload.userId,
            socketId: payload.socketId,
            name: payload.userName || null,
            muted: false,
          },
        ];
      });
    }

    function handleLeft(payload) {
      if (Number(payload?.channelId) !== Number(channelId)) {
        return;
      }

      setParticipants((current) =>
        current.filter((item) => item.userId !== payload.userId)
      );
    }

    function handleMute(payload) {
      if (Number(payload?.channelId) !== Number(channelId)) {
        return;
      }

      setParticipants((current) =>
        current.map((item) =>
          item.userId === payload.userId
            ? { ...item, muted: Boolean(payload.muted) }
            : item
        )
      );
    }

    socket.on("voice:user-joined", handleJoined);
    socket.on("voice:user-left", handleLeft);
    socket.on("voice:mute", handleMute);

    return () => {
      socket.off("voice:user-joined", handleJoined);
      socket.off("voice:user-left", handleLeft);
      socket.off("voice:mute", handleMute);
    };
  }, [channelId, refreshState]);

  // L'état publié par VoiceChannel (connexion, micro, casque) alimente l'affichage.
  useEffect(() => {
    function handleAudioState(event) {
      const detail = event.detail || {};
      setConnected(Boolean(detail.connected));
      setMuted(Boolean(detail.muted));
      setDeafened(Boolean(detail.deafened));

      if (detail.connecting !== undefined) {
        setConnecting(Boolean(detail.connecting));
      }

      if (detail.error) {
        setError(detail.error);
      } else if (detail.connected) {
        setError("");
      }
    }

    window.addEventListener("devmeet:audio-state", handleAudioState);

    return () =>
      window.removeEventListener("devmeet:audio-state", handleAudioState);
  }, []);

  function sendCommand(command) {
    window.dispatchEvent(
      new CustomEvent("devmeet:audio-command", { detail: { command } })
    );

    if (command === "join") {
      setConnecting(true);
      setError("");
    }
  }

  /** Le pseudo vient du serveur ; à défaut, un identifiant stable. */
  function labelFor(participant) {
    return participant.name || `Membre #${participant.userId}`;
  }

  function initialsFor(participant) {
    const parts = labelFor(participant)
      .split(" ")
      .filter(Boolean)
      .slice(0, 2);

    return parts.map((part) => part[0].toUpperCase()).join("") || "?";
  }

  return (
    <div className="ws-voice-stage">
      <div className="ws-voice-stage-card">
        <div className="ws-voice-stage-header">
          <Volume2 size={18} style={{ color: "#7985ff" }} />
          <div>
            <div className="ws-voice-stage-title">{channel.name}</div>
            <div className="ws-muted">
              {channel.description || "Salon vocal · conversation en direct"}
            </div>
          </div>
        </div>

        <div className="ws-voice-participants">
          {participants.length === 0 ? (
            <p className="ws-muted">
              Personne n'est dans le vocal pour l'instant.
            </p>
          ) : (
            participants.map((participant) => (
              <div className="ws-voice-participant" key={participant.userId}>
                <div className="ws-voice-avatar">
                  {initialsFor(participant)}
                </div>

                <span className="ws-voice-name">{labelFor(participant)}</span>

                {participant.muted ? (
                  <MicOff size={14} className="ws-voice-muted" title="Micro coupé" />
                ) : (
                  <Mic size={14} className="ws-voice-speaking" title="Micro actif" />
                )}
              </div>
            ))
          )}
        </div>

        {error && (
          <div className="ws-alert ws-alert-error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        <div className="ws-voice-actions">
          {!connected ? (
            <button
              className="ws-button ws-button-primary"
              type="button"
              disabled={connecting}
              onClick={() => sendCommand("join")}
            >
              {connecting ? (
                <>
                  <LoaderCircle size={14} className="dm-spin" /> Connexion…
                </>
              ) : (
                <>
                  <Mic size={14} /> Rejoindre le vocal
                </>
              )}
            </button>
          ) : (
            <>
              <button
                className={`ws-button${muted ? " ws-button-danger" : ""}`}
                type="button"
                onClick={() => sendCommand("toggle-mute")}
              >
                {muted ? <MicOff size={14} /> : <Mic size={14} />}
                {muted ? "Micro coupé" : "Micro actif"}
              </button>

              <button
                className={`ws-button${deafened ? " ws-button-danger" : ""}`}
                type="button"
                onClick={() => sendCommand("toggle-deafen")}
              >
                <Headphones size={14} />
                {deafened ? "Son coupé" : "Son activé"}
              </button>

              <button
                className="ws-button ws-button-danger"
                type="button"
                onClick={() => sendCommand("leave")}
              >
                <PhoneOff size={14} /> Quitter
              </button>
            </>
          )}
        </div>

        <p className="ws-form-help" style={{ marginTop: 12 }}>
          La conversation utilise WebRTC en pair-à-pair : au-delà de ~5
          participants, la qualité diminue (pas de serveur de mixage).
        </p>
      </div>
    </div>
  );
}

export default VoiceStage;
