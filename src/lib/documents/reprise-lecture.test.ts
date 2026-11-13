import { readFileSync } from "fs";
import { join } from "path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { controlerFichier, ErreurFichier, lireClasseur, tailleDecompressee, valeurCellule, verifierContenu } from "@/lib/documents/reprise-lecture";
import { analyserReprise } from "@/lib/validation/reprise-validation";

async function xlsx(remplir: (wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  remplir(wb);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("valeurCellule", () => {
  it("réduit formules, textes riches, liens et erreurs à leur valeur", () => {
    expect(valeurCellule({ formula: "A1+B1", result: 62000 })).toBe(62000);
    expect(valeurCellule({ formula: "A1" })).toBeNull();
    expect(valeurCellule({ richText: [{ text: "Awa " }, { text: "Diop" }] })).toBe("Awa Diop");
    expect(valeurCellule({ text: "lien", hyperlink: "https://exemple.sn" })).toBe("lien");
    expect(valeurCellule({ error: "#DIV/0!" })).toBeNull();
    expect(valeurCellule("x".repeat(500))).toHaveLength(300);
  });
});

describe("controlerFichier", () => {
  it("refuse un fichier vide, trop lourd ou qui n'est pas un .xlsx", () => {
    expect(() => controlerFichier(new Uint8Array())).toThrow("vide");
    expect(() => controlerFichier(new Uint8Array(3 * 1024 * 1024).fill(0x50))).toThrow("2 Mo");
    expect(() => controlerFichier(new TextEncoder().encode("Prénom;Nom\nAwa;Diop"))).toThrow(".xlsx");
    expect(() => controlerFichier(new Uint8Array([0x50, 0x4b, 1, 2, 3]))).toThrow(ErreurFichier);
  });

  it("mesure la taille décompressée d'un vrai classeur", async () => {
    const buf = await xlsx((wb) => wb.addWorksheet("Élèves").addRow(["Prénom", "Nom"]));
    const taille = tailleDecompressee(buf);
    expect(taille).toBeGreaterThan(buf.length);
    expect(() => controlerFichier(buf)).not.toThrow();
  });
});

/** Archive zip : chaque fichier rempli de `taille` octets (zéros), très compressibles */
async function archive(fichiers: Record<string, number>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [nom, taille] of Object.entries(fichiers)) zip.file(nom, new Uint8Array(taille), { createFolders: false });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Position de la fin du répertoire central (signature 0x06054b50) */
function finRepertoire(buf: Uint8Array): number {
  const vue = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = buf.length - 22; i >= 0; i--) if (vue.getUint32(i, true) === 0x06054b50) return i;
  throw new Error("EOCD introuvable");
}

describe("verifierContenu (archives piégées)", () => {
  it("refuse une archive qui annonce moins d'entrées qu'elle n'en contient", async () => {
    // 3 fichiers de 4 Mo : le répertoire n'en déclare qu'un, la pré-vérification ne voit que 4 Mo
    const buf = await archive({ "a.xml": 4e6, "b.xml": 4e6, "c.xml": 4e6 });
    const vue = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const fin = finRepertoire(buf);
    vue.setUint16(fin + 8, 1, true);
    vue.setUint16(fin + 10, 1, true);
    expect(tailleDecompressee(buf)).toBe(4e6);
    await expect(verifierContenu(buf)).rejects.toThrow(ErreurFichier);
  });

  it("refuse une archive dont les tailles annoncées mentent", async () => {
    const buf = await archive({ "xl/worksheets/sheet1.xml": 20e6 });
    const vue = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const central = vue.getUint32(finRepertoire(buf) + 16, true);
    vue.setUint32(central + 24, 100, true);
    expect(tailleDecompressee(buf)).toBe(100);
    await expect(verifierContenu(buf)).rejects.toThrow("trop volumineux");
  });

  it("refuse un taux de compression extrême même sous le plafond total", async () => {
    await expect(verifierContenu(await archive({ "xl/sharedStrings.xml": 5e6 }))).rejects.toThrow("trop volumineux");
  });

  it("refuse une feuille de plus de 10 000 lignes avant de la charger", async () => {
    const buf = await xlsx((wb) => {
      const ws = wb.addWorksheet("Élèves");
      for (let i = 0; i <= 10_000; i++) ws.addRow([i]);
    });
    await expect(lireClasseur(buf)).rejects.toThrow("dépasse 10 000 lignes");
  });

  it("accepte le modèle publié", async () => {
    const buf = new Uint8Array(readFileSync(join(process.cwd(), "public/modele-import-ecole.xlsx")));
    await expect(verifierContenu(buf)).resolves.toBeUndefined();
  });
});

describe("lireClasseur", () => {
  it("lit les valeurs, ignore les feuilles masquées et garde les dates en UTC", async () => {
    const buf = await xlsx((wb) => {
      const ws = wb.addWorksheet("Élèves");
      ws.addRow(["Prénom", "Nom", "Né le", "Total"]);
      ws.addRow(["Awa", "Diop", new Date(Date.UTC(2015, 2, 12)), { formula: "1+1", result: 2 }]);
      const cache = wb.addWorksheet("Listes");
      cache.state = "hidden";
      cache.addRow(["secret"]);
    });
    const c = await lireClasseur(buf);
    expect(c.feuilles.map((f) => f.nom)).toEqual(["Élèves"]);
    expect(c.feuilles[0].lignes[1].slice(0, 2)).toEqual(["Awa", "Diop"]);
    expect((c.feuilles[0].lignes[1][2] as Date).toISOString().slice(0, 10)).toBe("2015-03-12");
    expect(c.feuilles[0].lignes[1][3]).toBe(2);
  });

  it("refuse un classeur de plus de 20 feuilles", async () => {
    const buf = await xlsx((wb) => {
      for (let i = 0; i < 21; i++) wb.addWorksheet(`F${i}`).addRow(["x"]);
    });
    await expect(lireClasseur(buf)).rejects.toThrow("20 au maximum");
  });

  it("lit le modèle publié : classes et articles valides, élèves d'exemple refusés", async () => {
    const buf = new Uint8Array(readFileSync(join(process.cwd(), "public/modele-import-ecole.xlsx")));
    const apercu = analyserReprise(await lireClasseur(buf), {
      anneeScolaire: "2026-2027",
      aujourdhui: "2026-11-11",
      premierMois: "2026-10-01",
      calendrier: { mois_debut: 10, nb_mensualites: 9, jour_echeance: 5 },
      classes: [],
      eleves: [],
    });
    expect(apercu.erreursGlobales).toEqual([]);
    expect(apercu.classes.map((c) => c.etat)).toEqual(Array(5).fill("nouvelle"));
    expect(apercu.articles.filter((a) => a.etat === "nouveau")).toHaveLength(9);
    expect(apercu.eleves).toHaveLength(9);
    // Seule erreur attendue sur chaque exemple : « ligne d'exemple à effacer »
    for (const e of apercu.eleves) expect(e.erreurs).toEqual(["Ligne d'exemple du modèle : effacez-la avant l'import."]);
    const cheikh = apercu.eleves.find((e) => e.prenom === "Cheikh")!;
    expect(cheikh.options).toEqual([
      { libelle: "Transport", quantite: null, debut: null, fin: null },
      { libelle: "Étude du soir", quantite: null, debut: null, fin: null },
      { libelle: "Tenue", quantite: 3, debut: null, fin: null },
    ]);
    expect(apercu.eleves.find((e) => e.prenom === "Fatou")).toMatchObject({ statut: "abandon", dateDepart: "2026-11-05" });
  });
});
