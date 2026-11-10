import { describe, expect, it } from "vitest";
import { selectionnerArticles, type ArticleCatalogue } from "./inscription-initiale";

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
