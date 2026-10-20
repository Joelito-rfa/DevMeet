/** Libellés de présence partagés par les cartes de profil. */
export const PROFILE_STATUS = {
  online: { label: "En ligne", tone: "pf-status-online" },
  away: { label: "Absent", tone: "pf-status-away" },
  busy: { label: "Ne pas déranger", tone: "pf-status-busy" },
  invisible: { label: "Hors ligne", tone: "pf-status-offline" },
  offline: { label: "Hors ligne", tone: "pf-status-offline" },
};

export function profileStatus(status) {
  return PROFILE_STATUS[status] || PROFILE_STATUS.offline;
}

/** Initiales de secours, sans dépendre d'une image distante. */
export function initialsFor(name) {
  return (
    (name || "DevMeet")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "DM"
  );
}

/** Date lisible, sans heure, pour « Membre depuis ». */
export function memberSinceLabel(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
}
