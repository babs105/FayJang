import { echeanceDuMois, formatMois, moisScolaires } from "@/lib/dates";
import type { Ecole, Inscription, Paiement } from "@/types/database";

export type StatutMois = "paye" | "partiel" | "retard" | "a_venir" | "non_du";

/** Paiement du dernier mois par tranches (option de l'école) */
export interface InfoTranches {
  /** Mois dont l'échéance porte une tranche (YYYY-MM-01) */
  mois: string[];
  total: number;
  /** Tranches dont l'échéance est passée */
  echues: number;
  /** Montant d'une tranche (la dernière absorbe l'arrondi) */
  montant: number;
  /** Montant proposé par défaut à l'encaissement : le retard s'il y en a, sinon la prochaine tranche */
  suggestion: number;
  /** Échéance de la prochaine tranche non échue, ou null */
  prochaine: string | null;
}

export interface LigneMois {
  mois: string; // YYYY-MM-01
  echeance: string; // YYYY-MM-DD
  du: number;
  paye: number;
  reste: number;
  /** Part du mois déjà exigible à aujourd'hui (tout le mois, ou les tranches échues) */
  duEchu: number;
  /** Retard sur ce mois : duEchu - payé */
  resteEchu: number;
  statut: StatutMois;
  tranches?: InfoTranches;
}

export interface Situation {
  inscriptionDue: number;
  inscriptionPayee: number;
  mois: LigneMois[];
  /** Total échu à aujourd'hui (inscription + mensualités et tranches dont l'échéance est passée) */
  totalEchu: number;
  totalPaye: number;
  /** Reste à payer sur ce qui est échu : l'arriéré */
  arriere: number;
  /** Reste à payer sur toute l'année */
  resteAnnee: number;
  moisEnRetard: number;
}

export type CalendrierEcole = Pick<Ecole, "mois_debut" | "nb_mensualites" | "jour_echeance"> &
  Partial<Pick<Ecole, "tranches_dernier_mois" | "mois_debut_tranches" | "nb_tranches">>;
type InscriptionTarifs = Pick<Inscription, "annee_scolaire" | "frais_inscription" | "mensualite" | "reduction_mensuelle" | "statut">;
type PaiementCalcul = Pick<Paiement, "type" | "mois" | "montant" | "annule">;

/** Montant dû chaque mois après réduction */
export function mensualiteNette(ins: Pick<Inscription, "mensualite" | "reduction_mensuelle">): number {
  return Math.max(0, ins.mensualite - ins.reduction_mensuelle);
}

/** Nombre maximal de tranches possible à partir d'un mois de début (jusqu'à l'avant-dernier mois), 0 si impossible */
export function maxTranches(anneeScolaire: string, ecole: CalendrierEcole, moisDebutTranches: number): number {
  const mois = moisScolaires(anneeScolaire, ecole.mois_debut, ecole.nb_mensualites);
  const debut = mois.findIndex((m) => Number(m.slice(5, 7)) === moisDebutTranches);
  return debut < 0 ? 0 : Math.max(0, mois.length - 1 - debut);
}

/**
 * Mois qui portent une tranche du dernier mois : `nb_tranches` mois consécutifs à partir de `mois_debut_tranches`
 * (sans nombre : jusqu'à l'avant-dernier mois). Les tranches doivent finir avant le dernier mois.
 * Vide si l'option est désactivée ou si le réglage ne tient pas dans l'année scolaire.
 */
export function moisDesTranches(anneeScolaire: string, ecole: CalendrierEcole): string[] {
  if (!ecole.tranches_dernier_mois || !ecole.mois_debut_tranches) return [];
  const mois = moisScolaires(anneeScolaire, ecole.mois_debut, ecole.nb_mensualites);
  const debut = mois.findIndex((m) => Number(m.slice(5, 7)) === ecole.mois_debut_tranches);
  if (debut < 0 || debut >= mois.length - 1) return [];
  const fin = ecole.nb_tranches ? debut + ecole.nb_tranches : mois.length - 1;
  if (fin > mois.length - 1) return [];
  return mois.slice(debut, fin);
}

/** Part exigible du dernier mois après `echues` tranches sur `total` (la dernière tranche solde le mois) */
export function partEchue(du: number, echues: number, total: number): number {
  if (echues >= total) return du;
  return echues * Math.floor(du / total);
}

/**
 * Situation financière d'une inscription à une date donnée (todayDakar()).
 * Les paiements annulés sont ignorés. Un élève en abandon ne doit plus les mois qui suivent son départ :
 * seuls les mois déjà payés comptent alors (pas d'arriéré fictif).
 * Avec l'option « tranches », le dernier mois devient exigible par parts, à l'échéance de chaque mois de tranche.
 */
export function situationInscription(
  ins: InscriptionTarifs,
  paiements: PaiementCalcul[],
  ecole: CalendrierEcole,
  aujourdhui: string
): Situation {
  const valides = paiements.filter((p) => !p.annule);
  const inscriptionPayee = valides.filter((p) => p.type === "inscription").reduce((s, p) => s + p.montant, 0);
  const net = mensualiteNette(ins);
  const actif = ins.statut === "active";
  const tous = moisScolaires(ins.annee_scolaire, ecole.mois_debut, ecole.nb_mensualites);
  const dernier = tous[tous.length - 1];
  const moisTranches = moisDesTranches(ins.annee_scolaire, ecole);

  const mois = tous.map((m): LigneMois => {
    const paye = valides.filter((p) => p.type === "mensualite" && p.mois?.slice(0, 7) === m.slice(0, 7)).reduce((s, p) => s + p.montant, 0);
    const echeance = echeanceDuMois(m, ecole.jour_echeance);
    const du = actif ? net : Math.min(net, paye);
    const reste = Math.max(0, du - paye);

    let tranches: InfoTranches | undefined;
    let duEchu = echeance <= aujourdhui ? du : 0;
    if (m === dernier && moisTranches.length > 0 && du > 0) {
      const total = moisTranches.length;
      const echeances = moisTranches.map((t) => echeanceDuMois(t, ecole.jour_echeance));
      const echues = echeances.filter((e) => e <= aujourdhui).length;
      const montant = Math.floor(du / total);
      duEchu = echeance <= aujourdhui ? du : partEchue(du, echues, total);
      const retard = Math.max(0, duEchu - paye);
      // Sans retard : de quoi couvrir la prochaine tranche pas encore payée (paiements d'avance compris)
      let k = 1;
      while (k < total && partEchue(du, k, total) <= paye) k++;
      const suggestion = retard > 0 ? retard : Math.min(reste, Math.max(0, partEchue(du, k, total) - paye));
      tranches = {
        mois: moisTranches,
        total,
        echues,
        montant,
        suggestion,
        prochaine: echeances.find((e) => e > aujourdhui) ?? null,
      };
    }
    const resteEchu = Math.max(0, duEchu - paye);

    const statut: StatutMois =
      du === 0 ? "non_du" : reste === 0 ? "paye" : resteEchu > 0 && paye === 0 ? "retard" : paye > 0 ? "partiel" : "a_venir";
    return { mois: m, echeance, du, paye, reste, duEchu, resteEchu, statut, tranches };
  });

  const inscriptionDue = ins.frais_inscription;
  const resteInscription = Math.max(0, inscriptionDue - inscriptionPayee);
  const totalEchu = inscriptionDue + mois.reduce((s, m) => s + m.duEchu, 0);
  const totalPaye = valides.reduce((s, p) => s + p.montant, 0);
  const arriere = resteInscription + mois.reduce((s, m) => s + m.resteEchu, 0);
  const resteAnnee = resteInscription + mois.reduce((s, m) => s + m.reste, 0);
  const moisEnRetard = mois.filter((m) => m.resteEchu > 0).length;

  return { inscriptionDue, inscriptionPayee, mois, totalEchu, totalPaye, arriere, resteAnnee, moisEnRetard };
}

/** Plus petit nombre de tranches k (1..total) dont la part atteint `montant` */
function trancheAtteinte(du: number, total: number, montant: number): number {
  let k = 1;
  while (k < total && partEchue(du, k, total) < montant) k++;
  return k;
}

/**
 * Libellé d'un versement sur le dernier mois payé par tranches, d'après ce qui était déjà payé avant lui :
 * « Tranche 2/3 de juin 2027 », ou « Tranches 1 à 2/3 de juin 2027 » s'il en couvre plusieurs.
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

export interface TrancheIncluse {
  mois: string; // dernier mois (YYYY-MM-01)
  montant: number;
  libelle: string;
}

/**
 * Tranche du dernier mois à encaisser avec les mensualités choisies : pour chaque mois choisi qui porte une
 * tranche, le dernier mois doit être payé jusqu'à la part de cette tranche. Renvoie ce qui manque (déjà payé
 * et paiements d'avance déduits), ou null s'il n'y a rien à ajouter. Rien si le dernier mois est lui-même choisi.
 */
export function trancheAvecMois(situation: Situation, moisChoisis: string[]): TrancheIncluse | null {
  const dernier = situation.mois.find((m) => m.tranches);
  if (!dernier?.tranches || dernier.reste === 0 || moisChoisis.includes(dernier.mois)) return null;
  const indices = moisChoisis.map((m) => dernier.tranches!.mois.indexOf(m)).filter((i) => i >= 0);
  if (indices.length === 0) return null;
  const cible = partEchue(dernier.du, Math.max(...indices) + 1, dernier.tranches.total);
  const montant = Math.min(dernier.reste, Math.max(0, cible - dernier.paye));
  if (montant === 0) return null;
  return { mois: dernier.mois, montant, libelle: libelleTranche(dernier, dernier.paye, montant)! };
}
