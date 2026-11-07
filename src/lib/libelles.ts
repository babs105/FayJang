import { formatMois } from "@/lib/dates";
import type { ModePaiement, Niveau, Paiement, StatutInscription, TypePaiement } from "@/types/database";

export const MODES_PAIEMENT: ModePaiement[] = ["especes", "wave", "orange_money", "free_money", "virement", "cheque"];

export const LIBELLE_MODE: Record<ModePaiement, string> = {
  especes: "Espèces",
  wave: "Wave",
  orange_money: "Orange Money",
  free_money: "Free Money",
  virement: "Virement",
  cheque: "Chèque",
};

export const LIBELLE_TYPE: Record<TypePaiement, string> = {
  inscription: "Frais d'inscription",
  mensualite: "Mensualité",
  autre: "Autre frais",
};

export const NIVEAUX: Niveau[] = ["prescolaire", "elementaire", "moyen", "secondaire"];

export const LIBELLE_NIVEAU: Record<Niveau, string> = {
  prescolaire: "Préscolaire",
  elementaire: "Élémentaire",
  moyen: "Moyen",
  secondaire: "Secondaire",
};

export const LIBELLE_STATUT_INSCRIPTION: Record<StatutInscription, string> = {
  active: "Inscrit",
  abandon: "Abandon",
  transfert: "Transféré",
};

/** Objet d'une ligne de paiement, tel qu'affiché partout (historique, journal, reçu, export) */
export function libellePaiement(p: Pick<Paiement, "type" | "mois" | "libelle">): string {
  if (p.libelle) return p.libelle;
  if (p.type === "mensualite" && p.mois) return `Mensualité de ${formatMois(p.mois)}`;
  return LIBELLE_TYPE[p.type];
}
