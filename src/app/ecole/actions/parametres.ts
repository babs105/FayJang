"use server";

import { revalidatePath } from "next/cache";
import { isAnneeScolaireValide } from "@/lib/metier/dates";
import { messageErreur } from "@/lib/securite/erreurs";
import { verifierReglages } from "@/lib/metier/scolarite";
import { normaliserTelephone } from "@/lib/validation/telephone";
import { texte } from "@/lib/validation/saisie";
import { lireResultatParametres, messageParametres } from "@/lib/validation/parametres";
import { refusDroit, sessionEcriture, type Resultat } from "./_commun";

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
  const s = await sessionEcriture();
  if (typeof s === "string") return { success: false, message: s };
  const refus = refusDroit(s, "parametres");
  if (refus) return { success: false, message: refus };

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

  // Réglages et, pour une nouvelle année sans classe, copie des classes actives et de leur catalogue :
  // une seule transaction (bloc v1.11), l'école verrouillée. Un échec n'écrit rien. L'école vient du JWT.
  try {
    const { data, error } = await s.supabase.rpc("enregistrer_parametres", {
      p_nom: nom,
      p_ville: texte(saisie.ville, 60) || null,
      p_adresse: texte(saisie.adresse, 120) || null,
      p_responsable_nom: texte(saisie.responsable_nom, 80) || null,
      p_telephone_contact: normaliserTelephone(texte(saisie.telephone_contact, 30)),
      p_annee_scolaire: annee,
      p_mois_debut: moisDebut,
      p_nb_mensualites: nb,
      p_jour_echeance: jour,
      p_tranches_dernier_mois: tranches,
      p_mois_debut_tranches: tranches ? debutTranches : null,
      p_nb_tranches: tranches ? nbTranchesSaisi : null,
      p_rang_mois_tranches: tranches ? rang : 1,
      p_premier_mois_a_linscription: premierALinscription,
      p_dernier_mois_a_linscription: dernierALinscription,
    });
    if (error) throw error;

    revalidatePath("/ecole");
    return { success: true, message: messageParametres(lireResultatParametres(data), annee) };
  } catch (err) {
    return { success: false, message: messageErreur("parametres", err) };
  }
}
