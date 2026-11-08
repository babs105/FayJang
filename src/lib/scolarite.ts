import { echeanceDuMois, formatMois, moisScolaires } from "@/lib/dates";
import type { ArticleInscription, Ecole, Inscription, Paiement, StatutInscription, TypePaiement } from "@/types/database";

export type StatutMois = "paye" | "partiel" | "retard" | "a_venir" | "non_du";

/** Paiement d'un mois par tranches (option de l'école : dernier, avant-dernier ou antépénultième mois) */
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
  /** Mensualité exigible dès l'inscription (1er ou dernier mois, réglage de l'école) */
  aLinscription: boolean;
  tranches?: InfoTranches;
}

/** Ligne due au titre d'un article : frais unique (tenue × 2) ou un mois d'un service (transport de novembre) */
export interface LigneArticle {
  /** Clé de sélection : id de l'article, suivi de « :YYYY-MM-01 » pour un mois de service */
  cle: string;
  article_id: string;
  nature: "unique" | "mensuel";
  libelle: string;
  /** Mois du service, null pour un frais unique */
  mois: string | null;
  /** Échéance, null pour un frais unique (exigible dès l'inscription) */
  echeance: string | null;
  obligatoire: boolean;
  du: number;
  paye: number;
  reste: number;
  duEchu: number;
  resteEchu: number;
  statut: StatutMois;
}

export interface Situation {
  inscriptionDue: number;
  inscriptionPayee: number;
  mois: LigneMois[];
  articles: LigneArticle[];
  /** Total échu à aujourd'hui (inscription + mensualités, tranches et articles exigibles) */
  totalEchu: number;
  totalPaye: number;
  /** Reste à payer sur ce qui est échu : l'arriéré */
  arriere: number;
  /** Reste à payer sur toute l'année */
  resteAnnee: number;
  /** Mensualités en retard (les articles comptent dans l'arriéré, pas ici) */
  moisEnRetard: number;
}

export type CalendrierEcole = Pick<Ecole, "mois_debut" | "nb_mensualites" | "jour_echeance"> &
  Partial<
    Pick<
      Ecole,
      | "tranches_dernier_mois"
      | "mois_debut_tranches"
      | "nb_tranches"
      | "rang_mois_tranches"
      | "premier_mois_a_linscription"
      | "dernier_mois_a_linscription"
    >
  >;
type InscriptionTarifs = Pick<Inscription, "annee_scolaire" | "frais_inscription" | "mensualite" | "reduction_mensuelle" | "statut"> &
  Partial<Pick<Inscription, "mensualite_dernier_mois">> & {
    /** Date de départ (YYYY-MM-DD) d'un élève en abandon / transfert ; ignorée si l'inscription est active */
    date_depart?: string | null;
  };
type PaiementCalcul = Pick<Paiement, "type" | "mois" | "montant" | "annule"> & Partial<Pick<Paiement, "article_id">>;
export type ArticleCalcul = Pick<
  ArticleInscription,
  "id" | "libelle" | "nature" | "prix_unitaire" | "quantite" | "obligatoire" | "mois_debut" | "mois_fin"
>;

/** Montant dû chaque mois après réduction */
export function mensualiteNette(ins: Pick<Inscription, "mensualite" | "reduction_mensuelle">): number {
  return Math.max(0, ins.mensualite - ins.reduction_mensuelle);
}

/** Montant dû le dernier mois après réduction (mensualité du dernier mois si la classe en fixe une) */
export function mensualiteDernierMois(ins: Pick<Inscription, "mensualite" | "reduction_mensuelle"> & Partial<Pick<Inscription, "mensualite_dernier_mois">>): number {
  return Math.max(0, (ins.mensualite_dernier_mois ?? ins.mensualite) - ins.reduction_mensuelle);
}

const NOM_RANG: Record<number, string> = { 1: "dernier mois", 2: "avant-dernier mois", 3: "antépénultième mois" };
export function nomRang(rang: number | null | undefined): string {
  return NOM_RANG[rang ?? 1] ?? "dernier mois";
}

/** Index (dans les mois de l'année) du mois payé par tranches */
function indexCible(nbMois: number, ecole: CalendrierEcole): number {
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

function statutDe(du: number, paye: number, reste: number, resteEchu: number): StatutMois {
  return du === 0 ? "non_du" : reste === 0 ? "paye" : resteEchu > 0 && paye === 0 ? "retard" : paye > 0 ? "partiel" : "a_venir";
}

/** Libellé d'une ligne d'article : « Tenue × 2 », « Transport — novembre 2026 » */
export function libelleArticle(article: Pick<ArticleCalcul, "libelle" | "quantite" | "nature">, mois: string | null): string {
  if (article.nature === "mensuel") return mois ? `${article.libelle} — ${formatMois(mois)}` : article.libelle;
  return article.quantite > 1 ? `${article.libelle} × ${article.quantite}` : article.libelle;
}

/**
 * Situation financière d'une inscription à une date donnée (todayDakar()).
 * Les paiements annulés sont ignorés. Un élève en abandon ou transféré :
 * - sans date de départ (anciens abandons) : seul ce qui est déjà payé compte (pas d'arriéré fictif) ;
 * - avec une date de départ : les mois jusqu'au mois du départ inclus (« mois entamé = dû ») restent dus, les
 *   suivants valent min(tarif, payé) ; un mois par tranches doit les tranches échues à la fin du mois de départ ;
 *   frais d'inscription et frais uniques restent dus ; tout ce qui reste dû est échu immédiatement
 *   (arriéré = reste de l'année).
 * - le 1er et/ou le dernier mois peuvent être exigibles dès l'inscription (réglage de l'école) ;
 * - avec l'option « tranches », le mois ciblé devient exigible par parts, à l'échéance de chaque mois de tranche ;
 * - les frais uniques (tenue, blouson…) sont exigibles dès l'inscription, les services mensuels (transport,
 *   pensionnat) à l'échéance de chaque mois de leur période.
 */
export function situationInscription(
  ins: InscriptionTarifs,
  paiements: PaiementCalcul[],
  ecole: CalendrierEcole,
  aujourdhui: string,
  articles: ArticleCalcul[] = []
): Situation {
  const valides = paiements.filter((p) => !p.annule);
  const inscriptionPayee = valides.filter((p) => p.type === "inscription").reduce((s, p) => s + p.montant, 0);
  const net = mensualiteNette(ins);
  const netDernier = mensualiteDernierMois(ins);
  const actif = ins.statut === "active";
  const moisDepart = !actif && ins.date_depart ? ins.date_depart.slice(0, 7) : null;
  const parti = moisDepart !== null;
  const tous = moisScolaires(ins.annee_scolaire, ecole.mois_debut, ecole.nb_mensualites);
  const premier = tous[0];
  const dernier = tous[tous.length - 1];
  const moisTranches = moisDesTranches(ins.annee_scolaire, ecole);
  const cible = moisTranches.length > 0 ? tous[indexCible(tous.length, ecole)] : null;

  const mois = tous.map((m): LigneMois => {
    const paye = valides
      .filter((p) => p.type === "mensualite" && !p.article_id && p.mois?.slice(0, 7) === m.slice(0, 7))
      .reduce((s, p) => s + p.montant, 0);
    const echeance = echeanceDuMois(m, ecole.jour_echeance);
    const tarif = m === dernier ? netDernier : net;
    const aLinscription =
      (m === premier && !!ecole.premier_mois_a_linscription) || (m === dernier && !!ecole.dernier_mois_a_linscription);
    let du: number;
    if (actif) du = tarif;
    else if (!parti) du = Math.min(tarif, paye);
    else if (m.slice(0, 7) <= moisDepart! || (m === premier && aLinscription)) du = tarif;
    else {
      // Après le départ : le payé est gardé ; un mois par tranches doit les tranches échues à la fin du mois de départ
      let partDepart = 0;
      if (m === cible && !aLinscription) {
        const finDepart = `${moisDepart}-31`;
        const echues = moisDesTranches(ins.annee_scolaire, ecole).filter((t) => echeanceDuMois(t, ecole.jour_echeance) <= finDepart).length;
        partDepart = partEchue(tarif, echues, moisTranches.length);
      }
      du = Math.max(Math.min(tarif, paye), partDepart);
    }
    const reste = Math.max(0, du - paye);

    let tranches: InfoTranches | undefined;
    let duEchu = parti || aLinscription || echeance <= aujourdhui ? du : 0;
    // Un élève parti n'a plus de tranches : le mois est dû pour la part arrêtée au départ
    if (m === cible && !aLinscription && !parti && du > 0) {
      const total = moisTranches.length;
      const echeances = moisTranches.map((t) => echeanceDuMois(t, ecole.jour_echeance));
      const echues = echeances.filter((e) => e <= aujourdhui).length;
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
        montant: Math.floor(du / total),
        suggestion,
        prochaine: echeances.find((e) => e > aujourdhui) ?? null,
      };
    }
    const resteEchu = Math.max(0, duEchu - paye);
    return { mois: m, echeance, du, paye, reste, duEchu, resteEchu, statut: statutDe(du, paye, reste, resteEchu), aLinscription, tranches };
  });

  const lignesArticles: LigneArticle[] = [];
  for (const a of articles) {
    const payesArticle = valides.filter((p) => p.article_id === a.id);
    const ajouter = (m: string | null, echeance: string | null) => {
      const paye = payesArticle.filter((p) => (m ? p.mois?.slice(0, 7) === m.slice(0, 7) : true)).reduce((s, p) => s + p.montant, 0);
      const tarif = a.prix_unitaire * (a.nature === "unique" ? a.quantite : 1);
      // Frais unique : dû en entier ; service mensuel : mois entamé = dû, ensuite min(tarif, payé)
      const du = actif || (parti && (m === null || m.slice(0, 7) <= moisDepart!)) ? tarif : Math.min(tarif, paye);
      const reste = Math.max(0, du - paye);
      const duEchu = parti || echeance === null || echeance <= aujourdhui ? du : 0;
      const resteEchu = Math.max(0, duEchu - paye);
      lignesArticles.push({
        cle: m ? `${a.id}:${m}` : a.id,
        article_id: a.id,
        nature: a.nature,
        libelle: libelleArticle(a, m),
        mois: m,
        echeance,
        obligatoire: a.obligatoire,
        du,
        paye,
        reste,
        duEchu,
        resteEchu,
        statut: statutDe(du, paye, reste, resteEchu),
      });
    };
    if (a.nature === "unique") {
      ajouter(null, null);
    } else {
      const debut = (a.mois_debut ?? premier).slice(0, 7);
      const fin = (a.mois_fin ?? dernier).slice(0, 7);
      for (const m of tous) {
        const cle = m.slice(0, 7);
        // Un mois hors période reste affiché s'il a déjà été payé (service arrêté après paiement)
        const horsPeriode = cle < debut || cle > fin;
        if (horsPeriode && !payesArticle.some((p) => p.mois?.slice(0, 7) === cle)) continue;
        if (horsPeriode) {
          const paye = payesArticle.filter((p) => p.mois?.slice(0, 7) === cle).reduce((s, p) => s + p.montant, 0);
          lignesArticles.push({
            cle: `${a.id}:${m}`, article_id: a.id, nature: a.nature, libelle: libelleArticle(a, m), mois: m,
            echeance: echeanceDuMois(m, ecole.jour_echeance), obligatoire: a.obligatoire,
            du: paye, paye, reste: 0, duEchu: paye, resteEchu: 0, statut: "paye",
          });
          continue;
        }
        ajouter(m, echeanceDuMois(m, ecole.jour_echeance));
      }
    }
  }

  const inscriptionDue = ins.frais_inscription;
  const resteInscription = Math.max(0, inscriptionDue - inscriptionPayee);
  const somme = (champ: "duEchu" | "resteEchu" | "reste") =>
    mois.reduce((s, m) => s + m[champ], 0) + lignesArticles.reduce((s, l) => s + l[champ], 0);
  const totalEchu = inscriptionDue + somme("duEchu");
  const totalPaye = valides.reduce((s, p) => s + p.montant, 0);
  const arriere = resteInscription + somme("resteEchu");
  const resteAnnee = resteInscription + somme("reste");
  const moisEnRetard = mois.filter((m) => m.resteEchu > 0).length;

  return { inscriptionDue, inscriptionPayee, mois, articles: lignesArticles, totalEchu, totalPaye, arriere, resteAnnee, moisEnRetard };
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

export interface TrancheIncluse {
  mois: string; // mois payé par tranches (YYYY-MM-01)
  montant: number;
  libelle: string;
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

/** Ce que l'administration coche à l'encaissement */
export interface ChoixEncaissement {
  inscription?: boolean;
  /** Mensualités (YYYY-MM-01) */
  mois?: string[];
  /** Clés de LigneArticle.cle */
  articles?: string[];
  /** Montant partiel : accepté pour une seule ligne choisie */
  montant?: number | null;
  /** Ajouter la tranche portée par les mois choisis (par défaut oui) */
  inclure_tranche?: boolean;
}

export interface LigneEncaissement {
  type: TypePaiement;
  mois: string | null;
  article_id: string | null;
  montant: number;
  libelle: string | null;
}

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
  if (lignes.length === 0) return { erreur: "Rien à encaisser : ce qui est choisi est déjà payé." };

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
