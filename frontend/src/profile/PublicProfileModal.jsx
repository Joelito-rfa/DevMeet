import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, UserRound, X } from "lucide-react";

import { apiFetch } from "../services/api";
import ProfilePreview from "./ProfilePreview";

/**
 * Fiche publique d'un autre membre. Les décorations enregistrées sont
 * chargées depuis l'API : ce n'est jamais une copie locale du profil.
 */
function PublicProfileModal({ userId, token, onClose }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const result = await apiFetch(`/api/users/${userId}/profile`, { token });

        if (cancelled) {
          return;
        }

        if (!result.ok) {
          setError(result.data?.message || "Profil introuvable.");
          return;
        }

        setProfile(result.data?.profile || null);

        if (!result.data?.profile) {
          setError("Profil introuvable.");
        }
      } catch {
        if (!cancelled) {
          setError("Impossible de charger ce profil.");
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
  }, [token, userId]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="pf-modal-backdrop pf-public-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="pf-public-profile"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pf-public-title"
      >
        <header className="pf-modal-head">
          <div className="pf-public-heading">
            <span className="pf-public-icon" aria-hidden="true">
              <UserRound size={18} />
            </span>
            <div>
              <p className="pf-modal-eyebrow">Profil public</p>
              <h2 className="pf-modal-title" id="pf-public-title">
                {profile?.name || "Membre"}
              </h2>
            </div>
          </div>

          <button
            type="button"
            className="pf-modal-close"
            onClick={onClose}
            aria-label="Fermer le profil"
            autoFocus
          >
            <X size={19} />
          </button>
        </header>

        <div className="pf-public-body">
          {loading ? (
            <div className="pf-modal-loading">
              <LoaderCircle className="pf-spin" size={22} />
              Chargement du profil…
            </div>
          ) : error ? (
            <div className="ws-alert ws-alert-error" role="alert">
              {error}
            </div>
          ) : profile ? (
            <ProfilePreview user={profile} />
          ) : null}
        </div>
      </section>
    </div>,
    document.body
  );
}

export default PublicProfileModal;
