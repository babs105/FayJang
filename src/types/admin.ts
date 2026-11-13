// Types de la console SuperAdmin : école vue par la console, statistiques, retour des actions.
import type { Ecole } from "@/types/database";
import type { SituationAbonnement } from "@/types/commun";

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

/** Retour des actions de la console */
export type ResultatAdmin<T = undefined> = { success: boolean; message?: string; data?: T };

/** Identifiants du directeur d'une école créée par la console (D11), affichés une fois pour être transmis */
export type IdentifiantsDirecteur = { nom: string; email: string; motDePasse: string };
