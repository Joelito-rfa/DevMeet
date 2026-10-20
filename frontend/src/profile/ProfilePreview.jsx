import {
  backgroundClass,
  bannerClass,
  effectClassList,
  normalizeEffectList,
  readDecorations,
} from "./decorations";
import ProfileAvatar from "./ProfileAvatar";
import { memberSinceLabel, profileStatus } from "./profileMeta";

/**
 * Carte de profil réutilisable : aperçu de personnalisation, profil public et
 * carte du compte. Le fond, la bannière, le cadre et les effets proviennent
 * uniquement de jetons CSS et de classes : aucune image lourde n'est chargée.
 */
function ProfilePreview({
  user,
  decorations,
  className = "",
  showMeta = true,
  placeholderBio = false,
  children,
}) {
  const decor = readDecorations(decorations || readDecorations(user));
  const status = profileStatus(user?.status);
  const since = memberSinceLabel(user?.createdAt);
  const effects = normalizeEffectList(decor.profileEffects);
  const cardClasses = [
    "pf-profile",
    backgroundClass(decor.profileBackground),
    effectClassList(effects),
    decor.profileBackground ? "has-background" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cardClasses}>
      <div
        className={`pf-banner ${bannerClass(decor.profileBanner)}`}
        aria-hidden="true"
      />

      <div className="pf-profile-body">
        <header className="pf-profile-head">
          <ProfileAvatar user={user} frame={decor.avatarFrame} size="lg" />

          <div className="pf-identity">
            <h3 className="pf-name">{user?.name || "Votre profil"}</h3>

            <p className="pf-status">
              <span className={`pf-status-dot ${status.tone}`} aria-hidden="true" />
              {status.label}
            </p>
          </div>
        </header>

        {user?.bio || placeholderBio ? (
          <p className={`pf-bio${user?.bio ? "" : " is-empty"}`}>
            {user?.bio || "Aucune bio pour le moment."}
          </p>
        ) : null}

        {showMeta ? (
          <dl className="pf-meta">
            {since ? (
              <div>
                <dt>Membre depuis</dt>
                <dd>{since}</dd>
              </div>
            ) : null}

            <div>
              <dt>Statut</dt>
              <dd>{status.label}</dd>
            </div>
          </dl>
        ) : null}
      </div>

      {children ? <div className="pf-profile-actions">{children}</div> : null}

      {/* Couche dédiée aux particules : un seul élément, très léger. */}
      {effects.includes("particles") ? (
        <span className="pf-particles" aria-hidden="true" />
      ) : null}
    </article>
  );
}

export default ProfilePreview;
