"use server";

import { revalidatePath } from "next/cache";
import { getSessionEcole, hashCode } from "@/lib/securite/ecole-session";
import { createClientEcole } from "@/lib/supabase/server";
import { messageErreur } from "@/lib/securite/erreurs";
import { erreurMotDePasse, MOT_DE_PASSE_MAX } from "@/lib/validation/mot-de-passe";
import { lireSaisieCaissier } from "@/lib/validation/utilisateurs";
import { estUuid } from "@/lib/validation/saisie";
import { peutFaire } from "@/lib/securite/droits";
import { SESSION_EXPIREE, session, type Resultat } from "./_commun";

/**
 * Gestion des caissiers par le directeur (D09, tranche 3). Le rôle est contrôlé ici ET en base
 * (exiger_directeur, bloc v1.23) : un caissier qui appellerait ces actions est refusé deux fois.
 */

const RESERVE_DIRECTEUR = "Réservé au directeur de l'école.";

async function sessionDirecteur() {
  const utilisateur = await getSessionEcole();
  if (!utilisateur) return SESSION_EXPIREE;
  if (!peutFaire(utilisateur.role, "utilisateurs")) return RESERVE_DIRECTEUR;
  return { supabase: createClientEcole(utilisateur) };
}

export async function creerCaissier(saisie: { nom: string; email: string; motDePasse: string }): Promise<Resultat> {
  const s = await sessionDirecteur();
  if (typeof s === "string") return { success: false, message: s };
  const lu = lireSaisieCaissier(saisie ?? {});
  if (typeof lu === "string") return { success: false, message: lu };

  const { error } = await (s.supabase as any).rpc("creer_utilisateur_ecole", {
    p_nom: lu.nom,
    p_email: lu.email,
    p_code_hash: hashCode(lu.motDePasse),
  });
  if (error) return { success: false, message: messageErreur("utilisateurs", error, undefined, "Cet e-mail est déjà utilisé par un compte FayJàng.") };
  revalidatePath("/ecole");
  return { success: true, message: `Caissier ${lu.nom} créé : il se connecte avec ${lu.email} et le mot de passe provisoire.` };
}

export async function changerStatutUtilisateur(id: string, actif: boolean): Promise<Resultat> {
  const s = await sessionDirecteur();
  if (typeof s === "string") return { success: false, message: s };
  if (!estUuid(id) || typeof actif !== "boolean") return { success: false, message: "Utilisateur introuvable." };

  const { error } = await (s.supabase as any).rpc("changer_statut_utilisateur", { p_id: id, p_actif: actif });
  if (error) return { success: false, message: messageErreur("utilisateurs", error) };
  revalidatePath("/ecole");
  return { success: true, message: actif ? "Caissier réactivé : il peut se reconnecter." : "Caissier désactivé : sa session est coupée." };
}

export async function reinitialiserMotDePasseUtilisateur(id: string, nouveau: string): Promise<Resultat> {
  const s = await sessionDirecteur();
  if (typeof s === "string") return { success: false, message: s };
  if (!estUuid(id)) return { success: false, message: "Utilisateur introuvable." };
  const refus = erreurMotDePasse(String(nouveau ?? ""));
  if (refus) return { success: false, message: refus };

  const { error } = await (s.supabase as any).rpc("reinitialiser_mot_de_passe_utilisateur", {
    p_id: id,
    p_nouveau_hash: hashCode(nouveau),
  });
  if (error) return { success: false, message: messageErreur("utilisateurs", error) };
  revalidatePath("/ecole");
  return { success: true, message: "Mot de passe réinitialisé : sa session est coupée, communiquez-lui le nouveau." };
}

/** Changement de son propre mot de passe (directeur ou caissier) ; permis en lecture seule (décision F21) */
export async function changerMonMotDePasse(ancien: string, nouveau: string): Promise<Resultat> {
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };
  const refus = erreurMotDePasse(String(nouveau ?? ""));
  if (refus) return { success: false, message: refus };
  const { data, error } = await (s.supabase as any).rpc("changer_mon_mot_de_passe", {
    p_ancien_hash: hashCode(String(ancien ?? "").slice(0, MOT_DE_PASSE_MAX)),
    p_nouveau_hash: hashCode(nouveau),
  });
  if (error) return { success: false, message: messageErreur("mot-de-passe", error) };
  if (data !== true) return { success: false, message: "Mot de passe actuel incorrect." };
  return { success: true, message: "Mot de passe changé : reconnectez-vous avec le nouveau mot de passe." };
}
