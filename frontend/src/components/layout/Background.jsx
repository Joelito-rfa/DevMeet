import { useEffect } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";

const BLOBS = [
  { size: 620, color: "rgba(var(--theme-glow-rgb),0.18)", top: "-160px", left: "-140px", dx: 70, dy: 50, dur: 12 },
  { size: 560, color: "rgba(var(--theme-glow-rgb),0.15)", bottom: "-180px", right: "-120px", dx: -80, dy: -60, dur: 14 },
  { size: 480, color: "rgba(var(--theme-glow-rgb),0.11)", top: "28%", left: "58%", dx: 60, dy: -70, dur: 16 },
  { size: 400, color: "rgba(var(--theme-glow-rgb),0.14)", top: "62%", left: "6%", dx: -50, dy: 60, dur: 11 },
];

// Faisceaux de scène : de longues nappes verticales qui pivotent lentement.
const BEAMS = [
  { left: "6%", width: 260, color: "rgba(var(--theme-glow-rgb), 0.22)", tilt: 15, dur: 19, delay: 0 },
  { left: "42%", width: 210, color: "rgba(var(--theme-glow-rgb), 0.15)", tilt: -11, dur: 24, delay: -6 },
  { left: "74%", width: 280, color: "rgba(var(--theme-glow-rgb), 0.19)", tilt: 19, dur: 21, delay: -11 },
];

// Constellation : positions dispersées pour éviter tout motif régulier.
const STARS = [
  { left: "6%", top: "18%", size: 2, dur: 7, delay: 0 },
  { left: "13%", top: "62%", size: 1.5, dur: 9, delay: 1.6 },
  { left: "21%", top: "34%", size: 2.5, dur: 6, delay: 3.1 },
  { left: "28%", top: "84%", size: 2, dur: 8, delay: 0.8 },
  { left: "34%", top: "12%", size: 1.5, dur: 10, delay: 4.2 },
  { left: "39%", top: "55%", size: 2, dur: 7.5, delay: 2.4 },
  { left: "47%", top: "26%", size: 1.5, dur: 9.5, delay: 5.3 },
  { left: "52%", top: "72%", size: 2, dur: 6.5, delay: 1.1 },
  { left: "58%", top: "8%", size: 2.5, dur: 8.5, delay: 3.8 },
  { left: "63%", top: "46%", size: 1.5, dur: 11, delay: 0.4 },
  { left: "69%", top: "88%", size: 2, dur: 7, delay: 2.9 },
  { left: "74%", top: "30%", size: 1.5, dur: 9, delay: 5.8 },
  { left: "81%", top: "64%", size: 2.5, dur: 6.5, delay: 1.9 },
  { left: "88%", top: "16%", size: 2, dur: 8, delay: 4.6 },
  { left: "93%", top: "48%", size: 1.5, dur: 10.5, delay: 0.6 },
  { left: "96%", top: "78%", size: 2, dur: 7.5, delay: 3.4 },
  { left: "9%", top: "90%", size: 1.5, dur: 9.5, delay: 6.2 },
  { left: "44%", top: "92%", size: 2, dur: 6, delay: 2.1 },
  { left: "17%", top: "48%", size: 1.5, dur: 8.5, delay: 5.1 },
  { left: "55%", top: "38%", size: 1.5, dur: 7.5, delay: 0.9 },
];

// Particules flottantes 3D : petits points qui montent doucement.
const PARTICLES = Array.from({ length: 24 }, (_, i) => ({
  i,
  left: `${10 + i * 4}%`,
  top: `${80 + (i % 3) * 5}%`,
  size: 0.5 + (i % 3) * 0.4,
  dur: 10 + i * 0.7,
  delay: i * 0.4,
}));

export default function AnimatedBackground({ variant = "default" }) {
  const auth = variant === "auth";
  const opacity = auth ? 1 : 0.55;
  const reduceMotion = useReducedMotion();

  // Halo qui suit le curseur sur les pages d'authentification. Les valeurs
  // restent des MotionValue : aucune re-rendu React pendant le déplacement.
  const glowX = useMotionValue(-600);
  const glowY = useMotionValue(-600);
  const smoothX = useSpring(glowX, { stiffness: 55, damping: 22, mass: 0.7 });
  const smoothY = useSpring(glowY, { stiffness: 55, damping: 22, mass: 0.7 });
  const cursorGlow = useMotionTemplate`radial-gradient(640px circle at ${smoothX}px ${smoothY}px, rgba(var(--theme-glow-rgb), 0.18), rgba(var(--theme-glow-rgb), 0.05) 44%, transparent 70%)`;

  useEffect(() => {
    if (!auth || reduceMotion) {
      return undefined;
    }

    function handlePointer(event) {
      glowX.set(event.clientX);
      glowY.set(event.clientY);
    }

    window.addEventListener("pointermove", handlePointer, { passive: true });

    return () => window.removeEventListener("pointermove", handlePointer);
  }, [auth, reduceMotion, glowX, glowY]);

  return (
    <div className="dm-bg" aria-hidden="true" style={{ opacity }}>
      <div className="dm-bg-base" />
      <div className="dm-bg-grid" />

      {/* Sphere 3D tournante au centre : cœur lumineux du décor. */}
      {!reduceMotion && (
        <motion.div
          className="dm-bg-sphere"
          animate={{
            rotate: [0, 360],
            scale: [1, 1.05, 1],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      )}

      {auth && (
        <div className="dm-bg-aurora">
          <span className="dm-bg-aurora-1" />
          <span className="dm-bg-aurora-2" />
          <span className="dm-bg-aurora-3" />
        </div>
      )}

      {BLOBS.map((b, i) => (
        <motion.div
          key={i}
          className="dm-bg-blob"
          style={{
            width: b.size,
            height: b.size,
            background: `radial-gradient(circle, ${b.color}, transparent 68%)`,
            top: b.top,
            bottom: b.bottom,
            left: b.left,
            right: b.right,
          }}
          animate={{ x: [0, b.dx, 0], y: [0, b.dy, 0], scale: [1, 1.1, 1] }}
          transition={{ duration: b.dur, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}

      {auth && (
        <>
          <div className="dm-bg-beams">
            {BEAMS.map((beam, i) => (
              <span
                key={i}
                className="dm-bg-beam"
                style={{
                  left: beam.left,
                  width: beam.width,
                  "--beam-color": beam.color,
                  "--beam-tilt": `${beam.tilt}deg`,
                  "--beam-dur": `${beam.dur}s`,
                  animationDelay: `${beam.delay}s`,
                }}
              />
            ))}
          </div>

          <div className="dm-bg-sweep" />

          <div className="dm-bg-stars">
            {STARS.map((star, i) => (
              <span
                key={i}
                style={{
                  left: star.left,
                  top: star.top,
                  width: star.size,
                  height: star.size,
                  animationDuration: `${star.dur}s`,
                  animationDelay: `${star.delay}s`,
                }}
              />
            ))}
          </div>

          <motion.div className="dm-bg-cursor" style={{ background: cursorGlow }} />
        </>
      )}

      {/* Particules flottantes 3D qui montent lentement. */}
      {!reduceMotion && (
        <>
          {PARTICLES.map((p) => (
            <span
              key={p.i}
              className="dm-bg-particle"
              style={{
                left: p.left,
                top: p.top,
                width: p.size,
                height: p.size,
                animationDuration: `${p.dur}s`,
                animationDelay: `${p.delay}s`,
              }}
            />
          ))}
        </>
      )}

      <div className="dm-bg-vignette" />
    </div>
  );
}
