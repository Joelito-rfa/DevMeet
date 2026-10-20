import { Palette, RotateCcw } from "lucide-react";

import { DEFAULT_THEME } from "../../theme/theme";
import { useTheme } from "../../theme/useTheme";

function ThemePreview({ id }) {
  return (
    <div className="ws-theme-preview" data-theme={id} aria-hidden="true">
      <span className="ws-theme-preview-rail">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="ws-theme-preview-side">
        <i />
        <i />
        <i className="is-active" />
        <i />
        <i />
      </span>
      <span className="ws-theme-preview-main">
        <span className="ws-theme-preview-head" />
        <span className="ws-theme-preview-bubble" />
        <span className="ws-theme-preview-bubble is-short" />
        <span className="ws-theme-preview-input" />
      </span>
    </div>
  );
}

function AppearanceSettings() {
  const { theme, setTheme, themes, saving: themeSaving, error: themeError } =
    useTheme();
  const activeTheme = themes.find((item) => item.id === theme);
  const isDefault = theme === DEFAULT_THEME;

  return (
    <section className="ws-settings-section" aria-labelledby="settings-appearance">
      <header className="ws-settings-head">
        <span className="ws-settings-icon" aria-hidden="true">
          <Palette size={19} />
        </span>
        <div className="ws-settings-head-text">
          <h2 className="ws-settings-title" id="settings-appearance">
            Apparence
          </h2>
          <p className="ws-settings-sub">
            Choisissez l'ambiance de DevMeet. Tous les thèmes sont gratuits.
          </p>
        </div>
        <span className="ws-settings-tag">
          {activeTheme?.label || theme}
        </span>
      </header>

      <div className="ws-settings-body">
        <div className="ws-theme-default">
          <div className="ws-theme-default-copy">
            <span className="ws-theme-default-title">Thème par défaut</span>
            <p className="ws-theme-default-desc">
              Rétablit l'apparence initiale de DevMeet, avec la palette Discord
              Dark.
            </p>
          </div>

          <button
            type="button"
            className="ws-button ws-button-ghost"
            onClick={() => setTheme(DEFAULT_THEME)}
            disabled={isDefault || themeSaving}
          >
            <RotateCcw size={15} />
            {isDefault ? "Thème par défaut actif" : "Rétablir"}
          </button>
        </div>

        <div className="ws-theme-grid">
          {themes.map((item) => {
            const active = item.id === theme;

            return (
              <article
                key={item.id}
                className={`ws-theme-card${active ? " is-active" : ""}`}
              >
                <ThemePreview id={item.id} />

                <div className="ws-theme-card-head">
                  <span className="ws-theme-card-name">{item.label}</span>
                  {active ? (
                    <span className="ws-theme-card-active">
                      <span aria-hidden="true">✓</span> Thème actif
                    </span>
                  ) : item.free ? (
                    <span className="ws-theme-card-badge">Gratuit</span>
                  ) : null}
                </div>

                <p className="ws-theme-card-tagline">{item.tagline}</p>
                <p className="ws-theme-card-desc">{item.description}</p>

                <button
                  type="button"
                  className={`ws-button ws-theme-card-button ${
                    active ? "ws-button-ghost" : "ws-button-primary"
                  }`}
                  onClick={() => setTheme(item.id)}
                  disabled={active || themeSaving}
                  aria-pressed={active}
                >
                  {active ? "Thème actif" : "Appliquer"}
                </button>
              </article>
            );
          })}
        </div>

        {themeError ? (
          <div className="ws-alert ws-alert-error" style={{ marginTop: 14 }}>
            {themeError}
          </div>
        ) : null}

        <p
          className="ws-settings-note"
          style={{ marginTop: 12 }}
          aria-live="polite"
        >
          {themeSaving
            ? "Enregistrement du thème…"
            : "Le thème s'applique immédiatement et est conservé sur votre compte."}
        </p>

        <div className="ws-form-group" style={{ marginTop: 18, maxWidth: 320 }}>
          <label className="ws-form-label" htmlFor="profile-theme">
            Thème
          </label>
          <select
            id="profile-theme"
            className="ws-form-select"
            value={theme}
            onChange={(event) => setTheme(event.target.value)}
            disabled={themeSaving}
          >
            {themes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <p className="ws-form-help">
            Sélection rapide, synchronisée avec les cartes ci-dessus.
          </p>
        </div>
      </div>
    </section>
  );
}

export default AppearanceSettings;
