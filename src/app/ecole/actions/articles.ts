"use server";

import { revalidatePath } from "next/cache";
import { moisScolaires } from "@/lib/dates";
import { messageErreur } from "@/lib/erreurs";
import { debutService, lireEcole, moisCourant, sessionEcriture, type Resultat } from "./_commun";

/** Ajoute à un élève un article du catalogue de sa classe (service optionnel pris en cours d'année, tenue en plus) */
export async function ajouterArticleInscription(
  inscriptionId: string,
  articleClasseId: string,
  quantiteSaisie?: string | number
): Promise<Resultat> {
  const s = await sessionEcriture();
  if (typeof s === "string") return { success: false, message: s };
  try {
    const ecole = await lireEcole(s.supabase, s.ecoleId);
    const { data: ins, error: e1 } = await s.supabase
      .from("inscriptions")
      .select("id, classe_id, annee_scolaire, statut")
      .eq("id", inscriptionId)
      .eq("ecole_id", s.ecoleId)
      .maybeSingle();
    if (e1) throw e1;
    if (!ins || ins.statut !== "active") return { success: false, message: "Inscription introuvable ou inactive." };
    const { data: a, error: e2 } = await s.supabase
      .from("articles_classe")
      .select("id, libelle, nature, prix_unitaire, quantite_defaut, obligatoire")
      .eq("id", articleClasseId)
      .eq("classe_id", ins.classe_id)
      .eq("ecole_id", s.ecoleId)
      .maybeSingle();
    if (e2) throw e2;
    if (!a) return { success: false, message: "Article introuvable pour cette classe." };
    const q = a.nature === "mensuel" ? 1 : quantiteSaisie === undefined ? a.quantite_defaut : Number(quantiteSaisie);
    if (!Number.isInteger(q) || q < 1 || q > 99) return { success: false, message: "Quantité invalide." };
    if (a.nature === "mensuel") {
      const { data: actifs } = await s.supabase
        .from("articles_inscription")
        .select("id, mois_fin")
        .eq("inscription_id", ins.id)
        .eq("article_classe_id", a.id)
        .eq("ecole_id", s.ecoleId);
      if ((actifs ?? []).some((x) => !x.mois_fin || x.mois_fin >= moisCourant())) {
        return { success: false, message: `${a.libelle} : service déjà en cours pour cet élève.` };
      }
    }
    const mois = moisScolaires(ins.annee_scolaire, ecole.mois_debut, ecole.nb_mensualites);
    const { error } = await s.supabase.from("articles_inscription").insert({
      ecole_id: s.ecoleId,
      inscription_id: ins.id,
      article_classe_id: a.id,
      libelle: a.libelle,
      nature: a.nature,
      prix_unitaire: a.prix_unitaire,
      quantite: q,
      obligatoire: a.obligatoire,
      mois_debut: a.nature === "mensuel" ? debutService(mois) : null,
    });
    if (error) throw error;
    revalidatePath("/ecole");
    return { success: true, message: a.nature === "mensuel" ? `${a.libelle} ajouté à partir de ce mois.` : `${a.libelle} ajouté.` };
  } catch (err) {
    return { success: false, message: messageErreur("articles", err) };
  }
}

/**
 * Retire un article d'un élève. Sans paiement : il est supprimé. Service mensuel déjà payé : il s'arrête
 * à la fin du mois courant (ou du dernier mois payé). Frais unique déjà payé : refusé (annuler le reçu d'abord).
 */
export async function retirerArticleInscription(id: string): Promise<Resultat> {
  const s = await sessionEcriture();
  if (typeof s === "string") return { success: false, message: s };
  try {
    const { data: a, error: e1 } = await s.supabase
      .from("articles_inscription")
      .select("id, libelle, nature, mois_debut")
      .eq("id", id)
      .eq("ecole_id", s.ecoleId)
      .maybeSingle();
    if (e1) throw e1;
    if (!a) return { success: false, message: "Article introuvable." };
    const { data: payes, error: e2 } = await s.supabase.from("paiements").select("mois, annule").eq("article_id", id).eq("ecole_id", s.ecoleId);
    if (e2) throw e2;
    if (!payes?.length) {
      const { error } = await s.supabase.from("articles_inscription").delete().eq("id", id).eq("ecole_id", s.ecoleId);
      if (error) throw error;
      revalidatePath("/ecole");
      return { success: true, message: `${a.libelle} retiré.` };
    }
    if (a.nature === "unique") {
      if (payes.some((p) => !p.annule)) {
        return { success: false, message: `${a.libelle} a déjà été payé : annulez le reçu pour le retirer.` };
      }
      // Seuls des reçus annulés : la ligne reste (historique), mais plus rien n'est dû
      const { error } = await s.supabase.from("articles_inscription").update({ quantite: 0 }).eq("id", id).eq("ecole_id", s.ecoleId);
      if (error) throw error;
      revalidatePath("/ecole");
      return { success: true, message: `${a.libelle} retiré.` };
    }
    const dernierPaye = payes.filter((p) => !p.annule && p.mois).map((p) => p.mois!.slice(0, 10)).sort().pop();
    let fin = moisCourant();
    if (dernierPaye && dernierPaye > fin) fin = dernierPaye;
    if (a.mois_debut && fin < a.mois_debut) fin = a.mois_debut;
    const { error } = await s.supabase.from("articles_inscription").update({ mois_fin: fin }).eq("id", id).eq("ecole_id", s.ecoleId);
    if (error) throw error;
    revalidatePath("/ecole");
    return { success: true, message: `${a.libelle} arrêté : plus rien n'est dû après ${fin.slice(5, 7)}/${fin.slice(0, 4)}.` };
  } catch (err) {
    return { success: false, message: messageErreur("articles", err) };
  }
}
