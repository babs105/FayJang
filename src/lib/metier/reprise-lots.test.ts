import { describe, expect, it } from "vitest";
import { construireLot, decouper, lireCles, lireRetour, resumerRetour, TAILLE_LOT, type ArticleBase, type ClasseBase } from "@/lib/metier/reprise-lots";
import { repartirReprise, type ArticleCatalogueRep, type EntreeRepartition } from "@/lib/metier/reprise-repartition";
import type { EleveApercu } from "@/lib/validation/reprise-validation";

const ECOLE = {
  mois_debut: 10, nb_mensualites: 9, jour_echeance: 5, tranches_dernier_mois: false, mois_debut_tranches: null,
  nb_tranches: null, rang_mois_tranches: 1, premier_mois_a_linscription: false, dernier_mois_a_linscription: false,
};
const CATALOGUE: ArticleCatalogueRep[] = [
  { libelle: "Tenue", nature: "unique", prix: 8000, quantiteDefaut: 2, obligatoire: true },
  { libelle: "Transport", nature: "mensuel", prix: 5000, quantiteDefaut: 1, obligatoire: false },
];
const CLASSES: ClasseBase[] = [{ id: "c-cm2", nom: "CM2 A" }];
const ARTICLES: ArticleBase[] = [
  { id: "a-tenue", classe_id: "c-cm2", libelle: "Tenue" },
  { id: "a-transport", classe_id: "c-cm2", libelle: "Transport" },
];

/** Élève de l'aperçu, chiffré par repartirReprise comme le fait l'analyse du fichier */
function eleve(over: Partial<EntreeRepartition> = {}, ligne = 2, classe = "CM2 A"): EleveApercu {
  const entree: EntreeRepartition = {
    anneeScolaire: "2026-2027", aujourdhui: "2027-06-15", ecole: ECOLE, tarifs: { frais: 25000, mensualite: 15000, dernierMois: null },
    reduction: null, catalogue: CATALOGUE, statut: "active", dateDepart: null, verseScolarite: 0, verseArticles: 0, options: [], ...over,
  };
  const r = repartirReprise(entree);
  if (!r.ok) throw new Error(r.erreur);
  return {
    feuille: "Élèves", ligne, prenom: "Awa", nom: "Test", classe, parent: "Mme Test", telephone: "+221770000001", sexe: "F",
    dateNaissance: null, matriculeAncien: "A-12", statut: entree.statut, dateDepart: entree.dateDepart, reduction: entree.reduction,
    totalScolarite: entree.verseScolarite, totalArticles: entree.verseArticles, options: [], etat: "a_creer", erreurs: [], avertissements: [],
    repartition: { paiements: r.paiements, articles: r.articles, ...r.resume },
  };
}

describe("decouper", () => {
  it("26 élèves : un lot de 25 puis un lot de 1, dans l'ordre", () => {
    const lots = decouper(Array.from({ length: 26 }, (_, i) => i));
    expect(lots.map((l) => l.length)).toEqual([25, 1]);
    expect(lots[1]).toEqual([25]);
  });
  it("50 élèves : deux lots pleins ; aucun élève : aucun lot", () => {
    expect(decouper(Array.from({ length: 50 }, (_, i) => i)).map((l) => l.length)).toEqual([TAILLE_LOT, TAILLE_LOT]);
    expect(decouper([])).toEqual([]);
  });
});

describe("lireCles : le navigateur n'envoie que des lignes", () => {
  it("accepte feuille + ligne", () => {
    expect(lireCles([{ feuille: "Élèves", ligne: 3 }])).toEqual([{ feuille: "Élèves", ligne: 3 }]);
  });
  it("refuse un montant glissé dans une clé", () => {
    expect(typeof lireCles([{ feuille: "Élèves", ligne: 3, montant: 999999 }])).toBe("string");
    expect(typeof lireCles([{ feuille: "Élèves", ligne: 3, ecole_id: "x" }])).toBe("string");
  });
  it("refuse un lot de 26, un lot vide, une ligne répétée ou mal typée", () => {
    expect(typeof lireCles(Array.from({ length: 26 }, (_, i) => ({ feuille: "F", ligne: i + 1 })))).toBe("string");
    expect(typeof lireCles([])).toBe("string");
    expect(typeof lireCles([{ feuille: "F", ligne: 1 }, { feuille: "F", ligne: 1 }])).toBe("string");
    expect(typeof lireCles([{ feuille: "F", ligne: "1" }])).toBe("string");
    expect(typeof lireCles([{ feuille: "F", ligne: 1.5 }])).toBe("string");
    expect(typeof lireCles("x")).toBe("string");
  });
});

describe("construireLot", () => {
  it("garde la classe de la base, les articles du catalogue et les montants de la répartition", () => {
    const e = eleve({ verseScolarite: 40000, verseArticles: 16000 });
    const { lot, refuses } = construireLot([e], CLASSES, ARTICLES);
    expect(refuses).toEqual([]);
    expect(lot).toHaveLength(1);
    expect(lot[0].classe_id).toBe("c-cm2");
    expect(lot[0].matricule_ancien).toBe("A-12");
    expect(lot[0].paiements.reduce((s, p) => s + p.montant, 0)).toBe(56000);
    // Aucun prix ni libellé d'article n'est envoyé : la base les relit dans le catalogue
    expect(Object.keys(lot[0].articles[0]).sort()).toEqual(["article_classe_id", "mois_debut", "mois_fin", "quantite"]);
  });

  it("service arrêté puis repris : le paiement de février désigne la ligne de février, pas celle de novembre", () => {
    const e = eleve({
      verseArticles: 36000, // tenue 16 000 + transport nov, déc, fév, mars (20 000)
      options: [
        { libelle: "Transport", quantite: null, debut: "2026-11-01", fin: "2026-12-01" },
        { libelle: "Transport", quantite: null, debut: "2027-02-01", fin: "2027-03-01" },
      ],
    });
    const { lot } = construireLot([e], CLASSES, ARTICLES);
    const transport = lot[0].articles.filter((a) => a.article_classe_id === "a-transport");
    expect(transport.map((a) => [a.mois_debut, a.mois_fin])).toEqual([["2026-11-01", "2026-12-01"], ["2027-02-01", "2027-03-01"]]);
    const services = lot[0].paiements.filter((p) => p.type === "autre" && p.mois !== null);
    expect(services.map((p) => p.mois)).toEqual(["2026-11-01", "2026-12-01", "2027-02-01", "2027-03-01"]);
    for (const p of services) {
      const ligne = lot[0].articles[p.article_index!];
      expect(ligne.article_classe_id).toBe("a-transport");
      expect(ligne.mois_debut! <= p.mois! && p.mois! <= ligne.mois_fin!).toBe(true);
    }
    // Février : la seconde ligne de transport, pas la première
    const fevrier = services.find((p) => p.mois === "2027-02-01")!;
    expect(lot[0].articles[fevrier.article_index!].mois_debut).toBe("2027-02-01");
    // Le reçu nomme l'article et son mois, comme un encaissement de la fiche élève
    expect(fevrier.libelle).toBe("Transport — février 2027");
    expect(lot[0].paiements.filter((p) => p.type === "autre").every((p) => p.libelle)).toBe(true);
  });

  it("un élève sans versement n'a aucun paiement (aucun reçu ne sera numéroté)", () => {
    const { lot } = construireLot([eleve()], CLASSES, ARTICLES);
    expect(lot[0].paiements).toEqual([]);
  });

  it("refuse l'élève dont la classe n'existe pas en base", () => {
    const { lot, refuses } = construireLot([eleve({}, 7, "6ème B")], CLASSES, ARTICLES);
    expect(lot).toEqual([]);
    expect(refuses).toEqual([{ ligne: 7, message: expect.stringContaining("6ème B") }]);
  });

  it("refuse l'élève dont un article n'est pas retrouvé de façon unique dans le catalogue", () => {
    const absent = construireLot([eleve()], CLASSES, ARTICLES.filter((a) => a.libelle !== "Tenue"));
    expect(absent.lot).toEqual([]);
    const double = construireLot([eleve()], CLASSES, [...ARTICLES, { id: "a-tenue-2", classe_id: "c-cm2", libelle: "Tenue" }]);
    expect(double.lot).toEqual([]);
    expect(double.refuses[0].message).toContain("Tenue");
  });

  it("refuse une ligne qui n'est pas à créer", () => {
    const { lot, refuses } = construireLot([{ ...eleve(), etat: "deja_present" }], CLASSES, ARTICLES);
    expect(lot).toEqual([]);
    expect(refuses).toHaveLength(1);
  });
});

describe("retour de la base", () => {
  const retour = [
    { ligne: 2, statut: "cree", eleve_id: "e1", numero_recu: "FJ-2027-00001", montant: 90000 },
    { ligne: 3, statut: "cree", eleve_id: "e2", numero_recu: null, montant: 0 },
    { ligne: 4, statut: "ignore", eleve_id: null, numero_recu: null, montant: 0 },
  ];
  it("compte créés, ignorés, reçus et total encaissé", () => {
    expect(resumerRetour(lireRetour(retour)!)).toEqual({ crees: 2, ignores: 1, montant: 90000, recus: 1 });
  });
  it("refuse une forme inattendue", () => {
    expect(lireRetour({})).toBeNull();
    expect(lireRetour([{ ligne: "2", statut: "cree", montant: 0 }])).toBeNull();
    expect(lireRetour([{ ligne: 2, statut: "autre", montant: 0 }])).toBeNull();
  });
});
