// Mois payé par tranches (option de l'école) : mois ciblé, mois qui portent une tranche, réglages, libellés et part exigible.
import { formatMois, moisScolaires } from "@/lib/metier/dates";
import type { CalendrierEcole, InfoTranches, LigneMois, Situation } from "@/types/commun";
import type { TrancheIncluse } from "@/types/ecole";

const NOM_RANG: Record<number, string> = { 1: "dernier mois", 2: "avant-dernier mois", 3: "antépénultième mois" };
export function nomRang(rang: number | null | undefined): string {
  return NOM_RANG[rang ?? 1] ?? "dernier mois";
}

/** Index (dans les mois de l'année) du mois payé par tranches */
export function indexCible(nbMois: number, ecole: CalendrierEcole): number {
  return nbMois - Math.min(Math.max(ecole.rang_mois_tranches ?? 1, 1), 3);
}

/** Mois payé par tranches (YYYY-MM-01) d'après le rang choisi par l'école, ou null */
export function moisCibleTranches(anneeScolaire: string, ecole: CalendrierEcole): string | null {
  const mois = moisScolaires(anneeScolaire, ecole.mois_debut, ecole.nb_mensualites);
  const i = indexCible(mois.length, ecole);
  return i >= 0 ? mois[i] : null;
}

/** Nombre maximal de tranches possible à partir d'un mois de début (jusqu'au mois qui précède le mois ciblé), 0 si impossible */
export function maxTranches(anneeScolaire: string, ecole: CalendrierEcole, moisDebutTranches: number): number {
  const mois = moisScolaires(anneeScolaire, ecole.mois_debut, ecole.nb_mensualites);
  const debut = mois.findIndex((m) => Number(m.slice(5, 7)) === moisDebutTranches);
  return debut < 0 ? 0 : Math.max(0, indexCible(mois.length, ecole) - debut);
}

/**
 * Mois qui portent une tranche du mois ciblé : `nb_tranches` mois consécutifs à partir de `mois_debut_tranches`
 * (sans nombre : jusqu'au mois qui précède le mois ciblé). Les tranches doivent finir avant le mois ciblé.
 * Vide si l'option est désactivée ou si le réglage ne tient pas dans l'année scolaire.
 */
export function moisDesTranches(anneeScolaire: string, ecole: CalendrierEcole): string[] {
  if (!ecole.tranches_dernier_mois || !ecole.mois_debut_tranches) return [];
  const mois = moisScolaires(anneeScolaire, ecole.mois_debut, ecole.nb_mensualites);
  const cible = indexCible(mois.length, ecole);
  const debut = mois.findIndex((m) => Number(m.slice(5, 7)) === ecole.mois_debut_tranches);
  if (cible < 1 || debut < 0 || debut >= cible) return [];
  const fin = ecole.nb_tranches ? debut + ecole.nb_tranches : cible;
  if (fin > cible) return [];
  return mois.slice(debut, fin);
}

/**
 * Contrôle des réglages d'encaissement de l'école. Renvoie un message d'erreur lisible, ou null.
 * Le mois payé par tranches ne peut pas être aussi un mois payé à l'inscription.
 */
export function verifierReglages(anneeScolaire: string, ecole: CalendrierEcole): string | null {
  const mois = moisScolaires(anneeScolaire, ecole.mois_debut, ecole.nb_mensualites);
  if (!ecole.tranches_dernier_mois) return null;
  const cible = indexCible(mois.length, ecole);
  if (cible < 1) return "L'année est trop courte pour payer ce mois par tranches.";
  if (cible === mois.length - 1 && ecole.dernier_mois_a_linscription)
    return "Le dernier mois est payé à l'inscription : choisissez l'avant-dernier mois pour les tranches.";
  if (!ecole.mois_debut_tranches) return "Choisissez le mois de la première tranche.";
  const max = maxTranches(anneeScolaire, ecole, ecole.mois_debut_tranches);
  if (max < 1) return `La première tranche doit tomber avant le ${nomRang(ecole.rang_mois_tranches)} (${formatMois(mois[cible])}).`;
  if (ecole.nb_tranches && ecole.nb_tranches > max)
    return `À partir de ce mois, ${max} tranche${max > 1 ? "s" : ""} au plus avant ${formatMois(mois[cible])}.`;
  return null;
}

/** Part exigible du mois ciblé après `echues` tranches sur `total` (la dernière tranche solde le mois) */
export function partEchue(du: number, echues: number, total: number): number {
  if (echues >= total) return du;
  return echues * Math.floor(du / total);
}

/** Plus petit nombre de tranches k (1..total) dont la part atteint `montant` */
function trancheAtteinte(du: number, total: number, montant: number): number {
  let k = 1;
  while (k < total && partEchue(du, k, total) < montant) k++;
  return k;
}

/**
 * Libellé d'un versement sur le mois payé par tranches, d'après ce qui était déjà payé avant lui :
 * « Tranche 2/3 de mai 2027 », ou « Tranches 1 à 2/3 de mai 2027 » s'il en couvre plusieurs.
 */
export function libelleTranche(ligne: Pick<LigneMois, "mois" | "du"> & { tranches?: InfoTranches }, payeAvant: number, montant: number): string | null {
  if (!ligne.tranches || montant <= 0) return null;
  const { total } = ligne.tranches;
  // Première tranche que ce versement entame : celle dont la part dépasse ce qui était déjà payé
  let debut = 1;
  while (debut < total && partEchue(ligne.du, debut, total) <= payeAvant) debut++;
  const fin = trancheAtteinte(ligne.du, total, payeAvant + montant);
  const mois = formatMois(ligne.mois);
  return debut === fin ? `Tranche ${fin}/${total} de ${mois}` : `Tranches ${debut} à ${fin}/${total} de ${mois}`;
}

/**
 * Tranche à encaisser avec les mensualités choisies : pour chaque mois choisi qui porte une tranche, le mois
 * ciblé doit être payé jusqu'à la part de cette tranche. Renvoie ce qui manque (déjà payé et paiements
 * d'avance déduits), ou null s'il n'y a rien à ajouter. Rien si le mois ciblé est lui-même choisi.
 */
export function trancheAvecMois(situation: Situation, moisChoisis: string[]): TrancheIncluse | null {
  const ligne = situation.mois.find((m) => m.tranches);
  if (!ligne?.tranches || ligne.reste === 0 || moisChoisis.includes(ligne.mois)) return null;
  const indices = moisChoisis.map((m) => ligne.tranches!.mois.indexOf(m)).filter((i) => i >= 0);
  if (indices.length === 0) return null;
  const cible = partEchue(ligne.du, Math.max(...indices) + 1, ligne.tranches.total);
  const montant = Math.min(ligne.reste, Math.max(0, cible - ligne.paye));
  if (montant === 0) return null;
  return { mois: ligne.mois, montant, libelle: libelleTranche(ligne, ligne.paye, montant)! };
}
