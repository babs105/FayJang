import { describe, expect, it } from "vitest";
import type { Cellule, ClasseurBrut } from "./reprise-lecture";
import {
  analyserReprise,
  dateCellule,
  lireOption,
  montantCellule,
  ressembleAUneFormule,
  telephoneCellule,
  type ContexteReprise,
} from "./reprise-validation";

const CTX: ContexteReprise = {
  anneeScolaire: "2026-2027",
  aujourdhui: "2026-11-11",
  premierMois: "2026-10-01",
  classes: [],
  eleves: [],
};

const ENTETES_CLASSES = ["Classe *", "Niveau *", "Frais d'inscription *", "Mensualité *", "Mensualité dernier mois"];
const ENTETES_ARTICLES = ["Classe *", "Libellé *", "Nature *", "Prix unitaire *", "Quantité par défaut", "Obligatoire"];
const ENTETES_ELEVES = [
  "Prénom *", "Nom *", "Classe *", "Nom du parent *", "Téléphone du parent *", "Total versé (scolarité)",
  "Articles optionnels", "Total versé (articles)", "Réduction mensuelle", "Sexe", "Date de naissance",
  "Matricule ancien", "Statut", "Date de départ",
];

function classeur(eleves: Cellule[][], opts: { classes?: Cellule[][]; articles?: Cellule[][] } = {}): ClasseurBrut {
  return {
    feuilles: [
      { nom: "Lisez-moi", lignes: [["Modèle d'import"]] },
      { nom: "Classes", lignes: [ENTETES_CLASSES, ...(opts.classes ?? [["CM2 A", "elementaire", 25000, 15000, null]])] },
      { nom: "Articles", lignes: [ENTETES_ARTICLES, ...(opts.articles ?? [])] },
      { nom: "Élèves", lignes: [ENTETES_ELEVES, ...eleves] },
    ],
  };
}

/** Ligne d'élève valide, modifiable champ par champ */
function eleve(modifs: Partial<Record<string, Cellule>> = {}): Cellule[] {
  const base: Record<string, Cellule> = {
    prenom: "Aminata", nom: "Faye", classe: "CM2 A", parent: "Ousmane Faye", tel: "77 400 50 60", scol: 62000,
    options: null, art: null, reduc: null, sexe: "F", naissance: null, matricule: null, statut: null, depart: null,
    ...modifs,
  };
  return [base.prenom, base.nom, base.classe, base.parent, base.tel, base.scol, base.options, base.art, base.reduc,
    base.sexe, base.naissance, base.matricule, base.statut, base.depart];
}

describe("montantCellule", () => {
  it("accepte les écritures courantes d'un montant", () => {
    expect(montantCellule(75000)).toBe(75000);
    expect(montantCellule("75 000")).toBe(75000);
    expect(montantCellule("75000")).toBe(75000);
    expect(montantCellule("75.000 F")).toBe(75000);
    expect(montantCellule("75 000 FCFA")).toBe(75000);
    expect(montantCellule("1.250.000")).toBe(1250000);
    expect(montantCellule(null)).toBeNull();
    expect(montantCellule("")).toBeNull();
  });
  it("refuse décimales, négatifs et textes", () => {
    expect(montantCellule("75 000,5")).toBe("invalide");
    expect(montantCellule(75000.5)).toBe("invalide");
    expect(montantCellule(-500)).toBe("invalide");
    expect(montantCellule("-500")).toBe("invalide");
    expect(montantCellule("payé")).toBe("invalide");
    expect(montantCellule("75.5")).toBe("invalide");
    expect(montantCellule(60_000_000)).toBe("invalide");
  });
});

describe("dateCellule", () => {
  it("lit une date Excel en UTC, JJ/MM/AAAA et AAAA-MM-JJ", () => {
    expect(dateCellule(new Date(Date.UTC(2015, 2, 12)))).toBe("2015-03-12");
    expect(dateCellule("12/03/2015")).toBe("2015-03-12");
    expect(dateCellule("5/11/2026")).toBe("2026-11-05");
    expect(dateCellule("2015-03-12")).toBe("2015-03-12");
    expect(dateCellule(42075)).toBe("2015-03-12");
  });
  it("refuse une date qui n'existe pas", () => {
    expect(dateCellule("2026-02-31")).toBe("invalide");
    expect(dateCellule("31/02/2026")).toBe("invalide");
    expect(dateCellule("29/02/2027")).toBe("invalide");
    expect(dateCellule("29/02/2028")).toBe("2028-02-29");
    expect(dateCellule("bientôt")).toBe("invalide");
  });
});

describe("telephoneCellule", () => {
  it("normalise les formats courants en +221", () => {
    expect(telephoneCellule("77 123 45 67")).toBe("+221771234567");
    expect(telephoneCellule("+221771234567")).toBe("+221771234567");
    expect(telephoneCellule("00221 77 555 66 77")).toBe("+221775556677");
    expect(telephoneCellule(771234567)).toBe("+221771234567");
  });
  it("refuse un numéro trop court", () => {
    expect(telephoneCellule("77 12")).toBeNull();
    expect(telephoneCellule("")).toBeNull();
  });
});

describe("lireOption", () => {
  it("lit la quantité notée x3, ×3, X 3 ou *3", () => {
    expect(lireOption("Tenue x3")).toEqual({ libelle: "Tenue", quantite: 3 });
    expect(lireOption("Tenue ×3")).toEqual({ libelle: "Tenue", quantite: 3 });
    expect(lireOption("Tenue X 3")).toEqual({ libelle: "Tenue", quantite: 3 });
    expect(lireOption("Tenue*2")).toEqual({ libelle: "Tenue", quantite: 2 });
    expect(lireOption("Transport")).toEqual({ libelle: "Transport", quantite: null });
  });
});

describe("ressembleAUneFormule", () => {
  it("repère =, + et @ en tête", () => {
    expect(ressembleAUneFormule("=1+1")).toBe(true);
    expect(ressembleAUneFormule("+221")).toBe(true);
    expect(ressembleAUneFormule("@moi")).toBe(true);
    expect(ressembleAUneFormule("Awa")).toBe(false);
  });
});

describe("analyserReprise", () => {
  it("accepte une ligne valide et compte les parents distincts", () => {
    const a = analyserReprise(classeur([eleve(), eleve({ prenom: "Modou" }), eleve({ prenom: "Ali", tel: "70 111 22 34" })]), CTX);
    expect(a.erreursGlobales).toEqual([]);
    expect(a.compteurs).toMatchObject({ aCreer: 3, erreurs: 0, parents: 2, classesNouvelles: 1 });
    expect(a.eleves[0]).toMatchObject({ ligne: 2, classe: "CM2 A", telephone: "+221774005060", totalScolarite: 62000, etat: "a_creer" });
  });

  it("signale les champs obligatoires et les valeurs invalides", () => {
    const a = analyserReprise(
      classeur([
        eleve({ tel: null }),
        eleve({ prenom: "B", classe: "CE9" }),
        eleve({ prenom: "C", scol: "beaucoup" }),
        eleve({ prenom: "D", sexe: "X" }),
        eleve({ prenom: "E", naissance: "2026-02-31" }),
        eleve({ prenom: "=CMD()" }),
      ]),
      CTX
    );
    const erreurs = a.eleves.map((e) => e.erreurs.join(" "));
    expect(erreurs[0]).toContain("Téléphone du parent manquant");
    expect(erreurs[1]).toContain("Classe « CE9 » inconnue");
    expect(erreurs[2]).toContain("Total versé (scolarité) invalide");
    expect(erreurs[3]).toContain("Sexe « X » invalide");
    expect(erreurs[4]).toContain("Date de naissance invalide");
    expect(erreurs[5]).toContain("=, + ou @");
    expect(a.compteurs.erreurs).toBe(6);
  });

  it("contrôle statut et date de départ", () => {
    const a = analyserReprise(
      classeur([
        eleve({ statut: "abandon" }),
        eleve({ prenom: "B", statut: "transfert", depart: "15/12/2026" }),
        eleve({ prenom: "C", statut: "abandon", depart: "30/09/2026" }),
        eleve({ prenom: "D", depart: "05/11/2026" }),
        eleve({ prenom: "E", statut: "Abandonné", depart: "05/11/2026" }),
      ]),
      CTX
    );
    expect(a.eleves[0].erreurs).toContain("Date de départ obligatoire pour un abandon ou un transfert.");
    expect(a.eleves[1].erreurs).toContain("Date de départ dans le futur.");
    expect(a.eleves[2].erreurs[0]).toContain("avant le début de l'année scolaire");
    expect(a.eleves[3].erreurs[0]).toContain("élève actif");
    expect(a.eleves[4]).toMatchObject({ etat: "a_creer", statut: "abandon", dateDepart: "2026-11-05" });
  });

  it("lit les articles optionnels et leur quantité", () => {
    const articles: Cellule[][] = [
      ["CM2 A", "Tenue", "unique", 8000, 2, "oui"],
      ["CM2 A", "Transport", "mensuel", 5000, 1, "non"],
      ["CM2 A", "Pack x3", "unique", 1500, 1, "non"],
    ];
    const a = analyserReprise(
      classeur(
        [
          eleve({ options: "Transport ; Tenue x3" }),
          eleve({ prenom: "B", options: "Pack x3" }),
          eleve({ prenom: "C", options: "Transport x2" }),
          eleve({ prenom: "D", options: "Cantine" }),
          eleve({ prenom: "E", options: "transport;TRANSPORT" }),
          eleve({ prenom: "F", options: "Tenue x0" }),
        ],
        { articles }
      ),
      CTX
    );
    expect(a.eleves[0].options).toEqual([{ libelle: "Transport", quantite: null }, { libelle: "Tenue", quantite: 3 }]);
    expect(a.eleves[0].etat).toBe("a_creer");
    expect(a.eleves[1].options).toEqual([{ libelle: "Pack x3", quantite: null }]);
    expect(a.eleves[2].erreurs[0]).toContain("un service mensuel n'a pas de quantité");
    expect(a.eleves[3].erreurs[0]).toContain("Article « Cantine » absent du catalogue de CM2 A");
    expect(a.eleves[4].erreurs[0]).toContain("cité deux fois");
    expect(a.eleves[5].erreurs[0]).toContain("quantité de 1 à 99");
  });

  it("repère les doublons du fichier, les matricules répétés et les élèves déjà présents", () => {
    const ctx: ContexteReprise = { ...CTX, eleves: [{ prenom: "Awa", nom: "Sène", telephone: "+221774005060" }] };
    const a = analyserReprise(
      classeur([
        eleve({ matricule: "2024-01" }),
        eleve({ matricule: "2024-01", prenom: "Modou" }),
        eleve({ prenom: " aminata ", nom: "FAYE" }),
        eleve({ prenom: "Awa", nom: "Sène" }),
        eleve({ prenom: "Awa", nom: "Sene" }),
      ]),
      ctx
    );
    expect(a.eleves[1].erreurs[0]).toContain("Matricule ancien déjà utilisé ligne 2");
    expect(a.eleves[2].erreurs[0]).toContain("Même élève que la ligne 2");
    expect(a.eleves[3].etat).toBe("deja_present");
    expect(a.eleves[4].etat).toBe("a_creer");
    expect(a.eleves[4].avertissements[0]).toContain("très proche");
    expect(a.compteurs.dejaPresents).toBe(1);
  });

  it("avertit quand un même téléphone porte deux noms de parent", () => {
    const a = analyserReprise(classeur([eleve(), eleve({ prenom: "Modou", parent: "Mme Faye" })]), CTX);
    expect(a.eleves[1].etat).toBe("a_creer");
    expect(a.eleves[1].avertissements[0]).toContain("un seul parent sera créé");
    expect(a.compteurs.parents).toBe(1);
  });

  it("refuse les lignes d'exemple du modèle", () => {
    const a = analyserReprise(classeur([eleve({ prenom: "Awa", nom: "Diop", tel: "77 123 45 67" })]), CTX);
    expect(a.eleves[0].erreurs).toContain("Ligne d'exemple du modèle : effacez-la avant l'import.");
  });

  it("garde une classe déjà en base sans la modifier, avec son catalogue", () => {
    const ctx: ContexteReprise = {
      ...CTX,
      classes: [{ nom: "CM2 A", articles: [{ libelle: "Cantine", nature: "mensuel", obligatoire: false }] }],
    };
    const a = analyserReprise(
      classeur([eleve({ classe: "cm2 a", options: "Cantine" })], {
        classes: [["CM2 A", "elementaire", 30000, 15000, null]],
        articles: [["CM2 A", "Tenue", "unique", 8000, 1, "oui"]],
      }),
      ctx
    );
    expect(a.classes[0].etat).toBe("existante");
    expect(a.articles[0].etat).toBe("ignore");
    expect(a.eleves[0]).toMatchObject({ etat: "a_creer", classe: "CM2 A", options: [{ libelle: "Cantine", quantite: null }] });
    expect(a.avertissements.join(" ")).toContain("ne sera pas modifiée");
  });

  it("valide la feuille Classes et la feuille Articles", () => {
    const a = analyserReprise(
      classeur([], {
        classes: [
          ["CE1", "primaire", 20000, 12000, 6000],
          ["CE2", "inconnu", 20000, null, null],
          ["CE1", "elementaire", 20000, 12000, null],
        ],
        articles: [
          ["CE1", "Tenue", "une fois", 7000, null, "oui"],
          ["CE1", "Tenue", "unique", 7000, null, "oui"],
          ["CP", "Livre", "unique", 3000, null, "non"],
          ["CE1", "Bus", "hebdo", 3000, null, "peut-être"],
        ],
      }),
      CTX
    );
    expect(a.classes[0]).toMatchObject({ etat: "nouvelle", niveau: "elementaire", dernierMois: 6000 });
    expect(a.classes[1].erreurs.join(" ")).toMatch(/Niveau « inconnu » inconnu.*Mensualité manquante/);
    expect(a.classes[2].erreurs[0]).toContain("Classe en double (ligne 2)");
    expect(a.articles[0]).toMatchObject({ etat: "nouveau", nature: "unique", quantite: 1, obligatoire: true });
    expect(a.articles[1].erreurs[0]).toContain("Article en double");
    expect(a.articles[2].erreurs[0]).toContain("Classe « CP » inconnue");
    expect(a.articles[3].erreurs.join(" ")).toMatch(/Nature « hebdo ».*oui ou non/);
  });

  it("accepte une feuille par classe sans colonne Classe", () => {
    const entetes = ["Prénom", "Nom", "Parent", "Tél", "Montant payé"];
    const a = analyserReprise(
      {
        feuilles: [
          { nom: "Classes", lignes: [ENTETES_CLASSES, ["CM2 A", "elementaire", 25000, 15000, null], ["CE1", "elementaire", 20000, 12000, null]] },
          { nom: "CM2 A", lignes: [["ÉCOLE LES AMANDIERS 2026-2027"], [], entetes, ["Awa", "Sow", "Mme Sow", "77 400 50 61", "62 000"]] },
          { nom: "CE1", lignes: [entetes, ["Ali", "Ba", "M. Ba", "77 400 50 62", null]] },
          { nom: "Notes", lignes: [["Remarques diverses"]] },
        ],
      },
      CTX
    );
    expect(a.erreursGlobales).toEqual([]);
    expect(a.eleves.map((e) => [e.classe, e.ligne, e.totalScolarite, e.etat])).toEqual([
      ["CM2 A", 4, 62000, "a_creer"],
      ["CE1", 2, null, "a_creer"],
    ]);
    expect(a.avertissements.join(" ")).toContain("Feuille « Notes » ignorée");
  });

  it("bloque un fichier sans feuille d'élèves ou sans colonne Classe", () => {
    expect(analyserReprise({ feuilles: [{ nom: "Feuil1", lignes: [["A", "B"]] }] }, CTX).erreursGlobales[0]).toContain(
      "Aucune feuille d'élèves"
    );
    const sansClasse = analyserReprise({ feuilles: [{ nom: "Élèves", lignes: [["Prénom", "Nom"], ["Awa", "Sow"]] }] }, CTX);
    expect(sansClasse.erreursGlobales[0]).toContain("colonne « Classe » introuvable");
  });

  it("bloque une feuille tronquée (trop de lignes)", () => {
    const c = classeur([eleve()]);
    c.feuilles[3].tronquee = true;
    expect(analyserReprise(c, CTX).erreursGlobales[0]).toContain("découpez le fichier");
  });
});
