import { describe, expect, it } from "vitest";
import { colonneDe, normaliser, reconnaitreEntetes, typeFeuille } from "@/lib/validation/reprise-colonnes";

describe("normaliser", () => {
  it("retire casse, accents, astérisque et ponctuation", () => {
    expect(normaliser("Téléphone du parent *")).toBe("telephone du parent");
    expect(normaliser("  TEL. PARENT ")).toBe("tel parent");
    expect(normaliser("Frais d'inscription")).toBe("frais d inscription");
    expect(normaliser(null)).toBe("");
  });
});

describe("colonneDe", () => {
  it("reconnaît les en-têtes du modèle", () => {
    expect(colonneDe("eleves", "Prénom *")).toBe("prenom");
    expect(colonneDe("eleves", "Total versé (scolarité)")).toBe("totalScolarite");
    expect(colonneDe("eleves", "Total versé (articles)")).toBe("totalArticles");
    expect(colonneDe("eleves", "Articles optionnels")).toBe("articlesOptionnels");
    expect(colonneDe("classes", "Mensualité dernier mois")).toBe("dernierMois");
    expect(colonneDe("articles", "Quantité par défaut")).toBe("quantite");
  });

  it("reconnaît les variantes courantes des fichiers d'école", () => {
    expect(colonneDe("eleves", "Prénoms")).toBe("prenom");
    expect(colonneDe("eleves", "TEL. PARENT")).toBe("telephone");
    expect(colonneDe("eleves", "tel")).toBe("telephone");
    expect(colonneDe("eleves", "Montant payé")).toBe("totalScolarite");
    expect(colonneDe("eleves", "Tuteur")).toBe("parent");
    expect(colonneDe("eleves", "Remise")).toBe("reduction");
  });

  it("ignore les colonnes calculées et inconnues", () => {
    expect(colonneDe("eleves", "Total dû scolarité (calculé)")).toBeNull();
    expect(colonneDe("eleves", "Reste scolarité (calculé)")).toBeNull();
    expect(colonneDe("classes", "Total de l'année (calculé)")).toBeNull();
    expect(colonneDe("eleves", "Observations")).toBeNull();
  });
});

describe("reconnaitreEntetes", () => {
  it("garde la première occurrence d'une colonne", () => {
    expect(reconnaitreEntetes("eleves", ["N°", "Prénom", "Nom", "Classe", "Prénom"])).toEqual({ prenom: 1, nom: 2, classe: 3 });
  });
});

describe("typeFeuille", () => {
  it("classe les feuilles par leur nom", () => {
    expect(typeFeuille("Lisez-moi")).toBe("ignoree");
    expect(typeFeuille("Cas d'exemple")).toBe("ignoree");
    expect(typeFeuille("Classes")).toBe("classes");
    expect(typeFeuille("Articles")).toBe("articles");
    expect(typeFeuille("Élèves")).toBe("eleves");
    expect(typeFeuille("CM2 A")).toBe("autre");
  });
});
