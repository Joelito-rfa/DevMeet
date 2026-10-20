import { useNavigate, useParams } from "react-router-dom";
import { Hash } from "lucide-react";

import WorkspaceShell from "../components/layout/WorkspaceShell";
import {
  CHANNEL_ICONS,
  CHANNEL_TYPES,
  useWorkspace,
} from "../components/layout/workspace";
import ChannelView from "../components/channel/ChannelView";

/**
 * Un salon réel, ouvert depuis la communauté.
 *
 * L'accès est vérifié par le serveur : s'il manque un code d'accès,
 * `ChannelView` l'affiche et l'envoie à `POST /api/channels/:id/unlock` (qui
 * enregistre l'autorisation de façon durable). Un salon privé, lui, ne s'ouvre
 * jamais par code : il faut qu'un responsable l'ait autorisé.
 *
 * La mise en page (barre des communautés, sidebar des salons) vient du shell :
 * cette page ne fournit que l'en-tête et le contenu du salon.
 */
function Channel({ token, user, onLogout }) {
  const { communityId, channelId } = useParams();
  const navigate = useNavigate();

  // Le shell connaît déjà la liste des salons : l'en-tête s'y rattache sans
  // requête supplémentaire. Le détail (accès, permissions) est chargé par
  // ChannelView.
  return (
    <WorkspaceShell
      token={token}
      user={user}
      onLogout={onLogout}
      communityId={communityId}
      channelId={channelId}
      headerTitle={<ChannelHeaderTitle channelId={channelId} />}
      headerSubtitle="Salon"
      headerActions={
        <button
          className="ws-button ws-button-small"
          type="button"
          onClick={() => navigate(`/c/${communityId}`)}
        >
          ← Vue d'ensemble
        </button>
      }
    >
      <ChannelView token={token} user={user} />
    </WorkspaceShell>
  );
}

/**
 * Titre de l'en-tête : nom et icône du salon dans la liste déjà chargée par le
 * shell ; un libellé générique le temps du chargement.
 */
function ChannelHeaderTitle({ channelId }) {
  const workspace = useWorkspace();

  const channel = workspace?.channels?.find(
    (item) => Number(item.id) === Number(channelId)
  );

  if (!channel) {
    return <span>Salon</span>;
  }

  const Icon = CHANNEL_ICONS[channel.type] || Hash;
  const typeLabel =
    CHANNEL_TYPES.find((item) => item.value === channel.type)?.label ||
    channel.type;

  return (
    <span className="ws-inline" style={{ gap: 8 }}>
      <Icon size={20} style={{ color: "#7985ff", verticalAlign: "middle" }} />
      {channel.name}
      <span className="ws-muted" style={{ fontWeight: 400 }}>
        · {typeLabel}
      </span>
    </span>
  );
}

export default Channel;
