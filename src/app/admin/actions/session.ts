"use server";

import { redirect } from "next/navigation";
import { createAdminSession, destroyAdminSession, isAdminConfigure, verifyAdminCode } from "@/lib/securite/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";

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
