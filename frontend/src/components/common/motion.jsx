/* eslint-disable react-refresh/only-export-components --
   Ce module est la boîte à outils d'animation partagée : il expose
   volontairement des composants ET les variantes Framer Motion réutilisées par
   les écrans. Le découper n'apporterait rien côté produit ; le seul effet est
   que ce fichier déclenche un rechargement complet lors de l'édition. */
import { motion, AnimatePresence } from "framer-motion";

export const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] },
  }),
  exit: { opacity: 0, y: -16, transition: { duration: 0.25 } },
};

export const staggerParent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, scale: 0.94, transition: { duration: 0.2 } },
};

export function AnimatedPage({ children, style }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      style={style}
    >
      {children}
    </motion.div>
  );
}

export function FadeIn({ children, delay = 0, y = 24, style, className }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      style={style}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedButton({ children, ...props }) {
  const { onClick, type, style, className, title } = props;
  return (
    <motion.button
      type={type || "button"}
      onClick={onClick}
      title={title}
      className={className}
      style={style}
      whileHover={{ scale: 1.03, y: -1 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 22 }}
    >
      {children}
    </motion.button>
  );
}

export function AnimatedCard({ children, className, style, delay = 0, onClick }) {
  return (
    <motion.div
      className={className}
      style={style}
      onClick={onClick}
      variants={fadeUp}
      initial="hidden"
      animate="show"
      custom={delay}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedModal({ children, onClose }) {
  return (
    <motion.div
      className="dm-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="dm-modal"
        initial={{ opacity: 0, scale: 0.9, y: 32 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

export function AnimatedMessage({ children, kind = "info" }) {
  if (!children) return null;
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={String(children)}
        className={`dm-message dm-message-${kind}`}
        initial={{ opacity: 0, height: 0, marginBottom: 0 }}
        animate={{ opacity: 1, height: "auto", marginBottom: 20 }}
        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
        transition={{ duration: 0.3 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export { motion, AnimatePresence };
