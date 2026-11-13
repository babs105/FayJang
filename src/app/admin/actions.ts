"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminSession, destroyAdminSession, isAdmin, isAdminConfigure, verifyAdminCode } from "@/lib/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDateValide } from "@/lib/dates";
import { controlerAbonnementAdmin } from "@/lib/abonnement";
import { hashCode } from "@/lib/ecole-session";
import { erreurMotDePasse } from "@/lib/mot-de-passe";
import { estUuid } from "@/lib/saisie";
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
  const refus = controlerAbonnementAdmin(champs.statut_abonnement, champs.abonnement_fin);
  if (refus) return { success: false, message: refus };

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

/**
 * Réinitialise le mot de passe du directeur d'une école (D09, tranche 6 : oubli du directeur → FayJàng).
 * La fonction SQL n'est exécutable que par le client admin ; elle coupe la session du directeur et renvoie son
 * e-mail de connexion. Le mot de passe provisoire n'est ni journalisé ni renvoyé.
 */
export async function reinitialiserMotDePasseDirecteur(ecoleId: string, nouveau: string): Promise<{ success: boolean; message?: string }> {
  if (!(await isAdmin())) return { success: false, message: "Session expirée." };
  if (!estUuid(ecoleId)) return { success: false, message: "École introuvable." };
  const refus = erreurMotDePasse(String(nouveau ?? ""));
  if (refus) return { success: false, message: refus };

  const { data, error } = await (createAdminClient() as any).rpc("reinitialiser_mot_de_passe_directeur", {
    p_ecole_id: ecoleId,
    p_nouveau_hash: hashCode(nouveau),
  });
  if (error) {
    console.error("[admin] mot de passe directeur :", error.code);
    return { success: false, message: error.code === "FJ404" ? "Aucun compte directeur pour cette école." : "Réinitialisation impossible." };
  }
  return { success: true, message: `Mot de passe réinitialisé : le directeur se connecte avec ${String(data)} et le nouveau mot de passe.` };
}
