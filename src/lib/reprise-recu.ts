/**
 * Reçu de « Reprise de l'existant » : créé par la fonction SQL `importer_reprise`, qui écrit cette valeur
 * dans `paiements.encaisse_par`. Partagé client / serveur (aucune dépendance).
 */
export const ENCAISSE_PAR_REPRISE = "Reprise de l'existant";

/** Sous-titre du reçu PDF et de la page parent */
export const SOUS_TITRE_REPRISE = "Reprise des versements antérieurs à FayJàng";

/**
 * Vrai si ce nom d'utilisateur est réservé : égal au marqueur de reprise (espaces de bord et casse ignorés).
 * Un utilisateur ne doit pas pouvoir se faire passer pour une reprise (CHECK SQL utilisateurs_ecole_nom_reserve_check).
 * estRecuDeReprise, lui, reste une égalité exacte : « Moussa » n'est jamais une reprise.
 */
export function nomUtilisateurReserve(nom: string | null | undefined): boolean {
  return normaliserNom(nom ?? "") === normaliserNom(ENCAISSE_PAR_REPRISE);
}

/** Même normalisation que la contrainte SQL : casse, apostrophes typographiques, espaces multiples ou insécables */
function normaliserNom(nom: string): string {
  return nom.toLowerCase().replace(/[’‘ʼ`´]/g, "'").replace(/\s+/g, " ").trim();
}

/** Vrai si le paiement vient de la reprise de l'existant */
export function estRecuDeReprise(encaissePar: string | null | undefined): boolean {
  return encaissePar === ENCAISSE_PAR_REPRISE;
}
