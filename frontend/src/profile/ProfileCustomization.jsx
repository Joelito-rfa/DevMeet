import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Image,
  Palette,
  RotateCcw,
  Save,
  Sparkles,
  UserCog,
  X,
} from "lucide-react";

import { apiFetch, storeSession } from "../services/api";
import {
  AVATAR_FRAMES,
  DEFAULT_DECORATIONS,
  PROFILE_BACKGROUNDS,
  PROFILE_BANNERS,
  PROFILE_EFFECTS,
  decorationsPayload,
  readDecorations,
} from "./decorations";
import ProfileAvatar from "./ProfileAvatar";
import ProfilePreview from "./ProfilePreview";

const TABS = [
  { id: "backgrounds", label: "Fonds", icon: Palette },
  { id: "banners", label: "Bannières", icon: Image },
  { id: "frames", label: "Cadres", icon: UserCog },
  { id: "effects", label: "Effets", icon: Sparkles },
];

function emptyDraft() {
  return {
    ...DEFAULT_DECORATIONS,
    profileEffects: [],
  };
}

function isDefaultDraft(draft) {
  return (
    !draft.profileBackground &&
    !draft.profileBanner &&
    !draft.avatarFrame &&
    draft.profileEffects.length === 0
  );
}

function NoneChoice({ active, label, onClick, previewClass = "" }) {
  return (
    <button
      type="button"
      className={`pf-choice${active ? " is-active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className={`pf-choice-visual pf-choice-none ${previewClass}`}>
        <span aria-hidden="true">∅</span>
      </span>
      <span className="pf-choice-label">{label}</span>
      {active ? <Check className="pf-choice-check" size={14} /> : null}
    </button>
  );
}

/**
 * Fenêtre de personnalisation du profil.
 *
 * Le brouillon est local : l'aperçu se met à jour immédiatement, mais rien
 * n'est écrit avant « Enregistrer ». « Annuler » ferme sans toucher au profil.
 */
function ProfileCustomization({ user, token, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => readDecorations(user));
  const [tab, setTab] = useState("backgrounds");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const reset = isDefaultDraft(draft);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !saving) {
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
  }, [onClose, saving]);

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function toggleEffect(id) {
    setDraft((current) => {
      const selected = current.profileEffects.includes(id);

      return {
        ...current,
        profileEffects: selected
          ? current.profileEffects.filter((effect) => effect !== id)
          : [...current.profileEffects, id],
      };
    });
  }

  async function handleSave() {
    if (!token) {
      setError("Connectez-vous pour enregistrer vos décorations.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const result = await apiFetch("/api/auth/me", {
        method: "PATCH",
        token,
        body: decorationsPayload(draft),
      });

      if (!result.ok) {
        setError(
          result.data?.message || "Impossible d'enregistrer les décorations."
        );
        return;
      }

      if (result.data?.user) {
        storeSession(token, {
          ...(user || {}),
          ...result.data.user,
        });

        if (onSaved) {
          onSaved(result.data.user);
        }
      }

      onClose();
    } catch {
      setError("Le serveur est injoignable. Réessayez dans un instant.");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="pf-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <section
        className="pf-customization"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pf-customization-title"
      >
        <header className="pf-modal-head">
          <div>
            <p className="pf-modal-eyebrow">Profil et personnalisation</p>
            <h2 className="pf-modal-title" id="pf-customization-title">
              Personnaliser mon profil
            </h2>
          </div>

          <button
            type="button"
            className="pf-modal-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Fermer la personnalisation"
            autoFocus
          >
            <X size={19} />
          </button>
        </header>

        <div className="pf-customization-body">
          <aside className="pf-preview-column" aria-label="Aperçu du profil">
            <p className="pf-preview-caption">Aperçu en direct</p>
            <ProfilePreview
              user={user}
              decorations={draft}
              placeholderBio
            />
            <p className="pf-preview-help">
              Les décorations sont gratuites et n'affectent ni vos rôles ni vos
              permissions.
            </p>
          </aside>

          <div className="pf-editor-column">
            <div className="pf-tabs" role="tablist" aria-label="Décorations">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  aria-controls={`pf-tab-${id}`}
                  className={`pf-tab${tab === id ? " is-active" : ""}`}
                  onClick={() => setTab(id)}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>

            <div className="pf-tab-panel" id={`pf-tab-${tab}`} role="tabpanel">
              {tab === "backgrounds" ? (
                <div className="pf-choice-grid">
                  <NoneChoice
                    active={!draft.profileBackground}
                    label="Aucun fond"
                    onClick={() => update("profileBackground", null)}
                  />

                  {PROFILE_BACKGROUNDS.map((item) => {
                    const active = draft.profileBackground === item.id;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`pf-choice${active ? " is-active" : ""}`}
                        onClick={() => update("profileBackground", item.id)}
                        aria-pressed={active}
                      >
                        <span
                          className={`pf-choice-visual pf-choice-background pf-bg-${item.id}`}
                          aria-hidden="true"
                        />
                        <span className="pf-choice-label">{item.label}</span>
                        {active ? (
                          <Check className="pf-choice-check" size={14} />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {tab === "banners" ? (
                <div className="pf-choice-grid pf-choice-grid--banners">
                  <NoneChoice
                    active={!draft.profileBanner}
                    label="Aucune bannière"
                    onClick={() => update("profileBanner", null)}
                    previewClass="pf-choice-banner"
                  />

                  {PROFILE_BANNERS.map((item) => {
                    const active = draft.profileBanner === item.id;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`pf-choice${active ? " is-active" : ""}`}
                        onClick={() => update("profileBanner", item.id)}
                        aria-pressed={active}
                      >
                        <span
                          className={`pf-choice-visual pf-choice-banner pf-banner-${item.id}`}
                          aria-hidden="true"
                        />
                        <span className="pf-choice-label">{item.label}</span>
                        <span className="pf-choice-hint">{item.group}</span>
                        {active ? (
                          <Check className="pf-choice-check" size={14} />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {tab === "frames" ? (
                <div className="pf-choice-grid pf-choice-grid--frames">
                  <NoneChoice
                    active={!draft.avatarFrame}
                    label="Aucun cadre"
                    onClick={() => update("avatarFrame", null)}
                    previewClass="pf-choice-frame"
                  />

                  {AVATAR_FRAMES.map((item) => {
                    const active = draft.avatarFrame === item.id;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`pf-choice pf-choice--frame${
                          active ? " is-active" : ""
                        }`}
                        onClick={() => update("avatarFrame", item.id)}
                        aria-pressed={active}
                      >
                        <span className="pf-choice-frame-preview">
                          <ProfileAvatar
                            user={user}
                            frame={item.id}
                            size="md"
                            showStatus={false}
                          />
                        </span>
                        <span className="pf-choice-label">{item.label}</span>
                        {active ? (
                          <Check className="pf-choice-check" size={14} />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {tab === "effects" ? (
                <div className="pf-effects-panel">
                  <p className="pf-panel-help">
                    Activez un ou plusieurs effets légers. Ils respectent la
                    préférence système de réduction des animations.
                  </p>

                  <div className="pf-effect-list">
                    {PROFILE_EFFECTS.map((effect) => {
                      const active = draft.profileEffects.includes(effect.id);

                      return (
                        <button
                          key={effect.id}
                          type="button"
                          className={`pf-effect-choice${
                            active ? " is-active" : ""
                          }`}
                          onClick={() => toggleEffect(effect.id)}
                          aria-pressed={active}
                        >
                          <span
                            className={`pf-effect-preview pf-effect-preview--${effect.id}`}
                            aria-hidden="true"
                          />
                          <span className="pf-effect-copy">
                            <span className="pf-effect-label">
                              {effect.label}
                            </span>
                            <span className="pf-effect-desc">
                              {effect.description}
                            </span>
                          </span>
                          <span
                            className={`pf-switch${active ? " is-on" : ""}`}
                            aria-hidden="true"
                          >
                            <span />
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    className="pf-clear-effects"
                    onClick={() => update("profileEffects", [])}
                    disabled={draft.profileEffects.length === 0}
                  >
                    <RotateCcw size={14} />
                    Aucun effet
                  </button>
                </div>
              ) : null}
            </div>

            {error ? (
              <div className="ws-alert ws-alert-error" role="alert">
                {error}
              </div>
            ) : null}
          </div>
        </div>

        <footer className="pf-modal-foot">
          <p className="pf-save-hint">
            {reset
              ? "Les décorations sont toutes désactivées."
              : "L'aperçu est immédiat ; l'enregistrement applique les choix à votre profil public."}
          </p>

          <div className="pf-modal-actions">
            <button
              type="button"
              className="ws-button ws-button-ghost"
              onClick={onClose}
              disabled={saving}
            >
              Annuler
            </button>

            <button
              type="button"
              className="ws-button ws-button-ghost"
              onClick={() => setDraft(emptyDraft())}
              disabled={saving || reset}
            >
              <RotateCcw size={15} />
              Réinitialiser
            </button>

            <button
              type="button"
              className="ws-button ws-button-primary"
              onClick={handleSave}
              disabled={saving}
            >
              <Save size={16} />
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body
  );
}

export default ProfileCustomization;
