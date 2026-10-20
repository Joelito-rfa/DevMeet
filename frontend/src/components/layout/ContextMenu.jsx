import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

/**
 * Menu contextuel léger (click droit ou bouton « ⋯ »).
 *
 * `items` : [{ label, icon, onClick, danger, disabled, separator }].
 * Le menu se referme au clic extérieur, à Échap et après le choix d'une entrée.
 * Il se repositionne s'il déborderait du bas ou de la droite de l'écran.
 */
function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        onClose();
      }
    }

    function handleKey(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Estimation de la taille du menu : on le décale vers le haut / la gauche s'il
  // ne tient pas dans l'espace disponible sous le point de clic.
  const width = 262;
  const rowHeight = 42;
  const height = items.length * rowHeight + 10;
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const top =
    y + height + 8 > window.innerHeight
      ? Math.max(8, y - height)
      : y;

  return (
    <motion.div
      ref={ref}
      className="ws-menu"
      style={{ left, top, width }}
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: -2 }}
      transition={{ duration: 0.12 }}
      role="menu"
    >
      {items.map((item, index) =>
        item.separator ? (
          <div className="ws-menu-separator" key={`sep-${index}`} />
        ) : (
          <button
            className={`ws-menu-item${item.danger ? " ws-menu-item-danger" : ""}`}
            type="button"
            key={item.label}
            disabled={item.disabled}
            role="menuitem"
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.icon ? <span className="ws-menu-icon">{item.icon}</span> : null}
            {item.label}
          </button>
        )
      )}
    </motion.div>
  );
}

export default ContextMenu;
