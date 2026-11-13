import { writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { couper, genererRecuPdf, MAX_LIGNES_RECU, type DonneesRecu } from "@/lib/documents/recu-pdf";

const RECU: DonneesRecu = {
  ecole: { nom: "École Test", ville: "Dakar", adresse: null, telephone_contact: null },
  numero: "FJ-2026-00001",
  payeLe: "2026-11-11",
  mode: "especes",
  reference: null,
  annule: false,
  lignes: [{ type: "mensualite", mois: "2026-11-01", libelle: null, montant: 15000, annule: false }],
  eleve: { prenom: "Awa", nom: "Diop", matricule: "2026-0001" },
  classe: "CM2 A",
  anneeScolaire: "2026-2027",
};

describe("couper", () => {
  const mesurer = (s: string) => s.length * 5;
  it("laisse un texte qui tient dans la colonne", () => {
    expect(couper("Tenue", 100, mesurer)).toBe("Tenue");
  });
  it("coupe un texte trop large et le termine par des points", () => {
    const coupe = couper("A".repeat(120), 100, mesurer);
    expect(coupe.endsWith("...")).toBe(true);
    expect(mesurer(coupe)).toBeLessThanOrEqual(100);
  });
});

describe("genererRecuPdf", () => {
  it("génère un reçu avec des textes très longs", async () => {
    const long = "Fournitures scolaires et tenue de sport ".repeat(3);
    const pdf = await genererRecuPdf({
      ...RECU,
      ecole: { ...RECU.ecole, nom: "Groupe scolaire ".repeat(6) },
      eleve: { ...RECU.eleve, prenom: "Mame Diarra Bousso ".repeat(3) },
      classe: "Terminale scientifique ".repeat(3),
      lignes: [{ type: "autre", mois: null, libelle: long, montant: 99_999_999, annule: false }, ...RECU.lignes],
    });
    if (process.env.RECU_SORTIE) writeFileSync(process.env.RECU_SORTIE, pdf);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });

  it("plafonne le détail d'un lot démesuré", async () => {
    const ligne = RECU.lignes[0];
    const lignes = Array.from({ length: MAX_LIGNES_RECU + 5000 }, () => ligne);
    const pages = (await PDFDocument.load(await genererRecuPdf({ ...RECU, lignes }))).getPageCount();
    const plafond = (await PDFDocument.load(await genererRecuPdf({ ...RECU, lignes: lignes.slice(0, MAX_LIGNES_RECU + 1) }))).getPageCount();
    expect(pages).toBe(plafond);
  });
});
