"use server";

import { classeurAdmin } from "@/lib/documents/export-excel";
import { todayDakar } from "@/lib/metier/dates";
import { ecolesEnRetard as filtrerEnRetard, statsGlobales as calculerStats } from "@/lib/metier/admin-ecoles";
import { listerEcoles } from "./ecoles";
import type { ResultatAdmin } from "@/types/admin";
import type { EcoleAdmin, StatsGlobales } from "@/types/admin";

/** Chiffres du tableau de bord (toutes les écoles) */
export async function statsGlobales(): Promise<ResultatAdmin<{ stats: StatsGlobales; totauxDisponibles: boolean; enRetard: EcoleAdmin[] }>> {
  const liste = await listerEcoles();
  if (!liste.success || !liste.data) return { success: false, message: liste.message };
  const { ecoles, totauxDisponibles } = liste.data;
  return { success: true, data: { stats: calculerStats(ecoles), totauxDisponibles, enRetard: filtrerEnRetard(ecoles) } };
}

/** Écoles dont la fin d'essai ou d'abonnement est dépassée (délai de grâce ou lecture seule) */
export async function ecolesEnRetard(): Promise<ResultatAdmin<EcoleAdmin[]>> {
  const liste = await listerEcoles();
  if (!liste.success || !liste.data) return { success: false, message: liste.message };
  return { success: true, data: filtrerEnRetard(liste.data.ecoles) };
}

/** Export Excel de toutes les écoles, renvoyé en base64 (le navigateur en fait un fichier) */
export async function exportAdmin(): Promise<ResultatAdmin<{ nom: string; base64: string }>> {
  const liste = await listerEcoles();
  if (!liste.success || !liste.data) return { success: false, message: liste.message };
  if (!liste.data.totauxDisponibles) return { success: false, message: "Totaux indisponibles : export annulé pour ne pas donner de chiffres faux. Réessayez." };

  const tampon = await classeurAdmin(liste.data.ecoles);
  return { success: true, data: { nom: `fayjang-ecoles-${todayDakar()}.xlsx`, base64: Buffer.from(tampon).toString("base64") } };
}
