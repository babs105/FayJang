// Lignes d'un encaissement calculées depuis la situation de l'élève (le serveur ne croit pas les montants du client).
import { libelleTranche, trancheAvecMois } from "@/lib/metier/tranches";
import type { StatutInscription, TypePaiement } from "@/types/database";
import type { ChoixEncaissement, LigneEncaissement, Situation, TrancheIncluse } from "@/types/metier";

/** Message de lignesAEncaisser quand tout ce qui est choisi est déjà payé (comparé par les appelants, jamais recopié) */
export const RIEN_A_ENCAISSER = "Rien à encaisser : ce qui est choisi est déjà payé.";

/**
 * Lignes d'un encaissement, calculées depuis la situation (le serveur ne croit pas les montants du client).
 * Ce qui est déjà soldé est ignoré. Renvoie une erreur lisible si rien n'est dû ou si le montant est invalide.
 */
export function lignesAEncaisser(
  situation: Situation,
  choix: ChoixEncaissement
): { lignes: LigneEncaissement[]; tranche: TrancheIncluse | null } | { erreur: string } {
  const lignes: LigneEncaissement[] = [];
  if (choix.inscription) {
    const reste = Math.max(0, situation.inscriptionDue - situation.inscriptionPayee);
    if (reste > 0) lignes.push({ type: "inscription", mois: null, article_id: null, montant: reste, libelle: null });
  }
  const moisChoisis = [...new Set(choix.mois ?? [])];
  for (const m of moisChoisis) {
    const ligne = situation.mois.find((l) => l.mois === m);
    if (!ligne) return { erreur: "Mois invalide pour cette année scolaire." };
    if (ligne.reste > 0)
      lignes.push({ type: "mensualite", mois: m, article_id: null, montant: ligne.reste, libelle: libelleTranche(ligne, ligne.paye, ligne.reste) });
  }
  for (const cle of new Set(choix.articles ?? [])) {
    const ligne = situation.articles.find((l) => l.cle === cle);
    if (!ligne) return { erreur: "Article introuvable pour cet élève." };
    if (ligne.reste > 0)
      lignes.push({ type: "autre", mois: ligne.mois, article_id: ligne.article_id, montant: ligne.reste, libelle: ligne.libelle });
  }
  if (lignes.length === 0) return { erreur: RIEN_A_ENCAISSER };

  const partiel = choix.montant != null && choix.montant > 0;
  if (partiel) {
    if (lignes.length > 1) return { erreur: "Un montant partiel ne s'applique qu'à une seule ligne." };
    const ligne = lignes[0];
    if (choix.montant! > ligne.montant) return { erreur: `Le montant dépasse le reste dû (${ligne.montant} FCFA).` };
    ligne.montant = choix.montant!;
    if (ligne.type === "mensualite") {
      const l = situation.mois.find((x) => x.mois === ligne.mois)!;
      ligne.libelle = libelleTranche(l, l.paye, ligne.montant);
    }
  }

  const tranche = !partiel && choix.inclure_tranche !== false ? trancheAvecMois(situation, moisChoisis) : null;
  if (tranche) lignes.push({ type: "mensualite", mois: tranche.mois, article_id: null, montant: tranche.montant, libelle: tranche.libelle });
  return { lignes, tranche };
}

/** Ce qui est exigible dès l'inscription : frais, mensualités payées d'avance, frais uniques (articles obligatoires ou choisis) */
export function choixALinscription(situation: Situation): ChoixEncaissement {
  return {
    inscription: situation.inscriptionDue > situation.inscriptionPayee,
    mois: situation.mois.filter((m) => m.aLinscription && m.reste > 0).map((m) => m.mois),
    articles: situation.articles.filter((a) => a.nature === "unique" && a.reste > 0).map((a) => a.cle),
    inclure_tranche: false,
  };
}

/** Le paiement libre (hors catalogue) n'est permis que pour un élève encore inscrit : un élève parti ne règle que son solde dû */
export function paiementLibreAutorise(statut: StatutInscription): boolean {
  return statut === "active";
}
