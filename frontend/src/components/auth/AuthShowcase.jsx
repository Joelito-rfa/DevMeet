/**
 * Vitrine d'inscription : 8 thèmes de fond, chacun avec sa propre animation.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import heroIllustration from "../../assets/hero.png";
import { useLoginTheme } from "./useLoginTheme";
import { THEMES, PARALLAX, THEME_LABEL_BY_ID, THEME_TAGS } from "./AuthShowcaseThemes";

export { THEMES, PARALLAX, THEME_LABEL_BY_ID, THEME_TAGS };
export { useLoginTheme } from "./useLoginTheme";
export default AuthShowcase;

const INTRO_STAGGER = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.08 } },
};

// Entrée légèrement floutée puis nette : la profondeur se met en place en
// même temps que le texte apparaît.
const INTRO_ITEM = {
  hidden: { opacity: 0, y: 18, filter: "blur(7px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
  },
};

const FEATURE_STAGGER = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1 } },
};

// Poussières lumineuses du panneau : positions variées pour éviter tout motif.
const SPARKLES = [
  { left: "12%", top: "22%", size: 3, dur: 9, delay: 0 },
  { left: "26%", top: "68%", size: 2, dur: 12, delay: 1.4 },
  { left: "44%", top: "14%", size: 2, dur: 10, delay: 2.6 },
  { left: "63%", top: "42%", size: 3, dur: 13, delay: 0.8 },
  { left: "79%", top: "24%", size: 2, dur: 11, delay: 3.2 },
  { left: "88%", top: "61%", size: 2, dur: 14, delay: 1.9 },
  { left: "52%", top: "84%", size: 2, dur: 12, delay: 4.1 },
  { left: "18%", top: "46%", size: 2, dur: 15, delay: 2.2 },
  { left: "70%", top: "76%", size: 3, dur: 10, delay: 5.4 },
  { left: "36%", top: "88%", size: 2, dur: 13, delay: 6.1 },
];

// Contenu par défaut : identique sur la connexion et l'inscription.
const SHOWCASE_FEATURES = [
  {
    icon: "▦",
    title: "Travaillez en équipe",
    text: "Retrouvez votre équipe dans des salons dédiés.",
  },
  {
    icon: "◈",
    title: "Communiquez facilement",
    text: "Échangez des messages en temps réel.",
  },
  {
    icon: "✎",
    title: "Créez ensemble",
    text: "Collaborez sur un tableau blanc partagé.",
  },
];

// Constellation dessinée en canvas : les points dérivent lentement, se lient
// quand ils s'approchent et fuient doucement le curseur. Un seul canvas suffit
// pour toute la scène, ce qui reste fluide malgré le nombre de liens.
function ConstellationCanvas({ active }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas ? canvas.parentElement : null;
    if (!active || !canvas || !parent) {
      return undefined;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return undefined;
    }

    // La préférence système est aussi écoutée ici : le canvas doit se figer
    // même si la préférence change pendant la session.
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionQuery.matches;
    const LINK_DISTANCE = 132;
    const MAX_DPR = 2;
    const pointer = { x: -9999, y: -9999 };
    let width = 0;
    let height = 0;
    let nodes = [];
    let frame = 0;
    let previous = 0;

    function seed() {
      const count = width < 720 ? 16 : 27;
      nodes = Array.from({ length: count }, (_, index) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.24,
        vy: (Math.random() - 0.5) * 0.24,
        radius: 0.9 + Math.random() * 1.3,
        color: index % 5 === 0 ? "103, 232, 249" : "165, 180, 252",
      }));
    }

    function resize() {
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];

        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);

          if (distance > LINK_DISTANCE) {
            continue;
          }

          const alpha = (1 - distance / LINK_DISTANCE) * 0.32;
          ctx.strokeStyle = `rgba(129, 140, 248, ${alpha.toFixed(3)})`;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      for (const node of nodes) {
        const halo = ctx.createRadialGradient(
          node.x,
          node.y,
          0,
          node.x,
          node.y,
          node.radius * 7
        );
        halo.addColorStop(0, `rgba(${node.color}, 0.9)`);
        halo.addColorStop(1, `rgba(${node.color}, 0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius * 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(${node.color}, 0.95)`;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function step(timestamp) {
      const delta = previous ? Math.min((timestamp - previous) / 16.67, 3) : 1;
      previous = timestamp;

      for (const node of nodes) {
        const dx = node.x - pointer.x;
        const dy = node.y - pointer.y;
        const distance = Math.hypot(dx, dy);

        if (distance < 110 && distance > 0.001) {
          const force = ((110 - distance) / 110) * 0.3;
          node.vx += (dx / distance) * force * delta;
          node.vy += (dy / distance) * force * delta;
        }

        node.vx *= 0.995;
        node.vy *= 0.995;
        node.x += node.vx * delta;
        node.y += node.vy * delta;

        if (node.x < 0) node.x += width;
        if (node.x > width) node.x -= width;
        if (node.y < 0) node.y += height;
        if (node.y > height) node.y -= height;
      }

      draw();
      frame = requestAnimationFrame(step);
    }

    function handlePointer(event) {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
    }

    function handleLeave() {
      pointer.x = -9999;
      pointer.y = -9999;
    }

    function syncMotion() {
      reduced = motionQuery.matches;

      if (reduced) {
        cancelAnimationFrame(frame);
        frame = 0;
        draw();
      } else if (!frame && !document.hidden) {
        previous = 0;
        frame = requestAnimationFrame(step);
      }
    }

    function handleVisibility() {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (!frame && !reduced) {
        previous = 0;
        frame = requestAnimationFrame(step);
      }
    }

    function handleResize() {
      resize();
      if (reduced) {
        draw();
      }
    }

    resize();
    syncMotion();

    window.addEventListener("resize", handleResize);
    window.addEventListener("pointermove", handlePointer, { passive: true });
    window.addEventListener("pointerleave", handleLeave);
    document.addEventListener("visibilitychange", handleVisibility);
    motionQuery.addEventListener("change", syncMotion);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pointermove", handlePointer);
      window.removeEventListener("pointerleave", handleLeave);
      document.removeEventListener("visibilitychange", handleVisibility);
      motionQuery.removeEventListener("change", syncMotion);
    };
  }, [active]);

  if (!active) {
    return null;
  }

  return <canvas ref={canvasRef} className="dm-login-constellation" aria-hidden="true" />;
}

/**
 * Panneau de présentation animé des écrans d'authentification.
 * Chaque thème change la palette (aurores, faisceaux, poussières), les shapes
 * d'arrière-plan (constellation, anneaux, onde, grille), et la direction des
 * animations, tout en gardant le formulaire lisible. Les styles associés
 * vivent dans `pages/Login.css` (classes `dm-login-*`) et
 * `pages/LoginTheme.css` (signatures des 8 thèmes).
 */

function AuthShowcase({
  headline,
  lead,
  features = SHOWCASE_FEATURES,
  variant = "classic",
  theme = "neon",
}) {
  const [pointerActive, setPointerActive] = useState(false);
  const reduceMotion = useReducedMotion();
  const spectacular = variant === "spectacular";
  const t = useLoginTheme(theme);
  const bgMode = t.bgMode;
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const spotX = useMotionValue(0);
  const spotY = useMotionValue(0);
  const spring = { stiffness: 60, damping: 18, mass: 0.6 };
  const spotSpring = { stiffness: 130, damping: 22, mass: 0.5 };
  const smoothX = useSpring(pointerX, spring);
  const smoothY = useSpring(pointerY, spring);
  const smoothSpotX = useSpring(spotX, spotSpring);
  const smoothSpotY = useSpring(spotY, spotSpring);
  const artX = useTransform(smoothX, (value) => (reduceMotion ? 0 : value * t.artX));
  const artY = useTransform(smoothY, (value) => (reduceMotion ? 0 : value * t.artY));
  const tilt = spectacular ? 1.7 : 1;
  const artTiltX = useTransform(smoothY, (value) => (reduceMotion ? 0 : value * -4 * tilt));
  const artTiltY = useTransform(smoothX, (value) => (reduceMotion ? 0 : value * 5 * tilt));

  // Parallaxe multicouche : chaque plan du décor (aurores, grille, poussières)
  // se déplace d'une amplitude et d'une inertie différentes. C'est ce décalage
  // entre les plans qui donne une vraie profondeur, plutôt qu'un fond figé.
  // L'amplitude dépend du thème.
  const slowX = useSpring(pointerX, { stiffness: 32, damping: 16, mass: 0.9 });
  const slowY = useSpring(pointerY, { stiffness: 32, damping: 16, mass: 0.9 });
  const auroraX = useTransform(slowX, (value) => (reduceMotion ? 0 : value * -t.auroraX));
  const auroraY = useTransform(slowY, (value) => (reduceMotion ? 0 : value * -t.auroraY));
  const gridX = useTransform(slowX, (value) => (reduceMotion ? 0 : value * t.gridX));
  const gridY = useTransform(slowY, (value) => (reduceMotion ? 0 : value * t.gridY));
  const dustX = useTransform(smoothX, (value) => (reduceMotion ? 0 : value * t.dustX));
  const dustY = useTransform(smoothY, (value) => (reduceMotion ? 0 : value * t.dustY));
  const copyTiltX = useTransform(smoothY, (value) => (reduceMotion ? 0 : value * -2));
  const copyTiltY = useTransform(smoothX, (value) => (reduceMotion ? 0 : value * 2.6));

  // Halo qui suit le curseur : une seule couche repeinte, animée par ressort.
  const spotlightGradient = useMemo(
    () =>
      (x, y) =>
        `radial-gradient(320px circle at ${x}px ${y}px, ${t.sparkColor}22, ${t.sparkGlow} 40%, transparent 72%)`,
    [t.sparkColor, t.sparkGlow]
  );

  function handleIntroMove(event) {
    if (reduceMotion) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = event.clientX - rect.left;
    const relativeY = event.clientY - rect.top;

    pointerX.set((relativeX / rect.width - 0.5) * 2);
    pointerY.set((relativeY / rect.height - 0.5) * 2);
    spotX.set(relativeX);
    spotY.set(relativeY);
    setPointerActive(true);
  }

  function resetParallax() {
    pointerX.set(0);
    pointerY.set(0);
    setPointerActive(false);
  }

  return (      <section
        className={`dm-login-intro dm-login-intro--${t.id} dm-login-intro--${t.bgMode}${pointerActive ? " is-interactive" : ""}`}
        style={{
          "--theme-accent": t.accent,
          "--theme-accent-strong": t.accentStrong,
          "--theme-text": t.text,
          "--theme-sub": t.sub,
        }}
        onMouseMove={handleIntroMove}
        onMouseLeave={resetParallax}
      >
      <motion.div
        className={`dm-login-aurora dm-login-aurora--${bgMode}`}
        style={{
          x: auroraX,
          y: auroraY,
          borderColor: t.auroraBorder,
          "--aurora-1-color": t.aurora1,
          "--aurora-2-color": t.aurora2,
          "--aurora-3-color": t.aurora3,
          "--aurora-4-color": t.aurora4,
          "--aurora-tint": t.auroraTint,
        }}
        aria-hidden="true"
      >
        <span className="dm-login-aurora-blob dm-login-aurora-blob--a" />
        <span className="dm-login-aurora-blob dm-login-aurora-blob--b" />
        <span className="dm-login-aurora-blob dm-login-aurora-blob--c" />
        <span className="dm-login-aurora-blob dm-login-aurora-blob--d" />
      </motion.div>

      <motion.div
        className="dm-login-sheen"
        style={{
          background: t.sheenGradient,
          animationDirection: t.sheenDir,
        }}
        aria-hidden="true"
      />

      <motion.div
        className={`dm-login-grid dm-login-grid--${bgMode}`}
        style={{
          x: gridX,
          y: gridY,
          borderColor: t.gridColor,
          "--grid-color": t.gridColor,
          animationDirection: t.gridDir,
        }}
        aria-hidden="true"
      />

      <ConstellationCanvas active={spectacular} />

      <motion.div
        className="dm-login-spotlight"
        style={{
          background: spotlightGradient(smoothSpotX, smoothSpotY),
        }}
        aria-hidden="true"
      />

      {/* La constellation remplace les poussières dans la variante
         spectaculaire : inutile de garder dix animations pour rien. */}
      {!spectacular && (
        <motion.div
          className={`dm-login-sparkles dm-login-sparkles--${bgMode}`}
          style={{
            x: dustX,
            y: dustY,
            "--spark-color": t.sparkColor,
            "--spark-glow": t.sparkGlow,
            animationDirection: t.sparkDir,
          }}
          aria-hidden="true"
        >
          {SPARKLES.map((dot, index) => (
            <span
              key={index}
              style={{
                left: dot.left,
                top: dot.top,
                width: dot.size,
                height: dot.size,
                animationDuration: `${dot.dur}s`,
                animationDelay: `${dot.delay}s`,
              }}
            />
          )}

        </motion.div>)
      </motion.div>
    </>
  )}

      <motion.div
        className="dm-login-intro-content"
        variants={INTRO_STAGGER}
        initial={reduceMotion ? false : "hidden"}
        animate="show"
        style={{
          rotateX: copyTiltX,
          rotateY: copyTiltY,
          transformPerspective: 1200,
          background: t.sheenGradient,
        }}
      >
        <motion.div className="dm-login-brand" variants={INTRO_ITEM}>
        <div className="dm-login-mark" style={{ background: `linear-gradient(135deg, ${t.accentStrong}, ${t.accent})`, boxShadow: `0 8px 24px ${t.accentStrong}80` }}>◆</div>

        <div>
          <div className="dm-login-name">DevMeet</div>
          <div className="dm-login-tagline">Collaborez. Échangez. Créez.</div>
        </div>
        </motion.div>

        <motion.h1 className="dm-login-headline" variants={INTRO_ITEM}>
          {headline}
        </motion.h1>

        <motion.p className="dm-login-lead" variants={INTRO_ITEM}>
          {lead}
        </motion.p>

        <motion.div className="dm-login-features" variants={FEATURE_STAGGER}>
          {features.map((item) => (
            <motion.div
              key={item.title}
              className="dm-login-feature"
              variants={INTRO_ITEM}
              whileHover={reduceMotion ? undefined : { x: 4 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
            >
              <div className="dm-login-feature-icon" style={{ background: `${t.accent}22`, borderColor: `${t.accent}44`, color: t.accent, boxShadow: `0 0 18px ${t.accent}38` }}>{item.icon}</div>

              <div>
                <div className="dm-login-feature-title">{item.title}</div>
                <div className="dm-login-feature-text">{item.text}</div>
              </div>
            </motion.div>
          )}

        </motion.div>
      </motion.div>

      <motion.div
        className={`dm-login-art dm-login-art--${bgMode}`}
        style={{
          x: artX,
          y: artY,
          rotateX: artTiltX,
          rotateY: artTiltY,
          "--art-glow": t.artGlow,
          "--halo-color-1": t.haloColor1,
          "--halo-color-2": t.haloColor2,
          "--halo-color-3": t.haloColor3,
          animationTimingFunction: t.haloEase,
        }}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        {spectacular && (
          <div className="dm-login-rings" aria-hidden="true">
            <span className="dm-login-ring" />
            <span className="dm-login-ring dm-login-ring--b" />
          </div>
          )
}


        {spectacular && (
          <>
            <span className="dm-login-ripple" aria-hidden="true" />
            <span className="dm-login-ripple dm-login-ripple--b" aria-hidden="true" />          </>)
        </>
      )}

        <div className="dm-login-halo" aria-hidden="true" />

        {bgMode !== "classic" && (
          <div className="dm-login-orbit" aria-hidden="true">
            <span className="dm-login-orbit-ring" />
            <span className="dm-login-orbit-arc" />
            <span className="dm-login-orbit-dot--accent" />
            <span className="dm-login-orbit-dot dm-login-orbit-dot--b" />
          </div>
        )}        {bgMode === "ring" && (
          <>
            <span className="dm-login-ring dm-login-ring--c" aria-hidden="true" />
            <span className="dm-login-ring dm-login-ring--d" aria-hidden="true" />
          </>
        )}

        {bgMode === "wave" && (
          <>
            <span className="dm-login-ripple dm-login-ripple--c" aria-hidden="true" />
            <span className="dm-login-ripple dm-login-ripple--d" aria-hidden="true" />
          </>
        )}

        <motion.div
          className="dm-login-art-float"
          animate={reduceMotion ? undefined : { y: [0, spectacular ? -13 : -9, 0] }}
          transition={
            reduceMotion
              ? undefined
              : { duration: spectacular ? 6 : 7, repeat: Infinity, ease: "easeInOut" }
          }
        >
          <img src={heroIllustration} alt="" aria-hidden="true" />
        </motion.div>

        <span className="dm-login-floor" aria-hidden="true" />
      </motion.div>

      <motion.span
        className="dm-login-beam"
        style={{
          "--beam-color-1": t.beamColor1,
          "--beam-color-2": t.beamColor2,
          "--beam-color-3": t.beamColor3,
          animationDirection: t.beamDir,
        }}
        aria-hidden="true"
      />
    </section>
  );
}

