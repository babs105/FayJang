// Reprise de l'existant : forme de l'aperçu rendu à l'école (classes, articles, élèves chiffrés) et contexte lu en base.
import type { ArticlePrevu, PaiementPrevu } from "@/lib/metier/reprise-repartition";
import type { CalendrierEcole } from "@/lib/metier/scolarite";
import type { NatureArticle, Niveau, StatutInscription } from "@/types/database";

export interface ContexteReprise {
  anneeScolaire: string;
  /** Date de l'import (Dakar), AAAA-MM-JJ */
  aujourdhui: string;
  /** Premier mois de l'année scolaire, AAAA-MM-01 */
  premierMois: string;
  /** Paramètres de l'école (calendrier, tranches, mois exigibles à l'inscription) */
  calendrier: CalendrierEcole;
  /** Classes déjà présentes pour l'année, avec leurs tarifs et leur catalogue (dans l'ordre du catalogue) */
  classes: { nom: string; frais: number; mensualite: number; dernierMois: number | null; articles: ArticleCatalogue[] }[];
  /** Élèves déjà inscrits cette année (téléphone du parent normalisé) */
  eleves: { prenom: string; nom: string; telephone: string }[];
}

export interface ArticleCatalogue {
  libelle: string;
  nature: NatureArticle;
  obligatoire: boolean;
  prix: number;
  quantiteDefaut: number;
}

/** Ce que l'élève verse, réparti en paiements, et ce que l'app affichera ensuite */
export interface RepartitionEleve {
  paiements: PaiementPrevu[];
  articles: ArticlePrevu[];
  arriere: number;
  resteAnnee: number;
  totalPaye: number;
}

export interface ClasseApercu {
  ligne: number;
  nom: string;
  niveau: Niveau | null;
  frais: number | null;
  mensualite: number | null;
  dernierMois: number | null;
  etat: "nouvelle" | "existante" | "erreur";
  erreurs: string[];
}

export interface ArticleApercu {
  ligne: number;
  classe: string;
  libelle: string;
  nature: NatureArticle | null;
  prix: number | null;
  quantite: number;
  obligatoire: boolean;
  etat: "nouveau" | "ignore" | "erreur";
  erreurs: string[];
}

export interface OptionEleve {
  libelle: string;
  quantite: number | null;
  /** Service mensuel : premier mois dû (AAAA-MM-01) donné par le fichier ; null = règle par défaut */
  debut: string | null;
  /** Service mensuel : dernier mois dû si le service s'est arrêté ; null = en cours (ou jusqu'au départ) */
  fin: string | null;
}

export interface EleveApercu {
  feuille: string;
  ligne: number;
  prenom: string;
  nom: string;
  classe: string;
  parent: string;
  telephone: string | null;
  sexe: "M" | "F" | null;
  dateNaissance: string | null;
  matriculeAncien: string | null;
  statut: StatutInscription;
  dateDepart: string | null;
  reduction: number | null;
  totalScolarite: number | null;
  totalArticles: number | null;
  options: OptionEleve[];
  etat: "a_creer" | "deja_present" | "erreur";
  erreurs: string[];
  avertissements: string[];
  /** Chiffrage de l'élève ; null s'il est en erreur ou déjà présent */
  repartition: RepartitionEleve | null;
}

export interface ApercuReprise {
  /** Problèmes qui empêchent tout import (feuille manquante, fichier trop long…) */
  erreursGlobales: string[];
  avertissements: string[];
  classes: ClasseApercu[];
  articles: ArticleApercu[];
  eleves: EleveApercu[];
  compteurs: { aCreer: number; dejaPresents: number; erreurs: number; parents: number; classesNouvelles: number };
  /** Somme sur les élèves à créer, à comparer au cahier de caisse de l'école */
  totaux: { arriere: number; resteAnnee: number; verse: number };
}

/**
 * Classe utilisable par les élèves : nouvelle sans erreur dans le fichier, ou déjà en base. Une classe déjà en base garde
 * ses tarifs : si le fichier en donne d'autres, ses élèves sont refusés (décision DO3-A, `ecart`).
 */
export interface CatalogueClasse {
  nom: string;
  articles: ArticleCatalogue[];
  tarifs: { frais: number; mensualite: number; dernierMois: number | null } | null;
  ecart: string | null;
}
