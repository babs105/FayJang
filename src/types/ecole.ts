// Types de l'Espace École : données préparées par /ecole/page.tsx (vues), encaissement, caisse, catalogue des classes,
// inscription initiale.
import type { ArticleClasse, Classe, Ecole, ModePaiement, NatureArticle, RoleUtilisateur, StatutInscription, TypePaiement } from "@/types/database";
import type { Situation } from "@/types/commun";

/** Données préparées par page.tsx (serveur) pour l'Espace École (client) */

export type EcoleVue = Pick<
  Ecole,
  | "id"
  | "nom"
  | "slug"
  | "ville"
  | "adresse"
  | "responsable_nom"
  | "email_contact"
  | "telephone_contact"
  | "annee_scolaire"
  | "mois_debut"
  | "nb_mensualites"
  | "jour_echeance"
  | "tranches_dernier_mois"
  | "mois_debut_tranches"
  | "nb_tranches"
  | "rang_mois_tranches"
  | "premier_mois_a_linscription"
  | "dernier_mois_a_linscription"
  | "plan"
  | "statut_abonnement"
  | "trial_ends_at"
  | "abonnement_fin"
>;

export type ArticleClasseVue = Pick<ArticleClasse, "id" | "libelle" | "nature" | "prix_unitaire" | "quantite_defaut" | "obligatoire">;

export type ClasseVue = Pick<Classe, "id" | "nom" | "niveau" | "frais_inscription" | "mensualite" | "mensualite_dernier_mois" | "is_active"> & {
  effectif: number;
  articles: ArticleClasseVue[];
};

export interface PaiementVue {
  id: string;
  inscription_id: string;
  /** Lignes encaissées ensemble (même reçu) ; null pour les anciennes lignes */
  lot_id: string | null;
  numero_recu: string | null;
  type: TypePaiement;
  mois: string | null;
  montant: number;
  mode: ModePaiement;
  reference: string | null;
  libelle: string | null;
  paye_le: string;
  annule: boolean;
  motif_annulation: string | null;
  /** Qui a annulé le reçu (Espace École seulement) */
  annule_par: string | null;
  /** « Reprise de l'existant » pour un reçu importé, sinon null */
  encaisse_par: string | null;
  eleve_id: string;
  eleve_nom: string;
  classe_nom: string;
}

export interface EleveVue {
  id: string;
  matricule: string;
  /** Numéro de l'ancien système (reprise de l'existant), lecture seule */
  matricule_ancien: string | null;
  prenom: string;
  nom: string;
  sexe: "M" | "F" | null;
  date_naissance: string | null;
  parent: { id: string; nom: string; telephone: string; lien: string } | null;
  inscription: {
    id: string;
    classe_id: string;
    classe_nom: string;
    statut: StatutInscription;
    /** Date de départ (YYYY-MM-DD) d'un abandon / transfert, null sinon */
    date_depart: string | null;
    frais_inscription: number;
    mensualite: number;
    mensualite_dernier_mois: number | null;
    reduction_mensuelle: number;
  } | null;
  /** Dernière modification de l'élève, de son inscription, de son parent ou de ses articles (ISO) ; null si jamais modifié */
  derniere_modification: string | null;
  situation: Situation | null;
}

/** Membre de l'administration listé pour le directeur (lister_utilisateurs_ecole, bloc v1.23 ; jamais le hash) */
export interface UtilisateurListeVue {
  id: string;
  nom: string;
  email: string;
  role: RoleUtilisateur;
  actif: boolean;
}

/** Utilisateur connecté, tel que l'écran le voit (jamais de hash ni d'identifiant de session) */
export interface UtilisateurVue {
  nom: string;
  email: string;
  role: RoleUtilisateur;
}

// --- Encaissement, caisse, catalogue, inscription (types utilisés par src/lib/metier/)

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

export interface TrancheIncluse {
  mois: string; // mois payé par tranches (YYYY-MM-01)
  montant: number;
  libelle: string;
}

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

/** Horodatage d'une ligne : created_at et updated_at tels que renvoyés par Supabase (ISO 8601) */
export type Horodatage = { created_at: string; updated_at: string };
