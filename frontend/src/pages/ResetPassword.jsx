import { useState } from "react";
import { motion } from "framer-motion";
import { Lock, Loader2, ArrowLeft, ShieldCheck } from "lucide-react";
import { AnimatedPage } from "../components/common/motion";
import { apiFetch } from "../services/api";
import "./Login.css";

/**
 * Réinitialisation — dernière étape du « mot de passe oublié ».
 *
 * La page reçoit le jeton par `?token=…` (lien généré par le backend, ou lien
 * email en production) et pose le nouveau mot de passe. En cas de succès, le
 * serveur renvoie une session ouverte : pas besoin de retourner au formulaire
 * de connexion.
 */
function ResetPassword({ token, onLoginSuccess, onBack }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);

  // Le jeton peut manquer (visite directe) : la soumission nette refuse et
  // l'écran explique où obtenir un lien valide.
  async function handleSubmit(event) {
    event.preventDefault();

    if (!token) {
      setIsError(true);
      setMessage(
        "Lien invalide : demandez un mot de passe oublié depuis l'écran de connexion."
      );
      return;
    }

    if (password !== confirm) {
      setIsError(true);
      setMessage("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setMessage("");
    setIsError(false);
    setLoading(true);

    try {
      const result = await apiFetch("/api/auth/reset-password", {
        method: "POST",
        body: { token, password },
      });

      const data = result.data || {};

      if (!result.ok) {
        setIsError(true);
        setMessage(
          data.message ||
            "Le lien est invalide ou a déjà été utilisé. Demandez-en un nouveau."
        );
        return;
      }

      setMessage(data.message || "Mot de passe mis à jour.");

      // Le serveur renvoie la session : l'utilisateur arrive dans l'app.
      if (data.token) {
        onLoginSuccess(data.token, data.user || null);
      }
    } catch {
      setIsError(true);
      setMessage("Impossible de contacter le serveur.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnimatedPage>
      <div className="dm-login-page">
        <div className="dm-login-card is-solo">
          <section className="dm-login-form-side">
            <div className="dm-login-form-inner">
              <div className="dm-login-form-glow" aria-hidden="true" />

              <div className="dm-login-heading-block">
                <span className="dm-login-welcome-pill">
                  <span className="dm-login-pill-dot" aria-hidden="true" />
                  Nouveau mot de passe
                </span>
                <h2>Choisissez un mot de passe</h2>
                <p>
                  8 caractères minimum. Le lien ne sert qu'une seule fois : il
                  expire après usage ou 30 minutes.
                </p>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="dm-login-fields">
                  <div className="dm-login-field">
                    <span className="dm-login-field-icon">
                      <Lock size={15} />
                    </span>
                    <input
                      type="password"
                      placeholder="Nouveau mot de passe"
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      minLength={8}
                    />
                  </div>

                  <div className="dm-login-field">
                    <span className="dm-login-field-icon">
                      <ShieldCheck size={15} />
                    </span>
                    <input
                      type="password"
                      placeholder="Confirmer le mot de passe"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(event) => setConfirm(event.target.value)}
                      required
                    />
                  </div>
                </div>

                <motion.button
                  type="submit"
                  className="dm-login-submit"
                  style={{ marginTop: 16 }}
                  disabled={loading}
                  whileHover={{ scale: loading ? 1 : 1.02 }}
                  whileTap={{ scale: loading ? 1 : 0.98 }}
                >
                  {loading ? (
                    <Loader2 size={15} className="dm-login-spin" />
                  ) : (
                    <Lock size={15} />
                  )}
                  {loading ? "Mise à jour..." : "Enregistrer le mot de passe"}
                </motion.button>

                {message && (
                  <div
                    className={`dm-login-message${isError ? " is-error" : ""}`}
                  >
                    {message}
                  </div>
                )}
              </form>

              <p className="dm-login-switch">
                <button type="button" onClick={onBack}>
                  <ArrowLeft size={11} style={{ verticalAlign: "-2px" }} />
                  Retour à la connexion
                </button>
              </p>
            </div>
          </section>
        </div>
      </div>
    </AnimatedPage>
  );
}

export default ResetPassword;
