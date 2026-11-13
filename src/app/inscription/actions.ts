"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/serveur/supabase/admin";
import { createEcoleSession, hashCode } from "@/serveur/ecole-session";
import { anneeScolaireDe } from "@/lib/dates";
import { todayDakar } from "@/lib/config";
import { ipVisiteur } from "@/serveur/ip";
import { slugifier, validerCreationEcole } from "@/lib/creation-ecole";

const ECHEC = "Création du compte impossible pour le moment, réessayez.";

/**
 * Ouverture d'un compte école (essai gratuit). Client admin : l'école n'existe pas encore,
 * aucun JWT ne peut porter son ecole_id. Limite : 5 inscriptions par IP et par 15 minutes.
 * École, accès et compte directeur sont créés par la fonction SQL creer_ecole en une seule transaction (D11) :
 * jamais d'école à moitié créée. La session n'est ouverte qu'après son succès.
 */
export async function inscrireEcoleAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  // Champ piège invisible : un robot le remplit, un humain non
  if (String(formData.get("site") || "")) return { error: "Inscription impossible." };

  const v = validerCreationEcole({
    nom: formData.get("nom"),
    ville: formData.get("ville"),
    responsable: formData.get("responsable"),
    email: formData.get("email"),
    telephone: formData.get("telephone"),
    code: formData.get("code"),
  });
  if (!v.ok) return { error: v.message };
  const { nom, ville, responsable, email, telephone, code } = v.valeurs;

  const supabase = createAdminClient();
  const cleIp = `inscription:${(await ipVisiteur()) ?? "inconnue"}`;
  const { error: erreurLimite } = await (supabase as any).rpc("controler_tentatives", { p_cle: cleIp });
  if (erreurLimite) return { error: "Trop d'inscriptions depuis cette connexion. Réessayez dans 15 minutes." };
  await (supabase as any).rpc("noter_echec_plafonne", { p_cle: cleIp, p_seuil: 5 });

  // Un e-mail = un seul compte dans tout FayJàng (D09) : vérifié par creer_ecole, sous verrou (FJ422 email_pris)
  const { data, error } = await (supabase as any).rpc("creer_ecole", {
    p_nom: nom,
    p_slug_base: slugifier(nom),
    p_ville: ville,
    p_responsable: responsable,
    p_email: email,
    p_telephone: telephone,
    p_annee_scolaire: anneeScolaireDe(todayDakar()),
    p_code_hash: hashCode(code),
  });
  if (error) {
    if (error.code === "FJ422" && error.details === "email_pris") {
      return { error: "Un compte existe déjà avec cet e-mail : connectez-vous à l'Espace École." };
    }
    console.error("[inscription] création de l'école :", error.code ?? "erreur");
    return { error: ECHEC };
  }
  const utilisateurId = (data as { utilisateur_id?: unknown } | null)?.utilisateur_id;
  if (typeof utilisateurId !== "string") {
    console.error("[inscription] création de l'école : réponse inattendue");
    return { error: ECHEC };
  }

  await createEcoleSession(utilisateurId);
  redirect("/ecole?bienvenue=1");
}
