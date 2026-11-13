// Types métier partagés : scolarité (situation, mois, articles), encaissement, tranches, abonnement, reçus, caisse,
// catalogue des classes, console SuperAdmin. Des types seulement : la logique est dans src/lib/metier/.
import type { ArticleInscription, Ecole, Inscription, NatureArticle, Paiement, TypePaiement } from "@/types/database";

// --- scolarite

export type StatutMois = "paye" | "partiel" | "retard" | "a_venir" | "non_du";

/** Paiement d'un mois par tranches (option de l'école : dernier, avant-dernier ou antépénultième mois) */
export interface InfoTranches {
  /** Mois dont l'échéance porte une tranche (YYYY-MM-01) */
  mois: string[];
  total: number;
  /** Tranches dont l'échéance est passée */
  echues: number;
  /** Montant d'une tranche (la dernière absorbe l'arrondi) */
  montant: number;
  /** Montant proposé par défaut à l'encaissement : le retard s'il y en a, sinon la prochaine tranche */
  suggestion: number;
  /** Échéance de la prochaine tranche non échue, ou null */
  prochaine: string | null;
}

export interface LigneMois {
  mois: string; // YYYY-MM-01
  echeance: string; // YYYY-MM-DD
  du: number;
  paye: number;
  reste: number;
  /** Part du mois déjà exigible à aujourd'hui (tout le mois, ou les tranches échues) */
  duEchu: number;
  /** Retard sur ce mois : duEchu - payé */
  resteEchu: number;
  statut: StatutMois;
  /** Mensualité exigible dès l'inscription (1er ou dernier mois, réglage de l'école) */
  aLinscription: boolean;
  tranches?: InfoTranches;
}

/** Ligne due au titre d'un article : frais unique (tenue × 2) ou un mois d'un service (transport de novembre) */
export interface LigneArticle {
  /** Clé de sélection : id de l'article, suivi de « :YYYY-MM-01 » pour un mois de service */
  cle: string;
  article_id: string;
  nature: "unique" | "mensuel";
  libelle: string;
  /** Mois du service, null pour un frais unique */
  mois: string | null;
  /** Échéance, null pour un frais unique (exigible dès l'inscription) */
  echeance: string | null;
  obligatoire: boolean;
  du: number;
  paye: number;
  reste: number;
  duEchu: number;
  resteEchu: number;
  statut: StatutMois;
}

export interface Situation {
  inscriptionDue: number;
  inscriptionPayee: number;
  mois: LigneMois[];
  articles: LigneArticle[];
  /** Total échu à aujourd'hui (inscription + mensualités, tranches et articles exigibles) */
  totalEchu: number;
  totalPaye: number;
  /** Reste à payer sur ce qui est échu : l'arriéré */
  arriere: number;
  /** Reste à payer sur toute l'année */
  resteAnnee: number;
  /** Mensualités en retard (les articles comptent dans l'arriéré, pas ici) */
  moisEnRetard: number;
}

export type CalendrierEcole = Pick<Ecole, "mois_debut" | "nb_mensualites" | "jour_echeance"> &
  Partial<
    Pick<
      Ecole,
      | "tranches_dernier_mois"
      | "mois_debut_tranches"
      | "nb_tranches"
      | "rang_mois_tranches"
      | "premier_mois_a_linscription"
      | "dernier_mois_a_linscription"
    >
  >;

export type InscriptionTarifs = Pick<Inscription, "annee_scolaire" | "frais_inscription" | "mensualite" | "reduction_mensuelle" | "statut"> &
  Partial<Pick<Inscription, "mensualite_dernier_mois">> & {
    /** Date de départ (YYYY-MM-DD) d'un élève en abandon / transfert ; ignorée si l'inscription est active */
    date_depart?: string | null;
  };

export type PaiementCalcul = Pick<Paiement, "type" | "mois" | "montant" | "annule"> & Partial<Pick<Paiement, "article_id">>;

export type ArticleCalcul = Pick<
  ArticleInscription,
  "id" | "libelle" | "nature" | "prix_unitaire" | "quantite" | "obligatoire" | "mois_debut" | "mois_fin"
>;

// --- a-encaisser

/** Ce que l'administration coche à l'encaissement */
export interface ChoixEncaissement {
  inscription?: boolean;
  /** Mensualités (YYYY-MM-01) */
  mois?: string[];
  /** Clés de LigneArticle.cle */
  articles?: string[];
  /** Montant partiel : accepté pour une seule ligne choisie */
  montant?: number | null;
  /** Ajouter la tranche portée par les mois choisis (par défaut oui) */
  inclure_tranche?: boolean;
}

export interface LigneEncaissement {
  type: TypePaiement;
  mois: string | null;
  article_id: string | null;
  montant: number;
  libelle: string | null;
}

// --- tranches

export interface TrancheIncluse {
  mois: string; // mois payé par tranches (YYYY-MM-01)
  montant: number;
  libelle: string;
}

// --- abonnement

export type EtatAbonnement = "normal" | "alerte" | "grace" | "lecture_seule";

export interface SituationAbonnement {
  etat: EtatAbonnement;
  /** Dernier jour de l'essai ou de l'abonnement (YYYY-MM-DD), null si aucune date ne s'applique */
  fin: string | null;
  /** Dernier jour du délai de grâce, null sans date de fin */
  finGrace: string | null;
  /** Jours avant la fin (0 le jour même, négatif après), null sans date de fin */
  joursRestants: number | null;
}

// --- admin-ecoles

export type EcoleAdmin = Pick<
  Ecole,
  | "id"
  | "nom"
  | "slug"
  | "ville"
  | "responsable_nom"
  | "email_contact"
  | "telephone_contact"
  | "annee_scolaire"
  | "plan"
  | "statut_abonnement"
  | "trial_ends_at"
  | "abonnement_fin"
  | "is_active"
  | "created_at"
> & {
  eleves: number;
  encaisse: number;
  /** État calculé par la base (normal, alerte, grâce, lecture seule) ; null si la lecture a échoué */
  abonnement: SituationAbonnement | null;
};

export interface StatsGlobales {
  ecoles: number;
  abonnees: number;
  enEssai: number;
  suspendues: number;
  desactivees: number;
  /** Fin de l'essai ou de l'abonnement dépassée : délai de grâce ou lecture seule */
  enRetard: number;
  /** Fin dans les 7 jours */
  finProche: number;
  eleves: number;
  encaisse: number;
}

// --- caisse

export interface TotauxCaisse {
  /** Encaissé aujourd'hui (hors reprise) */
  jour: number;
  /** Encaissé ce mois-ci (hors reprise) */
  mois: number;
  /** Ce mois-ci par mode de paiement (hors reprise) */
  parModeMois: Map<string, number>;
  /** Tout ce qui a été versé sur l'année, reprise comprise */
  annee: number;
  /** Part de l'année reprise à l'import */
  reprise: number;
}

// --- classe-catalogue

export interface SaisieArticle {
  /** Ligne existante du catalogue (mise à jour sur place) ; absent = nouvelle ligne */
  id?: string;
  libelle: string;
  nature: string;
  prix_unitaire: string | number;
  quantite_defaut?: string | number;
  obligatoire: boolean;
}

/** Ligne du catalogue prête pour la fonction enregistrer_classe (un `type` : supabase-js exige une signature d'index pour le JSON) */
export type LigneCatalogue = {
  id?: string;
  libelle: string;
  nature: NatureArticle;
  prix_unitaire: number;
  quantite_defaut: number;
  obligatoire: boolean;
  /** Position dans la saisie (les lignes vides comptent) */
  ordre: number;
};

// --- encaissement

/** Ligne au format attendu par encaisser_paiement (p_lignes) */
export type LigneRpc = {
  type: LigneEncaissement["type"];
  mois: string | null;
  article_id: string | null;
  montant: number;
  libelle: string | null;
};

/** Résultat de encaisser_paiement */
export interface ResultatEncaissement {
  numero_recu: string | null;
  montant_encaisse: number;
  ids: string[];
  /** Vrai si la clé avait déjà servi pour exactement cet encaissement : rien n'a été ajouté */
  rejoue: boolean;
}

/** Issue d'une tentative d'encaissement vue du navigateur */
export type IssueEncaissement =
  | "succes" // reçu créé, ou rejeu d'un reçu déjà créé (success: true dans les deux cas)
  | "echec_metier" // l'action a répondu success: false (refus, conflit, erreur base)
  | "echec_reseau"; // la Server Action a levé une exception : on ignore si la base a enregistré

/** Dernière tentative d'envoi : contenu envoyé (voir signatureEncaissement) et issue */
export interface TentativeEncaissement {
  signature: string;
  issue: IssueEncaissement;
}

// --- inscription-initiale

/** Ligne du catalogue d'une classe, telle que lue dans articles_classe */
export type ArticleCatalogue = {
  id: string;
  libelle: string;
  nature: NatureArticle;
  quantite_defaut: number;
  obligatoire: boolean;
};

/** Article coché dans le formulaire d'inscription (quantité saisie pour un frais unique) */
export type ChoixArticle = { article_classe_id?: string; quantite?: string | number };

/** Article retenu pour l'élève, envoyé à la fonction SQL inscrire_eleve (qui recopie prix et libellé) */
export type ArticleRetenu = { article_classe_id: string; quantite: number };

/** Article du catalogue avec son prix, nécessaire pour calculer ce qui est dû à l'inscription */
export type ArticleCatalogueTarif = ArticleCatalogue & { prix_unitaire: number };

/** Ligne de reçu envoyée à la fonction SQL inscrire_eleve (p_lignes_paiement) ; l'article est désigné par son article_classe_id */
export type LignePaiementInscription = {
  type: "inscription" | "mensualite" | "autre";
  mois: string | null;
  article_classe_id: string | null;
  montant: number;
  libelle: string | null;
};

// --- modifications

/** Horodatage d'une ligne : created_at et updated_at tels que renvoyés par Supabase (ISO 8601) */
export type Horodatage = { created_at: string; updated_at: string };

// --- regrouper-recus

/** Champs minimaux d'une ligne de paiement pour la regrouper par reçu */
export type LigneRecu = Pick<
  Paiement,
  "id" | "inscription_id" | "lot_id" | "numero_recu" | "type" | "mois" | "libelle" | "montant" | "annule" | "motif_annulation"
>;

/** Un reçu (lot) : les lignes encaissées ensemble, affichées sur une seule ligne */
export type Recu<L extends LigneRecu> = {
  /** Clé unique du reçu : inscription + lot (ou la ligne seule si elle n'a pas de lot) */
  cle: string;
  /** Première ligne du reçu : porte le numéro, la date, le mode, l'élève, et sert de lien vers le PDF */
  premiere: L;
  lignes: L[];
  /** Total encaissé : somme des lignes non annulées */
  total: number;
  /** Somme de toutes les lignes, annulées comprises (affichée barrée si le reçu est annulé) */
  totalBrut: number;
  /** Reçu annulé : toutes ses lignes le sont */
  annule: boolean;
  motif_annulation: string | null;
};
