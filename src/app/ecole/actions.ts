"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getEcoleId, hashCode } from "@/lib/ecole-session";
import { createClientEcole } from "@/lib/supabase/server";
import { generateToken, todayDakar } from "@/lib/config";
import { isAnneeScolaireValide, isDateValide, moisScolaires } from "@/lib/dates";
import { messageErreur } from "@/lib/erreurs";
import { MODES_PAIEMENT, NIVEAUX } from "@/lib/libelles";
import { libelleTranche, moisDesTranches, situationInscription, trancheAvecMois } from "@/lib/scolarite";
import { normaliserTelephone } from "@/lib/telephone";
import type { ModePaiement, Niveau, StatutInscription, TypePaiement } from "@/types/database";

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
    .select("id, nom, annee_scolaire, mois_debut, nb_mensualites, jour_echeance, tranches_dernier_mois, mois_debut_tranches, nb_tranches")
    .eq("id", ecoleId)
    .single();
  if (error) throw error;
  return data;
}

// ------------------------------------------------------------------ Classes

export interface SaisieClasse {
  id?: string;
  nom: string;
  niveau: string;
  frais_inscription: string | number;
  mensualite: string | number;
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

  try {
    if (saisie.id) {
      const { error } = await s.supabase
        .from("classes")
        .update({ nom, niveau, frais_inscription: frais, mensualite })
        .eq("id", saisie.id)
        .eq("ecole_id", s.ecoleId);
      if (error) throw error;
    } else {
      const ecole = await lireEcole(s.supabase, s.ecoleId);
      const { error } = await s.supabase.from("classes").insert({
        ecole_id: s.ecoleId,
        nom,
        niveau,
        annee_scolaire: ecole.annee_scolaire,
        frais_inscription: frais,
        mensualite,
      });
      if (error) throw error;
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

/** Matricule : 2 chiffres de l'année de rentrée + numéro d'ordre (ex : 260042) */
async function prochainMatricule(supabase: ReturnType<typeof createClientEcole>, ecoleId: string, annee: string): Promise<string> {
  const prefixe = annee.slice(2, 4);
  const { count, error } = await supabase
    .from("eleves")
    .select("id", { count: "exact", head: true })
    .eq("ecole_id", ecoleId)
    .like("matricule", `${prefixe}%`);
  if (error) throw error;
  return `${prefixe}${String((count ?? 0) + 1).padStart(4, "0")}`;
}

export async function inscrireEleve(saisie: SaisieInscription): Promise<Resultat<{ eleveId: string }>> {
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };

  const reduction = montant(saisie.reduction_mensuelle || 0);
  if (reduction === null) return { success: false, message: "Réduction invalide." };
  const mode = (saisie.mode || "especes") as ModePaiement;
  if (saisie.payer_inscription && !MODES_PAIEMENT.includes(mode)) return { success: false, message: "Mode de paiement inconnu." };

  // Pas de transaction côté Supabase JS : ce qui a été créé ici est supprimé si une étape suivante échoue,
  // pour ne pas laisser d'élève sans inscription (ni d'inscription sans ses frais encaissés)
  let eleveCree: string | null = null;
  let inscriptionCreee: string | null = null;
  try {
    const ecole = await lireEcole(s.supabase, s.ecoleId);
    const { data: classe, error: erreurClasse } = await s.supabase
      .from("classes")
      .select("id, frais_inscription, mensualite, annee_scolaire, is_active")
      .eq("id", saisie.classe_id)
      .eq("ecole_id", s.ecoleId)
      .maybeSingle();
    if (erreurClasse) throw erreurClasse;
    if (!classe || !classe.is_active) return { success: false, message: "Choisissez une classe." };
    if (classe.annee_scolaire !== ecole.annee_scolaire) {
      return { success: false, message: `Cette classe appartient à l'année ${classe.annee_scolaire}.` };
    }
    if (reduction > classe.mensualite) return { success: false, message: "La réduction dépasse la mensualité." };

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
        reduction_mensuelle: reduction,
      })
      .select("id")
      .single();
    if (erreurInscription) throw erreurInscription;
    inscriptionCreee = inscription.id;

    if (saisie.payer_inscription && classe.frais_inscription > 0) {
      const { error } = await s.supabase.from("paiements").insert({
        ecole_id: s.ecoleId,
        inscription_id: inscription.id,
        type: "inscription",
        montant: classe.frais_inscription,
        mode,
        reference: texte(saisie.reference, 60) || null,
        paye_le: todayDakar(),
      });
      if (error) throw error;
    }

    revalidatePath("/ecole");
    return { success: true, message: "Élève inscrit.", data: { eleveId } };
  } catch (err) {
    if (inscriptionCreee) await s.supabase.from("inscriptions").delete().eq("id", inscriptionCreee).eq("ecole_id", s.ecoleId);
    if (eleveCree) await s.supabase.from("eleves").delete().eq("id", eleveCree).eq("ecole_id", s.ecoleId);
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
  champs: { statut?: StatutInscription; reduction_mensuelle?: string | number }
): Promise<Resultat> {
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };

  const maj: { statut?: StatutInscription; reduction_mensuelle?: number } = {};
  if (champs.statut) {
    if (!["active", "abandon", "transfert"].includes(champs.statut)) return { success: false, message: "Statut inconnu." };
    maj.statut = champs.statut;
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
  type: TypePaiement;
  mois?: string[]; // YYYY-MM-01, pour une mensualité
  montant?: string | number; // obligatoire pour « autre » ; facultatif sinon (= reste dû)
  mode: string;
  reference?: string;
  libelle?: string;
  /** Mensualités : ajouter au même reçu la tranche du dernier mois due avec ces mois (oui par défaut) */
  inclure_tranche?: boolean;
}

export async function encaisserPaiement(saisie: SaisiePaiement): Promise<Resultat<{ ids: string[] }>> {
  const s = await session();
  if (!s) return { success: false, message: SESSION_EXPIREE };

  const mode = saisie.mode as ModePaiement;
  if (!MODES_PAIEMENT.includes(mode)) return { success: false, message: "Mode de paiement inconnu." };
  const reference = texte(saisie.reference, 60) || null;
  if ((mode === "wave" || mode === "orange_money" || mode === "free_money") && !reference) {
    return { success: false, message: "Indiquez la référence de la transaction mobile money." };
  }
  const saisi = saisie.montant === undefined || saisie.montant === "" ? null : montant(saisie.montant);
  if (saisie.montant !== undefined && saisie.montant !== "" && (saisi === null || saisi === 0)) {
    return { success: false, message: "Montant invalide." };
  }

  try {
    const ecole = await lireEcole(s.supabase, s.ecoleId);
    const { data: ins, error: erreurIns } = await s.supabase
      .from("inscriptions")
      .select("id, annee_scolaire, frais_inscription, mensualite, reduction_mensuelle, statut")
      .eq("id", saisie.inscription_id)
      .eq("ecole_id", s.ecoleId)
      .maybeSingle();
    if (erreurIns) throw erreurIns;
    if (!ins) return { success: false, message: "Inscription introuvable." };

    const { data: paiements, error: erreurPaiements } = await s.supabase
      .from("paiements")
      .select("type, mois, montant, annule")
      .eq("inscription_id", ins.id)
      .eq("ecole_id", s.ecoleId);
    if (erreurPaiements) throw erreurPaiements;

    const aujourdhui = todayDakar();
    const situation = situationInscription(ins, paiements ?? [], ecole, aujourdhui);
    // Toutes les lignes de cet encaissement partagent un lot : la base leur donne le même numéro de reçu
    const base = { ecole_id: s.ecoleId, inscription_id: ins.id, mode, reference, paye_le: aujourdhui, lot_id: randomUUID() };
    const lignes: Array<typeof base & { type: TypePaiement; montant: number; mois?: string; libelle?: string }> = [];

    if (saisie.type === "inscription") {
      const reste = Math.max(0, situation.inscriptionDue - situation.inscriptionPayee);
      if (reste === 0) return { success: false, message: "Les frais d'inscription sont déjà réglés." };
      const m = saisi ?? reste;
      if (m > reste) return { success: false, message: `Il ne reste que ${reste} FCFA de frais d'inscription.` };
      lignes.push({ ...base, type: "inscription", montant: m });
    } else if (saisie.type === "mensualite") {
      const valides = new Set(moisScolaires(ins.annee_scolaire, ecole.mois_debut, ecole.nb_mensualites));
      const mois = Array.from(new Set(saisie.mois ?? [])).filter((m) => valides.has(m)).sort();
      if (mois.length === 0) return { success: false, message: "Choisissez au moins un mois." };
      if (saisi !== null && mois.length > 1) {
        return { success: false, message: "Un montant partiel ne s'applique qu'à un seul mois." };
      }
      for (const m of mois) {
        const ligne = situation.mois.find((l) => l.mois === m);
        const reste = ligne?.reste ?? 0;
        if (reste === 0) continue;
        // Dernier mois payé par tranches, choisi seul et sans montant : on encaisse la tranche due (ou la prochaine)
        const v = saisi ?? (ligne?.tranches && mois.length === 1 ? ligne.tranches.suggestion || reste : reste);
        if (v > reste) return { success: false, message: `Il ne reste que ${reste} FCFA pour ce mois.` };
        const libelleT = ligne ? libelleTranche(ligne, ligne.paye, v) : null;
        lignes.push({ ...base, type: "mensualite", mois: m, montant: v, ...(libelleT ? { libelle: libelleT } : {}) });
      }
      if (lignes.length === 0) return { success: false, message: "Les mois choisis sont déjà réglés." };
      // La tranche du dernier mois due avec ces mensualités va sur le même reçu (sauf montant partiel saisi)
      if (saisie.inclure_tranche !== false && saisi === null) {
        const tranche = trancheAvecMois(situation, lignes.map((l) => l.mois!));
        if (tranche) lignes.push({ ...base, type: "mensualite", mois: tranche.mois, montant: tranche.montant, libelle: tranche.libelle });
      }
    } else if (saisie.type === "autre") {
      const libelle = texte(saisie.libelle, 80);
      if (!libelle) return { success: false, message: "Précisez l'objet (tenue, transport, cantine...)." };
      if (!saisi) return { success: false, message: "Indiquez le montant." };
      lignes.push({ ...base, type: "autre", montant: saisi, libelle });
    } else {
      return { success: false, message: "Type de paiement inconnu." };
    }

    const { data, error } = await s.supabase.from("paiements").insert(lignes).select("id");
    if (error) throw error;
    revalidatePath("/ecole");
    const total = lignes.reduce((t, l) => t + l.montant, 0);
    const fcfa = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n)} FCFA`;
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
  if (tranches) {
    if (!Number.isInteger(debutTranches) || debutTranches < 1 || debutTranches > 12) {
      return { success: false, message: "Choisissez le mois de la première tranche." };
    }
    // La première tranche doit tomber sur un mois de l'année scolaire, avant le dernier mois
    const nbTranches = moisDesTranches(annee, {
      mois_debut: moisDebut,
      nb_mensualites: nb,
      jour_echeance: jour,
      tranches_dernier_mois: true,
      mois_debut_tranches: debutTranches,
    }).length;
    if (nbTranches === 0) {
      return { success: false, message: "Le mois de la première tranche doit être un mois de l'année scolaire, avant le dernier mois." };
    }
    if (!Number.isInteger(nbTranchesSaisi) || nbTranchesSaisi < 1 || nbTranchesSaisi > nbTranches) {
      return {
        success: false,
        message: `Nombre de tranches entre 1 et ${nbTranches} : elles doivent être payées avant le dernier mois.`,
      };
    }
  }

  try {
    const ecole = await lireEcole(s.supabase, s.ecoleId);
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
      })
      .eq("id", s.ecoleId);
    if (error) throw error;

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
          .select("nom, niveau, frais_inscription, mensualite")
          .eq("ecole_id", s.ecoleId)
          .eq("annee_scolaire", ecole.annee_scolaire)
          .eq("is_active", true);
        if (anciennes?.length) {
          const { error: erreurCopie } = await s.supabase
            .from("classes")
            .insert(anciennes.map((c) => ({ ...c, ecole_id: s.ecoleId, annee_scolaire: annee })));
          if (erreurCopie) throw erreurCopie;
          copie = anciennes.length;
        }
      }
    }
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
