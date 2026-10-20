import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Compass,
  LogIn,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import WorkspaceShell from "../components/layout/WorkspaceShell";
import { apiFetch } from "../services/api";
import { useAsyncEffect } from "../hooks/useAsyncEffect";

/**
 * Découverte des communautés publiques : liste réelle fournie par
 * `GET /api/communities/discover` (les communautés dont on est déjà membre en
 * sont exclues côté serveur, les communautés privées n'y figurent jamais).
 *
 * La page distingue explicitement ses états — chargement, résultats, liste
 * vide, recherche sans résultat, serveur injoignable, erreur serveur — pour ne
 * jamais afficher « aucune communauté » alors que la requête a échoué.
 */
function Discover({ token, user, onLogout }) {
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [communities, setCommunities] = useState([]);
  const [status, setStatus] = useState("loading");
  const [listError, setListError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [joiningId, setJoiningId] = useState(null);

  // Chaque requête porte un numéro : une réponse arrivée dans le désordre ne
  // peut pas écraser un résultat plus récent (recherches enchaînées).
  const requestRef = useRef(0);

  const load = useCallback(
    async (term = "", isCancelled = () => false) => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;

      setStatus("loading");
      setListError("");

      let result;

      try {
        const query = term ? `?search=${encodeURIComponent(term)}` : "";
        result = await apiFetch(`/api/communities/discover${query}`, {
          token,
        });
      } catch {
        // `fetch` rejette quand le serveur est injoignable (API arrêtée) :
        // c'est une panne réseau, pas une liste vide.
        if (isCancelled() || requestRef.current !== requestId) {
          return;
        }

        setCommunities([]);
        setAppliedSearch(term);
        setListError(
          "Serveur injoignable. Vérifiez que l'API DevMeet est démarrée, puis réessayez."
        );
        setStatus("error");
        return;
      }

      if (isCancelled() || requestRef.current !== requestId) {
        return;
      }

      setAppliedSearch(term);

      if (!result.ok) {
        setCommunities([]);
        setListError(
          result.data?.message ||
            `La récupération des communautés a échoué (code ${result.status}).`
        );
        setStatus("error");
        return;
      }

      setCommunities(result.data?.communities || []);
      setStatus("ready");
    },
    [token]
  );

  useAsyncEffect(
    async (isCancelled) => {
      await load("", isCancelled);
    },
    [load]
  );

  async function handleSearch(event) {
    event.preventDefault();

    setActionError("");
    setNotice("");
    setSearchInput((current) => current.trim());
    await load(searchInput.trim());
  }

  async function resetSearch() {
    setActionError("");
    setNotice("");
    setSearchInput("");
    await load("");
  }

  async function handleJoin(community) {
    // Un seul appel à la fois : le bouton est désactivé pendant l'adhésion.
    if (joiningId !== null) {
      return;
    }

    setJoiningId(community.id);
    setActionError("");
    setNotice("");

    let result;

    try {
      result = await apiFetch(`/api/communities/${community.id}/join`, {
        method: "POST",
        token,
      });
    } catch {
      setJoiningId(null);
      setActionError(
        "Serveur injoignable : impossible de rejoindre cette communauté pour l'instant."
      );
      return;
    }

    setJoiningId(null);

    if (!result.ok) {
      setActionError(
        result.data?.message || "Impossible de rejoindre cette communauté."
      );
      return;
    }

    setNotice(
      `Vous avez rejoint « ${community.name} ». Elle apparaît maintenant dans vos communautés (Accueil) et dans sa barre latérale.`
    );

    // Le serveur exclut les communautés dont on est membre : on retire la carte
    // tout de suite, puis on recharge la liste pour rester fidèle au serveur.
    setCommunities((previous) =>
      previous.filter((item) => item.id !== community.id)
    );

    await load(appliedSearch);
  }

  const isSearching = appliedSearch !== "";

  return (
    <WorkspaceShell
      token={token}
      user={user}
      onLogout={onLogout}
      headerTitle="Découvrir"
      headerSubtitle="Des communautés publiques réellement ouvertes. Rejoindre une communauté la fait passer dans vos communautés."
    >
      <form className="ws-inline" style={{ marginBottom: 22 }} onSubmit={handleSearch}>
        <div className="ws-form-group" style={{ flex: 1, marginBottom: 0 }}>
          <input
            className="ws-form-input"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Rechercher une communauté par nom…"
            maxLength={60}
            aria-label="Rechercher une communauté par nom"
          />
        </div>

        <button
          className="ws-button"
          type="submit"
          disabled={status === "loading"}
        >
          <Search size={17} />
          Rechercher
        </button>

        {searchInput || isSearching ? (
          <button
            className="ws-button ws-button-ghost"
            type="button"
            onClick={resetSearch}
            disabled={status === "loading"}
          >
            <X size={17} />
            Réinitialiser
          </button>
        ) : null}
      </form>

      {notice ? <div className="ws-alert ws-alert-success">{notice}</div> : null}
      {actionError ? (
        <div className="ws-alert ws-alert-error">{actionError}</div>
      ) : null}

      {isSearching && status !== "error" ? (
        <p className="ws-muted" style={{ marginBottom: 12 }}>
          Résultats pour « {appliedSearch} ».
        </p>
      ) : null}

      {status === "loading" ? <p className="ws-empty">Chargement…</p> : null}

      {status === "error" ? (
        <div className="ws-alert ws-alert-error">
          {listError}

          <div style={{ marginTop: 10 }}>
            <button
              className="ws-button ws-button-small"
              type="button"
              onClick={() => load(appliedSearch)}
            >
              <RefreshCw size={16} />
              Réessayer
            </button>
          </div>
        </div>
      ) : null}

      {status === "ready" && communities.length === 0 ? (
        isSearching ? (
          <>
            <p className="ws-empty">
              Aucune communauté publique ne correspond à « {appliedSearch} ».
            </p>

            <div className="ws-inline" style={{ justifyContent: "center" }}>
              <button
                className="ws-button ws-button-small"
                type="button"
                onClick={resetSearch}
              >
                <X size={16} />
                Réinitialiser la recherche
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="ws-empty">
              <Compass size={17} /> Aucune communauté publique à découvrir pour
              le moment : soit vous êtes déjà membre de toutes celles qui
              existent, soit aucune communauté publique n'a encore été créée.
            </p>

            <div className="ws-inline" style={{ justifyContent: "center" }}>
              <Link className="ws-button ws-button-primary" to="/">
                <Plus size={17} />
                Créer une communauté
              </Link>
            </div>
          </>
        )
      ) : null}

      {status === "ready" ? (
        <div className="ws-grid ws-grid-3">
          {communities.map((community) => (
            <div className="ws-card ws-community-card" key={community.id}>
              <div className="ws-card-title">{community.name}</div>

              <div className="ws-card-description">
                {community.description || "Aucune description."}
              </div>

              <div className="ws-meta">
                <span>{community.memberCount ?? 0} membres</span>
                <span>{community.channelCount ?? 0} salons</span>
              </div>

              <div className="ws-card-footer">
                <Link
                  className="ws-button ws-button-small"
                  to={`/c/${community.id}`}
                >
                  Aperçu
                </Link>

                <button
                  className="ws-button ws-button-small ws-button-primary"
                  type="button"
                  onClick={() => handleJoin(community)}
                  disabled={joiningId !== null}
                >
                  <LogIn size={16} />
                  {joiningId === community.id ? "Adhésion…" : "Rejoindre"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </WorkspaceShell>
  );
}

export default Discover;
