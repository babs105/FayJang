/**
 * Reçu de « Reprise de l'existant » : créé par la fonction SQL `importer_reprise`, qui écrit cette valeur
 * dans `paiements.encaisse_par`. Partagé client / serveur (aucune dépendance).
 */
export const ENCAISSE_PAR_REPRISE = "Reprise de l'existant";

/** Sous-titre du reçu PDF et de la page parent */
export const SOUS_TITRE_REPRISE = "Reprise des versements antérieurs à FayJàng";

/** Vrai si le paiement vient de la reprise de l'existant */
export function estRecuDeReprise(encaissePar: string | null | undefined): boolean {
  return encaissePar === ENCAISSE_PAR_REPRISE;
}
