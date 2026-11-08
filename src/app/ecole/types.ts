import type { ArticleClasse, Classe, Ecole, ModePaiement, StatutInscription, TypePaiement } from "@/types/database";
import type { Situation } from "@/lib/scolarite";

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
  eleve_id: string;
  eleve_nom: string;
  classe_nom: string;
}

export interface EleveVue {
  id: string;
  matricule: string;
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
    frais_inscription: number;
    mensualite: number;
    mensualite_dernier_mois: number | null;
    reduction_mensuelle: number;
  } | null;
  situation: Situation | null;
}
