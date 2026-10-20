import { useMemo, useState } from "react";
import {
  Check,
  Image as ImageIcon,
  Palette,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  UserCog,
} from "lucide-react";
import { useOutletContext } from "react-router-dom";

import ProfileAvatar from "../../profile/ProfileAvatar";
import ProfilePreview from "../../profile/ProfilePreview";
import {
  AVATAR_FRAMES,
  DEFAULT_DECORATIONS,
  PROFILE_BACKGROUNDS,
  PROFILE_BANNERS,
  PROFILE_EFFECTS,
  decorationsPayload,
  readDecorations,
} from "../../profile/decorations";
import { apiFetch, storeSession } from "../../services/api";

const TABS = [
  { id: "backgrounds", label: "Fonds", icon: Palette },
  { id: "banners", label: "Bannières", icon: ImageIcon },
  { id: "frames", label: "Cadres", icon: UserCog },
  { id: "effects", label: "Effets", icon: Sparkles },
];

function emptyDraft() {
  return { ...DEFAULT_DECORATIONS, profileEffects: [] };
}

function sameDecorations(a, b) {
  return (
    (a.profileBackground || null) === (b.profileBackground || null) &&
    (a.profileBanner || null) === (b.profileBanner || null) &&
    (a.avatarFrame || null) === (b.avatarFrame || null) &&
    a.profileEffects.length === b.profileEffects.length &&
    a.profileEffects.every((effect) => b.profileEffects.includes(effect))
  );
}

function isDefaultDraft(draft) {
  return (
    !draft.profileBackground &&
    !draft.profileBanner &&
    !draft.avatarFrame &&
    draft.profileEffects.length === 0
  );
}

function NoneChoice({ active, label, onClick, extraClass = "" }) {
  return (
    <button
      type="button"
      className={`pf-choice${active ? " is-active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className={`pf-choice-visual pf-choice-none ${extraClass}`.trim()}>
        <span aria-hidden="true">∅</span>
      </span>
      <span className="pf-choice-label">{label}</span>
      {active ? <Check className="pf-choice-check" size={14} /> : null}
    </button>
  );
}

function ProfileCustomizationSettings() {
  const { token, user, onUserUpdated } = useOutletContext();
  const savedDecorations = useMemo(() => readDecorations(user), [user]);
  const [draft, setDraft] = useState(() => readDecorations(user));
  const [tab, setTab] = useState("backgrounds");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const dirty = !sameDecorations(draft, savedDecorations);
  const reset = isDefaultDraft(draft);

  function announceChange() {
    setError("");
    setMessage("");
  }

  function update(field, value) {
    announceChange();
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function toggleEffect(id) {
    announceChange();
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

  function handleCancel() {
    setDraft(readDecorations(user));
    setError("");
    setMessage("Modifications annulées.");
  }

  function handleReset() {
    setDraft(emptyDraft());
    setError("");
    setMessage("");
  }

  async function handleSave() {
    if (!token) {
      setError("Connectez-vous pour enregistrer vos décorations.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

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

        if (onUserUpdated) {
          onUserUpdated(result.data.user);
        }
      }

      setMessage("Personnalisation enregistrée. Elle est visible sur votre profil public.");
      setTab("backgrounds");
    } catch {
      setError("Le serveur est injoignable. Réessayez dans un instant.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="ws-settings-section" aria-labelledby="settings-custom">
      <header className="ws-settings-head">
        <span className="ws-settings-icon" aria-hidden="true">
          <SlidersHorizontal size={19} />
        </span>
        <div className="ws-settings-head-text">
          <h2 className="ws-settings-title" id="settings-custom">
            Personnalisation du profil
          </h2>
          <p className="ws-settings-sub">
            Fonds, bannières, cadres et effets — gratuits pour tous.
          </p>
        </div>
        <span className="ws-settings-tag">Gratuit</span>
      </header>

      <div className="ws-settings-body pf-customizer-page">
        <div className="pf-settings-grid">
          <aside className="pf-preview-column pf-settings-preview">
            <p className="pf-preview-caption">Aperçu en direct</p>
            <ProfilePreview
              user={user}
              decorations={draft}
              placeholderBio
            />
            <p className="pf-preview-help">
              Cet aperçu utilise vos données réelles : avatar, nom, statut, bio
              et date d'inscription. Les décorations ne modifient aucune
              permission.
            </p>
          </aside>

          <div className="pf-editor-column pf-settings-editor">
            <div className="pf-tabs" role="tablist" aria-label="Décorations">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  aria-controls={`pf-settings-tab-${id}`}
                  className={`pf-tab${tab === id ? " is-active" : ""}`}
                  onClick={() => setTab(id)}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>

            <div
              className="pf-tab-panel"
              id={`pf-settings-tab-${tab}`}
              role="tabpanel"
            >
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
                    extraClass="pf-choice-banner"
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
                    extraClass="pf-choice-frame"
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
          </div>
        </div>

        {error ? (
          <div className="ws-alert ws-alert-error" role="alert">
            {error}
          </div>
        ) : null}

        {message ? (
          <div className="ws-alert ws-alert-success" role="status">
            {message}
          </div>
        ) : null}

        <div className="pf-settings-actions">
          <p className="pf-save-hint">
            {reset
              ? "Toutes les décorations sont désactivées dans l'aperçu."
              : "L'aperçu est immédiat ; « Enregistrer » applique les choix à votre profil public."}
          </p>

          <div className="pf-modal-actions">
            <button
              type="button"
              className="ws-button ws-button-ghost"
              onClick={handleCancel}
              disabled={saving || !dirty}
            >
              Annuler
            </button>

            <button
              type="button"
              className="ws-button ws-button-ghost"
              onClick={handleReset}
              disabled={saving || reset}
            >
              <RotateCcw size={15} />
              Réinitialiser
            </button>

            <button
              type="button"
              className="ws-button ws-button-primary"
              onClick={handleSave}
              disabled={saving || !dirty}
            >
              <Save size={16} />
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ProfileCustomizationSettings;
