import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { applyTheme, readStoredTheme } from "./theme/theme";
import "./index.css";
import "./styles/animations.css";
import "./styles/workspace.css";
import "./profile/profile-decorations.css";

// Le thème est posé avant le premier rendu : pas de flash de thème clair/sombre
// lors d'un rafraîchissement, y compris sur les pages publiques.
applyTheme(readStoredTheme());

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
