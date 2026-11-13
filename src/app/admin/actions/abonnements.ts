"use server";

import { isDateValide, todayDakar } from "@/lib/metier/dates";
import { controlerAbonnementAdmin } from "@/lib/metier/abonnement";
import { estUuid } from "@/lib/validation/saisie";
import type { PlanId, StatutAbonnement } from "@/types/database";
import { SESSION_EXPIREE, clientAdmin, majEcole, type ResultatAdmin } from "./_commun";

const PLANS: PlanId[] = ["essai", "standard", "premium"];
const STATUTS: StatutAbonnement[] = ["essai", "actif", "expire", "suspendu"];

/** L'école a payé : statut « Actif » jusqu'à la date choisie (aujourd'hui ou plus tard) */
export async function prolongerAbonnement(ecoleId: string, fin: string): Promise<ResultatAdmin> {
  const supabase = await clientAdmin();
  if (!supabase) return { success: false, message: SESSION_EXPIREE };
  if (!estUuid(ecoleId)) return { success: false, message: "École introuvable." };
  if (!isDateValide(fin)) return { success: false, message: "Indiquez la nouvelle date de fin." };
  if (fin < todayDakar()) return { success: false, message: "La nouvelle date de fin est déjà passée." };
  return majEcole(supabase, ecoleId, { statut_abonnement: "actif", abonnement_fin: fin }, "prolongation", `Abonnement actif jusqu'au ${fin.split("-").reverse().join("/")}.`);
}

/** Suspend l'abonnement : l'école passe en lecture seule tout de suite, sans délai de grâce */
export async function suspendreAbonnement(ecoleId: string): Promise<ResultatAdmin> {
  const supabase = await clientAdmin();
  if (!supabase) return { success: false, message: SESSION_EXPIREE };
  if (!estUuid(ecoleId)) return { success: false, message: "École introuvable." };
  return majEcole(supabase, ecoleId, { statut_abonnement: "suspendu" }, "suspension de l'abonnement", "Abonnement suspendu : l'école est en lecture seule.");
}

export async function changerOffre(ecoleId: string, plan: PlanId): Promise<ResultatAdmin> {
  const supabase = await clientAdmin();
  if (!supabase) return { success: false, message: SESSION_EXPIREE };
  if (!estUuid(ecoleId)) return { success: false, message: "École introuvable." };
  if (!PLANS.includes(plan)) return { success: false, message: "Offre inconnue." };
  return majEcole(supabase, ecoleId, { plan }, "offre", "Offre mise à jour.");
}

/** Correction manuelle complète (offre, statut, date de fin, école active), depuis la fiche d'une école */
export async function modifierAbonnement(
  ecoleId: string,
  champs: { plan: PlanId; statut_abonnement: StatutAbonnement; abonnement_fin: string; is_active: boolean }
): Promise<ResultatAdmin> {
  const supabase = await clientAdmin();
  if (!supabase) return { success: false, message: SESSION_EXPIREE };
  if (!estUuid(ecoleId)) return { success: false, message: "École introuvable." };
  if (!champs || typeof champs !== "object") return { success: false, message: "Saisie invalide." };
  if (!PLANS.includes(champs.plan)) return { success: false, message: "Offre inconnue." };
  if (!STATUTS.includes(champs.statut_abonnement)) return { success: false, message: "Statut inconnu." };
  if (typeof champs.is_active !== "boolean") return { success: false, message: "Valeur « active » invalide." };
  const refus = controlerAbonnementAdmin(champs.statut_abonnement, champs.abonnement_fin);
  if (refus) return { success: false, message: refus };
  return majEcole(
    supabase,
    ecoleId,
    {
      plan: champs.plan,
      statut_abonnement: champs.statut_abonnement,
      abonnement_fin: isDateValide(champs.abonnement_fin) ? champs.abonnement_fin : null,
      is_active: champs.is_active,
    },
    "abonnement",
    "Abonnement mis à jour."
  );
}
