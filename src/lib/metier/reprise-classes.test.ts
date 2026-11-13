import { describe, expect, it } from "vitest";
import type { Cellule, ClasseurBrut } from "@/lib/documents/reprise-lecture";
import { analyserReprise, type ContexteReprise } from "@/lib/validation/reprise-validation";
import { classesACreer } from "@/lib/metier/reprise-classes";

const CTX: ContexteReprise = {
  anneeScolaire: "2026-2027",
  aujourdhui: "2026-11-11",
  premierMois: "2026-10-01",
  calendrier: { mois_debut: 10, nb_mensualites: 9, jour_echeance: 5 },
  classes: [],
  eleves: [],
};

const ENTETES_CLASSES = ["Classe *", "Niveau *", "Frais d'inscription *", "Mensualité *", "Mensualité dernier mois"];
const ENTETES_ARTICLES = ["Classe *", "Libellé *", "Nature *", "Prix unitaire *", "Quantité par défaut", "Obligatoire"];

function classeur(classes: Cellule[][], articles: Cellule[][] = []): ClasseurBrut {
  return {
    feuilles: [
      { nom: "Classes", lignes: [ENTETES_CLASSES, ...classes] },
      { nom: "Articles", lignes: [ENTETES_ARTICLES, ...articles] },
      { nom: "Élèves", lignes: [["Prénom *", "Nom *", "Classe *"]] },
    ],
  };
}

describe("classesACreer", () => {
  it("crée les classes nouvelles avec leur catalogue, dans l'ordre du fichier", () => {
    const apercu = analyserReprise(
      classeur(
        [
          ["CM2 A", "élémentaire", 25000, 15000, null],
          ["6e B", "Collège", 30000, 20000, 10000],
        ],
        [
          ["CM2 A", "Tenue", "unique", 5000, 2, "oui"],
          ["CM2 A", "Transport", "par mois", 10000, null, "non"],
          ["6e B", "Fournitures", "unique", 15000, null, "oui"],
        ]
      ),
      CTX
    );
    const { classes, erreurs } = classesACreer(apercu);
    expect(erreurs).toEqual([]);
    expect(classes).toEqual([
      {
        nom: "CM2 A", niveau: "elementaire", frais: 25000, mensualite: 15000, dernierMois: null,
        articles: [
          { id: undefined, libelle: "Tenue", nature: "unique", prix_unitaire: 5000, quantite_defaut: 2, obligatoire: true, ordre: 0 },
          { id: undefined, libelle: "Transport", nature: "mensuel", prix_unitaire: 10000, quantite_defaut: 1, obligatoire: false, ordre: 1 },
        ],
      },
      {
        nom: "6e B", niveau: "moyen", frais: 30000, mensualite: 20000, dernierMois: 10000,
        articles: [{ id: undefined, libelle: "Fournitures", nature: "unique", prix_unitaire: 15000, quantite_defaut: 1, obligatoire: true, ordre: 0 }],
      },
    ]);
  });

  it("ne crée ni ne modifie une classe déjà présente, même si le fichier donne d'autres tarifs", () => {
    const ctx: ContexteReprise = {
      ...CTX,
      classes: [{ nom: "CM2 A", frais: 25000, mensualite: 15000, dernierMois: null, articles: [] }],
    };
    const apercu = analyserReprise(
      classeur(
        [
          ["cm2 a", "elementaire", 99000, 99000, null],
          ["CE1", "primaire", 20000, 12000, null],
        ],
        [["CM2 A", "Tenue", "unique", 5000, 1, "oui"]]
      ),
      ctx
    );
    expect(apercu.classes.map((c) => c.etat)).toEqual(["existante", "nouvelle"]);
    const { classes } = classesACreer(apercu);
    expect(classes.map((c) => c.nom)).toEqual(["CE1"]);
    expect(classes[0].articles).toEqual([]);
  });

  it("ignore les classes en erreur et les articles en erreur", () => {
    const apercu = analyserReprise(
      classeur(
        [
          ["CM2 A", "université", 25000, 15000, null],
          ["CE1", "elementaire", 20000, 12000, null],
        ],
        [
          ["CE1", "Tenue", "unique", "beaucoup", 1, "oui"],
          ["CE1", "Cantine", "mensuel", 8000, null, "non"],
        ]
      ),
      CTX
    );
    const { classes } = classesACreer(apercu);
    expect(classes.map((c) => c.nom)).toEqual(["CE1"]);
    expect(classes[0].articles.map((a) => a.libelle)).toEqual(["Cantine"]);
  });

  it("rejeu : une fois les classes en base, il n'y a plus rien à créer", () => {
    const fichier = classeur([["CE1", "elementaire", 20000, 12000, null]], [["CE1", "Cantine", "mensuel", 8000, null, "non"]]);
    const ctx: ContexteReprise = {
      ...CTX,
      classes: [{ nom: "CE1", frais: 20000, mensualite: 12000, dernierMois: null, articles: [{ libelle: "Cantine", nature: "mensuel", obligatoire: false, prix: 8000, quantiteDefaut: 1 }] }],
    };
    expect(classesACreer(analyserReprise(fichier, ctx)).classes).toEqual([]);
  });
});
