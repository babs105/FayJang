import { describe, expect, it } from "vitest";
import { choixALinscription, libelleTranche, lignesAEncaisser, paiementLibreAutorise, partEchue, situationInscription, trancheAvecMois, verifierReglages } from "@/lib/metier/scolarite";
import type { ArticleCalcul, CalendrierEcole, LigneEncaissement } from "@/types/metier";

// ---------- Exemple de référence (v1.5) ----------

const ANNEE = "2026-2027";

const ECOLE: CalendrierEcole = {
  mois_debut: 10,
  nb_mensualites: 9,
  jour_echeance: 5,
  tranches_dernier_mois: true,
  rang_mois_tranches: 2, // mai
  mois_debut_tranches: 2, // février
  nb_tranches: 3, // février, mars, avril
  premier_mois_a_linscription: true,
  dernier_mois_a_linscription: true,
};

const ECOLE_SANS_TRANCHES: CalendrierEcole = { ...ECOLE, tranches_dernier_mois: false };

const INS = {
  annee_scolaire: ANNEE,
  frais_inscription: 50000,
  mensualite: 20000,
  mensualite_dernier_mois: 20000,
  reduction_mensuelle: 0,
  statut: "active" as "active" | "abandon" | "transfert",
};

const TENUE: ArticleCalcul = {
  id: "tenue", libelle: "Tenue unique", nature: "unique", prix_unitaire: 7500, quantite: 2,
  obligatoire: true, mois_debut: null, mois_fin: null,
};
const BLOUSON: ArticleCalcul = {
  id: "blouson", libelle: "Ensemble blouson", nature: "unique", prix_unitaire: 12000, quantite: 1,
  obligatoire: true, mois_debut: null, mois_fin: null,
};
const JACKET: ArticleCalcul = {
  id: "jacket", libelle: "Jacket", nature: "unique", prix_unitaire: 15000, quantite: 1,
  obligatoire: true, mois_debut: null, mois_fin: null,
};
const TRANSPORT: ArticleCalcul = {
  id: "transport", libelle: "Transport", nature: "mensuel", prix_unitaire: 10000, quantite: 1,
  obligatoire: false, mois_debut: "2026-10-01", mois_fin: null,
};
const ARTICLES = [TENUE, BLOUSON, JACKET, TRANSPORT];

type P = { type: "inscription" | "mensualite" | "autre"; mois: string | null; montant: number; annule: boolean; article_id?: string | null };

const sit = (aujourdhui: string, paiements: P[] = [], opts: { ins?: Partial<typeof INS>; ecole?: CalendrierEcole; articles?: ArticleCalcul[] } = {}) =>
  situationInscription({ ...INS, ...opts.ins }, paiements, opts.ecole ?? ECOLE, aujourdhui, opts.articles ?? ARTICLES);

/** Convertit les lignes d'un encaissement en paiements (comme le fait l'insertion en base) */
const enPaiements = (lignes: LigneEncaissement[]): P[] =>
  lignes.map((l) => ({ type: l.type, mois: l.mois, montant: l.montant, annule: false, article_id: l.article_id }));

/** Appelle lignesAEncaisser et échoue si le résultat est une erreur */
function encaisser(s: ReturnType<typeof sit>, choix: Parameters<typeof lignesAEncaisser>[1]) {
  const r = lignesAEncaisser(s, choix);
  if ("erreur" in r) throw new Error(r.erreur);
  return r;
}

const somme = (lignes: { montant: number }[]) => lignes.reduce((s, l) => s + l.montant, 0);

/** Paiements de l'inscription (132 000) faits le 2026-10-01 */
function payerInscription(): P[] {
  const s = sit("2026-10-01");
  return enPaiements(encaisser(s, choixALinscription(s)).lignes);
}

// ---------- 1. Inscription ----------

describe("encaissement à l'inscription", () => {
  const s = sit("2026-10-01");
  const { lignes } = encaisser(s, choixALinscription(s));

  it("propose 6 lignes pour 132 000 FCFA", () => {
    expect(lignes).toHaveLength(6);
    expect(somme(lignes)).toBe(132000);
  });

  it("détaille frais, octobre, juin et les 3 articles obligatoires", () => {
    expect(lignes.find((l) => l.type === "inscription")?.montant).toBe(50000);
    expect(lignes.filter((l) => l.type === "mensualite").map((l) => l.mois)).toEqual(["2026-10-01", "2027-06-01"]);
    expect(lignes.filter((l) => l.type === "autre").map((l) => l.article_id).sort()).toEqual(["blouson", "jacket", "tenue"]);
    expect(lignes.find((l) => l.article_id === "tenue")?.montant).toBe(15000);
  });

  it("n'ajoute pas de tranche (inclure_tranche: false)", () => {
    expect(encaisser(s, choixALinscription(s)).tranche).toBeNull();
  });
});

// ---------- 2. Reste de l'année ----------

describe("resteAnnee", () => {
  it("272 000 sans transport", () => {
    expect(sit("2026-10-01", [], { articles: [TENUE, BLOUSON, JACKET] }).resteAnnee).toBe(272000);
  });
  it("362 000 avec transport (9 mois à 10 000)", () => {
    expect(sit("2026-10-01").resteAnnee).toBe(362000);
  });
});

// ---------- 3. Tranches : février, mars, avril, mai ----------

describe("tranches de mai : février, mars, avril puis mai soldé", () => {
  it("26 666, 26 666, 26 668 puis mai soldé", () => {
    let paiements = payerInscription();

    // Février
    let s = sit("2027-02-06", paiements, { articles: [TENUE, BLOUSON, JACKET] });
    expect(s.mois.find((m) => m.mois === "2027-05-01")?.tranches?.echues).toBe(1);
    let r = encaisser(s, { mois: ["2027-02-01"] });
    expect(r.lignes.map((l) => [l.mois, l.montant])).toEqual([["2027-02-01", 20000], ["2027-05-01", 6666]]);
    expect(r.lignes[1].libelle).toBe("Tranche 1/3 de mai 2027");
    expect(somme(r.lignes)).toBe(26666);
    paiements = [...paiements, ...enPaiements(r.lignes)];

    // Mars
    s = sit("2027-03-06", paiements, { articles: [TENUE, BLOUSON, JACKET] });
    r = encaisser(s, { mois: ["2027-03-01"] });
    expect(r.lignes[1].libelle).toBe("Tranche 2/3 de mai 2027");
    expect(somme(r.lignes)).toBe(26666);
    paiements = [...paiements, ...enPaiements(r.lignes)];

    // Avril : la dernière tranche absorbe le reste
    s = sit("2027-04-06", paiements, { articles: [TENUE, BLOUSON, JACKET] });
    r = encaisser(s, { mois: ["2027-04-01"] });
    expect(r.lignes[1].libelle).toBe("Tranche 3/3 de mai 2027");
    expect(r.lignes[1].montant).toBe(6668);
    expect(somme(r.lignes)).toBe(26668);
    paiements = [...paiements, ...enPaiements(r.lignes)];

    // Mai est soldé
    s = sit("2027-05-06", paiements, { articles: [TENUE, BLOUSON, JACKET] });
    const mai = s.mois.find((m) => m.mois === "2027-05-01")!;
    expect(mai.paye).toBe(20000);
    expect(mai.reste).toBe(0);
    expect(mai.statut).toBe("paye");
    expect(lignesAEncaisser(s, { mois: ["2027-05-01"] })).toEqual({ erreur: "Rien à encaisser : ce qui est choisi est déjà payé." });
  });
});

// ---------- 4. Sans la tranche ----------

describe("inclure_tranche: false", () => {
  it("encaisse février seul : 20 000", () => {
    const s = sit("2027-02-06", payerInscription());
    const r = encaisser(s, { mois: ["2027-02-01"], inclure_tranche: false });
    expect(r.lignes).toHaveLength(1);
    expect(somme(r.lignes)).toBe(20000);
    expect(r.tranche).toBeNull();
  });
});

// ---------- 5. Toutes les tranches échues ----------

describe("toutes les tranches sont échues", () => {
  it("au 2027-04-06 sans tranche payée, mai est dû en entier", () => {
    const s = sit("2027-04-06", payerInscription(), { articles: [TENUE, BLOUSON, JACKET] });
    const mai = s.mois.find((m) => m.mois === "2027-05-01")!;
    expect(mai.tranches?.echues).toBe(3);
    expect(mai.tranches?.total).toBe(3);
    expect(mai.duEchu).toBe(20000);
    expect(mai.resteEchu).toBe(20000);
    // Arriéré : novembre à avril (6 × 20 000) + mai (20 000)
    expect(s.arriere).toBe(140000);
    expect(s.moisEnRetard).toBe(7);
    expect(s.arriere).toBe(s.totalEchu - s.totalPaye);
  });

  it("au 2027-02-06, seule la 1re tranche (6 666) est échue", () => {
    const s = sit("2027-02-06", payerInscription());
    const mai = s.mois.find((m) => m.mois === "2027-05-01")!;
    expect(mai.duEchu).toBe(6666);
    expect(mai.tranches?.prochaine).toBe("2027-03-05");
  });
});

// ---------- 6. Paiement d'avance ----------

describe("paiement d'avance sur mai", () => {
  const avance: P = { type: "mensualite", mois: "2027-05-01", montant: 10000, annule: false };

  it("la suggestion tient compte de ce qui est versé", () => {
    const s = sit("2027-02-06", [...payerInscription(), avance]);
    const mai = s.mois.find((m) => m.mois === "2027-05-01")!;
    expect(mai.resteEchu).toBe(0); // 10 000 couvrent déjà la tranche échue (6 666)
    expect(mai.tranches?.suggestion).toBe(3332); // 13 332 - 10 000
  });

  it("la tranche portée par février est déjà couverte, celle de mars non", () => {
    const s = sit("2027-02-06", [...payerInscription(), avance]);
    expect(trancheAvecMois(s, ["2027-02-01"])).toBeNull();
    expect(trancheAvecMois(s, ["2027-03-01"])).toMatchObject({ mois: "2027-05-01", montant: 3332 });
    expect(trancheAvecMois(s, ["2027-04-01"])).toMatchObject({ montant: 10000 });
  });

  it("le libellé couvre la tranche entamée", () => {
    const s = sit("2027-02-06", [...payerInscription(), avance]);
    expect(trancheAvecMois(s, ["2027-03-01"])?.libelle).toBe("Tranche 2/3 de mai 2027");
    expect(trancheAvecMois(s, ["2027-04-01"])?.libelle).toBe("Tranches 2 à 3/3 de mai 2027");
  });
});

// ---------- 7. Arrondi ----------

describe("partEchue (arrondi)", () => {
  it("23 000 en 5 tranches : 4 600 × k, la 5e solde", () => {
    expect([1, 2, 3, 4].map((k) => partEchue(23000, k, 5))).toEqual([4600, 9200, 13800, 18400]);
    expect(partEchue(23000, 5, 5)).toBe(23000);
    expect(partEchue(23000, 7, 5)).toBe(23000);
  });
  it("20 000 en 3 tranches : 6 666, 13 332, 20 000", () => {
    expect([1, 2, 3].map((k) => partEchue(20000, k, 3))).toEqual([6666, 13332, 20000]);
  });
  it("aucune tranche échue : rien d'exigible", () => {
    expect(partEchue(20000, 0, 3)).toBe(0);
  });
  it("dans situationInscription : 23 000 en 5 tranches (décembre à avril, cible mai)", () => {
    const ecole: CalendrierEcole = { ...ECOLE, mois_debut_tranches: 12, nb_tranches: 5 };
    const ins = { mensualite: 23000, mensualite_dernier_mois: 23000 };
    const mai = (jour: string) =>
      sit(jour, [], { ecole, ins, articles: [] }).mois.find((m) => m.mois === "2027-05-01")!;
    expect(mai("2026-12-06").duEchu).toBe(4600);
    expect(mai("2027-02-06").duEchu).toBe(13800);
    expect(mai("2027-03-06").duEchu).toBe(18400);
    expect(mai("2027-04-06").duEchu).toBe(23000);
    expect(mai("2027-04-06").tranches?.montant).toBe(4600);
  });
});

// ---------- 8. Option désactivée ----------

describe("option tranches désactivée", () => {
  const s = sit("2027-04-06", payerInscription(), { ecole: ECOLE_SANS_TRANCHES });

  it("aucun mois n'a de tranches", () => {
    expect(s.mois.every((m) => m.tranches === undefined)).toBe(true);
  });
  it("mai est dû à son échéance seulement", () => {
    expect(s.mois.find((m) => m.mois === "2027-05-01")!.duEchu).toBe(0);
  });
  it("trancheAvecMois renvoie null", () => {
    expect(trancheAvecMois(s, ["2027-02-01"])).toBeNull();
  });
  it("encaisser février n'ajoute rien", () => {
    const r = encaisser(s, { mois: ["2027-02-01"] });
    expect(somme(r.lignes)).toBe(20000);
    expect(r.tranche).toBeNull();
  });
});

// ---------- 9. Abandon ----------

describe("élève en abandon", () => {
  const payes: P[] = [
    { type: "mensualite", mois: "2026-10-01", montant: 20000, annule: false },
    { type: "mensualite", mois: "2026-11-01", montant: 5000, annule: false },
    { type: "autre", mois: null, montant: 8000, annule: false, article_id: "tenue" },
    { type: "autre", mois: "2026-10-01", montant: 10000, annule: false, article_id: "transport" },
  ];
  const s = sit("2027-03-06", payes, { ins: { statut: "abandon" } });

  it("les mensualités sont plafonnées à ce qui est payé", () => {
    const oct = s.mois[0];
    const nov = s.mois[1];
    expect([oct.du, oct.reste, oct.statut]).toEqual([20000, 0, "paye"]);
    expect([nov.du, nov.reste, nov.statut]).toEqual([5000, 0, "paye"]);
    expect(s.mois.slice(2).every((m) => m.du === 0 && m.reste === 0 && m.statut === "non_du")).toBe(true);
    expect(s.moisEnRetard).toBe(0);
  });

  it("les articles sont plafonnés à ce qui est payé", () => {
    const tenue = s.articles.find((a) => a.article_id === "tenue")!;
    expect([tenue.du, tenue.reste]).toEqual([8000, 0]);
    expect(s.articles.filter((a) => a.reste > 0)).toHaveLength(0);
    expect(s.articles.find((a) => a.article_id === "jacket")?.du).toBe(0);
  });

  it("comportement actuel : les frais d'inscription ne sont PAS plafonnés (finding du backlog)", () => {
    // Aucun frais d'inscription payé : l'abandon reste redevable des 50 000 dans l'arriéré
    expect(s.inscriptionDue).toBe(50000);
    expect(s.arriere).toBe(50000);
    expect(s.resteAnnee).toBe(50000);
  });

  it("hors frais d'inscription, aucun arriéré fictif", () => {
    const avecFrais = sit("2027-03-06", [...payes, { type: "inscription", mois: null, montant: 50000, annule: false }], { ins: { statut: "abandon" } });
    expect(avecFrais.arriere).toBe(0);
    expect(avecFrais.resteAnnee).toBe(0);
  });
});

// ---------- 10. Montant partiel ----------

describe("montant partiel", () => {
  const s = sit("2027-02-06", payerInscription());

  it("refusé sur plusieurs lignes", () => {
    expect(lignesAEncaisser(s, { mois: ["2026-11-01", "2026-12-01"], montant: 5000 })).toEqual({
      erreur: "Un montant partiel ne s'applique qu'à une seule ligne.",
    });
  });
  it("refusé au-delà du reste dû", () => {
    expect(lignesAEncaisser(s, { mois: ["2026-11-01"], montant: 20001 })).toEqual({
      erreur: "Le montant dépasse le reste dû (20000 FCFA).",
    });
  });
  it("accepté sur une ligne, sans ajout de tranche", () => {
    const r = encaisser(s, { mois: ["2027-02-01"], montant: 5000 });
    expect(r.lignes).toHaveLength(1);
    expect(r.lignes[0].montant).toBe(5000);
    expect(r.tranche).toBeNull();
  });
  it("sur le mois des tranches : libellé de la tranche entamée", () => {
    const r = encaisser(s, { mois: ["2027-05-01"], montant: 10000 });
    expect(r.lignes[0].montant).toBe(10000);
    expect(r.lignes[0].libelle).toBe("Tranches 1 à 2/3 de mai 2027");
  });
  it("statut partiel et reste après un versement partiel", () => {
    const apres = sit("2027-02-06", [...payerInscription(), { type: "mensualite", mois: "2027-02-01", montant: 5000, annule: false }]);
    const fev = apres.mois.find((m) => m.mois === "2027-02-01")!;
    expect([fev.statut, fev.reste]).toEqual(["partiel", 15000]);
  });
  it("une ligne qui n'existe pas est refusée", () => {
    expect(lignesAEncaisser(s, { mois: ["2025-01-01"] })).toEqual({ erreur: "Mois invalide pour cette année scolaire." });
    expect(lignesAEncaisser(s, { articles: ["inconnu"] })).toEqual({ erreur: "Article introuvable pour cet élève." });
  });
});

// ---------- 11. Paiements annulés ----------

describe("paiements annulés", () => {
  it("sont ignorés dans tous les totaux", () => {
    const base = payerInscription();
    const annules = base.map((p) => ({ ...p, annule: true }));
    const s = sit("2026-10-01", annules);
    expect(s.totalPaye).toBe(0);
    expect(s.inscriptionPayee).toBe(0);
    expect(s.resteAnnee).toBe(362000);
    expect(s.mois[0].paye).toBe(0);
    expect(s.articles.every((a) => a.paye === 0)).toBe(true);
  });
  it("un reçu annulé remet les soldes comme avant", () => {
    const s = sit("2026-10-01", payerInscription().map((p) => ({ ...p, annule: true })));
    expect(somme(encaisser(s, choixALinscription(s)).lignes)).toBe(132000);
  });
});

// ---------- 12. Réglages ----------

describe("verifierReglages", () => {
  it("le réglage de l'exemple est valide", () => {
    expect(verifierReglages(ANNEE, ECOLE)).toBeNull();
  });
  it("tranches désactivées : toujours valide", () => {
    expect(verifierReglages(ANNEE, { ...ECOLE_SANS_TRANCHES, rang_mois_tranches: 1 })).toBeNull();
  });
  it("rang 1 (dernier mois) avec dernier mois à l'inscription : refusé", () => {
    const msg = verifierReglages(ANNEE, { ...ECOLE, rang_mois_tranches: 1 });
    expect(msg).toContain("Le dernier mois est payé à l'inscription");
  });
  it("4 tranches à partir de février avec rang 2 : trop nombreuses", () => {
    const msg = verifierReglages(ANNEE, { ...ECOLE, nb_tranches: 4 });
    expect(msg).toBe("À partir de ce mois, 3 tranches au plus avant mai 2027.");
  });
  it("mois de début manquant", () => {
    expect(verifierReglages(ANNEE, { ...ECOLE, mois_debut_tranches: null })).toBe("Choisissez le mois de la première tranche.");
  });
  it("première tranche trop tard", () => {
    expect(verifierReglages(ANNEE, { ...ECOLE, mois_debut_tranches: 5 })).toContain("La première tranche doit tomber avant");
  });
});

// ---------- 13. Service mensuel arrêté ----------

describe("service mensuel arrêté (mois_fin)", () => {
  const arrete: ArticleCalcul = { ...TRANSPORT, mois_fin: "2027-01-01" };
  const lignesTransport = (s: ReturnType<typeof sit>) => s.articles.filter((a) => a.article_id === "transport");

  it("plus de dû après le mois de fin", () => {
    const s = sit("2027-06-10", [], { articles: [arrete] });
    const l = lignesTransport(s);
    expect(l.map((x) => x.mois)).toEqual(["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01"]);
    expect(somme(l.map((x) => ({ montant: x.du })))).toBe(40000);
  });

  it("un mois payé hors période reste visible et payé", () => {
    const horsPeriode: P = { type: "autre", mois: "2027-03-01", montant: 10000, annule: false, article_id: "transport" };
    const s = sit("2027-06-10", [horsPeriode], { articles: [arrete] });
    const mars = lignesTransport(s).find((x) => x.mois === "2027-03-01")!;
    expect(mars).toMatchObject({ du: 10000, paye: 10000, reste: 0, resteEchu: 0, statut: "paye" });
    expect(lignesTransport(s)).toHaveLength(5);
  });

  it("un mois hors période non payé n'apparaît pas et ne crée pas d'arriéré", () => {
    const s = sit("2027-06-10", [], { articles: [arrete], ecole: ECOLE_SANS_TRANCHES });
    expect(lignesTransport(s).some((x) => x.mois === "2027-02-01")).toBe(false);
    // inscription 50 000 + 9 mensualités échues 180 000 + transport d'octobre à janvier 40 000
    expect(s.arriere).toBe(270000);
  });

  it("service qui démarre plus tard (mois_debut)", () => {
    const tard: ArticleCalcul = { ...TRANSPORT, mois_debut: "2027-01-01" };
    const s = sit("2026-10-01", [], { articles: [tard] });
    expect(lignesTransport(s).map((x) => x.mois)[0]).toBe("2027-01-01");
    expect(lignesTransport(s)).toHaveLength(6);
  });

  it("un mois de service n'est pas échu avant son échéance", () => {
    const s = sit("2026-10-04", [], { articles: [TRANSPORT] });
    expect(lignesTransport(s)[0]).toMatchObject({ duEchu: 0, resteEchu: 0, statut: "a_venir" });
    const apres = sit("2026-10-05", [], { articles: [TRANSPORT] });
    expect(lignesTransport(apres)[0]).toMatchObject({ duEchu: 10000, resteEchu: 10000, statut: "retard" });
  });
});

// ---------- 14. libelleTranche ----------

describe("libelleTranche", () => {
  const s = sit("2027-02-06", payerInscription());
  const mai = s.mois.find((m) => m.mois === "2027-05-01")!;

  it("une seule tranche : « Tranche k/n »", () => {
    expect(libelleTranche(mai, 0, 6666)).toBe("Tranche 1/3 de mai 2027");
    expect(libelleTranche(mai, 6666, 6666)).toBe("Tranche 2/3 de mai 2027");
    expect(libelleTranche(mai, 13332, 6668)).toBe("Tranche 3/3 de mai 2027");
  });
  it("plusieurs tranches : « Tranches a à b/n »", () => {
    expect(libelleTranche(mai, 0, 13332)).toBe("Tranches 1 à 2/3 de mai 2027");
    expect(libelleTranche(mai, 0, 20000)).toBe("Tranches 1 à 3/3 de mai 2027");
    expect(libelleTranche(mai, 6666, 13334)).toBe("Tranches 2 à 3/3 de mai 2027");
  });
  it("null hors mois à tranches ou pour un montant nul", () => {
    expect(libelleTranche(s.mois[0], 0, 1000)).toBeNull();
    expect(libelleTranche(mai, 0, 0)).toBeNull();
  });
});

// ---------- Départ d'un élève (abandon / transfert avec date_depart) ----------

describe("départ d'un élève", () => {
  // Exemple E : sans tranches, ni mois à l'inscription ; frais d'inscription et octobre payés
  const ECOLE_E: CalendrierEcole = { ...ECOLE, tranches_dernier_mois: false, premier_mois_a_linscription: false, dernier_mois_a_linscription: false };
  const fraisEtOctobre: P[] = [
    { type: "inscription", mois: null, montant: 50000, annule: false },
    { type: "mensualite", mois: "2026-10-01", montant: 20000, annule: false },
  ];
  const parti = (depart: string | null, paiements: P[] = fraisEtOctobre, extra: { ecole?: CalendrierEcole; articles?: ArticleCalcul[]; statut?: "abandon" | "transfert" | "active"; aujourdhui?: string } = {}) =>
    sit(extra.aujourdhui ?? "2027-03-01", paiements, {
      ecole: extra.ecole ?? ECOLE_E,
      articles: extra.articles ?? [],
      ins: { statut: extra.statut ?? "abandon", date_depart: depart } as Partial<typeof INS>,
    });

  it("E : novembre à janvier dus (60 000), février à juin non dus, arriéré = reste de l'année", () => {
    const s = parti("2027-01-15");
    expect(s.arriere).toBe(60000);
    expect(s.mois.find((m) => m.mois === "2027-01-01")?.du).toBe(20000);
    for (const m of ["2027-02-01", "2027-03-01", "2027-04-01", "2027-05-01", "2027-06-01"])
      expect(s.mois.find((l) => l.mois === m)?.statut).toBe("non_du");
    expect(s.resteAnnee).toBe(60000);
    expect(s.arriere).toBe(s.resteAnnee);
  });

  it("E : encaisser novembre + décembre + janvier = 60 000, puis arriéré 0", () => {
    const s = parti("2027-01-15");
    const { lignes } = encaisser(s, { mois: ["2026-11-01", "2026-12-01", "2027-01-01"] });
    expect(somme(lignes)).toBe(60000);
    const apres = parti("2027-01-15", [...fraisEtOctobre, ...enPaiements(lignes)]);
    expect(apres.arriere).toBe(0);
    expect(apres.resteAnnee).toBe(0);
  });

  it("transfert : même règle que l'abandon", () => {
    expect(parti("2027-01-15", fraisEtOctobre, { statut: "transfert" }).arriere).toBe(60000);
  });

  it("départ le 3 janvier (avant l'échéance du 5) : janvier est dû", () => {
    const s = parti("2027-01-03");
    expect(s.mois.find((m) => m.mois === "2027-01-01")?.reste).toBe(20000);
    expect(s.arriere).toBe(60000);
  });

  it("calculé avant le départ : tout est déjà échu (duEchu = du)", () => {
    const s = parti("2027-01-15", fraisEtOctobre, { aujourdhui: "2026-11-02" });
    expect(s.arriere).toBe(60000);
  });

  it("mois payé après le départ : payé gardé, reste 0, arriéré inchangé", () => {
    const s = parti("2027-01-15", [...fraisEtOctobre, { type: "mensualite", mois: "2027-04-01", montant: 20000, annule: false }]);
    const avril = s.mois.find((m) => m.mois === "2027-04-01")!;
    expect(avril.du).toBe(20000);
    expect(avril.reste).toBe(0);
    expect(avril.statut).toBe("paye");
    expect(s.arriere).toBe(60000);
  });

  it("mois partiel après le départ : du = payé", () => {
    const s = parti("2027-01-15", [...fraisEtOctobre, { type: "mensualite", mois: "2027-04-01", montant: 8000, annule: false }]);
    const avril = s.mois.find((m) => m.mois === "2027-04-01")!;
    expect(avril.du).toBe(8000);
    expect(avril.reste).toBe(0);
    expect(s.arriere).toBe(60000);
  });

  it("transport 5 000 de novembre à juin : arriéré 75 000 (mois jusqu'à janvier)", () => {
    const transport: ArticleCalcul = { ...TRANSPORT, prix_unitaire: 5000, mois_debut: "2026-11-01", mois_fin: "2027-06-01" };
    const s = parti("2027-01-15", fraisEtOctobre, { articles: [transport] });
    expect(s.arriere).toBe(60000 + 3 * 5000);
    expect(s.articles.find((a) => a.mois === "2027-02-01")?.statut).toBe("non_du");
    expect(s.arriere).toBe(s.resteAnnee);
  });

  it("frais d'inscription non payés et tenue non payée : dus", () => {
    const s = parti("2027-01-15", [{ type: "mensualite", mois: "2026-10-01", montant: 20000, annule: false }], { articles: [TENUE] });
    expect(s.arriere).toBe(50000 + 15000 + 60000);
  });

  it("1er mois à l'inscription non payé, départ en octobre : dû", () => {
    const s = parti("2026-10-20", [{ type: "inscription", mois: null, montant: 50000, annule: false }], {
      ecole: { ...ECOLE_E, premier_mois_a_linscription: true },
      aujourdhui: "2026-10-25",
    });
    expect(s.mois[0].reste).toBe(20000);
    expect(s.arriere).toBe(20000);
  });

  it("dernier mois à l'inscription : règle générale (non dû après le départ)", () => {
    const s = parti("2027-01-15", fraisEtOctobre, { ecole: { ...ECOLE_E, dernier_mois_a_linscription: true } });
    expect(s.mois.find((m) => m.mois === "2027-06-01")?.statut).toBe("non_du");
    expect(s.arriere).toBe(60000);
  });

  it("mois par tranches (mai en 3 tranches de février), départ le 10 mars : 2 parts dues", () => {
    const e: CalendrierEcole = { ...ECOLE, premier_mois_a_linscription: false, dernier_mois_a_linscription: false };
    const s = parti("2027-03-10", fraisEtOctobre, { ecole: e });
    const mai = s.mois.find((m) => m.mois === "2027-05-01")!;
    expect(mai.du).toBe(13332);
    expect(mai.duEchu).toBe(13332);
    expect(mai.tranches).toBeUndefined();
    // novembre à mars (5 mois) + 2 parts de mai
    expect(s.arriere).toBe(5 * 20000 + 13332);
    expect(s.arriere).toBe(s.resteAnnee);
  });

  it("mois par tranches : départ après la tranche d'avril, mai dû en entier", () => {
    const e: CalendrierEcole = { ...ECOLE, premier_mois_a_linscription: false, dernier_mois_a_linscription: false };
    const s = parti("2027-04-10", fraisEtOctobre, { ecole: e });
    expect(s.mois.find((m) => m.mois === "2027-05-01")?.du).toBe(20000);
  });

  it("abandon sans date : ancien comportement (seul le payé compte)", () => {
    const s = parti(null);
    expect(s.arriere).toBe(0);
    expect(s.resteAnnee).toBe(0);
    expect(s.mois.find((m) => m.mois === "2026-11-01")?.statut).toBe("non_du");
  });

  it("statut active avec une date : date ignorée", () => {
    const avec = parti("2027-01-15", fraisEtOctobre, { statut: "active" });
    const sans = parti(null, fraisEtOctobre, { statut: "active" });
    expect(avec).toEqual(sans);
    expect(avec.mois.find((m) => m.mois === "2027-04-01")?.duEchu).toBe(0);
  });
});

describe("paiementLibreAutorise", () => {
  it("autorise un élève inscrit", () => expect(paiementLibreAutorise("active")).toBe(true));
  it("refuse un élève en abandon", () => expect(paiementLibreAutorise("abandon")).toBe(false));
  it("refuse un élève transféré", () => expect(paiementLibreAutorise("transfert")).toBe(false));
});

// ---------- Traçabilité : « Encaissé par » n'a aucun effet sur les soldes (D09, tranche 2) ----------

describe("novembre encaissé par un utilisateur nommé", () => {
  it("arriéré 0 et reste sur l'année 7 x 20 000 = 140 000 (octobre et novembre payés)", () => {
    const payes: P[] = [
      { type: "mensualite", mois: "2026-10-01", montant: 20000, annule: false },
      { type: "mensualite", mois: "2026-11-01", montant: 20000, annule: false },
    ];
    const s = sit("2026-11-12", payes, { ins: { frais_inscription: 0 }, articles: [], ecole: { ...ECOLE, premier_mois_a_linscription: false, dernier_mois_a_linscription: false } });
    expect(s.arriere).toBe(0);
    expect(s.resteAnnee).toBe(140000);
  });
  it("après l'annulation de novembre : arriéré 20 000 et reste 160 000", () => {
    const payes: P[] = [
      { type: "mensualite", mois: "2026-10-01", montant: 20000, annule: false },
      { type: "mensualite", mois: "2026-11-01", montant: 20000, annule: true },
    ];
    const s = sit("2026-11-12", payes, { ins: { frais_inscription: 0 }, articles: [], ecole: { ...ECOLE, premier_mois_a_linscription: false, dernier_mois_a_linscription: false } });
    expect(s.arriere).toBe(20000);
    expect(s.resteAnnee).toBe(160000);
  });
});
