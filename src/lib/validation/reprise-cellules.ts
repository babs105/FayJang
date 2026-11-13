// Reprise de l'existant : lecture d'une cellule du fichier (texte, montant, date, téléphone, mois, options) et plafonds.
// Pur : chaque fonction rend la valeur lue, null si la case est vide, ou "invalide".
import { DEBUT_FORMULE } from "@/lib/documents/export-sur";
import { normaliserTelephone } from "@/lib/validation/telephone";
import type { Cellule } from "@/lib/documents/reprise-lecture";
import { normaliser } from "@/lib/validation/reprise-colonnes";
import type { NatureArticle, Niveau, StatutInscription } from "@/types/database";

export const MAX_ELEVES = 2000;
export const MAX_CLASSES = 200;
/** Plafond du catalogue d'une classe (même borne que enregistrer_classe, bloc v1.9) */
export const MAX_ARTICLES_CLASSE = 30;
/** Articles optionnels lus par élève : au-delà, la ligne est en erreur (borne de calcul, review sécurité T2) */
export const MAX_OPTIONS_ELEVE = 20;
/** Erreurs gardées par ligne : la ligne est déjà refusée, le reste n'apprend rien et gonfle la réponse */
export const MAX_ERREURS_LIGNE = 5;
const MONTANT_MAX = 50_000_000;

// ---------------------------------------------------------------------------------------------------------------
// Lecture des cellules

/** Texte d'une cellule, espaces réduits ; un nombre est gardé tel quel (« 2024118 ») */
export function texteCellule(c: Cellule, max = 120): string {
  if (c === null || typeof c === "boolean") return "";
  if (c instanceof Date) return dateIso(c) ?? "";
  const s = typeof c === "number" ? String(c) : c;
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Vide → null ; montant entier FCFA ; « invalide » sinon. Accepte « 75 000 », « 75.000 F », « 75000 FCFA » */
export function montantCellule(c: Cellule): number | null | "invalide" {
  if (c === null || c === "") return null;
  if (typeof c === "number") return Number.isInteger(c) && c >= 0 && c <= MONTANT_MAX ? c : "invalide";
  if (typeof c !== "string") return "invalide";
  let s = c.replace(/[\s  ]/g, "").replace(/(fcfa|cfa|f)$/i, "");
  if (s === "") return null;
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+$/.test(s)) return "invalide";
  const n = Number(s);
  return n <= MONTANT_MAX ? n : "invalide";
}

function dateIso(d: Date): string | null {
  if (isNaN(d.getTime())) return null;
  // Les dates d'Excel arrivent à minuit UTC : on lit les composantes UTC, pas l'heure locale
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Date au format AAAA-MM-JJ si elle existe vraiment (aller-retour : le 31 février est refusé) */
function dateReelle(a: number, m: number, j: number): string | null {
  const d = new Date(Date.UTC(a, m - 1, j));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== j) return null;
  if (a < 1900 || a > 2100) return null;
  return dateIso(d);
}

/** Vide → null ; date AAAA-MM-JJ ; « invalide » sinon. Accepte une vraie date Excel, JJ/MM/AAAA ou AAAA-MM-JJ */
export function dateCellule(c: Cellule): string | null | "invalide" {
  if (c === null || c === "") return null;
  if (c instanceof Date) return dateIso(c) ?? "invalide";
  if (typeof c === "number") {
    // Numéro de série Excel (jours depuis le 30/12/1899) d'une cellule sans format de date
    if (!Number.isInteger(c) || c < 1 || c > 80000) return "invalide";
    return dateIso(new Date(Math.round((c - 25569) * 86400000))) ?? "invalide";
  }
  if (typeof c !== "string") return "invalide";
  const s = c.trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return dateReelle(Number(m[3]), Number(m[2]), Number(m[1])) ?? "invalide";
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return dateReelle(Number(m[1]), Number(m[2]), Number(m[3])) ?? "invalide";
  return "invalide";
}

/** Téléphone normalisé +221…, ou null s'il est invalide */
export function telephoneCellule(c: Cellule): string | null {
  const t = normaliserTelephone(texteCellule(c, 40));
  return t && /^\+\d{9,15}$/.test(t) ? t : null;
}

/** Un texte qui commence par =, +, - ou @ (ou une tabulation, un retour chariot) deviendrait une formule dans un
 *  export Excel : refusé. Même expression que l'export (celluleTexte), qui reste la défense principale. */
export function ressembleAUneFormule(s: string): boolean {
  return DEBUT_FORMULE.test(s);
}

export const SEXES: Record<string, "M" | "F"> = {
  m: "M", masculin: "M", g: "M", garcon: "M", h: "M", homme: "M",
  f: "F", feminin: "F", fille: "F", femme: "F",
};
export const STATUTS: Record<string, StatutInscription> = {
  "": "active", active: "active", actif: "active", inscrit: "active", inscrite: "active",
  abandon: "abandon", abandonne: "abandon", abandonnee: "abandon",
  transfert: "transfert", transfere: "transfert", transferee: "transfert",
};
export const NIVEAUX: Record<string, Niveau> = {
  prescolaire: "prescolaire", maternelle: "prescolaire", preelementaire: "prescolaire",
  elementaire: "elementaire", primaire: "elementaire",
  moyen: "moyen", college: "moyen",
  secondaire: "secondaire", lycee: "secondaire",
};
export const NATURES: Record<string, NatureArticle> = {
  unique: "unique", "frais unique": "unique", "une fois": "unique",
  mensuel: "mensuel", mensuelle: "mensuel", "par mois": "mensuel", "service mensuel": "mensuel",
};
export const OUI_NON: Record<string, boolean> = { oui: true, o: true, x: true, vrai: true, "1": true, non: false, n: false, faux: false, "0": false };

export function choix<T>(table: Record<string, T>, c: Cellule): T | undefined {
  const cle = normaliser(texteCellule(c));
  return Object.hasOwn(table, cle) ? table[cle] : undefined; // « constructor » ne remonte pas le prototype
}

/** « Tenue x3 » → { libelle: "Tenue", quantite: 3 } ; sans suffixe : quantite null */
export function lireOption(brut: string): { libelle: string; quantite: number | null } {
  const m = /^(.*?)\s*[x×*]\s*(\d{1,3})$/i.exec(brut.trim());
  if (m && m[1].trim()) return { libelle: m[1].trim(), quantite: Number(m[2]) };
  return { libelle: brut.trim(), quantite: null };
}

/** « Cantine (03/2027) » → { reste: "Cantine", debut: "03/2027" } ; sans parenthèse finale : debut null */
/**
 * Période d'un service : « 11/2026 » (en cours), « 11/2026-01/2027 », « novembre à janvier », « 05/2027- ».
 * fin null = toujours en cours. Chaque côté est lu par moisCellule.
 */
export function lirePeriode(texte: string, moisAnnee: string[]): { debut: string; fin: string | null } | "invalide" {
  const s = texte.trim();
  const seul = moisCellule(s, moisAnnee);
  if (seul !== null && seul !== "invalide") return { debut: seul, fin: null };
  // « 2026-11-2027-01 » contient plusieurs tirets : chaque séparateur est essayé jusqu'à deux côtés lisibles
  for (const m of s.matchAll(/\s*[-–—→]\s*|\s+(?:a|à|au|jusqu'?a|jusqu'?à|jusqu’à)\s+/gi)) {
    const debut = moisCellule(s.slice(0, m.index), moisAnnee);
    if (debut === null || debut === "invalide") continue;
    const droite = s.slice(m.index! + m[0].length).trim();
    if (!droite) return { debut, fin: null };
    const fin = moisCellule(droite, moisAnnee);
    if (fin !== null && fin !== "invalide") return { debut, fin };
  }
  return "invalide";
}

export function separerDebut(brut: string): { reste: string; debut: string | null } {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(brut.trim());
  if (m && m[1].trim()) return { reste: m[1].trim(), debut: m[2].trim() };
  return { reste: brut.trim(), debut: null };
}

const MOIS_NOMS: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, mar: 3, avril: 4, avr: 4, mai: 5, juin: 6,
  juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, sep: 9, octobre: 10, oct: 10, novembre: 11, nov: 11,
  decembre: 12, dec: 12,
};

/**
 * Mois de début d'un service (AAAA-MM-01) : « 01/2027 », « 2027-01 », « janvier », « janv. 2027 », une date Excel…
 * Un mois sans année est pris dans l'année scolaire (`moisAnnee`). Vide → null ; illisible → « invalide ».
 */
export function moisCellule(c: Cellule, moisAnnee: string[]): string | null | "invalide" {
  if (c === null || c === "") return null;
  const mois = (a: number, m: number) => (m >= 1 && m <= 12 && a >= 2000 && a <= 2100 ? `${a}-${String(m).padStart(2, "0")}-01` : "invalide");
  if (c instanceof Date || typeof c === "number") {
    const d = dateCellule(c);
    return d === null || d === "invalide" ? "invalide" : `${d.slice(0, 7)}-01`;
  }
  if (typeof c !== "string") return "invalide";
  const s = c.trim();
  let m = /^(\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return mois(Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m) return mois(Number(m[1]), Number(m[2]));
  const date = dateCellule(s);
  if (date && date !== "invalide") return `${date.slice(0, 7)}-01`;
  const n = normaliser(s).split(" ");
  const numero = Object.hasOwn(MOIS_NOMS, n[0]) ? MOIS_NOMS[n[0]] : undefined;
  if (!numero || n.length > 2) return "invalide";
  if (n.length === 2) return /^\d{4}$/.test(n[1]) ? mois(Number(n[1]), numero) : "invalide";
  return moisAnnee.find((x) => Number(x.slice(5, 7)) === numero) ?? "invalide";
}
