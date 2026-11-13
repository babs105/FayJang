// Situation d'une inscription : ce qui est dû, payé, en retard et restant, mois par mois et article par article.
// Tranches du mois ciblé : tranches.ts ; lignes d'un encaissement : a-encaisser.ts (réexportés ici).
import { echeanceDuMois, formatMois, moisScolaires } from "@/lib/metier/dates";
import { indexCible, moisDesTranches, partEchue } from "@/lib/metier/tranches";
import type { ArticleInscription, Ecole, Inscription, Paiement } from "@/types/database";

export * from "@/lib/metier/tranches";
export * from "@/lib/metier/a-encaisser";

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
