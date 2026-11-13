// Calculs de la console SuperAdmin sur la liste des écoles : statistiques, écoles en retard, lignes de l'export.
// Pur : ni Next.js ni Supabase, la liste est lue par src/app/admin/actions/_commun.ts.
import type { SituationAbonnement } from "@/lib/metier/abonnement";
import { celluleTexte } from "@/lib/documents/export-sur";
import type { Ecole } from "@/types/database";

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

/** Fin de l'essai ou de l'abonnement dépassée (délai de grâce ou lecture seule), d'après l'état calculé par la base */
export function estEnRetard(e: Pick<EcoleAdmin, "abonnement">): boolean {
  return e.abonnement?.etat === "grace" || e.abonnement?.etat === "lecture_seule";
}

export function statsGlobales(ecoles: EcoleAdmin[]): StatsGlobales {
  return {
    ecoles: ecoles.length,
    abonnees: ecoles.filter((e) => e.statut_abonnement === "actif").length,
    enEssai: ecoles.filter((e) => e.statut_abonnement === "essai").length,
    suspendues: ecoles.filter((e) => e.statut_abonnement === "suspendu").length,
    desactivees: ecoles.filter((e) => !e.is_active).length,
    enRetard: ecoles.filter(estEnRetard).length,
    finProche: ecoles.filter((e) => e.abonnement?.etat === "alerte").length,
    eleves: ecoles.reduce((s, e) => s + e.eleves, 0),
    encaisse: ecoles.reduce((s, e) => s + e.encaisse, 0),
  };
}

/** Écoles en retard, la plus ancienne fin d'abord (celles qui ne paient plus depuis le plus longtemps) */
export function ecolesEnRetard(ecoles: EcoleAdmin[]): EcoleAdmin[] {
  return ecoles.filter(estEnRetard).sort((a, b) => (a.abonnement?.fin ?? "").localeCompare(b.abonnement?.fin ?? ""));
}

/** Rubriques de la page Abonnements, dans l'ordre d'urgence */
export const RUBRIQUES_ABONNEMENT = [
  { cle: "lecture_seule", titre: "Lecture seule (expirées ou suspendues)" },
  { cle: "grace", titre: "Délai de grâce" },
  { cle: "alerte", titre: "Fin dans les 7 jours" },
  { cle: "normal", titre: "À jour" },
  { cle: "inconnu", titre: "État inconnu" },
] as const;

export type CleRubrique = (typeof RUBRIQUES_ABONNEMENT)[number]["cle"];

export function rubriqueAbonnement(e: Pick<EcoleAdmin, "abonnement">): CleRubrique {
  return e.abonnement?.etat ?? "inconnu";
}

const LIBELLE_STATUT: Record<string, string> = { essai: "Essai", actif: "Actif", expire: "Expiré", suspendu: "Suspendu" };
const LIBELLE_ETAT: Record<string, string> = {
  normal: "Normal",
  alerte: "Fin proche",
  grace: "Délai de grâce",
  lecture_seule: "Lecture seule",
};

export const ENTETES_EXPORT_ADMIN = [
  "École",
  "Identifiant",
  "Ville",
  "Responsable",
  "E-mail",
  "Téléphone",
  "Année scolaire",
  "Offre",
  "Statut",
  "État",
  "Fin",
  "Active",
  "Élèves",
  "Encaissé (FCFA)",
  "Inscrite le",
] as const;

/** Une ligne de l'export Excel par école ; les textes libres sont neutralisés contre les formules */
export function lignesExportAdmin(ecoles: EcoleAdmin[]): (string | number)[][] {
  return ecoles.map((e) => [
    celluleTexte(e.nom),
    celluleTexte(e.slug),
    celluleTexte(e.ville),
    celluleTexte(e.responsable_nom),
    celluleTexte(e.email_contact),
    celluleTexte(e.telephone_contact),
    e.annee_scolaire,
    e.plan,
    LIBELLE_STATUT[e.statut_abonnement] ?? e.statut_abonnement,
    e.abonnement ? LIBELLE_ETAT[e.abonnement.etat] : "Inconnu",
    e.abonnement?.fin ?? "",
    e.is_active ? "Oui" : "Non",
    e.eleves,
    e.encaisse,
    e.created_at.slice(0, 10),
  ]);
}
