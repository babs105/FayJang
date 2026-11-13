// Reprise de l'existant : entrée de la répartition d'un élève (tarifs, catalogue, versé), ce qu'elle produit
// (paiements et articles prévus, résumé), et le contrôle défensif de l'entrée.
import { verifierReglages, type CalendrierEcole } from "@/lib/metier/scolarite";
import { formatFCFA } from "@/lib/utils";
import type { NatureArticle, StatutInscription } from "@/types/database";

/** Article du catalogue d'une classe ; l'ordre du tableau est l'ordre du catalogue */
export interface ArticleCatalogueRep {
  libelle: string;
  nature: NatureArticle;
  prix: number;
  quantiteDefaut: number;
  obligatoire: boolean;
}

export interface EntreeRepartition {
  anneeScolaire: string;
  /** Date de l'import (Dakar), AAAA-MM-JJ */
  aujourdhui: string;
  /** Paramètres de l'école */
  ecole: CalendrierEcole;
  /** Tarifs de l'inscription (classe en base, ou classe du fichier) */
  tarifs: { frais: number; mensualite: number; dernierMois: number | null };
  reduction: number | null;
  catalogue: ArticleCatalogueRep[];
  statut: StatutInscription;
  dateDepart: string | null;
  verseScolarite: number | null;
  verseArticles: number | null;
  /** Options choisies ; quantite null = quantité par défaut ; debut = premier mois (AAAA-MM-01) d'un service mensuel,
   *  null ou absent = règle par défaut ; fin = dernier mois d'un service arrêté, null ou absent = en cours (ou jusqu'au
   *  départ). Un service arrêté puis repris est cité une fois par période, chacune avec son début. */
  options: { libelle: string; quantite: number | null; debut?: string | null; fin?: string | null }[];
}

export interface PaiementPrevu {
  type: "inscription" | "mensualite" | "autre";
  /** AAAA-MM-01 : mois de la mensualité ou du service ; null pour l'inscription et un frais unique */
  mois: string | null;
  /** Libellé de l'article du catalogue pour le type « autre » */
  article: string | null;
  /** Type « autre » : position de la ligne dans `articles` (un service repris a une ligne par période) */
  articleIndex: number | null;
  montant: number;
  /** Texte affiché (« Mensualité de novembre 2026 », « Tenue × 2 », « Tranches 1 à 2/3 de mai 2027 ») */
  libelle: string;
  /** Libellé de tranche à enregistrer, ou null */
  libelleTranche: string | null;
}

/** Article à rattacher à l'inscription, avec la période de son service */
export interface ArticlePrevu {
  libelle: string;
  nature: NatureArticle;
  prix: number;
  quantite: number;
  obligatoire: boolean;
  moisDebut: string | null;
  moisFin: string | null;
}

export interface ResumeRepartition {
  /** Ce que l'app affichera après l'import, calculé par situationInscription sur les paiements produits */
  arriere: number;
  resteAnnee: number;
  totalPaye: number;
}

export type ResultatRepartition =
  | { ok: false; erreur: string }
  | { ok: true; paiements: PaiementPrevu[]; articles: ArticlePrevu[]; resume: ResumeRepartition; avertissements: string[] };

const entier = (n: number | null | undefined) => n === null || n === undefined || (Number.isInteger(n) && n >= 0);

export function controler(e: EntreeRepartition): string | null {
  const reglages = verifierReglages(e.anneeScolaire, e.ecole);
  if (reglages) return `Paramètres de l'école incohérents : ${reglages}`;
  const montants = [e.tarifs.frais, e.tarifs.mensualite, e.tarifs.dernierMois, e.reduction, e.verseScolarite, e.verseArticles];
  for (const a of e.catalogue) montants.push(a.prix, a.quantiteDefaut);
  if (!montants.every(entier)) return "Les montants doivent être des nombres entiers de FCFA, positifs ou nuls.";
  if ((e.reduction ?? 0) > e.tarifs.mensualite) {
    return `La réduction mensuelle (${formatFCFA(e.reduction ?? 0)}) dépasse la mensualité de la classe (${formatFCFA(e.tarifs.mensualite)}).`;
  }
  if (e.statut !== "active" && !e.dateDepart) return "Date de départ obligatoire pour un abandon ou un transfert.";
  return null;
}
