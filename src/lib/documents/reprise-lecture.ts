// Reprise de l'existant : lecture du classeur Excel déposé par l'école (valeurs seulement, jamais de formule exécutée).
import ExcelJS from "exceljs";
import JSZip from "jszip";
import type { Cellule, ClasseurBrut, FeuilleBrute } from "@/types/reprise";

export const LIMITES = {
  /** Taille du fichier déposé */
  octets: 2 * 1024 * 1024,
  /** Taille totale une fois décompressé, mesurée en flux (protection contre une archive piégée) */
  octetsDecompresses: 10 * 1024 * 1024,
  /** Fichiers dans l'archive (un classeur ordinaire en compte une vingtaine) */
  entrees: 200,
  /** Taille décompressée / taille compressée d'un fichier de plus de 1 Mo */
  tauxCompression: 100,
  /** Balises <row> d'une feuille, comptées avant qu'exceljs ne construise les lignes en mémoire */
  lignesXml: 10_000,
  feuilles: 20,
  /** Lignes lues par feuille (en-têtes compris) */
  lignes: 2100,
  colonnes: 40,
  /** Longueur maximale d'un texte de cellule */
  caracteres: 300,
} as const;

export class ErreurFichier extends Error {}

/** Réduit une valeur exceljs (formule, texte riche, lien, erreur) à sa valeur affichée */
export function valeurCellule(v: unknown): Cellule {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.slice(0, LIMITES.caracteres);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("error" in o) return null;
    // Formule : seul le résultat déjà calculé par Excel est gardé
    if ("formula" in o || "sharedFormula" in o) return valeurCellule(o.result);
    if (Array.isArray(o.richText)) return valeurCellule(o.richText.map((r: { text?: unknown }) => String(r?.text ?? "")).join(""));
    if ("text" in o) return valeurCellule(o.text);
  }
  return null;
}

/**
 * Somme des tailles décompressées annoncées par le répertoire central d'une archive zip (un .xlsx est un zip).
 * null si le répertoire est introuvable ou incohérent.
 */
export function tailleDecompressee(buf: Uint8Array): number | null {
  const vue = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Fin du répertoire central : signature 0x06054b50, dans les 64 Ko + 22 octets de la fin
  const debutRecherche = Math.max(0, buf.length - 22 - 0xffff);
  let fin = -1;
  for (let i = buf.length - 22; i >= debutRecherche; i--) {
    if (vue.getUint32(i, true) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) return null;
  const nbEntrees = vue.getUint16(fin + 10, true);
  let pos = vue.getUint32(fin + 16, true);
  let total = 0;
  for (let n = 0; n < nbEntrees; n++) {
    if (pos + 46 > buf.length || vue.getUint32(pos, true) !== 0x02014b50) return null;
    const taille = vue.getUint32(pos + 24, true);
    // 0xFFFFFFFF = zip64 : pas attendu pour un classeur de cette taille
    if (taille === 0xffffffff) return null;
    total += taille;
    pos += 46 + vue.getUint16(pos + 28, true) + vue.getUint16(pos + 30, true) + vue.getUint16(pos + 32, true);
  }
  return total;
}

/** Contrôles du fichier avant de l'ouvrir ; lève ErreurFichier avec un message lisible */
export function controlerFichier(buf: Uint8Array): void {
  if (buf.length === 0) throw new ErreurFichier("Le fichier est vide.");
  if (buf.length > LIMITES.octets) throw new ErreurFichier("Fichier trop lourd : 2 Mo au maximum.");
  // Un .xlsx commence par « PK » (archive zip) ; un .xls ancien ou un CSV renommé est refusé
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new ErreurFichier("Ce fichier n'est pas un classeur Excel .xlsx. Enregistrez-le au format « Classeur Excel (.xlsx) ».");
  }
  const taille = tailleDecompressee(buf);
  if (taille === null) throw new ErreurFichier("Fichier Excel illisible ou abîmé.");
  if (taille > LIMITES.octetsDecompresses) throw new ErreurFichier("Fichier trop volumineux une fois ouvert.");
}

/** Nombre de balises <row …> dans un morceau de XML ; `reste` garde la fin du morceau précédent (balise coupée) */
function compterLignes(morceau: Uint8Array, reste: number[]): number {
  const octets = reste.length ? Uint8Array.from([...reste, ...morceau]) : morceau;
  let n = 0;
  for (let i = 0; i + 4 < octets.length; i++) {
    // « <row » suivi d'un espace, de « > » ou de « / » (pas « <rowBreaks »)
    if (octets[i] === 0x3c && octets[i + 1] === 0x72 && octets[i + 2] === 0x6f && octets[i + 3] === 0x77) {
      const suivant = octets[i + 4];
      if (suivant === 0x20 || suivant === 0x3e || suivant === 0x2f || suivant === 0x09 || suivant === 0x0a || suivant === 0x0d) n++;
    }
  }
  reste.length = 0;
  reste.push(...octets.slice(Math.max(0, octets.length - 4)));
  return n;
}

/**
 * Mesure réelle du contenu de l'archive, avant qu'exceljs ne charge tout en mémoire : chaque fichier est
 * décompressé en flux et la lecture s'arrête dès qu'un plafond est dépassé (taille totale, taille par rapport
 * au compressé, lignes d'une feuille). Ne se fie pas aux tailles annoncées par l'archive, qui peuvent mentir.
 */
export async function verifierContenu(buf: Uint8Array): Promise<void> {
  let zip: JSZip;
  try {
    // Ne lit que le répertoire de l'archive : rien n'est décompressé ici
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new ErreurFichier("Fichier Excel illisible ou abîmé.");
  }
  const entrees = Object.values(zip.files).filter((f) => !f.dir);
  if (entrees.length === 0 || entrees.length > LIMITES.entrees) throw new ErreurFichier("Fichier Excel illisible ou abîmé.");
  let total = 0;
  for (const f of entrees) {
    const feuille = /^xl\/worksheets\/[^/]+\.xml$/i.test(f.name);
    await new Promise<void>((ok, ko) => {
      const flux = (f as unknown as { internalStream(type: "uint8array"): FluxZip }).internalStream("uint8array");
      let taille = 0;
      let lignes = 0;
      const reste: number[] = [];
      let fini = false;
      const arreter = (message: string) => {
        if (fini) return;
        fini = true;
        flux.pause();
        ko(new ErreurFichier(message));
      };
      flux
        .on("data", (morceau: Uint8Array) => {
          if (fini) return;
          taille += morceau.length;
          total += morceau.length;
          if (total > LIMITES.octetsDecompresses) return arreter("Fichier trop volumineux une fois ouvert.");
          if (feuille) {
            lignes += compterLignes(morceau, reste);
            if (lignes > LIMITES.lignesXml) {
              return arreter("Une feuille du classeur dépasse 10 000 lignes : découpez le fichier.");
            }
          }
        })
        .on("error", () => arreter("Fichier Excel illisible ou abîmé."))
        .on("end", () => {
          if (fini) return;
          fini = true;
          // Un taux de compression extrême trahit une archive piégée (un vrai classeur reste sous ~30)
          const compresse = (f as unknown as { _data?: { compressedSize?: number } })._data?.compressedSize ?? 0;
          if (taille > 1024 * 1024 && compresse > 0 && taille / compresse > LIMITES.tauxCompression) {
            ko(new ErreurFichier("Fichier trop volumineux une fois ouvert."));
          } else ok();
        })
        .resume();
    });
  }
}

interface FluxZip {
  on(evenement: "data", rappel: (morceau: Uint8Array) => void): FluxZip;
  on(evenement: "error", rappel: (err: unknown) => void): FluxZip;
  on(evenement: "end", rappel: () => void): FluxZip;
  pause(): FluxZip;
  resume(): FluxZip;
}

/** Ouvre le classeur et en extrait les valeurs des feuilles, dans les limites de LIMITES */
export async function lireClasseur(buf: Uint8Array): Promise<ClasseurBrut> {
  controlerFichier(buf);
  await verifierContenu(buf);
  const classeur = new ExcelJS.Workbook();
  try {
    await classeur.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  } catch {
    throw new ErreurFichier("Fichier Excel illisible ou abîmé.");
  }
  if (classeur.worksheets.length > LIMITES.feuilles) {
    throw new ErreurFichier(`Trop de feuilles dans le classeur : ${LIMITES.feuilles} au maximum.`);
  }
  const feuilles: FeuilleBrute[] = [];
  for (const ws of classeur.worksheets) {
    // Feuille masquée (ex : « Listes » du modèle) : ignorée
    if (ws.state && ws.state !== "visible") continue;
    const lignes: Cellule[][] = [];
    const nbLignes = Math.min(ws.rowCount, LIMITES.lignes);
    for (let r = 1; r <= nbLignes; r++) {
      const ligne = ws.getRow(r);
      const nbCol = Math.min(ligne.cellCount, LIMITES.colonnes);
      const valeurs: Cellule[] = [];
      for (let c = 1; c <= nbCol; c++) valeurs.push(valeurCellule(ligne.getCell(c).value));
      lignes.push(valeurs);
    }
    feuilles.push({ nom: ws.name.slice(0, 60), lignes, tronquee: ws.rowCount > LIMITES.lignes });
  }
  return { feuilles };
}
