import { createContext, useContext } from "react";
import { Hash, Megaphone, Mic, PenTool } from "lucide-react";

/**
 * Éléments partagés par l'ossature de l'espace de travail et ses pages.
 *
 * Ils vivent hors de `WorkspaceShell.jsx` pour que ce fichier n'exporte que des
 * composants — condition du rafraîchissement à chaud de Vite.
 */

/** Icônes par type de salon, partagées par la barre et l'en-tête. */
export const CHANNEL_ICONS = {
  text: Hash,
  voice: Mic,
  announcement: Megaphone,
  board: PenTool,
};

export const CHANNEL_TYPES = [
  { value: "text", label: "Textuel", icon: Hash },
  { value: "voice", label: "Vocal", icon: Mic },
  { value: "announcement", label: "Annonces", icon: Megaphone },
  { value: "board", label: "Tableau blanc", icon: PenTool },
];

/**
 * Contexte partagé : la sidebar et les pages puisent dans les mêmes données
 * (une seule requête par communauté, un seul abonnement Socket.IO).
 */
export const WorkspaceContext = createContext(null);

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
