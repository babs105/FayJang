// Types partagés par plusieurs espaces (École, parent, console, documents) : situation d'une inscription (mois,
// articles, tranches), état de l'abonnement, reçus regroupés. Des types seulement : la logique est dans src/lib/metier/.
import type { ArticleInscription, Ecole, Inscription, Paiement } from "@/types/database";

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
