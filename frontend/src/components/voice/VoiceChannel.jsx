import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Headphones } from "lucide-react";
import socket from "../../services/socket";

const ICE_SERVERS = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

/**
 * Conversation vocale (WebRTC en maillage P2P).
 *
 * Corrections apportées au composant d'origine :
 *   - le micro n'est plus demandé automatiquement à l'ouverture du salon : il
 *     faut cliquer sur « Rejoindre le vocal » (une permission navigateur ne
 *     doit pas être déclenchée par une simple navigation) ;
 *   - les écouteurs sont enregistrés AVANT toute attente asynchrone, sinon les
 *     premiers messages d'un pair déjà présent étaient perdus ;
 *   - les éléments audio distants sont conservés pour pouvoir les couper ;
 *   - `voice:leave` est émis proprement au démontage et au changement de salon ;
 *   - après une reconnexion socket, l'entrée dans le salon vocal est rejouée.
 *
 * Depuis la refonte de l'espace de travail, le composant expose aussi un petit
 * protocole d'événements DOM :
 *   - `devmeet:audio-command` (window → ce composant) : « join », « leave »,
 *     « toggle-mute », « toggle-deafen ». C'est la sidebar et le panneau vocal
 *     qui les émettent ;
 *   - `devmeet:audio-state` (ce composant → window) : l'état courant
 *     (connexion, micro coupé, son coupé) pour que ces mêmes contrôles
 *     reflètent la réalité du flux.
 * Un seul moteur audio par client : ces événements ne font que le piloter.
 *
 * `floating={false}` masque le widget flottant : la page affiche alors sa
 * propre scène vocale (VoiceStage) en utilisant ce même moteur.
 *
 * Limite assumée : c'est un maillage P2P. Au-delà de ~5 participants, la bande
 * passante montante devient le facteur limitant (pas de SFU).
 */
export default function VoiceChannel({ roomId, enabled = true, floating = true }) {
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [participants, setParticipants] = useState([]);

  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const audiosRef = useRef({});
  const joinedRef = useRef(false);
  // Référence stable du « son coupé », lisible depuis les créations de pairs.
  const deafenedRef = useRef(false);

  const closePeer = useCallback((remoteId) => {
    const peer = peersRef.current[remoteId];

    if (peer) {
      peer.close();
      delete peersRef.current[remoteId];
    }

    const audio = audiosRef.current[remoteId];

    if (audio) {
      audio.srcObject = null;
      audio.pause();
      delete audiosRef.current[remoteId];
    }
  }, []);

  const leave = useCallback(() => {
    if (joinedRef.current) {
      socket.emit("voice:leave", { channelId: roomId });
    }

    joinedRef.current = false;
    setConnected(false);
    setConnecting(false);
    setMuted(false);
    setDeafened(false);
    setParticipants([]);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    Object.keys(peersRef.current).forEach((remoteId) => closePeer(remoteId));
  }, [roomId, closePeer]);

  const createPeer = useCallback(
    (remoteId, initiator, stream) => {
      const peer = new RTCPeerConnection(ICE_SERVERS);

      stream.getTracks().forEach((track) => peer.addTrack(track, stream));

      peer.ontrack = (event) => {
        let audio = audiosRef.current[remoteId];

        if (!audio) {
          audio = new Audio();
          audio.autoplay = true;
          audiosRef.current[remoteId] = audio;
        }

        audio.srcObject = event.streams[0];
        audio.muted = deafenedRef.current;
        audio.play().catch(() => {});
      };

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("voice-ice", {
            to: remoteId,
            candidate: event.candidate,
          });
        }
      };

      peer.onconnectionstatechange = () => {
        if (
          peer.connectionState === "failed" ||
          peer.connectionState === "closed"
        ) {
          closePeer(remoteId);
        }
      };

      if (initiator) {
        peer
          .createOffer()
          .then((offer) => peer.setLocalDescription(offer).then(() => offer))
          .then((offer) => socket.emit("voice-offer", { to: remoteId, offer }))
          .catch(() => closePeer(remoteId));
      }

      return peer;
    },
    [closePeer]
  );

  useEffect(() => {
    deafenedRef.current = deafened;

    // Couper le son entrant revient à muter tous les flux distants.
    Object.values(audiosRef.current).forEach((audio) => {
      audio.muted = deafened;
    });
  }, [deafened]);

  useEffect(() => {
    if (!enabled || !roomId) {
      return undefined;
    }

    function handleUserJoined(payload) {
      // Deux formats coexistent : `voice:user-joined` (objet) et
      // `voice-user-joined` (identifiant de connexion brut).
      const remoteId =
        typeof payload === "string" ? payload : payload?.socketId;

      if (!remoteId || remoteId === socket.id) {
        return;
      }

      if (!joinedRef.current || !localStreamRef.current) {
        return;
      }

      if (peersRef.current[remoteId]) {
        return;
      }

      peersRef.current[remoteId] = createPeer(
        remoteId,
        true,
        localStreamRef.current
      );
    }

    async function handleOffer({ from, offer }) {
      if (!from || !offer || !localStreamRef.current) {
        return;
      }

      try {
        let peer = peersRef.current[from];

        if (!peer) {
          peer = createPeer(from, false, localStreamRef.current);
          peersRef.current[from] = peer;
        }

        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit("voice-answer", { to: from, answer });
      } catch {
        closePeer(from);
      }
    }

    async function handleAnswer({ from, answer }) {
      const peer = peersRef.current[from];

      if (!peer || !answer) {
        return;
      }

      try {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
      } catch {
        closePeer(from);
      }
    }

    async function handleIce({ from, candidate }) {
      const peer = peersRef.current[from];

      if (!peer || !candidate) {
        return;
      }

      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Un candidat arrivé trop tard n'est pas une erreur bloquante.
      }
    }

    function handleUserLeft(payload) {
      const remoteId =
        typeof payload === "string" ? payload : payload?.socketId;

      if (remoteId) {
        closePeer(remoteId);
      }
    }

    // Le socket a été reconnecté : le serveur ne nous sait plus dans le salon.
    function handleReconnect() {
      if (joinedRef.current) {
        socket.emit("voice:join", { channelId: roomId });
      }
    }

    socket.on("voice:user-joined", handleUserJoined);
    socket.on("voice-user-joined", handleUserJoined);
    socket.on("voice-offer", handleOffer);
    socket.on("voice-answer", handleAnswer);
    socket.on("voice-ice", handleIce);
    socket.on("voice:user-left", handleUserLeft);
    socket.on("voice-user-left", handleUserLeft);
    socket.on("connect", handleReconnect);

    return () => {
      socket.off("voice:user-joined", handleUserJoined);
      socket.off("voice-user-joined", handleUserJoined);
      socket.off("voice-offer", handleOffer);
      socket.off("voice-answer", handleAnswer);
      socket.off("voice-ice", handleIce);
      socket.off("voice:user-left", handleUserLeft);
      socket.off("voice-user-left", handleUserLeft);
      socket.off("connect", handleReconnect);

      leave();
    };
  }, [enabled, roomId, createPeer, closePeer, leave]);

  const join = useCallback(async () => {
    if (!roomId || joinedRef.current) {
      return;
    }

    setError("");
    setConnecting(true);

    let stream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setConnecting(false);
      setError(
        "Micro indisponible : autorisez l'accès au microphone dans le navigateur."
      );
      return;
    }

    localStreamRef.current = stream;
    joinedRef.current = true;
    setConnected(true);
    setConnecting(false);

    socket.emit("voice:join", { channelId: roomId }, (response) => {
      if (!response || !response.success) {
        setError(
          response?.message || "Impossible de rejoindre le salon vocal."
        );
        leave();
        return;
      }

      setParticipants(response.participants || []);
    });
  }, [roomId, leave]);

  function toggleMute() {
    if (!localStreamRef.current) {
      return;
    }

    const next = !muted;

    localStreamRef.current
      .getAudioTracks()
      .forEach((track) => {
        track.enabled = !next;
      });

    setMuted(next);

    socket.emit("voice:mute", { channelId: roomId, muted: next });
  }

  // --- Pilotage à distance (sidebar / scène vocale) ------------------------
  useEffect(() => {
    function handleCommand(event) {
      const command = event.detail?.command;

      if (command === "join") {
        join();
        return;
      }

      if (command === "leave") {
        leave();
        return;
      }

      if (command === "toggle-mute") {
        toggleMute();
        return;
      }

      if (command === "toggle-deafen") {
        setDeafened((value) => !value);
      }
    }

    window.addEventListener("devmeet:audio-command", handleCommand);

    return () =>
      window.removeEventListener("devmeet:audio-command", handleCommand);
    // Recréé à chaque rendu : `muted` et `joinedRef` restent justes.
  });

  // --- Publication de l'état ----------------------------------------------
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("devmeet:audio-state", {
        detail: {
          connected,
          connecting,
          muted,
          deafened,
          channelId: roomId ?? null,
          error,
          participants,
        },
      })
    );
  }, [connected, connecting, muted, deafened, error, roomId, participants]);

  if (!enabled || !roomId) {
    return null;
  }

  if (!floating) {
    // La scène vocale de la page porte l'interface : ici, seul le moteur vit.
    return null;
  }

  if (!connected) {
    return (
      <div
        style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: "8px",
          maxWidth: "280px",
        }}
      >
        {error ? (
          <div
            style={{
              padding: "9px 11px",
              border: "1px solid #5a2a2d",
              borderRadius: "8px",
              background: "#2a1c1f",
              color: "#f85149",
              fontSize: "11px",
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={join}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            height: "42px",
            padding: "0 16px",
            border: "none",
            borderRadius: "21px",
            background: "linear-gradient(135deg,#5865f2,#7985ff)",
            color: "#f0f6fc",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 8px 20px rgba(88,101,242,0.3)",
          }}
        >
          <Mic size={16} />
          Rejoindre le vocal
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "7px",
        border: "1px solid #30363d",
        borderRadius: "24px",
        background: "#161b22",
        boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
      }}
    >
      <span
        style={{
          paddingLeft: "9px",
          color: "#8b949e",
          fontSize: "11px",
        }}
      >
        Vocal · {Math.max(participants.length, 1)} participant
        {Math.max(participants.length, 1) > 1 ? "s" : ""}
      </span>

      <button
        type="button"
        onClick={toggleMute}
        title={muted ? "Réactiver le micro" : "Couper le micro"}
        style={{
          width: "38px",
          height: "38px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          borderRadius: "50%",
          background: muted ? "#f85149" : "#30363d",
          color: "#f0f6fc",
          cursor: "pointer",
        }}
      >
        {muted ? <MicOff size={17} /> : <Mic size={17} />}
      </button>

      <button
        type="button"
        onClick={() => setDeafened((value) => !value)}
        title={deafened ? "Réactiver le son entrant" : "Couper le son entrant"}
        style={{
          width: "38px",
          height: "38px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          borderRadius: "50%",
          background: deafened ? "#f85149" : "#30363d",
          color: "#f0f6fc",
          cursor: "pointer",
        }}
      >
        <Headphones size={17} />
      </button>

      <button
        type="button"
        onClick={leave}
        title="Quitter le salon vocal"
        style={{
          width: "38px",
          height: "38px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          borderRadius: "50%",
          background: "#332124",
          color: "#f85149",
          cursor: "pointer",
        }}
      >
        <PhoneOff size={17} />
      </button>
    </div>
  );
}
