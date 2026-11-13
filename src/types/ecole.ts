import type { ArticleClasse, Classe, Ecole, ModePaiement, StatutInscription, TypePaiement, RoleUtilisateur } from "@/types/database";
import type { Situation } from "@/types/metier";

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
