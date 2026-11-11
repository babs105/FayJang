// Reprise de l'existant : répartition de ce qu'un élève a déjà versé en paiements (inscription, mensualités, tranches,
// articles). Fonction pure, sans accès à la base. Le dû vient d'une seule source, situationInscription(), appelée sans
// paiement : les « bacs » reprennent ses lignes, le versé les remplit dans l'ordre où l'école les aurait encaissés. Un
// second appel sur les paiements produits donne l'arriéré et le reste de l'année que l'app affichera après l'import.
import { echeanceDuMois, moisScolaires } from "@/lib/dates";
import { libellePaiement } from "@/lib/libelles";
import {
  libelleArticle,
  libelleTranche,
  mensualiteDernierMois,
  mensualiteNette,
  moisCibleTranches,
  moisDesTranches,
  partEchue,
  situationInscription,
  verifierReglages,
  type ArticleCalcul,
  type CalendrierEcole,
  type InfoTranches,
} from "@/lib/scolarite";
import { formatFCFA } from "@/lib/utils";
import type { NatureArticle, StatutInscription } from "@/types/database";

/** Article du catalogue d'une classe ; l'ordre du tableau est l'ordre du catalogue */
export interface ArticleCatalogueRep {
  libelle: string;
  nature: NatureArticle;
  prix: number;
  quantiteDefaut: number;
  obligatoire: boolean;
}

export interface EntreeRepartition {
  anneeScolaire: string;
  /** Date de l'import (Dakar), AAAA-MM-JJ */
  aujourdhui: string;
  /** Paramètres de l'école */
  ecole: CalendrierEcole;
  /** Tarifs de l'inscription (classe en base, ou classe du fichier) */
  tarifs: { frais: number; mensualite: number; dernierMois: number | null };
  reduction: number | null;
  catalogue: ArticleCatalogueRep[];
  statut: StatutInscription;
  dateDepart: string | null;
  verseScolarite: number | null;
  verseArticles: number | null;
  /** Options choisies ; quantite null = quantité par défaut ; debut = premier mois (AAAA-MM-01) d'un service mensuel,
   *  null ou absent = règle par défaut ; fin = dernier mois d'un service arrêté, null ou absent = en cours (ou jusqu'au
   *  départ). Un service arrêté puis repris est cité une fois par période, chacune avec son début. */
  options: { libelle: string; quantite: number | null; debut?: string | null; fin?: string | null }[];
}

export interface PaiementPrevu {
  type: "inscription" | "mensualite" | "autre";
  /** AAAA-MM-01 : mois de la mensualité ou du service ; null pour l'inscription et un frais unique */
  mois: string | null;
  /** Libellé de l'article du catalogue pour le type « autre » */
  article: string | null;
  /** Type « autre » : position de la ligne dans `articles` (un service repris a une ligne par période) */
  articleIndex: number | null;
  montant: number;
  /** Texte affiché (« Mensualité de novembre 2026 », « Tenue × 2 », « Tranches 1 à 2/3 de mai 2027 ») */
  libelle: string;
  /** Libellé de tranche à enregistrer, ou null */
  libelleTranche: string | null;
}

/** Article à rattacher à l'inscription, avec la période de son service */
export interface ArticlePrevu {
  libelle: string;
  nature: NatureArticle;
  prix: number;
  quantite: number;
  obligatoire: boolean;
  moisDebut: string | null;
  moisFin: string | null;
}

export interface ResumeRepartition {
  /** Ce que l'app affichera après l'import, calculé par situationInscription sur les paiements produits */
  arriere: number;
  resteAnnee: number;
  totalPaye: number;
}

export type ResultatRepartition =
  | { ok: false; erreur: string }
  | { ok: true; paiements: PaiementPrevu[]; articles: ArticlePrevu[]; resume: ResumeRepartition; avertissements: string[] };

interface Bac {
  /** Clé du cumul : « ins », ou le mois (YYYY-MM-01) */
  cle: string;
  du: number;
  echeance: string;
  /** À date égale, la mensualité (0) passe avant la tranche (1) */
  rang: number;
}

const entier = (n: number | null | undefined) => n === null || n === undefined || (Number.isInteger(n) && n >= 0);

function controler(e: EntreeRepartition): string | null {
  const reglages = verifierReglages(e.anneeScolaire, e.ecole);
  if (reglages) return `Paramètres de l'école incohérents : ${reglages}`;
  const montants = [e.tarifs.frais, e.tarifs.mensualite, e.tarifs.dernierMois, e.reduction, e.verseScolarite, e.verseArticles];
  for (const a of e.catalogue) montants.push(a.prix, a.quantiteDefaut);
  if (!montants.every(entier)) return "Les montants doivent être des nombres entiers de FCFA, positifs ou nuls.";
  if ((e.reduction ?? 0) > e.tarifs.mensualite) {
    return `La réduction mensuelle (${formatFCFA(e.reduction ?? 0)}) dépasse la mensualité de la classe (${formatFCFA(e.tarifs.mensualite)}).`;
  }
  if (e.statut !== "active" && !e.dateDepart) return "Date de départ obligatoire pour un abandon ou un transfert.";
  return null;
}

export function repartirReprise(e: EntreeRepartition): ResultatRepartition {
  const erreurControle = controler(e);
  if (erreurControle) return { ok: false, erreur: erreurControle };

  const { ecole, anneeScolaire, aujourdhui } = e;
  const tous = moisScolaires(anneeScolaire, ecole.mois_debut, ecole.nb_mensualites);
  const premier = tous[0];
  const dernier = tous[tous.length - 1];
  const actif = e.statut === "active";
  const moisDepart = actif ? null : e.dateDepart!.slice(0, 7);
  const finService = moisDepart ? `${moisDepart}-01` : null;
  const verseScolarite = e.verseScolarite ?? 0;
  const verseArticles = e.verseArticles ?? 0;
  const avertissements: string[] = [];

  // Contrôle défensif des périodes des services mensuels choisis (la validation du fichier l'a déjà fait)
  for (const o of e.options) {
    const def = e.catalogue.find((a) => a.libelle === o.libelle);
    if (def?.nature !== "mensuel") continue;
    if (o.fin && !o.debut) return { ok: false, erreur: `« ${o.libelle} » : une fin de service sans début.` };
    if (!o.debut) continue;
    if (!tous.includes(o.debut)) return { ok: false, erreur: `Le début de « ${o.libelle} » (${o.debut}) est hors de l'année scolaire ${anneeScolaire}.` };
    if (finService && o.debut > finService) return { ok: false, erreur: `Le début de « ${o.libelle} » (${o.debut.slice(0, 7)}) est après le départ de l'élève.` };
    if (o.fin) {
      if (!tous.includes(o.fin)) return { ok: false, erreur: `La fin de « ${o.libelle} » (${o.fin}) est hors de l'année scolaire ${anneeScolaire}.` };
      if (o.fin < o.debut) return { ok: false, erreur: `« ${o.libelle} » : la fin est avant le début.` };
      if (finService && o.fin > finService) return { ok: false, erreur: `La fin de « ${o.libelle} » (${o.fin.slice(0, 7)}) est après le départ de l'élève.` };
    }
  }
  for (const def of e.catalogue) {
    const liste = e.options.filter((o) => o.libelle === def.libelle);
    if (liste.length < 2) continue;
    if (def.nature !== "mensuel") return { ok: false, erreur: `« ${def.libelle} » cité deux fois.` };
    if (liste.some((o) => !o.debut)) return { ok: false, erreur: `« ${def.libelle} » cité plusieurs fois sans période.` };
    const tri = [...liste].sort((a, b) => (a.debut! < b.debut! ? -1 : 1));
    for (let k = 1; k < tri.length; k++) {
      if (!tri[k - 1].fin || tri[k - 1].fin! >= tri[k].debut!) return { ok: false, erreur: `« ${def.libelle} » : les périodes se chevauchent.` };
    }
  }

  const ins = {
    annee_scolaire: anneeScolaire,
    frais_inscription: e.tarifs.frais,
    mensualite: e.tarifs.mensualite,
    mensualite_dernier_mois: e.tarifs.dernierMois,
    reduction_mensuelle: e.reduction ?? 0,
    statut: e.statut,
    date_depart: e.dateDepart,
  };

  // Articles retenus : obligatoires et choisis, dans l'ordre du catalogue ; un service repris a une ligne par période
  const retenus = e.catalogue.flatMap((def, rang) => {
    const choisies = e.options.filter((o) => o.libelle === def.libelle);
    if (!def.obligatoire && !choisies.length) return [];
    if (def.nature === "unique") {
      // Un frais unique de quantité 0 n'est pas rattaché (comme inscrire_eleve) : M-B du backlog
      const quantite = choisies[0]?.quantite ?? def.quantiteDefaut;
      return quantite < 1 ? [] : [{ id: `a${rang}`, rang, def, quantite, debut: null, fin: null }];
    }
    const periodes = choisies.length ? [...choisies].sort((a, b) => ((a.debut ?? "") < (b.debut ?? "") ? -1 : 1)) : [null];
    return periodes.map((o, k) => ({ id: `a${rang}p${k}`, rang, def, quantite: 1, debut: o?.debut ?? null, fin: o?.fin ?? null }));
  });
  const calcul = (r: (typeof retenus)[number], moisDebut: string | null, moisFin: string | null): ArticleCalcul => ({
    id: r.id,
    libelle: r.def.libelle,
    nature: r.def.nature,
    prix_unitaire: r.def.prix,
    quantite: r.quantite,
    obligatoire: r.def.obligatoire,
    mois_debut: moisDebut,
    mois_fin: moisFin,
  });

  // ----- Une seule source pour le dû : la situation sans aucun paiement, services dus dès le premier mois -----
  const sit0 = situationInscription(
    ins,
    [],
    ecole,
    aujourdhui,
    retenus.map((r) => calcul(r, r.def.nature === "mensuel" ? (r.debut ?? premier) : null, r.def.nature === "mensuel" ? (r.fin ?? finService) : null))
  );

  // ----- Pool scolarité -----
  const net = mensualiteNette(ins);
  const netDernier = mensualiteDernierMois(ins);
  const tarifDe = (m: string) => (m === dernier ? netDernier : net);
  const moisTranches = moisDesTranches(anneeScolaire, ecole);
  const cible = moisTranches.length > 0 ? moisCibleTranches(anneeScolaire, ecole) : null;
  const ligneDe = (m: string) => sit0.mois.find((l) => l.mois === m)!;

  const bacs: Bac[] = [];
  if (sit0.inscriptionDue > 0) bacs.push({ cle: "ins", du: sit0.inscriptionDue, echeance: "", rang: 0 });
  const dejaPris = new Set<string>();
  for (const m of [premier, dernier]) {
    const l = ligneDe(m);
    if (l.aLinscription && l.du > 0 && !dejaPris.has(m)) {
      dejaPris.add(m);
      bacs.push({ cle: m, du: l.du, echeance: "", rang: 0 });
    }
  }
  const suivants: Bac[] = [];
  for (const l of sit0.mois) {
    if (dejaPris.has(l.mois) || l.du <= 0) continue;
    if (l.mois === cible) {
      // Mois payé par tranches : une tranche par mois de tranche, jusqu'à épuiser le dû de la situation
      const tarif = tarifDe(l.mois);
      let reste = l.du;
      for (let k = 1; k <= moisTranches.length && reste > 0; k++) {
        const part = Math.min(reste, partEchue(tarif, k, moisTranches.length) - partEchue(tarif, k - 1, moisTranches.length));
        if (part <= 0) continue;
        suivants.push({ cle: l.mois, du: part, echeance: echeanceDuMois(moisTranches[k - 1], ecole.jour_echeance), rang: 1 });
        reste -= part;
      }
    } else {
      suivants.push({ cle: l.mois, du: l.du, echeance: l.echeance, rang: 0 });
    }
  }
  suivants.sort((a, b) => (a.echeance < b.echeance ? -1 : a.echeance > b.echeance ? 1 : a.rang - b.rang));
  bacs.push(...suivants);

  const parCle = new Map<string, number>();
  const verser = (cle: string, montant: number) => parCle.set(cle, (parCle.get(cle) ?? 0) + montant);
  let reste = verseScolarite;
  for (const b of bacs) {
    const pris = Math.min(reste, b.du);
    if (pris > 0) verser(b.cle, pris);
    reste -= pris;
  }

  // Excédent : refusé pour un élève actif ; rangé après le départ pour un élève parti (décision DO1-B)
  if (reste > 0 && !actif) {
    const avant = reste;
    const extras = sit0.mois
      .filter((l) => l.mois !== cible && tarifDe(l.mois) - l.du > 0)
      .map((l) => ({ cle: l.mois, du: tarifDe(l.mois) - l.du }));
    if (cible) {
      const l = ligneDe(cible);
      if (tarifDe(cible) - l.du > 0) extras.push({ cle: cible, du: tarifDe(cible) - l.du });
    }
    for (const b of extras) {
      const pris = Math.min(reste, b.du);
      if (pris > 0) verser(b.cle, pris);
      reste -= pris;
    }
    if (avant - reste > 0) avertissements.push(`${formatFCFA(avant - reste)} versés après le départ : l'élève les garde, sans remboursement.`);
  }
  if (reste > 0) return { ok: false, erreur: `Le total versé (scolarité) dépasse le dû de l'année de ${formatFCFA(reste)}.` };

  // ----- Pool articles : frais uniques (obligatoires d'abord), puis services mois par mois -----
  const rangDe = (id: string) => retenus.find((r) => r.id === id)!.rang;
  const lignesArticles = sit0.articles
    .filter((l) => l.du > 0)
    .map((l) => ({ l, ordre: l.nature === "unique" ? [0, l.obligatoire ? 0 : 1, rangDe(l.article_id)] : [1, tous.indexOf(l.mois!), rangDe(l.article_id)] }))
    .sort((a, b) => a.ordre[0] - b.ordre[0] || a.ordre[1] - b.ordre[1] || a.ordre[2] - b.ordre[2]);
  const paiementsArticles: PaiementPrevu[] = [];
  const recoit = new Set<string>();
  let resteArt = verseArticles;
  for (const { l } of lignesArticles) {
    const pris = Math.min(resteArt, l.du);
    if (pris <= 0) continue;
    resteArt -= pris;
    recoit.add(l.article_id);
    const index = retenus.findIndex((r) => r.id === l.article_id);
    paiementsArticles.push({ type: "autre", mois: l.mois, article: retenus[index].def.libelle, articleIndex: index, montant: pris, libelle: l.libelle, libelleTranche: null });
  }
  if (resteArt > 0) return { ok: false, erreur: `Le total versé (articles) dépasse le dû des articles de ${formatFCFA(resteArt)}.` };

  // ----- Période des services -----
  const moisImport = `${aujourdhui.slice(0, 7)}-01`;
  const articles: ArticlePrevu[] = [];
  const articlesFinaux: ArticleCalcul[] = [];
  // Position d'un article dans `retenus` -> position dans `articles` (un service non rattaché disparaît de la liste)
  const nouvelleIndex = new Map<number, number>();
  for (const [position, r] of retenus.entries()) {
    let debut: string | null = null;
    let fin: string | null = null;
    if (r.def.nature === "mensuel") {
      debut = r.debut ?? (recoit.has(r.id) ? premier : moisImport > premier ? moisImport : premier);
      fin = r.fin ?? finService;
      // Service sans versement, import après le départ : il reste dû pour le mois du départ, obligatoire ou
      // optionnel (décision de l'humain, review database T2, M-A)
      if (fin && debut > fin) {
        debut = fin;
        avertissements.push(`« ${r.def.libelle} » : aucun versement, il est dû pour le mois du départ.`);
      }
      // Import après le dernier mois de l'année, service sans versement ni début donné : rien n'est dû, on ne le
      // rattache pas plutôt que d'écrire un début hors de l'année (M-C du backlog)
      if (debut > dernier) {
        avertissements.push(`« ${r.def.libelle} » : l'année scolaire est terminée et le service n'a aucun versement, il n'est pas rattaché.`);
        continue;
      }
    }
    nouvelleIndex.set(position, articles.length);
    articles.push({
      libelle: r.def.libelle, nature: r.def.nature, prix: r.def.prix, quantite: r.quantite,
      obligatoire: r.def.obligatoire, moisDebut: debut, moisFin: fin,
    });
    articlesFinaux.push(calcul(r, debut, fin));
  }

  // ----- Paiements -----
  const paiements: PaiementPrevu[] = [];
  const montantIns = parCle.get("ins") ?? 0;
  if (montantIns > 0) {
    paiements.push({ type: "inscription", mois: null, article: null, articleIndex: null, montant: montantIns, libelle: libellePaiement({ type: "inscription", mois: null, libelle: null }), libelleTranche: null });
  }
  for (const m of tous) {
    const montant = parCle.get(m) ?? 0;
    if (montant <= 0) continue;
    let tranche: string | null = null;
    if (m === cible) {
      const info: InfoTranches = { mois: moisTranches, total: moisTranches.length, echues: 0, montant: 0, suggestion: 0, prochaine: null };
      tranche = libelleTranche({ mois: m, du: tarifDe(m), tranches: info }, 0, montant);
    }
    paiements.push({ type: "mensualite", mois: m, article: null, articleIndex: null, montant, libelle: libellePaiement({ type: "mensualite", mois: m, libelle: tranche }), libelleTranche: tranche });
  }
  paiements.push(...paiementsArticles);

  // ----- Seconde passe : ce que l'app affichera après l'import -----
  // À ce stade articleIndex désigne la position dans `retenus` ; il est converti en position dans `articles` au retour
  const sit = situationInscription(
    ins,
    paiements.map((p) => ({
      type: p.type, mois: p.mois, montant: p.montant, annule: false, article_id: p.articleIndex !== null ? retenus[p.articleIndex].id : null,
    })),
    ecole,
    aujourdhui,
    articlesFinaux
  );
  const coherent =
    sit.totalPaye === verseScolarite + verseArticles &&
    sit.inscriptionPayee <= sit.inscriptionDue &&
    sit.mois.every((l) => l.paye <= l.du) &&
    sit.articles.every((l) => l.paye <= l.du);
  if (!coherent) return { ok: false, erreur: "Répartition impossible : les montants versés ne correspondent pas au dû calculé. Vérifiez la ligne." };

  // `articles` ne contient plus que les services rattachés : articleIndex devient une position dans ce tableau
  const paiementsFinaux = paiements.map((p) => (p.articleIndex === null ? p : { ...p, articleIndex: nouvelleIndex.get(p.articleIndex)! }));
  return { ok: true, paiements: paiementsFinaux, articles, resume: { arriere: sit.arriere, resteAnnee: sit.resteAnnee, totalPaye: sit.totalPaye }, avertissements };
}
