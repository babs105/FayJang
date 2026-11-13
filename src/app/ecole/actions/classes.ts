"use server";

import { revalidatePath } from "next/cache";
import { messageErreur } from "@/lib/securite/erreurs";
import { NIVEAUX } from "@/lib/metier/libelles";
import { lireArticles } from "@/lib/metier/classe-catalogue";
import { estUuid, montant, texte } from "@/lib/validation/saisie";
import type { Niveau } from "@/types/database";
import { refusDroit, sessionEcriture, type Resultat } from "./_commun";
import type { SaisieArticle } from "@/types/metier";

export interface SaisieClasse {
  id?: string;
  nom: string;
  niveau: string;
  frais_inscription: string | number;
  mensualite: string | number;
  /** Vide = même montant que la mensualité */
  mensualite_dernier_mois?: string | number;
  articles?: SaisieArticle[];
}

export async function enregistrerClasse(saisie: SaisieClasse): Promise<Resultat> {
  const s = await sessionEcriture();
  if (typeof s === "string") return { success: false, message: s };
  const refus = refusDroit(s, "classes");
  if (refus) return { success: false, message: refus };

  const nom = texte(saisie.nom, 40);
  const niveau = saisie.niveau as Niveau;
  const frais = montant(saisie.frais_inscription);
  const mensualite = montant(saisie.mensualite);
  if (nom.length < 1) return { success: false, message: "Indiquez le nom de la classe (ex : CM2 A)." };
  if (!NIVEAUX.includes(niveau)) return { success: false, message: "Niveau inconnu." };
  if (frais === null || mensualite === null) return { success: false, message: "Montants invalides (en FCFA, sans décimales)." };
  const dernierSaisi = String(saisie.mensualite_dernier_mois ?? "").trim();
  const dernier = dernierSaisi === "" ? null : montant(dernierSaisi);
  if (dernierSaisi !== "" && dernier === null) return { success: false, message: "Mensualité du dernier mois invalide." };
  const articles = lireArticles(saisie.articles);
  if (typeof articles === "string") return { success: false, message: articles };

  if (saisie.id && !estUuid(saisie.id)) return { success: false, message: "Classe introuvable." };

  // Classe et catalogue en une seule transaction (bloc v1.9) : un échec n'écrit rien. L'école vient du JWT ;
  // une ligne gardée garde son id, donc le lien avec les élèves déjà inscrits (qui conservent leur copie et leur prix).
  // Catalogue absent de la saisie : il n'est pas touché.
  try {
    const { error } = await s.supabase.rpc("enregistrer_classe", {
      p_classe_id: saisie.id ?? null,
      p_nom: nom,
      p_niveau: niveau,
      p_frais_inscription: frais,
      p_mensualite: mensualite,
      p_mensualite_dernier_mois: dernier,
      p_articles: saisie.articles ? articles : null,
    });
    if (error) throw error;
  } catch (err) {
    return { success: false, message: messageErreur("classes", err, undefined, "Une classe porte déjà ce nom cette année.") };
  }
  revalidatePath("/ecole");
  return { success: true, message: saisie.id ? "Classe mise à jour. Les élèves déjà inscrits gardent leur tarif." : "Classe créée." };
}

export async function archiverClasse(id: string, actif: boolean): Promise<Resultat> {
  const s = await sessionEcriture();
  if (typeof s === "string") return { success: false, message: s };
  const refus = refusDroit(s, "classes");
  if (refus) return { success: false, message: refus };
  const { error } = await s.supabase.from("classes").update({ is_active: actif }).eq("id", id).eq("ecole_id", s.ecoleId);
  if (error) return { success: false, message: messageErreur("classes", error) };
  revalidatePath("/ecole");
  return { success: true };
}
