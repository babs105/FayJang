import { describe, expect, it } from "vitest";
import { lireArticles } from "@/lib/metier/classe-catalogue";
import { estUuid, montant, texte } from "@/lib/validation/saisie";
import type { SaisieArticle } from "@/types/ecole";

const ID_TENUE = "0c9a0456-36b1-4225-b14e-c8bfb78256da";
const ID_CAHIER = "8f1e2d3c-4b5a-4968-8776-655443322110";

const art = (a: Partial<SaisieArticle>): SaisieArticle => ({ libelle: "Tenue", nature: "unique", prix_unitaire: "15000", obligatoire: true, ...a });

describe("lireArticles", () => {
  it("catalogue de l'exemple : tenue 15 000, transport 8 000/mois, cahier 2 500 × 2", () => {
    const r = lireArticles([
      art({ id: ID_TENUE, libelle: "Tenue", prix_unitaire: "15 000", quantite_defaut: "1" }),
      art({ libelle: "Transport", nature: "mensuel", prix_unitaire: 8000, obligatoire: false }),
      art({ libelle: "Cahier", prix_unitaire: "2500", quantite_defaut: 2 }),
    ]);
    expect(r).toEqual([
      { id: ID_TENUE, libelle: "Tenue", nature: "unique", prix_unitaire: 15000, quantite_defaut: 1, obligatoire: true, ordre: 0 },
      { id: undefined, libelle: "Transport", nature: "mensuel", prix_unitaire: 8000, quantite_defaut: 1, obligatoire: false, ordre: 1 },
      { id: undefined, libelle: "Cahier", nature: "unique", prix_unitaire: 2500, quantite_defaut: 2, obligatoire: true, ordre: 2 },
    ]);
  });

  it("saisie absente : catalogue vide", () => {
    expect(lireArticles(undefined)).toEqual([]);
  });

  it("ligne sans libellé ignorée, l'ordre garde l'index d'origine", () => {
    const r = lireArticles([art({ libelle: "  " }), art({ libelle: "Cahier" })]);
    expect(r).toEqual([expect.objectContaining({ libelle: "Cahier", ordre: 1 })]);
  });

  it("plus de 30 articles : refus", () => {
    const saisis = Array.from({ length: 31 }, (_, i) => art({ libelle: `A${i}` }));
    expect(lireArticles(saisis)).toBe("30 articles au plus par classe.");
    expect(Array.isArray(lireArticles(saisis.slice(0, 30)))).toBe(true);
  });

  it("prix invalide : message qui nomme l'article", () => {
    expect(lireArticles([art({ libelle: "Blouse", prix_unitaire: "-5" })])).toBe("Prix invalide pour « Blouse ».");
    expect(lireArticles([art({ libelle: "Blouse", prix_unitaire: "12,5" })])).toBe("Prix invalide pour « Blouse ».");
    expect(lireArticles([art({ libelle: "Blouse", prix_unitaire: "50000001" })])).toBe("Prix invalide pour « Blouse ».");
  });

  it("quantité hors 0 à 99 : refus", () => {
    expect(lireArticles([art({ libelle: "Cahier", quantite_defaut: 100 })])).toBe("Quantité invalide pour « Cahier ».");
    expect(lireArticles([art({ libelle: "Cahier", quantite_defaut: 1.5 })])).toBe("Quantité invalide pour « Cahier ».");
    expect(lireArticles([art({ libelle: "Cahier", quantite_defaut: 0 })])).toEqual([expect.objectContaining({ quantite_defaut: 0 })]);
  });

  it("service mensuel : quantité forcée à 1", () => {
    expect(lireArticles([art({ nature: "mensuel", quantite_defaut: 3 })])).toEqual([expect.objectContaining({ nature: "mensuel", quantite_defaut: 1 })]);
  });

  it("nature inconnue : traitée comme frais unique", () => {
    expect(lireArticles([art({ nature: "autre" })])).toEqual([expect.objectContaining({ nature: "unique" })]);
  });

  it("id vide ou mal formé : nouvelle ligne", () => {
    const r = lireArticles([art({ id: "" }), art({ id: "abc" })]);
    expect(r).toEqual([expect.objectContaining({ id: undefined }), expect.objectContaining({ id: undefined })]);
  });

  it("même id saisi deux fois : seule la première ligne garde le lien", () => {
    const r = lireArticles([art({ id: ID_CAHIER, libelle: "Cahier" }), art({ id: ID_CAHIER.toUpperCase(), libelle: "Cahier bis" })]);
    expect(r).toEqual([expect.objectContaining({ id: ID_CAHIER }), expect.objectContaining({ libelle: "Cahier bis", id: undefined })]);
  });

  it("libellé coupé à 60 caractères", () => {
    const r = lireArticles([art({ libelle: "x".repeat(80) })]);
    expect(r).toEqual([expect.objectContaining({ libelle: "x".repeat(60) })]);
  });

  it("saisie qui n'est pas un tableau, ou ligne qui n'est pas un objet : « Articles invalides. »", () => {
    expect(lireArticles("x" as unknown as SaisieArticle[])).toBe("Articles invalides.");
    expect(lireArticles([null as unknown as SaisieArticle])).toBe("Articles invalides.");
  });
});

describe("saisie", () => {
  it("montant accepte les espaces de milliers (normal, insécable, fine insécable)", () => {
    expect(montant("25 000")).toBe(25000);
    expect(montant("25 000")).toBe(25000);
    expect(montant("25 000")).toBe(25000);
    expect(montant("25.000")).toBe(25000);
    expect(montant("")).toBe(0);
    expect(montant("-1")).toBeNull();
  });
  it("texte enlève les espaces et coupe", () => {
    expect(texte("  CM2 A  ", 3)).toBe("CM2");
    expect(texte(undefined)).toBe("");
  });
  it("estUuid", () => {
    expect(estUuid(ID_TENUE)).toBe(true);
    expect(estUuid(ID_TENUE.toUpperCase())).toBe(true);
    expect(estUuid("abc")).toBe(false);
    expect(estUuid(undefined)).toBe(false);
  });
});
