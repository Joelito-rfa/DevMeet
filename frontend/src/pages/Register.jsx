import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  UserPlus,
  Loader2,
} from "lucide-react";
import { AnimatedPage } from "../components/common/motion";
import AuthShowcase from "../components/auth/AuthShowcase";
import { GitHubIcon, GoogleIcon } from "../components/auth/BrandIcons";
import "./Login.css";
import "./LoginTheme.css";
import { apiFetch } from "../services/api";
import { consumeOAuthNotice, startOAuth } from "../services/oauth";
import { useTheme } from "../theme/useTheme";

function Register({ onRegisterSuccess, onGoToLogin }) {
  const { theme } = useTheme();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Retour d'une connexion Google/GitHub refusée ou non configurée : le
  // message s'affiche dans le formulaire plutôt que sur une page intermédiaire.
  useEffect(() => {
    consumeOAuthNotice((notice) => {
      setIsError(true);
      setMessage(notice);
    });
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setIsError(false);
    setLoading(true);

    try {
      const result = await apiFetch("/api/auth/register", {
        method: "POST",
        body: {
          name,
          email,
          password,
        },
      });

      const data = result.data || {};

      if (!result.ok) {
        setIsError(true);
        setMessage(data.message || "Erreur d'inscription.");
        return;
      }

      setMessage(data.message);

      if (onRegisterSuccess) {
        onRegisterSuccess();
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
        <div className="dm-login-card">
          <AuthShowcase
            headline={
              <>
                Créez votre espace
                <br />
                <span className="dm-login-shine">collaboratif</span>
              </>
            }
            lead="Rejoignez DevMeet et travaillez avec votre équipe dans un espace pensé pour la collaboration en temps réel."
            theme={theme === "badass" ? "badass" : "neon"}
          />

          {/* ------------------------------- Formulaire -------------------------------- */}
          <section className="dm-login-form-side">
            <div className="dm-login-form-inner">
              <div className="dm-login-form-glow" aria-hidden="true" />

              <div className="dm-login-heading-block">
                <span className="dm-login-welcome-pill">
                  <span className="dm-login-pill-dot" aria-hidden="true" />
                  Commencez en 30 secondes
                </span>
                <h2>Créer un compte</h2>
                <p>Rejoignez votre équipe sur DevMeet</p>
              </div>

              <form className="dm-register-form" onSubmit={handleSubmit}>
                <div className="dm-login-fields">
                  <div className="dm-login-field">
                    <span className="dm-login-field-icon">
                      <User size={15} />
                    </span>
                    <input
                      type="text"
                      placeholder="Nom complet"
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                    />
                  </div>

                  <div className="dm-login-field">
                    <span className="dm-login-field-icon">
                      <Mail size={15} />
                    </span>
                    <input
                      type="email"
                      placeholder="Adresse email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                  </div>

                  <div className="dm-login-field">
                    <span className="dm-login-field-icon">
                      <Lock size={15} />
                    </span>
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Mot de passe"
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="dm-login-eye"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={
                        showPassword
                          ? "Masquer le mot de passe"
                          : "Afficher le mot de passe"
                      }
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div className="dm-login-row">
                  <label className="dm-login-remember">
                    <input type="checkbox" required />
                    J'accepte les conditions d'utilisation de DevMeet
                  </label>
                </div>

                <motion.button
                  type="submit"
                  className="dm-login-submit"
                  disabled={loading}
                  whileHover={{ scale: loading ? 1 : 1.02 }}
                  whileTap={{ scale: loading ? 1 : 0.98 }}
                >
                  {loading ? (
                    <>
                      <Loader2 size={15} className="dm-login-spin" />
                      Création en cours...
                    </>
                  ) : (
                    <>
                      <UserPlus size={15} />
                      Créer mon compte
                    </>
                  )}
                </motion.button>

                <AnimatePresence>
                  {message && (
                    <motion.div
                      key={message}
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className={`dm-login-message${isError ? " is-error" : ""}`}
                    >
                      {message}
                    </motion.div>
                  )}
                </AnimatePresence>
              </form>

              <div className="dm-login-divider">
                <span />
                <em>ou</em>
                <span />
              </div>

              <div className="dm-login-socials">
                <button
                  type="button"
                  onClick={() => startOAuth("google")}
                >
                  <span className="dm-login-social-icon">
                    <GoogleIcon />
                  </span>
                  Google
                </button>

                <button
                  type="button"
                  onClick={() => startOAuth("github")}
                >
                  <span className="dm-login-social-icon">
                    <GitHubIcon />
                  </span>
                  GitHub
                </button>
              </div>

              <p className="dm-login-switch">
                Vous avez déjà un compte ?{" "}
                <button type="button" onClick={onGoToLogin}>
                  Se connecter
                </button>
              </p>
            </div>
          </section>
        </div>
      </div>
    </AnimatedPage>
  );
}

export default Register;
