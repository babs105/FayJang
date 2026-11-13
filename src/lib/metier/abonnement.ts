/**
 * Abonnement d'une école. LA RÈGLE (alerte 7 jours avant la fin, 7 jours de grâce, puis lecture seule) N'EST PAS
 * ICI : elle n'existe que dans la base (`situation_abonnement`, bloc v1.20 de 05-migrations.sql), qui refuse
 * elle-même les écritures d'une école en lecture seule. L'application lit `abonnement_ecole()` et affiche ce
 * que la base répond : l'écran ne peut donc pas dire autre chose que ce qui est réellement bloqué.
 */
import { isDateValide } from "@/lib/metier/dates";

export type EtatAbonnement = "normal" | "alerte" | "grace" | "lecture_seule";

const ETATS: readonly string[] = ["normal", "alerte", "grace", "lecture_seule"];

/** Message du refus d'écriture, identique à celui que lève la base (FJ403) */
export const MESSAGE_LECTURE_SEULE =
  "Abonnement expiré ou suspendu : l'Espace École est en lecture seule. Contactez FayJàng.";

export interface SituationAbonnement {
  etat: EtatAbonnement;
  /** Dernier jour de l'essai ou de l'abonnement (YYYY-MM-DD), null si aucune date ne s'applique */
  fin: string | null;
  /** Dernier jour du délai de grâce, null sans date de fin */
  finGrace: string | null;
  /** Jours avant la fin (0 le jour même, négatif après), null sans date de fin */
  joursRestants: number | null;
}

const estDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Lit la réponse de `abonnement_ecole()`. null si elle est absente ou mal formée : l'appelant n'affiche rien de faux */
export function lireSituationAbonnement(brut: unknown): SituationAbonnement | null {
  if (!brut || typeof brut !== "object") return null;
  const s = brut as Record<string, unknown>;
  if (typeof s.etat !== "string" || !ETATS.includes(s.etat)) return null;
  return {
    etat: s.etat as EtatAbonnement,
    fin: estDate(s.fin) ? s.fin : null,
    finGrace: estDate(s.fin_grace) ? s.fin_grace : null,
    joursRestants: typeof s.jours_restants === "number" && Number.isInteger(s.jours_restants) ? s.jours_restants : null,
  };
}

/** Une école écrit (encaisse, inscrit, modifie) tant qu'elle n'est pas en lecture seule */
export function peutEcrire(etat: EtatAbonnement): boolean {
  return etat !== "lecture_seule";
}

/** Message de /admin quand le statut « Actif » est enregistré sans date de fin */
export const DATE_FIN_ACTIF_MANQUANTE = "Indiquez la date de fin pour le statut Actif.";

/**
 * Contrôle de /admin avant d'enregistrer un abonnement : « Actif » exige une date de fin valide (sans elle, la base
 * laisserait l'école en état normal pour toujours). Les autres statuts acceptent une date vide. null si tout va bien.
 */
export function controlerAbonnementAdmin(statut: string, abonnementFin: string): string | null {
  return statut === "actif" && !isDateValide(abonnementFin) ? DATE_FIN_ACTIF_MANQUANTE : null;
}
