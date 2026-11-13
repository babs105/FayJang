// Types de la reprise de l'existant (import Excel) : aperçu rendu à l'école, entrée et sortie de la répartition,
// lots envoyés à importer_reprise. Des types seulement : la logique est dans src/lib/validation/ et src/lib/metier/.
import type { Classe, NatureArticle, Niveau, StatutInscription } from "@/types/database";
import type { CalendrierEcole, LigneCatalogue } from "@/types/metier";

// --- reprise-entree

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

// --- reprise-lots

/** Ligne d'élève du fichier, désignée sans aucun montant */
export interface CleEleve {
  feuille: string;
  ligne: number;
}

/** Classe lue en base */
export interface ClasseBase {
  id: string;
  nom: string;
}

/** Article du catalogue lu en base */
export interface ArticleBase {
  id: string;
  classe_id: string;
  libelle: string;
}

/** Élève tel que la fonction SQL importer_reprise le reçoit (JSONB) */
export interface EleveSql {
  ligne: number;
  prenom: string;
  nom: string;
  parent_nom: string;
  telephone: string;
  sexe: "M" | "F" | null;
  date_naissance: string | null;
  matricule_ancien: string | null;
  classe_id: string;
  reduction: number;
  statut: string;
  date_depart: string | null;
  /** Les tarifs, libellés et natures sont relus par la base dans le catalogue : seul l'identifiant et le choix passent */
  articles: { article_classe_id: string; quantite: number; mois_debut: string | null; mois_fin: string | null }[];
  /** article_index : position (à partir de 0) dans `articles` ci-dessus, jamais un identifiant */
  paiements: { type: string; mois: string | null; article_index: number | null; montant: number; libelle: string | null }[];
}

export interface RefusLigne {
  ligne: number;
  message: string;
}

/** Une ligne du retour de importer_reprise */
export interface ResultatEleveReprise {
  ligne: number;
  statut: "cree" | "ignore";
  eleve_id: string | null;
  numero_recu: string | null;
  montant: number;
}

/** Compte rendu d'un lot, renvoyé au navigateur (sans nom ni téléphone) */
export interface ResultatLotReprise {
  crees: number;
  ignores: number;
  /** Total encaissé en reprise sur ce lot, en FCFA */
  montant: number;
  /** Nombre de reçus « Reprise de l'existant » émis */
  recus: number;
  refuses: RefusLigne[];
}

// --- reprise-classes

export interface ClasseACreer {
  nom: string;
  niveau: Niveau;
  frais: number;
  mensualite: number;
  /** null = même montant que la mensualité */
  dernierMois: number | null;
  articles: LigneCatalogue[];
}

// --- reprise-apercu

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
