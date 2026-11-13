"use server";

import { hashCode } from "@/lib/ecole-session";
import { erreurMotDePasse } from "@/lib/mot-de-passe";
import { estUuid } from "@/lib/saisie";
import type { EcoleAdmin } from "@/lib/admin-ecoles";
import { SESSION_EXPIREE, chargerEcoles, clientAdmin, majEcole, type ResultatAdmin } from "./_commun";

/** Liste des écoles avec leurs totaux et leur état d'abonnement */
export async function listerEcoles(): Promise<ResultatAdmin<{ ecoles: EcoleAdmin[]; totauxDisponibles: boolean }>> {
  const supabase = await clientAdmin();
  if (!supabase) return { success: false, message: SESSION_EXPIREE };
  try {
    return { success: true, data: await chargerEcoles(supabase) };
  } catch (err) {
    console.error("[admin] liste des écoles :", (err as { code?: string })?.code ?? "erreur");
    return { success: false, message: "Lecture des écoles impossible, rechargez la page." };
  }
}

/** Fiche d'une école (mêmes données que la liste) */
export async function voirEcole(ecoleId: string): Promise<ResultatAdmin<{ ecole: EcoleAdmin; totauxDisponibles: boolean }>> {
  if (!estUuid(ecoleId)) return { success: false, message: "École introuvable." };
  const liste = await listerEcoles();
  if (!liste.success || !liste.data) return { success: false, message: liste.message };
  const ecole = liste.data.ecoles.find((e) => e.id === ecoleId);
  if (!ecole) return { success: false, message: "École introuvable." };
  return { success: true, data: { ecole, totauxDisponibles: liste.data.totauxDisponibles } };
}

/** Désactive une école : la base refuse alors toute connexion de l'école et tout lien parent (echanger_*) */
export async function suspendreEcole(ecoleId: string): Promise<ResultatAdmin> {
  const supabase = await clientAdmin();
  if (!supabase) return { success: false, message: SESSION_EXPIREE };
  if (!estUuid(ecoleId)) return { success: false, message: "École introuvable." };
  return majEcole(supabase, ecoleId, { is_active: false }, "suspension de l'école", "École désactivée : ni l'école ni les parents ne peuvent plus s'y connecter.");
}

export async function reactiverEcole(ecoleId: string): Promise<ResultatAdmin> {
  const supabase = await clientAdmin();
  if (!supabase) return { success: false, message: SESSION_EXPIREE };
  if (!estUuid(ecoleId)) return { success: false, message: "École introuvable." };
  return majEcole(supabase, ecoleId, { is_active: true }, "réactivation de l'école", "École réactivée.");
}

/**
 * Réinitialise le mot de passe du directeur d'une école (D09, tranche 6 : oubli du directeur → FayJàng).
 * La fonction SQL n'est exécutable que par le client admin ; elle coupe la session du directeur et renvoie son
 * e-mail de connexion. Le mot de passe provisoire n'est ni journalisé ni renvoyé.
 */
export async function reinitialiserMotDePasseDirecteur(ecoleId: string, nouveau: string): Promise<ResultatAdmin> {
  const supabase = await clientAdmin();
  if (!supabase) return { success: false, message: SESSION_EXPIREE };
  if (!estUuid(ecoleId)) return { success: false, message: "École introuvable." };
  const refus = erreurMotDePasse(String(nouveau ?? ""));
  if (refus) return { success: false, message: refus };

  const { data, error } = await (supabase as any).rpc("reinitialiser_mot_de_passe_directeur", {
    p_ecole_id: ecoleId,
    p_nouveau_hash: hashCode(nouveau),
  });
  if (error) {
    console.error("[admin] mot de passe directeur :", error.code);
    return { success: false, message: error.code === "FJ404" ? "Aucun compte directeur pour cette école." : "Réinitialisation impossible." };
  }
  return { success: true, message: `Mot de passe réinitialisé : le directeur se connecte avec ${String(data)} et le nouveau mot de passe.` };
}
