"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getEcoleId, hashCode } from "@/lib/ecole-session";
import { createClientEcole } from "@/lib/supabase/server";
import { generateToken, todayDakar } from "@/lib/config";
import { isAnneeScolaireValide, isDateValide, moisScolaires } from "@/lib/dates";
import { messageErreur } from "@/lib/erreurs";
import { MODES_PAIEMENT, NIVEAUX } from "@/lib/libelles";
import { choixALinscription, lignesAEncaisser, situationInscription, verifierReglages } from "@/lib/scolarite";
import { matriculeSuivant } from "@/lib/matricule";
import { normaliserTelephone } from "@/lib/telephone";
import type { ModePaiement, NatureArticle, Niveau, StatutInscription } from "@/types/database";

export interface Resultat<T = undefined> {
  success: boolean;
  message?: string;
  data?: T;
}

const SESSION_EXPIREE = "Session expirée : reconnectez-vous à l'Espace École.";

function texte(valeur: unknown, max = 120): string {
  return String(valeur ?? "").trim().slice(0, max);
}

/** Montant FCFA saisi (« 25 000 », « 25000 ») ; null si invalide */
function montant(valeur: unknown): number | null {
  const n = Number(String(valeur ?? "").replace(/[\s  .]/g, ""));
  return Number.isInteger(n) && n >= 0 && n <= 50_000_000 ? n : null;
}

async function session() {
  const ecoleId = await getEcoleId();
  if (!ecoleId) return null;
  return { ecoleId, supabase: createClientEcole(ecoleId) };
}

async function lireEcole(supabase: ReturnType<typeof createClientEcole>, ecoleId: string) {
  const { data, error } = await supabase
    .from("ecoles")
    .select(
      "id, nom, annee_scolaire, mois_debut, nb_mensualites, jour_echeance, tranches_dernier_mois, mois_debut_tranches, nb_tranches, rang_mois_tranches, premier_mois_a_linscription, dernier_mois_a_linscription"
    )
    .eq("id", ecoleId)
    .single();
  if (error) throw error;
  return data;
}

type Client = ReturnType<typeof createClientEcole>;

const MOBILE_MONEY: ModePaiement[] = ["wave", "orange_money", "free_money"];

/** Mode et référence d'un encaissement ; message d'erreur si invalide */
function lireMode(modeSaisi: unknown, referenceSaisie: unknown): { mode: ModePaiement; reference: string | null } | string {
  const mode = String(modeSaisi || "especes") as ModePaiement;
  if (!MODES_PAIEMENT.includes(mode)) return "Mode de paiement inconnu.";
  const reference = texte(referenceSaisie, 60) || null;
  if (MOBILE_MONEY.includes(mode) && !reference) return "Indiquez la référence de la transaction mobile money.";
  return { mode, reference };
}

/** Premier jour du mois courant à Dakar (YYYY-MM-01) */
function moisCourant(): string {
  return `${todayDakar().slice(0, 7)}-01`;
}

/** Premier mois dû pour un service pris en cours d'année : le mois courant, borné à l'année scolaire */
function debutService(mois: string[]): string {
  const courant = moisCourant();
  if (courant <= mois[0]) return mois[0];
  if (courant >= mois[mois.length - 1]) return mois[mois.length - 1];
  return courant;
}

/** Inscription, paiements et articles d'un élève, puis sa situation recalculée côté serveur */
async function chargerSituation(supabase: Client, ecoleId: string, inscriptionId: string) {
  const ecole = await lireEcole(supabase, ecoleId);
  const { data: ins, error: erreurIns } = await supabase
    .from("inscriptions")
    .select("id, annee_scolaire, frais_inscription, mensualite, mensualite_dernier_mois, reduction_mensuelle, statut, date_depart")
    .eq("id", inscriptionId)
    .eq("ecole_id", ecoleId)
    .maybeSingle();
  if (erreurIns) throw erreurIns;
  if (!ins) return null;
  const [{ data: paiements, error: e1 }, { data: articles, error: e2 }] = await Promise.all([
    supabase.from("paiements").select("type, mois, montant, annule, article_id").eq("inscription_id", ins.id).eq("ecole_id", ecoleId),
    supabase
      .from("articles_inscription")
      .select("id, libelle, nature, prix_unitaire, quantite, obligatoire, mois_debut, mois_fin")
      .eq("inscription_id", ins.id)
      .eq("ecole_id", ecoleId)
      .order("created_at"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const situation = situationInscription(ins, paiements ?? [], ecole, todayDakar(), articles ?? []);
  return { ecole, ins, situation, paiements: paiements ?? [], articles: articles ?? [] };
}

const fcfa = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n)} FCFA`;

// ------------------------------------------------------------------ Classes

export interface SaisieArticle {
  /** Ligne existante du catalogue (mise à jour sur place) ; absent = nouvelle ligne */
  id?: string;
  libelle: string;
  nature: string;
  prix_unitaire: string | number;
  quantite_defaut?: string | number;
  obligatoire: boolean;
}

/** Catalogue saisi pour une classe ; message d'erreur si une ligne est invalide */
function lireArticles(saisis: SaisieArticle[] | undefined) {
  if (saisis !== undefined && !Array.isArray(saisis)) return "Articles invalides.";
  if ((saisis ?? []).length > 30) return "30 articles au plus par classe.";
  const lignes: { id?: string; libelle: string; nature: NatureArticle; prix_unitaire: number; quantite_defaut: number; obligatoire: boolean; ordre: number }[] = [];
  for (const [i, a] of (saisis ?? []).entries()) {
    if (!a || typeof a !== "object") return "Articles invalides.";
    const libelle = texte(a.libelle, 60);
    if (!libelle) continue;
    const nature: NatureArticle = a.nature === "mensuel" ? "mensuel" : "unique";
    const prix = montant(a.prix_unitaire);
    const quantite = nature === "mensuel" ? 1 : Number(a.quantite_defaut ?? 1);
    if (prix === null) return `Prix invalide pour « ${libelle} ».`;
    if (!Number.isInteger(quantite) || quantite < 0 || quantite > 99) return `Quantité invalide pour « ${libelle} ».`;
    lignes.push({ id: a.id || undefined, libelle, nature, prix_unitaire: prix, quantite_defaut: quantite, obligatoire: a.obligatoire === true, ordre: i });
  }
  return lignes;
}

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
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };

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

  try {
    let classeId = saisie.id;
    const champs = { nom, niveau, frais_inscription: frais, mensualite, mensualite_dernier_mois: dernier };
    if (classeId) {
      const { data, error } = await s.supabase.from("classes").update(champs).eq("id", classeId).eq("ecole_id", s.ecoleId).select("id");
      if (error) throw error;
      if (!data?.length) return { success: false, message: "Classe introuvable." };
    } else {
      const ecole = await lireEcole(s.supabase, s.ecoleId);
      const { data, error } = await s.supabase
        .from("classes")
        .insert({ ...champs, ecole_id: s.ecoleId, annee_scolaire: ecole.annee_scolaire })
        .select("id")
        .single();
      if (error) throw error;
      classeId = data.id;
    }
    // Catalogue mis à jour ligne par ligne : une ligne gardée garde son id, donc le lien avec les élèves
    // déjà inscrits (qui conservent leur copie et leur prix dans articles_inscription)
    if (saisie.articles) {
      const { data: existants, error: erreurLecture } = await s.supabase
        .from("articles_classe")
        .select("id")
        .eq("classe_id", classeId!)
        .eq("ecole_id", s.ecoleId);
      if (erreurLecture) throw erreurLecture;
      const ids = new Set((existants ?? []).map((a) => a.id));
      for (const { id, ...a } of articles) {
        if (id && ids.has(id)) {
          const { error } = await s.supabase.from("articles_classe").update(a).eq("id", id).eq("ecole_id", s.ecoleId);
          if (error) throw error;
        } else {
          const { error } = await s.supabase.from("articles_classe").insert({ ...a, ecole_id: s.ecoleId, classe_id: classeId! });
          if (error) throw error;
        }
      }
      const gardes = new Set(articles.map((a) => a.id).filter(Boolean));
      const retires = [...ids].filter((id) => !gardes.has(id));
      if (retires.length) {
        const { error } = await s.supabase.from("articles_classe").delete().in("id", retires).eq("ecole_id", s.ecoleId);
        if (error) throw error;
      }
    }
  } catch (err) {
    return { success: false, message: messageErreur("classes", err, undefined, "Une classe porte déjà ce nom cette année.") };
  }
  revalidatePath("/ecole");
  return { success: true, message: saisie.id ? "Classe mise à jour. Les élèves déjà inscrits gardent leur tarif." : "Classe créée." };
}

export async function archiverClasse(id: string, actif: boolean): Promise<Resultat> {
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };
  const { error } = await s.supabase.from("classes").update({ is_active: actif }).eq("id", id).eq("ecole_id", s.ecoleId);
  if (error) return { success: false, message: messageErreur("classes", error) };
  revalidatePath("/ecole");
  return { success: true };
}

// ------------------------------------------------------------------ Inscriptions

export interface SaisieInscription {
  eleve_id?: string; // réinscription d'un élève existant
  prenom?: string;
  nom?: string;
  sexe?: string;
  date_naissance?: string;
  parent_nom?: string;
  parent_telephone?: string;
  classe_id: string;
  reduction_mensuelle?: string | number;
  /** Articles de la classe retenus pour l'élève : les obligatoires sont toujours pris, quantité modifiable */
  articles?: { article_classe_id: string; quantite?: string | number }[];
  /** Encaisser tout ce qui est dû à l'inscription (frais, mensualités d'avance, articles) en un seul reçu */
  payer_inscription?: boolean;
  mode?: string;
  reference?: string;
}

/** Parent existant (même téléphone dans l'école) ou nouveau parent avec son lien magique */
async function trouverOuCreerParent(
  supabase: ReturnType<typeof createClientEcole>,
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

/** Matricule suivant de l'année (plus grand matricule existant + 1, voir matriculeSuivant) */
async function prochainMatricule(supabase: ReturnType<typeof createClientEcole>, ecoleId: string, annee: string): Promise<string> {
  const prefixe = annee.slice(2, 4);
  const { data, error } = await supabase
    .from("eleves")
    .select("matricule")
    .eq("ecole_id", ecoleId)
    .like("matricule", `${prefixe}%`)
    // Matricules de longueur fixe (6 caractères) : l'ordre texte suit l'ordre numérique.
    // Le plus grand suffit, et la lecture reste sous le plafond de lignes de PostgREST.
    .order("matricule", { ascending: false })
    .limit(1);
  if (error) throw error;
  return matriculeSuivant(prefixe, (data ?? []).map((e) => e.matricule));
}

export async function inscrireEleve(saisie: SaisieInscription): Promise<Resultat<{ eleveId: string }>> {
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };

  const reduction = montant(saisie.reduction_mensuelle || 0);
  if (reduction === null) return { success: false, message: "Réduction invalide." };
  const reglement = saisie.payer_inscription ? lireMode(saisie.mode, saisie.reference) : null;
  if (typeof reglement === "string") return { success: false, message: reglement };

  // Pas de transaction côté Supabase JS : ce qui a été créé ici est supprimé si une étape suivante échoue,
  // pour ne pas laisser d'élève sans inscription (ni d'inscription sans ses frais encaissés)
  let eleveCree: string | null = null;
  let inscriptionCreee: string | null = null;
  try {
    const ecole = await lireEcole(s.supabase, s.ecoleId);
    const { data: classe, error: erreurClasse } = await s.supabase
      .from("classes")
      .select("id, frais_inscription, mensualite, mensualite_dernier_mois, annee_scolaire, is_active")
      .eq("id", saisie.classe_id)
      .eq("ecole_id", s.ecoleId)
      .maybeSingle();
    if (erreurClasse) throw erreurClasse;
    if (!classe || !classe.is_active) return { success: false, message: "Choisissez une classe." };
    if (classe.annee_scolaire !== ecole.annee_scolaire) {
      return { success: false, message: `Cette classe appartient à l'année ${classe.annee_scolaire}.` };
    }
    if (reduction > classe.mensualite) return { success: false, message: "La réduction dépasse la mensualité." };

    // Articles retenus : obligatoires toujours, optionnels s'ils sont cochés ; quantité saisie pour les frais uniques
    const { data: catalogue, error: erreurCatalogue } = await s.supabase
      .from("articles_classe")
      .select("id, libelle, nature, prix_unitaire, quantite_defaut, obligatoire")
      .eq("classe_id", classe.id)
      .eq("ecole_id", s.ecoleId)
      .order("ordre");
    if (erreurCatalogue) throw erreurCatalogue;
    const choisis = new Map((Array.isArray(saisie.articles) ? saisie.articles.slice(0, 50) : []).map((a) => [a?.article_classe_id, a?.quantite]));
    const moisAnnee = moisScolaires(ecole.annee_scolaire, ecole.mois_debut, ecole.nb_mensualites);
    const articlesEleve = [];
    for (const a of catalogue ?? []) {
      if (!a.obligatoire && !choisis.has(a.id)) continue;
      const q = a.nature === "unique" && choisis.get(a.id) !== undefined ? Number(choisis.get(a.id)) : a.quantite_defaut;
      if (!Number.isInteger(q) || q < 0 || q > 99) return { success: false, message: `Quantité invalide pour « ${a.libelle} ».` };
      if (a.obligatoire && a.nature === "unique" && q < 1 && a.quantite_defaut > 0) return { success: false, message: `« ${a.libelle} » est obligatoire pour cette classe.` };
      if (a.nature === "unique" && q === 0) continue;
      articlesEleve.push({
        article_classe_id: a.id,
        libelle: a.libelle,
        nature: a.nature,
        prix_unitaire: a.prix_unitaire,
        quantite: a.nature === "mensuel" ? 1 : q,
        obligatoire: a.obligatoire,
        mois_debut: a.nature === "mensuel" ? debutService(moisAnnee) : null,
      });
    }

    let eleveId = saisie.eleve_id;
    if (eleveId) {
      const { data: eleve, error } = await s.supabase.from("eleves").select("id").eq("id", eleveId).eq("ecole_id", s.ecoleId).maybeSingle();
      if (error) throw error;
      if (!eleve) return { success: false, message: "Élève introuvable." };
    } else {
      const prenom = texte(saisie.prenom, 60);
      const nom = texte(saisie.nom, 60);
      const parentNom = texte(saisie.parent_nom, 80);
      const telephone = normaliserTelephone(saisie.parent_telephone);
      const sexe = saisie.sexe === "M" || saisie.sexe === "F" ? saisie.sexe : null;
      const naissance = isDateValide(saisie.date_naissance) ? saisie.date_naissance : null;
      if (!prenom || !nom) return { success: false, message: "Prénom et nom de l'élève obligatoires." };
      if (!parentNom || !telephone || !/^\+\d{9,15}$/.test(telephone)) {
        return { success: false, message: "Nom et téléphone du parent obligatoires (ex : 77 123 45 67)." };
      }

      const parentId = await trouverOuCreerParent(s.supabase, s.ecoleId, parentNom, telephone);
      // Deux inscriptions simultanées peuvent viser le même matricule : on réessaie
      for (let essai = 0; essai < 3 && !eleveId; essai++) {
        const matricule = await prochainMatricule(s.supabase, s.ecoleId, ecole.annee_scolaire);
        const { data, error } = await s.supabase
          .from("eleves")
          .insert({ ecole_id: s.ecoleId, parent_id: parentId, matricule, prenom, nom, sexe, date_naissance: naissance })
          .select("id")
          .single();
        if (error && error.code !== "23505") throw error;
        eleveId = data?.id;
        eleveCree = data?.id ?? null;
      }
      if (!eleveId) return { success: false, message: "Attribution du matricule impossible, réessayez." };
    }

    const { data: inscription, error: erreurInscription } = await s.supabase
      .from("inscriptions")
      .insert({
        ecole_id: s.ecoleId,
        eleve_id: eleveId,
        classe_id: classe.id,
        annee_scolaire: ecole.annee_scolaire,
        frais_inscription: classe.frais_inscription,
        mensualite: classe.mensualite,
        mensualite_dernier_mois: classe.mensualite_dernier_mois,
        reduction_mensuelle: reduction,
      })
      .select("id")
      .single();
    if (erreurInscription) throw erreurInscription;
    inscriptionCreee = inscription.id;

    if (articlesEleve.length) {
      const { error } = await s.supabase
        .from("articles_inscription")
        .insert(articlesEleve.map((a) => ({ ...a, ecole_id: s.ecoleId, inscription_id: inscription.id })));
      if (error) throw error;
    }

    // Tout ce qui est dû à l'inscription, recalculé par le serveur, sur un seul reçu
    let encaisse = 0;
    let avertissement = "";
    if (reglement) {
      const charge = await chargerSituation(s.supabase, s.ecoleId, inscription.id);
      const calcul = charge ? lignesAEncaisser(charge.situation, choixALinscription(charge.situation)) : null;
      if (calcul && "lignes" in calcul) {
        const base = { ecole_id: s.ecoleId, inscription_id: inscription.id, ...reglement, paye_le: todayDakar(), lot_id: randomUUID() };
        const { error } = await s.supabase.from("paiements").insert(calcul.lignes.map((l) => ({ ...base, ...l })));
        if (error) throw error;
        encaisse = calcul.lignes.reduce((t, l) => t + l.montant, 0);
      } else if (calcul && "erreur" in calcul && !calcul.erreur.startsWith("Rien à encaisser")) {
        avertissement = ` Encaissement non fait : ${calcul.erreur} Encaissez depuis la fiche.`;
      }
    }

    revalidatePath("/ecole");
    return {
      success: true,
      message: encaisse ? `Élève inscrit. Reçu créé : ${fcfa(encaisse)} encaissés.` : `Élève inscrit.${avertissement}`,
      data: { eleveId },
    };
  } catch (err) {
    // Nettoyage de ce qui a été créé ; un échec ici est signalé pour que l'école vérifie la liste
    const r1 = inscriptionCreee ? await s.supabase.from("inscriptions").delete().eq("id", inscriptionCreee).eq("ecole_id", s.ecoleId) : null;
    const r2 = eleveCree ? await s.supabase.from("eleves").delete().eq("id", eleveCree).eq("ecole_id", s.ecoleId) : null;
    if (r1?.error || r2?.error) {
      console.error("[inscription] nettoyage incomplet", r1?.error?.code ?? r2?.error?.code);
      return { success: false, message: "Inscription interrompue : vérifiez la liste des élèves avant de réessayer." };
    }
    return { success: false, message: messageErreur("inscription", err, undefined, "Cet élève est déjà inscrit cette année.") };
  }
}

/**
 * Supprime un élève saisi par erreur (et ses inscriptions). Refusé s'il a le moindre paiement, même annulé :
 * l'historique financier se conserve, on passe alors l'inscription en « abandon ».
 * Le parent est supprimé aussi s'il n'a plus aucun enfant dans l'école.
 */
export async function supprimerEleve(id: string): Promise<Resultat> {
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };

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

export async function modifierInscription(
  id: string,
  champs: { statut?: StatutInscription; date_depart?: string | null; reduction_mensuelle?: string | number }
): Promise<Resultat> {
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };

  const maj: { statut?: StatutInscription; date_depart?: string | null; reduction_mensuelle?: number } = {};
  if (champs.statut) {
    if (!["active", "abandon", "transfert"].includes(champs.statut)) return { success: false, message: "Statut inconnu." };
    maj.statut = champs.statut;
  }
  if (champs.statut || champs.date_depart !== undefined) {
    try {
      const { data: ins, error: erreurIns } = await s.supabase
        .from("inscriptions")
        .select("statut, annee_scolaire")
        .eq("id", id)
        .eq("ecole_id", s.ecoleId)
        .maybeSingle();
      if (erreurIns) throw erreurIns;
      if (!ins) return { success: false, message: "Inscription introuvable." };
      const statut = champs.statut ?? ins.statut;
      if (statut === "active") {
        // Retour en « Inscrit » : la date de départ est effacée
        maj.date_depart = null;
      } else {
        const date = champs.date_depart;
        if (date === undefined || date === null || date === "") {
          if (champs.statut) return { success: false, message: "Indiquez la date de départ de l'élève." };
        } else {
          if (!isDateValide(date)) return { success: false, message: "Date de départ invalide." };
          if (date > todayDakar()) return { success: false, message: "La date de départ ne peut pas être dans le futur." };
          const ecole = await lireEcole(s.supabase, s.ecoleId);
          const mois = moisScolaires(ins.annee_scolaire, ecole.mois_debut, ecole.nb_mensualites);
          const premier = mois[0];
          const [a, m] = mois[mois.length - 1].split("-").map(Number);
          const dernierJour = `${mois[mois.length - 1].slice(0, 8)}${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
          if (date < premier || date > dernierJour)
            return { success: false, message: `La date de départ doit être dans l'année scolaire ${ins.annee_scolaire}.` };
          maj.date_depart = date;
        }
      }
    } catch (err) {
      return { success: false, message: messageErreur("inscriptions", err) };
    }
  }
  if (champs.reduction_mensuelle !== undefined) {
    const r = montant(champs.reduction_mensuelle);
    if (r === null) return { success: false, message: "Réduction invalide." };
    maj.reduction_mensuelle = r;
  }
  const { error } = await s.supabase.from("inscriptions").update(maj).eq("id", id).eq("ecole_id", s.ecoleId);
  if (error) {
    if (error.code === "23514") return { success: false, message: "La réduction ne peut pas dépasser la mensualité." };
    return { success: false, message: messageErreur("inscriptions", error) };
  }
  revalidatePath("/ecole");
  return { success: true };
}

export async function modifierEleve(
  id: string,
  champs: { prenom: string; nom: string; sexe: string; date_naissance: string; parent_nom: string; parent_telephone: string }
): Promise<Resultat> {
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };
  const prenom = texte(champs.prenom, 60);
  const nom = texte(champs.nom, 60);
  const parentNom = texte(champs.parent_nom, 80);
  const telephone = normaliserTelephone(champs.parent_telephone);
  if (!prenom || !nom) return { success: false, message: "Prénom et nom obligatoires." };
  if (!parentNom || !telephone || !/^\+\d{9,15}$/.test(telephone)) return { success: false, message: "Parent : nom et téléphone valides obligatoires." };

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

// ------------------------------------------------------------------ Paiements

export interface SaisiePaiement {
  inscription_id: string;
  /** Frais d'inscription */
  inscription?: boolean;
  /** Mensualités (YYYY-MM-01) */
  mois?: string[];
  /** Articles et mois de service (clés de LigneArticle) */
  articles?: string[];
  /** Montant partiel (une seule ligne choisie) ; vide = reste dû */
  montant?: string | number;
  mode: string;
  reference?: string;
  /** Ajouter au même reçu la tranche due avec les mensualités choisies (oui par défaut) */
  inclure_tranche?: boolean;
  /** Paiement libre hors catalogue (objet + montant), seul sur son reçu */
  libre?: { libelle: string; montant: string | number };
}

export async function encaisserPaiement(saisie: SaisiePaiement): Promise<Resultat<{ ids: string[] }>> {
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };

  const reglement = lireMode(saisie.mode, saisie.reference);
  if (typeof reglement === "string") return { success: false, message: reglement };
  const vide = saisie.montant === undefined || saisie.montant === null || String(saisie.montant).trim() === "";
  const saisi = vide ? null : montant(saisie.montant);
  if (!vide && (saisi === null || saisi === 0)) return { success: false, message: "Montant invalide." };

  try {
    const charge = await chargerSituation(s.supabase, s.ecoleId, saisie.inscription_id);
    if (!charge) return { success: false, message: "Inscription introuvable." };
    const { situation, ins } = charge;
    const aujourdhui = todayDakar();
    // Toutes les lignes de cet encaissement partagent un lot : la base leur donne le même numéro de reçu
    const base = { ecole_id: s.ecoleId, inscription_id: ins.id, ...reglement, paye_le: aujourdhui, lot_id: randomUUID() };

    let lignes;
    if (saisie.libre) {
      const libelle = texte(saisie.libre.libelle, 80);
      const m = montant(saisie.libre.montant);
      if (!libelle) return { success: false, message: "Précisez l'objet du paiement." };
      if (!m) return { success: false, message: "Indiquez le montant." };
      lignes = [{ type: "autre" as const, mois: null, article_id: null, montant: m, libelle }];
    } else {
      // Tableaux bornés : chaque valeur est ensuite validée contre la situation recalculée
      const mois = Array.from(new Set(Array.isArray(saisie.mois) ? saisie.mois.slice(0, 24).map(String) : [])).sort();
      const articles = Array.isArray(saisie.articles) ? saisie.articles.slice(0, 100).map(String) : [];
      let montantChoisi = saisi;
      // Mois payé par tranches choisi seul et sans montant : on encaisse la tranche due (ou la prochaine)
      if (montantChoisi === null && mois.length === 1 && !saisie.inscription && articles.length === 0) {
        const ligne = situation.mois.find((l) => l.mois === mois[0]);
        if (ligne?.tranches && ligne.tranches.suggestion > 0 && ligne.tranches.suggestion < ligne.reste) montantChoisi = ligne.tranches.suggestion;
      }
      const calcul = lignesAEncaisser(situation, {
        inscription: saisie.inscription === true,
        mois,
        articles,
        montant: montantChoisi,
        inclure_tranche: saisie.inclure_tranche,
      });
      if ("erreur" in calcul) return { success: false, message: calcul.erreur };
      lignes = calcul.lignes;
    }

    const { data, error } = await s.supabase
      .from("paiements")
      .insert(lignes.map((l) => ({ ...base, ...l })))
      .select("id");
    if (error) throw error;
    revalidatePath("/ecole");
    const total = lignes.reduce((t, l) => t + l.montant, 0);
    const tranche = lignes.length > 1 ? lignes.find((l) => l.libelle?.startsWith("Tranche")) : undefined;
    return {
      success: true,
      message: `Reçu créé : ${fcfa(total)} encaissés${tranche ? ` (dont ${(tranche.libelle ?? "").toLowerCase()} : ${fcfa(tranche.montant)})` : ""}.`,
      data: { ids: (data ?? []).map((d) => d.id) },
    };
  } catch (err) {
    return { success: false, message: messageErreur("paiements", err) };
  }
}

// ------------------------------------------------------------------ Articles et services d'un élève

/** Ajoute à un élève un article du catalogue de sa classe (service optionnel pris en cours d'année, tenue en plus) */
export async function ajouterArticleInscription(
  inscriptionId: string,
  articleClasseId: string,
  quantiteSaisie?: string | number
): Promise<Resultat> {
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };
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
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };
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

export async function annulerPaiement(id: string, motif: string): Promise<Resultat> {
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };
  const m = texte(motif, 200);
  if (m.length < 3) return { success: false, message: "Indiquez le motif de l'annulation." };
  // Un reçu est un document : l'annulation porte sur toutes ses lignes (même lot)
  const { data: ligne } = await s.supabase.from("paiements").select("lot_id").eq("id", id).eq("ecole_id", s.ecoleId).maybeSingle();
  if (!ligne) return { success: false, message: "Paiement introuvable." };
  const requete = s.supabase.from("paiements").update({ annule: true, motif_annulation: m }).eq("ecole_id", s.ecoleId).eq("annule", false);
  const { error } = await (ligne.lot_id ? requete.eq("lot_id", ligne.lot_id) : requete.eq("id", id));
  if (error) return { success: false, message: messageErreur("paiements", error) };
  revalidatePath("/ecole");
  return { success: true, message: "Reçu annulé (toutes ses lignes). Il reste visible, barré « ANNULÉ »." };
}

// ------------------------------------------------------------------ Parents

export async function regenererLienParent(parentId: string): Promise<Resultat> {
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };
  const { error } = await s.supabase.from("parents").update({ token: generateToken() }).eq("id", parentId).eq("ecole_id", s.ecoleId);
  if (error) return { success: false, message: messageErreur("parents", error) };
  revalidatePath("/ecole");
  return { success: true, message: "Nouveau lien créé : l'ancien ne fonctionne plus." };
}

// ------------------------------------------------------------------ Paramètres

export interface SaisieParametres {
  nom: string;
  ville: string;
  adresse: string;
  responsable_nom: string;
  telephone_contact: string;
  annee_scolaire: string;
  mois_debut: string | number;
  nb_mensualites: string | number;
  jour_echeance: string | number;
  tranches_dernier_mois: boolean;
  mois_debut_tranches: string | number;
  nb_tranches: string | number;
  /** Mois payé par tranches : 1 = dernier, 2 = avant-dernier, 3 = antépénultième */
  rang_mois_tranches?: string | number;
  premier_mois_a_linscription?: boolean;
  dernier_mois_a_linscription?: boolean;
}

export async function enregistrerParametres(saisie: SaisieParametres): Promise<Resultat> {
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };

  const nom = texte(saisie.nom, 100);
  const annee = texte(saisie.annee_scolaire, 9);
  const moisDebut = Number(saisie.mois_debut);
  const nb = Number(saisie.nb_mensualites);
  const jour = Number(saisie.jour_echeance);
  if (nom.length < 2) return { success: false, message: "Nom de l'école obligatoire." };
  if (!isAnneeScolaireValide(annee)) return { success: false, message: "Année scolaire au format 2026-2027." };
  if (!Number.isInteger(moisDebut) || moisDebut < 1 || moisDebut > 12) return { success: false, message: "Mois de rentrée invalide." };
  if (!Number.isInteger(nb) || nb < 1 || nb > 12) return { success: false, message: "Nombre de mensualités entre 1 et 12." };
  if (!Number.isInteger(jour) || jour < 1 || jour > 28) return { success: false, message: "Jour d'échéance entre 1 et 28." };
  const tranches = saisie.tranches_dernier_mois === true;
  const debutTranches = Number(saisie.mois_debut_tranches);
  const nbTranchesSaisi = Number(saisie.nb_tranches);
  const rang = Number(saisie.rang_mois_tranches ?? 1);
  const premierALinscription = saisie.premier_mois_a_linscription === true;
  const dernierALinscription = saisie.dernier_mois_a_linscription === true;
  if (tranches) {
    if (!Number.isInteger(rang) || rang < 1 || rang > 3) return { success: false, message: "Mois payé par tranches invalide." };
    if (!Number.isInteger(debutTranches) || debutTranches < 1 || debutTranches > 12) {
      return { success: false, message: "Choisissez le mois de la première tranche." };
    }
    if (!Number.isInteger(nbTranchesSaisi) || nbTranchesSaisi < 1) return { success: false, message: "Nombre de tranches invalide." };
    const probleme = verifierReglages(annee, {
      mois_debut: moisDebut,
      nb_mensualites: nb,
      jour_echeance: jour,
      tranches_dernier_mois: true,
      mois_debut_tranches: debutTranches,
      nb_tranches: nbTranchesSaisi,
      rang_mois_tranches: rang,
      premier_mois_a_linscription: premierALinscription,
      dernier_mois_a_linscription: dernierALinscription,
    });
    if (probleme) return { success: false, message: probleme };
  }

  try {
    const ecole = await lireEcole(s.supabase, s.ecoleId);
    // Nouvelle année : reprendre les classes (et leurs tarifs) de l'année précédente si elle n'en a pas
    let copie = 0;
    if (annee !== ecole.annee_scolaire) {
      const { count } = await s.supabase
        .from("classes")
        .select("id", { count: "exact", head: true })
        .eq("ecole_id", s.ecoleId)
        .eq("annee_scolaire", annee);
      if (!count) {
        const { data: anciennes } = await s.supabase
          .from("classes")
          .select("id, nom, niveau, frais_inscription, mensualite, mensualite_dernier_mois")
          .eq("ecole_id", s.ecoleId)
          .eq("annee_scolaire", ecole.annee_scolaire)
          .eq("is_active", true);
        if (anciennes?.length) {
          const { data: nouvelles, error: erreurCopie } = await s.supabase
            .from("classes")
            .insert(anciennes.map(({ id: _id, ...c }) => ({ ...c, ecole_id: s.ecoleId, annee_scolaire: annee })))
            .select("id, nom");
          if (erreurCopie) throw erreurCopie;
          copie = anciennes.length;
          // Le catalogue d'articles (tenues, services) suit chaque classe
          const parNom = new Map((nouvelles ?? []).map((c) => [c.nom, c.id]));
          const { data: catalogue, error: erreurCatalogue } = await s.supabase
            .from("articles_classe")
            .select("classe_id, libelle, nature, prix_unitaire, quantite_defaut, obligatoire, ordre")
            .eq("ecole_id", s.ecoleId)
            .in("classe_id", anciennes.map((c) => c.id));
          const nomDe = new Map(anciennes.map((c) => [c.id, c.nom]));
          const copies = (catalogue ?? [])
            .map(({ classe_id, ...a }) => ({ ...a, ecole_id: s.ecoleId, classe_id: parNom.get(nomDe.get(classe_id) ?? "") ?? "" }))
            .filter((a) => a.classe_id);
          const { error: erreurArticles } =
            erreurCatalogue ? { error: erreurCatalogue } : copies.length ? await s.supabase.from("articles_classe").insert(copies) : { error: null };
          if (erreurArticles) {
            // Classes copiées sans leur catalogue : on les retire pour que l'école puisse réessayer
            await s.supabase.from("classes").delete().eq("ecole_id", s.ecoleId).in("id", (nouvelles ?? []).map((c) => c.id));
            throw erreurArticles;
          }
        }
      }
    }
    // Après la copie : si elle échoue, l'année ne change pas et l'école peut réessayer
    const { error } = await s.supabase
      .from("ecoles")
      .update({
        nom,
        ville: texte(saisie.ville, 60) || null,
        adresse: texte(saisie.adresse, 120) || null,
        responsable_nom: texte(saisie.responsable_nom, 80) || null,
        telephone_contact: normaliserTelephone(saisie.telephone_contact),
        annee_scolaire: annee,
        mois_debut: moisDebut,
        nb_mensualites: nb,
        jour_echeance: jour,
        tranches_dernier_mois: tranches,
        mois_debut_tranches: tranches ? debutTranches : null,
        nb_tranches: tranches ? nbTranchesSaisi : null,
        rang_mois_tranches: tranches ? rang : 1,
        premier_mois_a_linscription: premierALinscription,
        dernier_mois_a_linscription: dernierALinscription,
      })
      .eq("id", s.ecoleId);
    if (error) throw error;

    revalidatePath("/ecole");
    return {
      success: true,
      message: copie ? `Paramètres enregistrés. ${copie} classes reprises pour ${annee} : réinscrivez les élèves.` : "Paramètres enregistrés.",
    };
  } catch (err) {
    return { success: false, message: messageErreur("parametres", err) };
  }
}

export async function changerCodeAcces(ancien: string, nouveau: string): Promise<Resultat> {
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };
  if (nouveau.trim().length < 8) return { success: false, message: "Le nouveau code doit faire au moins 8 caractères." };
  const { data, error } = await (s.supabase as any).rpc("changer_code_ecole", {
    p_ancien_hash: hashCode(ancien),
    p_nouveau_hash: hashCode(nouveau),
  });
  if (error) return { success: false, message: messageErreur("code", error) };
  if (data !== true) return { success: false, message: "Code actuel incorrect." };
  return { success: true, message: "Code changé : reconnectez-vous avec le nouveau code." };
}
