"use server";

// Fiche d'identité d'un élève : modification (et son parent), suppression d'un élève saisi par erreur
import { revalidatePath } from "next/cache";
import { generateToken, todayDakar } from "@/lib/config";
import { isDateValide } from "@/lib/metier/dates";
import { messageErreur } from "@/lib/securite/erreurs";
import { normaliserTelephone } from "@/lib/validation/telephone";
import { texte } from "@/lib/validation/saisie";
import { DATE_NAISSANCE_FUTURE, sessionEcriture, type Client, type Resultat } from "./_commun";

/** Parent existant (même téléphone dans l'école) ou nouveau parent avec son lien magique (modification d'un élève) */
async function trouverOuCreerParent(
  supabase: Client,
  ecoleId: string,
  nom: string,
  telephone: string
): Promise<string> {
  const { data: existant, error: erreurLecture } = await supabase
    .from("parents")
    .select("id")
    .eq("ecole_id", ecoleId)
    .eq("telephone", telephone)
    .maybeSingle();
  if (erreurLecture) throw erreurLecture;
  if (existant) return existant.id;

  const { data, error } = await supabase
    .from("parents")
    .insert({ ecole_id: ecoleId, nom, telephone, token: generateToken() })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * Supprime un élève saisi par erreur (et ses inscriptions). Refusé s'il a le moindre paiement, même annulé :
 * l'historique financier se conserve, on passe alors l'inscription en « abandon ».
 * Le parent est supprimé aussi s'il n'a plus aucun enfant dans l'école.
 */
export async function supprimerEleve(id: string): Promise<Resultat> {
  const s = await sessionEcriture();
  if (typeof s === "string") return { success: false, message: s };

  try {
    const { data: eleve, error: erreurEleve } = await s.supabase
      .from("eleves")
      .select("id, parent_id")
      .eq("id", id)
      .eq("ecole_id", s.ecoleId)
      .maybeSingle();
    if (erreurEleve) throw erreurEleve;
    if (!eleve) return { success: false, message: "Élève introuvable." };

    const { data: inscriptions, error: erreurIns } = await s.supabase
      .from("inscriptions")
      .select("id")
      .eq("eleve_id", id)
      .eq("ecole_id", s.ecoleId);
    if (erreurIns) throw erreurIns;
    const ids = (inscriptions ?? []).map((i) => i.id);
    if (ids.length) {
      const { count, error } = await s.supabase
        .from("paiements")
        .select("id", { count: "exact", head: true })
        .eq("ecole_id", s.ecoleId)
        .in("inscription_id", ids);
      if (error) throw error;
      if (count) {
        return {
          success: false,
          message: "Cet élève a des paiements enregistrés : il ne peut pas être supprimé. Passez son inscription en « Abandon ».",
        };
      }
    }

    const { error } = await s.supabase.from("eleves").delete().eq("id", id).eq("ecole_id", s.ecoleId);
    if (error) throw error;

    if (eleve.parent_id) {
      const { count } = await s.supabase
        .from("eleves")
        .select("id", { count: "exact", head: true })
        .eq("ecole_id", s.ecoleId)
        .eq("parent_id", eleve.parent_id);
      if (!count) await s.supabase.from("parents").delete().eq("id", eleve.parent_id).eq("ecole_id", s.ecoleId);
    }
  } catch (err) {
    return { success: false, message: messageErreur("eleves", err) };
  }
  revalidatePath("/ecole");
  return { success: true, message: "Élève supprimé." };
}

export async function modifierEleve(
  id: string,
  champs: { prenom: string; nom: string; sexe: string; date_naissance: string; parent_nom: string; parent_telephone: string }
): Promise<Resultat> {
  const s = await sessionEcriture();
  if (typeof s === "string") return { success: false, message: s };
  const prenom = texte(champs.prenom, 60);
  const nom = texte(champs.nom, 60);
  const parentNom = texte(champs.parent_nom, 80);
  const telephone = normaliserTelephone(champs.parent_telephone);
  if (!prenom || !nom) return { success: false, message: "Prénom et nom obligatoires." };
  if (!parentNom || !telephone || !/^\+\d{9,15}$/.test(telephone)) return { success: false, message: "Parent : nom et téléphone valides obligatoires." };
  if (isDateValide(champs.date_naissance) && champs.date_naissance > todayDakar()) return { success: false, message: DATE_NAISSANCE_FUTURE };

  try {
    const parentId = await trouverOuCreerParent(s.supabase, s.ecoleId, parentNom, telephone);
    const { error } = await s.supabase
      .from("eleves")
      .update({
        prenom,
        nom,
        sexe: champs.sexe === "M" || champs.sexe === "F" ? champs.sexe : null,
        date_naissance: isDateValide(champs.date_naissance) ? champs.date_naissance : null,
        parent_id: parentId,
      })
      .eq("id", id)
      .eq("ecole_id", s.ecoleId);
    if (error) throw error;
    // Le nom saisi met aussi à jour la fiche du parent (même téléphone)
    await s.supabase.from("parents").update({ nom: parentNom }).eq("id", parentId).eq("ecole_id", s.ecoleId);
  } catch (err) {
    return { success: false, message: messageErreur("eleves", err) };
  }
  revalidatePath("/ecole");
  return { success: true, message: "Fiche mise à jour." };
}
