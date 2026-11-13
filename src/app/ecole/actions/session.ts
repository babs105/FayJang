"use server";

import { redirect } from "next/navigation";
import { echangerUtilisateurEcole, TropDeTentativesError, type UtilisateurConnecte } from "@/serveur/supabase/server";
import { createEcoleSession, destroyEcoleSession } from "@/serveur/ecole-session";
import { MOT_DE_PASSE_MAX, normaliserEmail } from "@/lib/mot-de-passe";

const IDENTIFIANTS_INCORRECTS = "E-mail ou mot de passe incorrect.";

export async function loginEcoleAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const saisie = String(formData.get("email") || "").trim();
  const motDePasse = String(formData.get("mot_de_passe") || "").slice(0, MOT_DE_PASSE_MAX);
  if (!saisie || !motDePasse) return { error: "Renseignez votre e-mail et votre mot de passe." };
  // Plus de connexion par l'identifiant court de l'école (décision D09 du 2026-11-12)
  const email = normaliserEmail(saisie);
  if (!email) return { error: "Connectez-vous avec votre adresse e-mail (l'identifiant de l'école n'est plus accepté)." };

  let utilisateur: UtilisateurConnecte | null;
  try {
    utilisateur = await echangerUtilisateurEcole(email, motDePasse);
  } catch (err) {
    if (err instanceof TropDeTentativesError) return { error: err.message };
    console.error("[ecole/login] échange impossible");
    return { error: "Connexion impossible pour le moment, réessayez." };
  }
  if (!utilisateur) return { error: IDENTIFIANTS_INCORRECTS };

  await createEcoleSession(utilisateur.utilisateurId);
  redirect("/ecole");
}

export async function logoutEcoleAction(): Promise<void> {
  await destroyEcoleSession();
  redirect("/ecole/login");
}
