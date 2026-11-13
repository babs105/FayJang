import { describe, expect, it } from "vitest";
import { lignesPaiementInscription, selectionnerArticles, type ArticleCatalogue, type ArticleCatalogueTarif } from "@/lib/metier/inscription-initiale";

const tenue: ArticleCatalogue = { id: "tenue", libelle: "Tenue", nature: "unique", quantite_defaut: 2, obligatoire: true };
const blouson: ArticleCatalogue = { id: "blouson", libelle: "Blouson", nature: "unique", quantite_defaut: 1, obligatoire: false };
const transport: ArticleCatalogue = { id: "transport", libelle: "Transport", nature: "mensuel", quantite_defaut: 1, obligatoire: false };
const cantine: ArticleCatalogue = { id: "cantine", libelle: "Cantine", nature: "mensuel", quantite_defaut: 1, obligatoire: true };
const fournitures: ArticleCatalogue = { id: "fournitures", libelle: "Fournitures", nature: "unique", quantite_defaut: 0, obligatoire: true };

describe("selectionnerArticles", () => {
  it("prend les obligatoires sans qu'ils soient cochés, avec leur quantité par défaut", () =>
    expect(selectionnerArticles([tenue, cantine], [])).toEqual({
      articles: [
        { article_classe_id: "tenue", quantite: 2 },
        { article_classe_id: "cantine", quantite: 1 },
      ],
    }));

  it("ignore un optionnel non coché, prend un optionnel coché", () =>
    expect(selectionnerArticles([blouson, transport], [{ article_classe_id: "transport" }])).toEqual({
      articles: [{ article_classe_id: "transport", quantite: 1 }],
    }));

  it("exemple du plan : tenue ×2 obligatoire + transport mensuel coché", () =>
    expect(selectionnerArticles([tenue, transport], [{ article_classe_id: "transport" }, { article_classe_id: "tenue", quantite: "2" }])).toEqual({
      articles: [
        { article_classe_id: "tenue", quantite: 2 },
        { article_classe_id: "transport", quantite: 1 },
      ],
    }));

  it("prend la quantité saisie pour un frais unique", () =>
    expect(selectionnerArticles([blouson], [{ article_classe_id: "blouson", quantite: 3 }])).toEqual({
      articles: [{ article_classe_id: "blouson", quantite: 3 }],
    }));

  it("un service mensuel compte toujours pour 1", () =>
    expect(selectionnerArticles([transport], [{ article_classe_id: "transport", quantite: 5 }])).toEqual({
      articles: [{ article_classe_id: "transport", quantite: 1 }],
    }));

  it("un frais unique optionnel à 0 n'est pas retenu", () =>
    expect(selectionnerArticles([blouson], [{ article_classe_id: "blouson", quantite: 0 }])).toEqual({ articles: [] }));

  it("refuse un obligatoire mis à 0", () =>
    expect(selectionnerArticles([tenue], [{ article_classe_id: "tenue", quantite: 0 }])).toEqual({
      erreur: "« Tenue » est obligatoire pour cette classe.",
    }));

  it("un obligatoire à quantité par défaut 0 peut rester à 0 (non retenu)", () =>
    expect(selectionnerArticles([fournitures], [])).toEqual({ articles: [] }));

  it("refuse une quantité hors 0-99 ou non entière", () => {
    expect(selectionnerArticles([blouson], [{ article_classe_id: "blouson", quantite: 100 }])).toEqual({ erreur: "Quantité invalide pour « Blouson »." });
    expect(selectionnerArticles([blouson], [{ article_classe_id: "blouson", quantite: "1,5" }])).toEqual({ erreur: "Quantité invalide pour « Blouson »." });
    expect(selectionnerArticles([blouson], [{ article_classe_id: "blouson", quantite: -1 }])).toEqual({ erreur: "Quantité invalide pour « Blouson »." });
  });

  it("ignore un article coché qui n'est pas au catalogue de la classe", () =>
    expect(selectionnerArticles([blouson], [{ article_classe_id: "autre-classe", quantite: 1 }])).toEqual({ articles: [] }));

  it("accepte une saisie absente ou mal formée sans planter", () => {
    expect(selectionnerArticles([tenue], undefined)).toEqual({ articles: [{ article_classe_id: "tenue", quantite: 2 }] });
    expect(selectionnerArticles([tenue], "n'importe quoi" as never)).toEqual({ articles: [{ article_classe_id: "tenue", quantite: 2 }] });
  });
});

describe("lignesPaiementInscription", () => {
  const ecole = {
    annee_scolaire: "2026-2027",
    mois_debut: 10,
    nb_mensualites: 9,
    jour_echeance: 5,
    premier_mois_a_linscription: true,
    dernier_mois_a_linscription: false,
    tranches_dernier_mois: false,
  };
  const classe = { frais_inscription: 50_000, mensualite: 25_000, mensualite_dernier_mois: null };
  const catalogue: ArticleCatalogueTarif[] = [
    { ...tenue, prix_unitaire: 15_000 },
    { ...transport, prix_unitaire: 10_000 },
  ];
  const articles = [
    { article_classe_id: "tenue", quantite: 2 },
    { article_classe_id: "transport", quantite: 1 },
  ];
  const base = { classe, reduction: 5_000, ecole, aujourdhui: "2026-11-10", catalogue, articles, moisDebutServices: "2026-11-01" };

  it("exemple du plan : frais 50 000 + 1er mois net 20 000 + tenue 30 000 = 100 000, transport non encaissé", () =>
    expect(lignesPaiementInscription(base)).toEqual({
      lignes: [
        { type: "inscription", mois: null, article_classe_id: null, montant: 50_000, libelle: null },
        { type: "mensualite", mois: "2026-10-01", article_classe_id: null, montant: 20_000, libelle: null },
        { type: "autre", mois: null, article_classe_id: "tenue", montant: 30_000, libelle: "Tenue × 2" },
      ],
      total: 100_000,
    }));

  it("coupe à 120 caractères un libellé d'article trop long (la base refuserait la ligne)", () => {
    const long = "T".repeat(200);
    const r = lignesPaiementInscription({ ...base, catalogue: [{ ...tenue, libelle: long, prix_unitaire: 15_000 }, catalogue[1]] });
    const ligne = "lignes" in r ? r.lignes.find((l) => l.type === "autre") : undefined;
    expect(ligne?.libelle?.length).toBe(120);
    expect(ligne?.montant).toBe(30_000);
  });

  it("réduction égale à la mensualité : le 1er mois ne coûte rien, seuls frais et tenue sont encaissés", () => {
    const r = lignesPaiementInscription({ ...base, reduction: 25_000 });
    expect("lignes" in r && r.total).toBe(80_000);
    expect("lignes" in r && r.lignes.some((l) => l.type === "mensualite")).toBe(false);
  });

  it("frais d'inscription à 0 et rien d'autre dû : Rien à encaisser", () => {
    const r = lignesPaiementInscription({
      ...base,
      classe: { ...classe, frais_inscription: 0 },
      ecole: { ...ecole, premier_mois_a_linscription: false },
      articles: [{ article_classe_id: "transport", quantite: 1 }],
    });
    expect("erreur" in r && r.erreur).toMatch(/^Rien à encaisser/);
    // L'appelant se fie à cet indicateur, pas au texte du message
    expect("erreur" in r && r.rienAEncaisser).toBe(true);
  });

  it("un vrai refus ne porte pas l'indicateur « rien à encaisser »", () => {
    const r = lignesPaiementInscription({ ...base, articles: [{ article_classe_id: "inconnu", quantite: 1 }] });
    expect(r).toEqual({ erreur: "Article introuvable pour cette classe." });
  });

  it("dernier mois à l'inscription : utilise mensualite_dernier_mois, net de la réduction", () => {
    const r = lignesPaiementInscription({
      ...base,
      classe: { ...classe, mensualite_dernier_mois: 18_000 },
      ecole: { ...ecole, premier_mois_a_linscription: false, dernier_mois_a_linscription: true },
      articles: [],
    });
    expect(r).toEqual({
      lignes: [
        { type: "inscription", mois: null, article_classe_id: null, montant: 50_000, libelle: null },
        { type: "mensualite", mois: "2027-06-01", article_classe_id: null, montant: 13_000, libelle: null },
      ],
      total: 63_000,
    });
  });

  it("école sans mois à l'inscription : frais et tenue seulement", () => {
    const r = lignesPaiementInscription({ ...base, ecole: { ...ecole, premier_mois_a_linscription: false } });
    expect("lignes" in r && r.lignes.map((l) => l.type)).toEqual(["inscription", "autre"]);
    expect("lignes" in r && r.total).toBe(80_000);
  });

  it("refuse un article absent du catalogue", () =>
    expect(lignesPaiementInscription({ ...base, articles: [{ article_classe_id: "inconnu", quantite: 1 }] })).toEqual({
      erreur: "Article introuvable pour cette classe.",
    }));
});
