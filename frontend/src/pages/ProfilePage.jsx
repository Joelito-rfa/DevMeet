import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Edit3, Sparkles } from "lucide-react";

import WorkspaceShell from "../components/layout/WorkspaceShell";
import ProfilePreview from "../profile/ProfilePreview";
import { apiFetch } from "../services/api";

function ProfilePage({ token, user, onLogout }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const result = await apiFetch(`/api/users/${id}/profile`, { token });

        if (cancelled) {
          return;
        }

        if (!result.ok) {
          setError(result.data?.message || "Profil introuvable.");
          setProfile(null);
        } else {
          setProfile(result.data.profile);
        }
      } catch {
        if (!cancelled) {
          setError("Le serveur est injoignable. Réessayez dans un instant.");
          setProfile(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, token]);

  const isOwn = user && Number(user.id) === Number(id);

  return (
    <WorkspaceShell
      token={token}
      user={user}
      onLogout={onLogout}
      headerTitle="Profil"
      headerSubtitle={profile ? profile.name : "Chargement…"}
    >
      <div className="ws-profile-page pf-public-page">
        {loading ? (
          <p className="ws-settings-note">Chargement du profil…</p>
        ) : error ? (
          <div className="ws-alert ws-alert-error" role="alert">
            {error}
          </div>
        ) : profile ? (
          <div className="pf-public-page-inner">
            <ProfilePreview user={profile}>
              {isOwn ? (
                <>
                  <button
                    type="button"
                    className="ws-button ws-profile-action"
                    onClick={() => navigate("/parametres/profil")}
                  >
                    <Edit3 size={17} />
                    Modifier le profil
                  </button>

                  <button
                    type="button"
                    className="ws-button ws-button-primary ws-profile-action"
                    onClick={() =>
                      navigate("/parametres/profil/personnalisation")
                    }
                  >
                    <Sparkles size={17} />
                    Personnaliser
                  </button>
                </>
              ) : null}
            </ProfilePreview>

            {isOwn ? (
              <p className="pf-public-hint">
                Votre profil public affiche votre nom, votre statut, votre bio
                et les décorations enregistrées. Aucune permission n'est
                modifiée par ces éléments visuels.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </WorkspaceShell>
  );
}

export default ProfilePage;
