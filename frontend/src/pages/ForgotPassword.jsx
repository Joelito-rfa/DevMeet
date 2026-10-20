import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, Loader2, KeyRound, ArrowLeft } from "lucide-react";
import { AnimatedPage } from "../components/common/motion";
import { apiFetch } from "../services/api";
import { startOAuth } from "../services/oauth";
import "./Login.css";

/**
 * Mot de passe oublié — demande du lien de réinitialisation.
 *
 * Réponse du serveur volontairement neutre (anti-énumération). En local, le
 * serveur renvoie aussi `resetLink` (pas de SMTP ici) : l'écran l'affiche en
 * bouton primaire. Pour un compte lié à Google/GitHub, le serveur répond avec
 * `providers` : on propose alors les boutons OAuth — c'est la méthode de
 * récupération prévue pour ces comptes, tant qu'ils n'ont pas de mot de passe.
 */
function ForgotPassword({ onBack }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [resetLink, setResetLink] = useState("");
  const [providers, setProviders] = useState([]);
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setResetLink("");
    setProviders([]);
    setIsError(false);
    setLoading(true);

    try {
      const result = await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: { email },
      });

      const data = result.data || {};

      if (!result.ok) {
        setIsError(true);
        setMessage(data.message || "Requête impossible. Réessayez.");
        return;
      }

      setProviders(data.providers || []);
      setResetLink(data.resetLink || "");
      setMessage(data.message || "Requête envoyée.");
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
                  Accès perdu
                </span>
                <h2>Mot de passe oublié ?</h2>
                <p>
                  Indiquez l'adresse de votre compte : nous générons un lien de
                  réinitialisation valable 30 minutes.
                </p>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="dm-login-fields">
                  <div className="dm-login-field">
                    <span className="dm-login-field-icon">
                      <Mail size={15} />
                    </span>
                    <input
                      type="email"
                      placeholder="Adresse du compte"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
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
                    <KeyRound size={15} />
                  )}
                  {loading ? "Envoi..." : "Recevoir le lien"}
                </motion.button>

                {message && (
                  <div
                    className={`dm-login-message${isError ? " is-error" : ""}`}
                  >
                    {message}
                  </div>
                )}
              </form>

              {providers.length > 0 && (
                <>
                  <div className="dm-login-divider">
                    <span />
                    <em>ou</em>
                    <span />
                  </div>

                  <div className="dm-login-socials">
                    {providers.includes("google") && (
                      <button type="button" onClick={() => startOAuth("google")}>
                        <span className="dm-login-social-icon">G</span>
                        Google
                      </button>
                    )}

                    {providers.includes("github") && (
                      <button type="button" onClick={() => startOAuth("github")}>
                        <span className="dm-login-social-icon">◉</span>
                        GitHub
                      </button>
                    )}
                  </div>

                  <p className="dm-login-legal">
                    Ce compte a été créé avec{" "}
                    {providers
                      .map((provider) => (provider === "github" ? "GitHub" : "Google"))
                      .join(" ou ")}
                    . Vous n'avez donc pas de mot de passe : passez par le
                    bouton du fournisseur pour retrouver l'accès.
                  </p>
                </>
              )}

              {resetLink && (
                <>
                  <div className="dm-login-divider">
                    <span />
                    <em>mode local</em>
                    <span />
                  </div>

                  <button
                    type="button"
                    className="dm-login-submit"
                    onClick={() => {
                      window.location.href = resetLink;
                    }}
                  >
                    <KeyRound size={15} />
                    Ouvrir le lien de réinitialisation
                  </button>

                  <p className="dm-login-legal">
                    En production, ce lien part par email. En local (sans
                    serveur de mail), il est présenté ici pour tester le flux.
                  </p>
                </>
              )}

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

export default ForgotPassword;
