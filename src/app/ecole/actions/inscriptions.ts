"use server";

// Inscription d'un élève et modification de son inscription (classe, statut, réduction)
import { revalidatePath } from "next/cache";
import { todayDakar } from "@/lib/config";
import { isDateValide, moisScolaires } from "@/lib/dates";
import { contrainteViolee, messageErreur } from "@/lib/erreurs";
import { fcfa } from "@/lib/format";
import { lignesPaiementInscription, selectionnerArticles, type LignePaiementInscription } from "@/lib/inscription-initiale";
import { normaliserTelephone } from "@/lib/telephone";
import { estUuid, montant, texte } from "@/lib/saisie";
import type { StatutInscription } from "@/types/database";
import { debutService, lireEcole, lireMode, sessionEcriture, type Resultat, DATE_NAISSANCE_FUTURE } from "./_commun";

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

/** Retour de la fonction SQL inscrire_eleve (supabase/schema/05-migrations.sql, bloc v1.7) */
type ResultatInscription = {
  eleve_id: string;
  inscription_id: string;
  parent_id: string | null;
  parent_cree: boolean;
  matricule: string | null;
  numero_recu: string | null;
  montant_encaisse: number;
};

/**
 * Inscrit un élève (nouveau ou réinscrit) : parent, élève, inscription, articles et reçu (si demandé) sont créés par la fonction SQL
 * inscrire_eleve en une seule transaction, donc jamais à moitié. Les champs sont validés ici pour les messages,
 * puis revérifiés par la base, qui recopie elle-même tarifs et articles depuis la classe.
 */
export async function inscrireEleve(saisie: SaisieInscription): Promise<Resultat<{ eleveId: string }>> {
  const s = await sessionEcriture();
  if (typeof s === "string") return { success: false, message: s };

  // Identifiants mal formés refusés ici plutôt que par une erreur Postgres générique
  const classeId = texte(saisie.classe_id, 40);
  if (!estUuid(classeId)) return { success: false, message: "Choisissez une classe." };
  if (saisie.eleve_id && !estUuid(saisie.eleve_id)) return { success: false, message: "Élève introuvable." };
  const reduction = montant(saisie.reduction_mensuelle || 0);
  if (reduction === null) return { success: false, message: "Réduction invalide." };
  const reglement = saisie.payer_inscription ? lireMode(saisie.mode, saisie.reference) : null;
  if (typeof reglement === "string") return { success: false, message: reglement };
  // Une liste d'articles mal formée est refusée, pas réduite en silence aux obligatoires
  if (saisie.articles !== undefined && (!Array.isArray(saisie.articles) || saisie.articles.length > 50)) {
    return { success: false, message: "Articles invalides." };
  }

  // Nouvel élève : identité et parent ; le téléphone est normalisé ici (E.164), la base n'en vérifie que la forme
  let identite = {};
  if (!saisie.eleve_id) {
    const prenom = texte(saisie.prenom, 60);
    const nom = texte(saisie.nom, 60);
    const parentNom = texte(saisie.parent_nom, 80);
    const telephone = normaliserTelephone(saisie.parent_telephone);
    if (!prenom || !nom) return { success: false, message: "Prénom et nom de l'élève obligatoires." };
    if (!parentNom || !telephone || !/^\+\d{9,15}$/.test(telephone)) {
      return { success: false, message: "Nom et téléphone du parent obligatoires (ex : 77 123 45 67)." };
    }
    if (isDateValide(saisie.date_naissance) && saisie.date_naissance > todayDakar()) {
      return { success: false, message: DATE_NAISSANCE_FUTURE };
    }
    identite = {
      p_prenom: prenom,
      p_nom: nom,
      p_sexe: saisie.sexe === "M" || saisie.sexe === "F" ? saisie.sexe : null,
      p_date_naissance: isDateValide(saisie.date_naissance) ? saisie.date_naissance : null,
      p_parent_nom: parentNom,
      p_parent_telephone: telephone,
    };
  }

  let inscrit: ResultatInscription;
  try {
    const ecole = await lireEcole(s.supabase, s.ecoleId);
    const { data: catalogue, error: erreurCatalogue } = await s.supabase
      .from("articles_classe")
      .select("id, libelle, nature, quantite_defaut, obligatoire, prix_unitaire")
      .eq("classe_id", classeId)
      .eq("ecole_id", s.ecoleId)
      .order("ordre");
    if (erreurCatalogue) throw erreurCatalogue;
    const selection = selectionnerArticles(catalogue ?? [], saisie.articles);
    if ("erreur" in selection) return { success: false, message: selection.erreur };
    // Un service mensuel pris en cours d'année est dû à partir du mois courant
    const moisDebutServices = debutService(moisScolaires(ecole.annee_scolaire, ecole.mois_debut, ecole.nb_mensualites));

    // Encaissement à l'inscription : lignes calculées ici (même code que la fiche), la base les vérifie
    // et les insère dans la même transaction que l'inscription. Rien à encaisser : on inscrit sans reçu.
    let lignes: LignePaiementInscription[] = [];
    if (reglement) {
      const { data: classe, error: erreurClasse } = await s.supabase
        .from("classes")
        .select("frais_inscription, mensualite, mensualite_dernier_mois")
        .eq("id", classeId)
        .eq("ecole_id", s.ecoleId)
        .maybeSingle();
      if (erreurClasse) throw erreurClasse;
      if (!classe) return { success: false, message: "Choisissez une classe." };
      const calcul = lignesPaiementInscription({
        classe,
        reduction,
        ecole,
        aujourdhui: todayDakar(),
        catalogue: catalogue ?? [],
        articles: selection.articles,
        moisDebutServices,
      });
      if ("lignes" in calcul) lignes = calcul.lignes;
      else if (!calcul.rienAEncaisser) return { success: false, message: calcul.erreur };
    }

    const { data, error } = await s.supabase.rpc("inscrire_eleve", {
      p_classe_id: classeId,
      p_eleve_id: saisie.eleve_id || null,
      ...identite,
      p_reduction: reduction,
      p_articles: selection.articles,
      p_mois_debut_services: moisDebutServices,
      p_mode: reglement && lignes.length ? reglement.mode : null,
      p_reference: reglement && lignes.length ? reglement.reference : null,
      p_lignes_paiement: lignes,
    });
    if (error) throw error;
    inscrit = data as ResultatInscription;
  } catch (err) {
    return { success: false, message: messageErreur("inscription", err, undefined, "Cet élève est déjà inscrit cette année.") };
  }

  const parentConnu = !saisie.eleve_id && !inscrit.parent_cree ? " Parent déjà enregistré avec ce téléphone : l'élève est rattaché à sa fiche." : "";
  revalidatePath("/ecole");
  return {
    success: true,
    message:
      (inscrit.numero_recu
        ? `Élève inscrit. Reçu ${inscrit.numero_recu} créé : ${fcfa(inscrit.montant_encaisse)} encaissés.`
        : reglement
          ? "Élève inscrit. Rien à encaisser à l'inscription : aucun reçu créé."
          : "Élève inscrit.") + parentConnu,
    data: { eleveId: inscrit.eleve_id },
  };
}

export async function modifierInscription(
  id: string,
  champs: { statut?: StatutInscription; date_depart?: string | null; reduction_mensuelle?: string | number }
): Promise<Resultat> {
  const s = await sessionEcriture();
  if (typeof s === "string") return { success: false, message: s };

  const maj: { statut?: StatutInscription; date_depart?: string | null; reduction_mensuelle?: number } = {};
  if (champs.statut !== undefined) {
    if (!["active", "abandon", "transfert"].includes(champs.statut)) return { success: false, message: "Statut inconnu." };
    maj.statut = champs.statut;
  }
  if (champs.statut !== undefined || champs.date_depart !== undefined) {
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
          if (champs.statut !== undefined) return { success: false, message: "Indiquez la date de départ de l'élève." };
        } else {
          if (typeof date !== "string" || !isDateValide(date) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date)
            return { success: false, message: "Date de départ invalide." };
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
  if (Object.keys(maj).length === 0) return { success: true };
  const { error } = await s.supabase.from("inscriptions").update(maj).eq("id", id).eq("ecole_id", s.ecoleId);
  if (error) {
    // Message choisi d'après le nom exact de la contrainte ; une contrainte inconnue garde le message générique
    const contrainte = contrainteViolee(error);
    if (contrainte === "inscriptions_date_depart_check")
      return { success: false, message: "La date de départ n'est possible que pour un élève en abandon ou transféré." };
    // « inscriptions_check » : nom donné par Postgres au CHECK de table (reduction_mensuelle <= mensualite)
    if (contrainte && /^inscriptions_(check\d*|reduction_mensuelle_check)$/.test(contrainte))
      return { success: false, message: "La réduction ne peut pas dépasser la mensualité." };
    return { success: false, message: messageErreur("inscriptions", error) };
  }
  revalidatePath("/ecole");
  return { success: true };
}
