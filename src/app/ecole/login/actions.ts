"use server";

import { redirect } from "next/navigation";
import { echangerAccesEcole, TropDeTentativesError } from "@/lib/supabase/server";
import { createEcoleSession, destroyEcoleSession } from "@/lib/ecole-session";

export async function loginEcoleAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const identifiant = String(formData.get("identifiant") || "").trim().toLowerCase().slice(0, 100);
  const code = String(formData.get("code") || "").slice(0, 100);
  if (!identifiant || !code) return { error: "Renseignez l'identifiant (ou l'e-mail) et le code d'accès." };

  let ecoleId: string | null;
  try {
    ecoleId = await echangerAccesEcole(identifiant, code);
  } catch (err) {
    if (err instanceof TropDeTentativesError) return { error: err.message };
    console.error("[ecole/login] échange impossible");
    return { error: "Connexion impossible pour le moment, réessayez." };
  }
  if (!ecoleId) return { error: "Identifiant ou code d'accès incorrect." };

  await createEcoleSession(ecoleId);
  redirect("/ecole");
}

export async function logoutEcoleAction(): Promise<void> {
  await destroyEcoleSession();
  redirect("/ecole/login");
}
