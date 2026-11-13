"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { todayDakar } from "@/lib/config";
import { messageErreur } from "@/lib/securite/erreurs";
import { fcfa } from "@/lib/metier/format";
import { empreintePaiements, lignesPourRpc, messageAnnulation, lireCleEncaissement, lireResultatEncaissement } from "@/lib/metier/encaissement";
import { lignesAEncaisser, paiementLibreAutorise, situationInscription } from "@/lib/metier/scolarite";
import { estUuid, montant, texte } from "@/lib/validation/saisie";
import { peutFaire } from "@/lib/securite/droits";
import { lireEcole, lireMode, sessionEcriture, type Client, type Resultat } from "./_commun";
import type { LigneEncaissement } from "@/types/ecole";

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
  /** Clé d'idempotence (UUID) créée par le formulaire : le même envoi répété ne crée qu'un reçu. Absente ou invalide : générée par le serveur */
  cle?: string;
}

export async function encaisserPaiement(saisie: SaisiePaiement): Promise<Resultat<{ ids: string[] }>> {
  const s = await sessionEcriture();
  if (typeof s === "string") return { success: false, message: s };

  if (!estUuid(saisie.inscription_id)) return { success: false, message: "Inscription introuvable." };
  const reglement = lireMode(saisie.mode, saisie.reference);
  if (typeof reglement === "string") return { success: false, message: reglement };
  const vide = saisie.montant === undefined || saisie.montant === null || String(saisie.montant).trim() === "";
  const saisi = vide ? null : montant(saisie.montant);
  if (!vide && (saisi === null || saisi === 0)) return { success: false, message: "Montant invalide." };

  try {
    const charge = await chargerSituation(s.supabase, s.ecoleId, saisie.inscription_id);
    if (!charge) return { success: false, message: "Inscription introuvable." };
    const { situation, ins } = charge;
    // Clé d'idempotence : celle du navigateur (un renvoi réseau ou un double clic la réutilise), sinon générée ici.
    // Toutes les lignes de cet encaissement partagent ce lot : la base leur donne le même numéro de reçu.
    const cle = lireCleEncaissement(saisie.cle) ?? randomUUID();

    let lignes: LigneEncaissement[];
    if (saisie.libre) {
      if (!paiementLibreAutorise(ins.statut)) return { success: false, message: "Élève parti : seul le solde dû peut être encaissé." };
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

    // Une seule fonction SQL, une seule transaction : sous verrou de l'inscription, la base vérifie que rien n'a
    // bougé depuis la lecture (empreinte) et que chaque ligne reste dans le dû, puis crée toutes les lignes.
    const empreinte = empreintePaiements(charge.paiements);
    const { data, error } = await s.supabase.rpc("encaisser_paiement", {
      p_inscription_id: ins.id,
      p_lot_id: cle,
      p_mode: reglement.mode,
      p_reference: reglement.reference,
      p_lignes: lignesPourRpc(lignes),
      p_nb_paiements: empreinte.nb,
      p_total_actif: empreinte.total,
    });
    if (error) throw error;
    const resultat = lireResultatEncaissement(data);
    if (!resultat) throw new Error("Réponse inattendue de encaisser_paiement.");
    revalidatePath("/ecole");
    if (resultat.rejoue) {
      return {
        success: true,
        message: `Cet encaissement était déjà enregistré${resultat.numero_recu ? ` (reçu ${resultat.numero_recu})` : ""} : ${fcfa(resultat.montant_encaisse)}, rien n'a été ajouté.`,
        data: { ids: resultat.ids },
      };
    }
    const tranche = lignes.length > 1 ? lignes.find((l) => l.libelle?.startsWith("Tranche")) : undefined;
    return {
      success: true,
      message: `Reçu créé : ${fcfa(resultat.montant_encaisse)} encaissés${tranche ? ` (dont ${(tranche.libelle ?? "").toLowerCase()} : ${fcfa(tranche.montant)})` : ""}.`,
      data: { ids: resultat.ids },
    };
  } catch (err) {
    return { success: false, message: messageErreur("paiements", err) };
  }
}

export async function annulerPaiement(id: string, motif: string): Promise<Resultat> {
  const s = await sessionEcriture();
  if (typeof s === "string") return { success: false, message: s };
  // D09 : seul le directeur annule (la base applique le même refus : policy ecole_annule)
  if (!peutFaire(s.utilisateur.role, "annuler")) {
    return { success: false, message: "Seul le directeur peut annuler un reçu. Demandez-lui de le faire." };
  }
  const m = texte(motif, 200);
  if (m.length < 3) return { success: false, message: "Indiquez le motif de l'annulation." };
  // Un reçu est un document : l'annulation porte sur toutes ses lignes (même lot)
  const { data: ligne } = await s.supabase.from("paiements").select("lot_id").eq("id", id).eq("ecole_id", s.ecoleId).maybeSingle();
  if (!ligne) return { success: false, message: "Paiement introuvable." };
  const requete = s.supabase.from("paiements").update({ annule: true, motif_annulation: m }).eq("ecole_id", s.ecoleId).eq("annule", false);
  // .select("id") : on compte les lignes réellement annulées (0 = un autre poste a annulé ce reçu avant nous)
  const { data: annulees, error } = await (ligne.lot_id ? requete.eq("lot_id", ligne.lot_id) : requete.eq("id", id)).select("id");
  if (error) return { success: false, message: messageErreur("paiements", error) };
  const resultat = messageAnnulation(annulees?.length ?? 0);
  if (resultat.success) revalidatePath("/ecole");
  return resultat;
}
