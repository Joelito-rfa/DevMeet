import { useEffect } from "react";

/**
 * Exécute une opération asynchrone depuis un effet, sans provoquer de rendu en
 * cascade : les mises à jour d'état ont lieu APRÈS la première attente, jamais
 * pendant la phase d'effet elle-même.
 *
 * La fonction reçoit un testeur `isCancelled()` pour ne rien écrire dans un
 * composant démonté (changement d'écran pendant un chargement).
 */
export function useAsyncEffect(effect, deps) {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Une microtâche : garantit que `effect` (et donc les setState qu'il
      // déclenche) ne s'exécute pas synchroniquement dans l'effet.
      await Promise.resolve();

      if (cancelled) {
        return;
      }

      await effect(() => cancelled);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
