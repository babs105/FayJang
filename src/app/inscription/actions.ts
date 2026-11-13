"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createEcoleSession, hashCode } from "@/lib/ecole-session";
import { anneeScolaireDe } from "@/lib/dates";
import { todayDakar } from "@/lib/config";
import { ipVisiteur } from "@/lib/ip";
import { normaliserTelephone } from "@/lib/telephone";
import { erreurMotDePasse } from "@/lib/mot-de-passe";

/** Identifiant de connexion lisible : « Cours Sainte-Marie de Hann » → « cours-sainte-marie-de-hann » */
function slugifier(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "ecole";
}

/**
 * Ouverture d'un compte école (essai gratuit). Client admin : l'école n'existe pas encore,
 * aucun JWT ne peut porter son ecole_id. Limite : 5 inscriptions par IP et par 15 minutes.
 */
export async function inscrireEcoleAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const nom = String(formData.get("nom") || "").trim().slice(0, 100);
  const ville = String(formData.get("ville") || "").trim().slice(0, 60);
  const responsable = String(formData.get("responsable") || "").trim().slice(0, 80);
  const email = String(formData.get("email") || "").trim().toLowerCase().slice(0, 120);
  const telephone = normaliserTelephone(String(formData.get("telephone") || ""));
  const code = String(formData.get("code") || "");
  // Champ piège invisible : un robot le remplit, un humain non
  if (String(formData.get("site") || "")) return { error: "Inscription impossible." };

  if (nom.length < 3) return { error: "Indiquez le nom de l'école." };
  if (!responsable) return { error: "Indiquez le nom du responsable." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: "Adresse e-mail invalide." };
  if (!telephone || !/^\+\d{9,15}$/.test(telephone)) return { error: "Numéro de téléphone invalide (ex : 77 123 45 67)." };
  const refusMotDePasse = erreurMotDePasse(code);
  if (refusMotDePasse) return { error: refusMotDePasse };

  const supabase = createAdminClient();
  const cleIp = `inscription:${(await ipVisiteur()) ?? "inconnue"}`;
  const { error: erreurLimite } = await (supabase as any).rpc("controler_tentatives", { p_cle: cleIp });
  if (erreurLimite) return { error: "Trop d'inscriptions depuis cette connexion. Réessayez dans 15 minutes." };
  await (supabase as any).rpc("noter_echec_plafonne", { p_cle: cleIp, p_seuil: 5 });

  // Un e-mail = un seul compte dans tout FayJàng (D09) : ni une autre école, ni un utilisateur d'une école
  const [{ data: emailPris }, { data: utilisateurPris }] = await Promise.all([
    // ilike pour les anciens e-mails en casse mixte ; % et _ échappés (sinon jokers : oracle sur un domaine)
    supabase.from("ecoles").select("id").ilike("email_contact", email.replace(/[\\%_]/g, "\\$&")).maybeSingle(),
    supabase.from("utilisateurs_ecole").select("id").eq("email", email).maybeSingle(),
  ]);
  if (emailPris || utilisateurPris) return { error: "Un compte existe déjà avec cet e-mail : connectez-vous à l'Espace École." };

  const base = slugifier(nom);
  const { data: existants } = await supabase.from("ecoles").select("slug").like("slug", `${base}%`);
  const pris = new Set((existants ?? []).map((e) => e.slug));
  let slug = base;
  for (let i = 2; pris.has(slug); i++) slug = `${base}-${i}`;

  const { data: ecole, error } = await supabase
    .from("ecoles")
    .insert({
      nom,
      slug,
      ville: ville || null,
      responsable_nom: responsable,
      email_contact: email,
      telephone_contact: telephone,
      annee_scolaire: anneeScolaireDe(todayDakar()),
    })
    .select("id")
    .single();
  if (error || !ecole) {
    console.error("[inscription] création de l'école :", error?.code ?? "erreur");
    return { error: "Création du compte impossible pour le moment, réessayez." };
  }

  const { error: erreurAcces } = await supabase.from("acces_ecole").insert({ ecole_id: ecole.id, code_hash: hashCode(code) });
  if (erreurAcces) {
    console.error("[inscription] code d'accès :", erreurAcces.code ?? "erreur");
    await supabase.from("ecoles").delete().eq("id", ecole.id);
    return { error: "Création du compte impossible pour le moment, réessayez." };
  }

  // Compte du directeur (D09) : c'est lui qui se connecte. acces_ecole reste rempli pour un retour arrière.
  const { data: directeur, error: erreurDirecteur } = await supabase
    .from("utilisateurs_ecole")
    .insert({ ecole_id: ecole.id, nom: responsable, email, code_hash: hashCode(code), role: "directeur" })
    .select("id")
    .single();
  if (erreurDirecteur || !directeur) {
    console.error("[inscription] compte directeur :", erreurDirecteur?.code ?? "erreur");
    await supabase.from("ecoles").delete().eq("id", ecole.id);
    return { error: "Création du compte impossible pour le moment, réessayez." };
  }

  await createEcoleSession(directeur.id);
  redirect("/ecole?bienvenue=1");
}
