import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LogIn, TriangleAlert } from "lucide-react";

import WorkspaceShell from "../components/layout/WorkspaceShell";
import { apiFetch } from "../services/api";
import { useAsyncEffect } from "../hooks/useAsyncEffect";

/**
 * Page d'invitation `/invite/:code`.
 *
 * Accessible SANS compte pour l'aperçu (le serveur ne révèle alors ni les
 * salons privés ni la liste des membres). L'acceptation, elle, exige une
 * session : c'est le serveur qui le rappelle (`401 auth_required`).
 */
function Invite({ token, user, onLogout }) {
  const { code } = useParams();
  const navigate = useNavigate();

  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);

  // L'aperçu est public : `apiFetch` sans jeton suffit (aucun en-tête
  // Authorization n'est ajouté quand le jeton est vide).
  useAsyncEffect(async (isCancelled) => {
    const result = await apiFetch(`/api/invitations/${code}`);

    if (isCancelled()) {
      return;
    }

    if (result.ok) {
      setPreview(result.data);
    } else {
      setError(result.data?.message || "Invitation introuvable.");
    }

    setLoading(false);
  }, [code]);

  async function handleAccept() {
    setJoining(true);
    setError("");

    const result = await apiFetch(`/api/invitations/${code}/accept`, {
      method: "POST",
      token,
    });

    setJoining(false);

    if (!result.ok) {
      setError(result.data?.message || "Impossible de rejoindre.");
      return;
    }

    setMessage(result.data?.message || "Invitation acceptée.");

    const communityId = result.data?.community?.id;

    if (communityId) {
      navigate(`/c/${communityId}`);
    }
  }

  if (loading) {
    return (
      <WorkspaceShell
        user={user}
        token={token}
        onLogout={onLogout}
        headerIcon={<LogIn size={22} />}
        headerTitle="Invitation"
      >
        <p className="ws-empty">Vérification de l'invitation…</p>
      </WorkspaceShell>
    );
  }

  if (error && !preview) {
    return (
      <WorkspaceShell
        user={user}
        token={token}
        onLogout={onLogout}
        headerIcon={<LogIn size={22} />}
        headerTitle="Invitation"
        headerSubtitle="Ce lien n'est plus valable."
      >
        <div className="ws-card" style={{ maxWidth: 520 }}>
          <div className="ws-card-title">
            <TriangleAlert size={17} /> {error}
          </div>

          <p className="ws-muted">
            Une invitation peut être révoquée, expirée ou avoir atteint son
            nombre maximal d'utilisations. Demandez un nouveau lien à un
            responsable de la communauté.
          </p>

          <div className="ws-card-footer">
            <Link className="ws-button" to="/">
              Mes communautés
            </Link>
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      user={user}
      token={token}
      onLogout={onLogout}
      headerIcon={<LogIn size={22} />}
      headerTitle={preview.community.name}
      headerSubtitle="Vous êtes invité à rejoindre cette communauté."
    >
      <div className="ws-card" style={{ maxWidth: 540 }}>
        <div className="ws-card-title">Invitation</div>

        <p className="ws-muted">
          {preview.community.description || "Aucune description."}
        </p>

        <div className="ws-meta">
          <span>{preview.community.memberCount ?? 0} membres</span>
          <span>{preview.community.channelCount ?? 0} salons</span>
          <span className="ws-badge">
            {preview.community.isPublic ? "Publique" : "Privée"}
          </span>
        </div>

        {error ? <div className="ws-alert ws-alert-error">{error}</div> : null}

        {message ? (
          <div className="ws-alert ws-alert-success">{message}</div>
        ) : null}

        <div className="ws-card-footer">
          {token ? (
            <button
              className="ws-button ws-button-primary"
              type="button"
              onClick={handleAccept}
              disabled={joining}
            >
              <LogIn size={17} />
              {joining ? "Adhésion…" : "Rejoindre la communauté"}
            </button>
          ) : (
            <>
              <Link className="ws-button ws-button-primary" to="/login">
                Se connecter pour rejoindre
              </Link>

              <Link className="ws-button" to="/register">
                Créer un compte
              </Link>
            </>
          )}
        </div>

        {!token ? (
          <p className="ws-form-help">
            L'aperçu est public ; l'adhésion nécessite un compte (le serveur
            refuse une acceptation anonyme).
          </p>
        ) : null}
      </div>
    </WorkspaceShell>
  );
}

export default Invite;
