"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminSession, destroyAdminSession, isAdmin, isAdminConfigure, verifyAdminCode } from "@/lib/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDateValide } from "@/lib/dates";
import type { PlanId, StatutAbonnement } from "@/types/database";

export async function loginAdminAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  if (!isAdminConfigure()) return { error: "Console non configurée (SUPERADMIN_CODE)." };
  const supabase = createAdminClient();
  // Même compteur que les autres connexions : 5 échecs en 15 minutes bloquent la console 15 minutes
  const { error: bloque } = await (supabase as any).rpc("controler_tentatives", { p_cle: "admin" });
  if (bloque) return { error: "Trop de tentatives. Réessayez dans 15 minutes." };

  if (!verifyAdminCode(String(formData.get("code") || ""))) {
    await (supabase as any).rpc("noter_echec_plafonne", { p_cle: "admin", p_seuil: 5 });
    return { error: "Code incorrect." };
  }
  await (supabase as any).rpc("effacer_tentatives", { p_cle: "admin" });
  await createAdminSession();
  redirect("/admin");
}

export async function logoutAdminAction(): Promise<void> {
  await destroyAdminSession();
  redirect("/admin/login");
}

export async function modifierAbonnement(
  ecoleId: string,
  champs: { plan: PlanId; statut_abonnement: StatutAbonnement; abonnement_fin: string; is_active: boolean }
): Promise<{ success: boolean; message?: string }> {
  if (!(await isAdmin())) return { success: false, message: "Session expirée." };
  if (!["essai", "standard", "premium"].includes(champs.plan)) return { success: false, message: "Plan inconnu." };
  if (!["essai", "actif", "expire", "suspendu"].includes(champs.statut_abonnement)) return { success: false, message: "Statut inconnu." };

  const { error } = await createAdminClient()
    .from("ecoles")
    .update({
      plan: champs.plan,
      statut_abonnement: champs.statut_abonnement,
      abonnement_fin: isDateValide(champs.abonnement_fin) ? champs.abonnement_fin : null,
      is_active: champs.is_active,
    })
    .eq("id", ecoleId);
  if (error) {
    console.error("[admin] abonnement :", error.code);
    return { success: false, message: "Enregistrement impossible." };
  }
  revalidatePath("/admin");
  return { success: true, message: "Abonnement mis à jour." };
}
