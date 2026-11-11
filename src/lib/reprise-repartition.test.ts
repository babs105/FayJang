import { describe, expect, it } from "vitest";
import { moisScolaires } from "./dates";
import { CAS_REPRISE, type CasReprise, type ReglagesCas } from "./reprise-cas.fixture";
import { repartirReprise, type ArticleCatalogueRep, type EntreeRepartition, type ResultatRepartition } from "./reprise-repartition";
import { situationInscription, type ArticleCalcul } from "./scolarite";

type Ok = Extract<ResultatRepartition, { ok: true }>;

const R = (o: Partial<ReglagesCas> = {}): ReglagesCas => ({
  mois_debut: 10, nb_mensualites: 9, jour_echeance: 5, tranches_dernier_mois: false, mois_debut_tranches: null,
  nb_tranches: null, rang_mois_tranches: 1, premier_mois_a_linscription: false, dernier_mois_a_linscription: false, ...o,
});
/** Juin à l'inscription, mai en 3 tranches (janvier, février, mars) */
const MAI_EN_TRANCHES = R({ dernier_mois_a_linscription: true, tranches_dernier_mois: true, rang_mois_tranches: 2, mois_debut_tranches: 1, nb_tranches: 3 });
/** Juin (dernier mois) en 3 tranches (mars, avril, mai) */
const JUIN_EN_TRANCHES = R({ tranches_dernier_mois: true, rang_mois_tranches: 1, mois_debut_tranches: 3, nb_tranches: 3 });

const CATALOGUE_CM2A: ArticleCatalogueRep[] = [
  { libelle: "Tenue", nature: "unique", prix: 8000, quantiteDefaut: 2, obligatoire: true },
  { libelle: "Transport", nature: "mensuel", prix: 5000, quantiteDefaut: 1, obligatoire: false },
  { libelle: "Cantine", nature: "mensuel", prix: 10000, quantiteDefaut: 1, obligatoire: false },
];

function depuisCas(c: CasReprise): EntreeRepartition {
  return {
    anneeScolaire: c.annee,
    aujourdhui: c.aujourdhui,
    ecole: c.reglages,
    tarifs: { frais: c.classe.frais_inscription, mensualite: c.classe.mensualite, dernierMois: c.classe.mensualite_dernier_mois },
    reduction: c.eleve.reduction,
    catalogue: [...c.catalogue]
      .sort((a, b) => a.ordre - b.ordre)
      .map((a) => ({ libelle: a.libelle, nature: a.nature, prix: a.prix_unitaire, quantiteDefaut: a.quantite_defaut, obligatoire: a.obligatoire })),
    statut: c.eleve.statut,
    dateDepart: c.eleve.dateDepart,
    verseScolarite: c.eleve.totalScolarite,
    verseArticles: c.eleve.totalArticles,
    options: c.eleve.options,
  };
}

const cle = (p: { type: string; mois: string | null; article: string | null; montant: number }) => `${p.type}|${p.mois}|${p.article}|${p.montant}`;

function ok(r: ResultatRepartition): Ok {
  if (!r.ok) throw new Error(`Erreur inattendue : ${r.erreur}`);
  return r;
}

describe("repartirReprise : cas de la feuille « Cas d'exemple »", () => {
  for (const c of CAS_REPRISE) {
    it(c.nom, () => {
      const r = repartirReprise(depuisCas(c));
      if ("erreur" in c.attendu) {
        expect(r.ok).toBe(false);
        expect(!r.ok && r.erreur).toContain(c.attendu.erreur);
        return;
      }
      const a = ok(r);
      expect(a.paiements.map(cle).sort()).toEqual(c.attendu.paiements.map(cle).sort());
      const debuts = Object.fromEntries(a.articles.filter((x) => x.nature === "mensuel").map((x) => [x.libelle, x.moisDebut]));
      expect(debuts).toEqual(c.attendu.debutServices);
      expect(a.resume.arriere).toBe(c.attendu.arriere);
      expect(a.resume.resteAnnee).toBe(c.attendu.resteAnnee);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Parité avec l'app : recalcul indépendant à partir des seules sorties de la fonction

function recalcul(e: EntreeRepartition, a: Ok) {
  const ins = {
    annee_scolaire: e.anneeScolaire, frais_inscription: e.tarifs.frais, mensualite: e.tarifs.mensualite,
    mensualite_dernier_mois: e.tarifs.dernierMois, reduction_mensuelle: e.reduction ?? 0, statut: e.statut, date_depart: e.dateDepart,
  };
  const articles: ArticleCalcul[] = a.articles.map((x, i) => ({
    id: `x${i}`, libelle: x.libelle, nature: x.nature, prix_unitaire: x.prix, quantite: x.quantite, obligatoire: x.obligatoire,
    mois_debut: x.moisDebut, mois_fin: x.moisFin,
  }));
  const id = (libelle: string | null) => articles.find((x) => x.libelle === libelle)?.id ?? null;
  const paiements = a.paiements.map((p) => ({ type: p.type, mois: p.mois, montant: p.montant, annule: false, article_id: id(p.article) }));
  return {
    avant: situationInscription(ins, [], e.ecole, e.aujourdhui, articles),
    apres: situationInscription(ins, paiements, e.ecole, e.aujourdhui, articles),
  };
}

function verifierParite(e: EntreeRepartition, a: Ok) {
  // Beaucoup de valeurs par variante : les écarts sont collectés puis signalés en un seul expect (expect est lent)
  const ecarts: string[] = [];
  const egal = (nom: string, obtenu: number, attendu: number) => {
    if (obtenu !== attendu) ecarts.push(`${nom} : ${obtenu} au lieu de ${attendu}`);
  };
  const verse = (e.verseScolarite ?? 0) + (e.verseArticles ?? 0);
  egal("somme des paiements", a.paiements.reduce((s, p) => s + p.montant, 0), verse);
  egal("totalPaye", a.resume.totalPaye, verse); // 1
  const { avant, apres } = recalcul(e, a);
  const dueScol = avant.inscriptionDue + avant.mois.reduce((s, l) => s + l.du, 0);
  const dueArt = avant.articles.reduce((s, l) => s + l.du, 0);
  egal("resteAnnee", a.resume.resteAnnee, Math.max(0, dueScol - (e.verseScolarite ?? 0)) + Math.max(0, dueArt - (e.verseArticles ?? 0))); // 2
  egal("resteAnnee recalculé", apres.resteAnnee, a.resume.resteAnnee);
  egal("arriere recalculé", apres.arriere, a.resume.arriere);
  if (apres.inscriptionPayee > apres.inscriptionDue) ecarts.push("inscription payée au-delà du dû"); // 3
  for (const l of apres.mois) if (l.paye > l.du) ecarts.push(`${l.mois} : payé ${l.paye} > dû ${l.du}`);
  for (const l of apres.articles) if (l.paye > l.du) ecarts.push(`${l.libelle} : payé ${l.paye} > dû ${l.du}`);
  if (ecarts.length) throw new Error(`Versé ${e.verseScolarite}/${e.verseArticles} : ${ecarts.join(" ; ")}`);
}

interface Variante {
  nom: string;
  entree: EntreeRepartition;
}

function variantes(): Variante[] {
  const classes = [
    { nom: "CM2 A", tarifs: { frais: 25000, mensualite: 15000, dernierMois: null as number | null }, reduction: null as number | null },
    { nom: "CE1 réduit", tarifs: { frais: 20000, mensualite: 12000, dernierMois: 6000 }, reduction: 2000 },
  ];
  const reglages: [string, ReglagesCas][] = [
    ["sans réglage", R()],
    ["premier mois à l'inscription", R({ premier_mois_a_linscription: true })],
    ["dernier mois à l'inscription", R({ dernier_mois_a_linscription: true })],
    ["juin en tranches", JUIN_EN_TRANCHES],
    ["mai en tranches + juin à l'inscription", MAI_EN_TRANCHES],
    ["premier et dernier à l'inscription + mai en tranches", { ...MAI_EN_TRANCHES, premier_mois_a_linscription: true }],
  ];
  const departs: [string, string, "active" | "abandon" | "transfert", string | null][] = [
    ["actif", "2026-11-11", "active", null],
    ["actif en mars", "2027-03-01", "active", null],
    ["parti avant les tranches", "2026-11-11", "abandon", "2026-11-05"],
    ["parti pendant les tranches", "2027-03-01", "transfert", "2027-02-10"],
    ["parti après les tranches", "2027-04-20", "abandon", "2027-04-10"],
    ["parti au mois cible", "2027-06-20", "transfert", "2027-06-12"],
    ["parti, import bien après le départ", "2027-01-15", "abandon", "2026-11-05"],
  ];
  const sortie: Variante[] = [];
  for (const cl of classes) {
    for (const [nomR, ecole] of reglages) {
      // La classe à tarifs particuliers (dernier mois, réduction) n'est balayée que sur trois situations
      for (const [nomD, aujourdhui, statut, dateDepart] of cl.nom === "CM2 A" ? departs : departs.filter((_, i) => [0, 3, 6].includes(i))) {
        sortie.push({
          nom: `${cl.nom} / ${nomR} / ${nomD}`,
          entree: {
            anneeScolaire: "2026-2027", aujourdhui, ecole, tarifs: cl.tarifs, reduction: cl.reduction, catalogue: CATALOGUE_CM2A,
            statut, dateDepart, verseScolarite: 0, verseArticles: 0,
            options: [{ libelle: "Transport", quantite: null }, { libelle: "Cantine", quantite: null }],
          },
        });
      }
    }
  }
  return sortie;
}

describe("repartirReprise : parité avec situationInscription", () => {
  for (const v of variantes()) {
    it(`balayage des versés : ${v.nom}`, { timeout: 30000 }, () => {
      const e = v.entree;
      const mois = moisScolaires(e.anneeScolaire, e.ecole.mois_debut, e.ecole.nb_mensualites);
      const net = e.tarifs.mensualite - (e.reduction ?? 0);
      const netDernier = (e.tarifs.dernierMois ?? e.tarifs.mensualite) - (e.reduction ?? 0);
      // Plafond : l'année entière comme si l'élève n'était pas parti
      const plafond = e.tarifs.frais + net * (mois.length - 1) + netDernier;

      const valeurs = new Set<number>([0, 1, plafond - 1, plafond]);
      for (let i = 0; i < plafond; i += 1511) valeurs.add(i);
      for (const verse of valeurs) {
        const entree = { ...e, verseScolarite: verse };
        verifierParite(entree, ok(repartirReprise(entree)));
      }
      const trop = repartirReprise({ ...e, verseScolarite: plafond + 1 });
      expect(trop.ok).toBe(false);
      expect(!trop.ok && trop.erreur).toContain("dépasse");

      // Articles : de 0 au dû des articles de la situation sans paiement, services dus dès le premier mois
      const sans = repartirReprise({ ...e, verseScolarite: 0, verseArticles: 0 });
      const { avant } = recalcul(e, ok(sans));
      const pleinArt = situationInscription(
        { annee_scolaire: e.anneeScolaire, frais_inscription: 0, mensualite: 0, reduction_mensuelle: 0, statut: "active" },
        [], e.ecole, e.aujourdhui,
        CATALOGUE_CM2A.map((a, i): ArticleCalcul => ({
          id: `p${i}`, libelle: a.libelle, nature: a.nature, prix_unitaire: a.prix, quantite: a.quantiteDefaut, obligatoire: a.obligatoire,
          mois_debut: null, mois_fin: null,
        }))
      );
      expect(avant.articles.length).toBeGreaterThan(0);
      const dueArtSit0 = e.dateDepart
        ? situationInscription(
            { annee_scolaire: e.anneeScolaire, frais_inscription: 0, mensualite: 0, reduction_mensuelle: 0, statut: e.statut, date_depart: e.dateDepart },
            [], e.ecole, e.aujourdhui,
            CATALOGUE_CM2A.map((a, i): ArticleCalcul => ({
              id: `p${i}`, libelle: a.libelle, nature: a.nature, prix_unitaire: a.prix, quantite: a.quantiteDefaut, obligatoire: a.obligatoire,
              mois_debut: a.nature === "mensuel" ? mois[0] : null, mois_fin: a.nature === "mensuel" ? `${e.dateDepart!.slice(0, 7)}-01` : null,
            }))
          ).articles.reduce((s, l) => s + l.du, 0)
        : pleinArt.articles.reduce((s, l) => s + l.du, 0);
      for (let verse = 0; verse <= dueArtSit0; verse += 3100) {
        const entree = { ...e, verseArticles: verse };
        verifierParite(entree, ok(repartirReprise(entree)));
      }
      const plein = { ...e, verseScolarite: 20000, verseArticles: dueArtSit0 };
      verifierParite(plein, ok(repartirReprise(plein)));
      const debord = repartirReprise({ ...e, verseArticles: dueArtSit0 + 1 });
      expect(debord.ok).toBe(false);
      expect(!debord.ok && debord.erreur).toContain("dépasse");
    });
  }
});

describe("repartirReprise : services qui commencent en cours d'année (parité)", () => {
  const cas: [string, string, "active" | "abandon" | "transfert", string | null, string | null, string | null][] = [
    ["actif, transport depuis janvier", "2027-02-11", "active", null, "2027-01-01", null],
    ["actif, transport depuis janvier et cantine depuis mars", "2027-04-02", "active", null, "2027-01-01", "2027-03-01"],
    ["actif, début au mois de l'import", "2026-11-11", "active", null, "2026-11-01", "2026-11-01"],
    ["parti, transport depuis novembre", "2027-01-15", "abandon", "2026-12-05", "2026-11-01", null],
    ["parti, début au mois du départ", "2027-01-15", "transfert", "2026-12-05", "2026-12-01", "2026-12-01"],
  ];
  for (const [nom, aujourdhui, statut, dateDepart, debutT, debutC] of cas) {
    it(`balayage des versés : ${nom}`, { timeout: 30000 }, () => {
      const e: EntreeRepartition = {
        anneeScolaire: "2026-2027", aujourdhui, ecole: R(), tarifs: { frais: 25000, mensualite: 15000, dernierMois: null }, reduction: null,
        catalogue: CATALOGUE_CM2A, statut, dateDepart, verseScolarite: 0, verseArticles: 0,
        options: [{ libelle: "Transport", quantite: null, debut: debutT }, { libelle: "Cantine", quantite: null, debut: debutC }],
      };
      // Le dû des articles, lu sur la situation sans paiement dont les services commencent à leur mois
      const sans = ok(repartirReprise(e));
      expect(sans.articles.find((a) => a.libelle === "Transport")?.moisDebut).toBe(debutT);
      if (debutC) expect(sans.articles.find((a) => a.libelle === "Cantine")?.moisDebut).toBe(debutC);
      const fin = dateDepart ? `${dateDepart.slice(0, 7)}-01` : null;
      const dueArt = situationInscription(
        { annee_scolaire: e.anneeScolaire, frais_inscription: 0, mensualite: 0, reduction_mensuelle: 0, statut, date_depart: dateDepart },
        [], e.ecole, aujourdhui,
        CATALOGUE_CM2A.map((a, i): ArticleCalcul => ({
          id: `p${i}`, libelle: a.libelle, nature: a.nature, prix_unitaire: a.prix, quantite: a.quantiteDefaut, obligatoire: a.obligatoire,
          mois_debut: a.libelle === "Transport" ? debutT : a.libelle === "Cantine" ? (debutC ?? (a.nature === "mensuel" ? "2026-10-01" : null)) : null,
          mois_fin: a.nature === "mensuel" ? fin : null,
        }))
      ).articles.reduce((s, l) => s + l.du, 0);
      for (let verse = 0; verse <= dueArt; verse += 2500) {
        const entree = { ...e, verseScolarite: 40000, verseArticles: verse };
        const r = ok(repartirReprise(entree));
        // Aucun paiement de service avant le mois de début du service
        for (const p of r.paiements.filter((x) => x.article === "Transport")) expect(p.mois! >= debutT!).toBe(true);
        verifierParite(entree, r);
      }
      verifierParite({ ...e, verseArticles: dueArt }, ok(repartirReprise({ ...e, verseArticles: dueArt })));
      const debord = repartirReprise({ ...e, verseArticles: dueArt + 1 });
      expect(debord.ok).toBe(false);
    });
  }

  it("refuse un début hors de l'année", () => {
    const e = depuisCas(CAS_REPRISE.find((c) => c.nom === "Bineta Sy")!);
    const r = repartirReprise({ ...e, options: [{ libelle: "Transport", quantite: null, debut: "2026-09-01" }] });
    expect(!r.ok && r.erreur).toContain("hors de l'année");
  });

  it("refuse un début après le départ", () => {
    const e = depuisCas(CAS_REPRISE.find((c) => c.nom === "Bineta Sy")!);
    const r = repartirReprise({ ...e, statut: "abandon", dateDepart: "2026-11-05", options: [{ libelle: "Transport", quantite: null, debut: "2026-12-01" }] });
    expect(!r.ok && r.erreur).toContain("après le départ");
  });
});

describe("repartirReprise : ordre de remplissage", () => {
  const base = depuisCas(CAS_REPRISE.find((c) => c.nom === "Réglage spécial, 130 000 versés")!);
  const mensualites = (e: EntreeRepartition) =>
    Object.fromEntries(ok(repartirReprise(e)).paiements.filter((p) => p.type === "mensualite").map((p) => [p.mois!.slice(0, 7), p.montant]));

  it("à date égale, la mensualité passe avant la tranche", () => {
    // inscription 25 000 + juin 15 000 + octobre à décembre 45 000 = 85 000 ; janvier 15 000 = 100 000 ; puis la tranche 1 de mai (le 5 janvier aussi)
    expect(mensualites({ ...base, verseScolarite: 99999 })["2027-01"]).toBe(14999);
    expect(mensualites({ ...base, verseScolarite: 99999 })["2027-05"]).toBeUndefined();
    const apres = mensualites({ ...base, verseScolarite: 102000 });
    expect(apres["2027-01"]).toBe(15000);
    expect(apres["2027-05"]).toBe(2000);
    expect(apres["2027-02"]).toBeUndefined();
  });

  it("libelle les tranches du mois payé par tranches", () => {
    const r = ok(repartirReprise({ ...base, verseScolarite: 130000 }));
    expect(r.paiements.find((p) => p.mois === "2027-05-01")?.libelleTranche).toBe("Tranches 1 à 2/3 de mai 2027");
    expect(r.paiements.find((p) => p.mois === "2027-03-01")?.libelleTranche).toBeNull();
  });

  it("les frais uniques obligatoires passent avant les optionnels, puis les services mois par mois", () => {
    const catalogue: ArticleCatalogueRep[] = [
      { libelle: "Sac", nature: "unique", prix: 3000, quantiteDefaut: 1, obligatoire: false },
      { libelle: "Tenue", nature: "unique", prix: 8000, quantiteDefaut: 1, obligatoire: true },
      { libelle: "Transport", nature: "mensuel", prix: 5000, quantiteDefaut: 1, obligatoire: false },
    ];
    const e: EntreeRepartition = { ...base, ecole: R(), catalogue, verseScolarite: 0, verseArticles: 10000, options: [{ libelle: "Sac", quantite: null }, { libelle: "Transport", quantite: null }] };
    const r = ok(repartirReprise(e));
    expect(r.paiements.map(cle).sort()).toEqual(["autre|null|Sac|2000", "autre|null|Tenue|8000"]);
    expect(r.articles.find((a) => a.libelle === "Transport")?.moisDebut).toBe("2026-11-01"); // sans argent : mois de l'import
  });
});

describe("repartirReprise : élève parti (décision DO1-B)", () => {
  const sansTranches = (o: Partial<EntreeRepartition>): EntreeRepartition => ({
    ...depuisCas(CAS_REPRISE[0]), ecole: R(), tarifs: { frais: 25000, mensualite: 15000, dernierMois: null }, catalogue: [], options: [],
    statut: "abandon", dateDepart: "2026-11-05", verseScolarite: 0, verseArticles: null, reduction: null, ...o,
  });

  it("un excédent est rangé après le départ, avec un avertissement", () => {
    // Dû au départ : 25 000 + octobre + novembre = 55 000 ; 60 000 versés : 5 000 sur décembre
    const r = ok(repartirReprise(sansTranches({ verseScolarite: 60000 })));
    expect(r.paiements.map(cle)).toContain("mensualite|2026-12-01|null|5000");
    expect(r.avertissements.some((a) => a.includes("versés après le départ"))).toBe(true);
    expect(r.resume.arriere).toBe(0);
    expect(r.resume.resteAnnee).toBe(0);
  });

  it("sans excédent, aucun avertissement", () => {
    expect(ok(repartirReprise(sansTranches({ verseScolarite: 55000 }))).avertissements).toEqual([]);
  });

  it("au-delà du dû de l'année entière, c'est une erreur", () => {
    expect(ok(repartirReprise(sansTranches({ verseScolarite: 160000 }))).resume.totalPaye).toBe(160000);
    const r = repartirReprise(sansTranches({ verseScolarite: 160001 }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erreur).toContain("dépasse");
  });

  it("le surplus finit sur les tranches restantes du mois payé par tranches", () => {
    // Dû au départ 55 000 ; décembre à avril et juin 6 × 15 000 = 90 000 ; la tranche 1 de mai arrive après
    const e = sansTranches({ ecole: MAI_EN_TRANCHES, verseScolarite: 150000 });
    const r = ok(repartirReprise(e));
    const mai = r.paiements.find((p) => p.mois === "2027-05-01");
    expect(mai?.montant).toBe(5000);
    expect(mai?.libelleTranche).toBe("Tranche 1/3 de mai 2027");
    expect(r.paiements.map(cle)).toContain("mensualite|2027-06-01|null|15000");
  });

  it("un départ pendant les tranches doit les tranches échues", () => {
    // Départ le 10/02 : tranches des 5 janvier et 5 février échues = 10 000 sur mai
    const e = sansTranches({ ecole: MAI_EN_TRANCHES, dateDepart: "2027-02-10", aujourdhui: "2027-03-01", verseScolarite: 25000 + 15000 * 5 + 10000 });
    const r = ok(repartirReprise(e));
    expect(r.paiements.find((p) => p.mois === "2027-05-01")).toMatchObject({ montant: 10000, libelleTranche: "Tranches 1 à 2/3 de mai 2027" });
    expect(r.avertissements).toEqual([]);
    expect(r.resume.resteAnnee).toBe(0);
  });
});

describe("repartirReprise : services d'un élève parti", () => {
  const parti = (catalogue: ArticleCatalogueRep[], verseArticles: number): EntreeRepartition => ({
    ...depuisCas(CAS_REPRISE[0]), ecole: R(), tarifs: { frais: 25000, mensualite: 15000, dernierMois: null }, catalogue,
    options: catalogue.filter((a) => !a.obligatoire).map((a) => ({ libelle: a.libelle, quantite: null })),
    statut: "abandon", dateDepart: "2026-11-05", aujourdhui: "2027-01-15", verseScolarite: 0, verseArticles, reduction: null,
  });
  const transport: ArticleCatalogueRep = { libelle: "Transport", nature: "mensuel", prix: 5000, quantiteDefaut: 1, obligatoire: false };
  const pension: ArticleCatalogueRep = { libelle: "Pension", nature: "mensuel", prix: 9000, quantiteDefaut: 1, obligatoire: true };

  it("service payé : dû du premier mois au mois du départ", () => {
    const r = ok(repartirReprise(parti([transport], 10000)));
    expect(r.articles[0]).toMatchObject({ moisDebut: "2026-10-01", moisFin: "2026-11-01" });
  });

  it("service optionnel sans argent, import après le départ : dû pour le seul mois du départ", () => {
    const r = ok(repartirReprise(parti([transport], 0)));
    expect(r.articles[0]).toMatchObject({ moisDebut: "2026-11-01", moisFin: "2026-11-01" });
    expect(r.avertissements.join(" ")).toContain("« Transport » : aucun versement, il est dû pour le mois du départ");
    // 25 000 + octobre et novembre 30 000 + 5 000
    expect(r.resume.arriere).toBe(60000);
  });

  it("service obligatoire sans argent, import après le départ : dû pour le seul mois du départ", () => {
    const r = ok(repartirReprise(parti([pension], 0)));
    expect(r.articles[0]).toMatchObject({ moisDebut: "2026-11-01", moisFin: "2026-11-01" });
    expect(r.avertissements.join(" ")).toContain("Pension");
    // 25 000 + octobre et novembre 30 000 + 9 000
    expect(r.resume.arriere).toBe(64000);
  });
});

describe("repartirReprise : contrôles préalables", () => {
  const base = depuisCas(CAS_REPRISE[1]);
  it("refuse une réduction supérieure à la mensualité", () => {
    const r = repartirReprise({ ...base, reduction: 99000 });
    expect(r.ok).toBe(false);
  });
  it("refuse des Paramètres incohérents", () => {
    const r = repartirReprise({ ...base, ecole: R({ tranches_dernier_mois: true, mois_debut_tranches: null }) });
    expect(r.ok).toBe(false);
  });
  it("refuse un montant non entier", () => {
    expect(repartirReprise({ ...base, verseScolarite: 100.5 }).ok).toBe(false);
  });
  it("refuse un élève parti sans date de départ", () => {
    expect(repartirReprise({ ...base, statut: "abandon", dateDepart: null }).ok).toBe(false);
  });
});
