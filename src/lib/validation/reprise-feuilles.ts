// Reprise de l'existant : feuilles du classeur (classes, articles, élèves), ligne d'en-tête, lignes de données,
// et clés d'identité d'un élève (doublons, élèves d'exemple du modèle).
import type { Cellule, ClasseurBrut, FeuilleBrute } from "@/types/reprise";
import { COLONNES_REQUISES, normaliser, reconnaitreEntetes, typeFeuille, type TypeFeuille } from "@/lib/validation/reprise-colonnes";
import { MAX_ELEVES, texteCellule } from "@/lib/validation/reprise-cellules";

/** Élèves d'exemple du modèle : à effacer avant l'import */
export const EXEMPLES = new Set(
  [
    ["awa", "diop"], ["ibrahima", "diop"], ["fatou", "ndiaye"], ["moussa", "fall"],
    ["khady", "sarr"], ["ndeye", "gueye"], ["mariama", "ba"], ["cheikh", "mbaye"], ["bineta", "sy"],
  ].map(([p, n]) => `${p}|${n}`)
);
export const TELEPHONES_EXEMPLES = new Set(["+221771234567", "+221787654321", "+221762223344", "+221701112233", "+221779998877", "+221784445566", "+221775556677", "+221763334455"]);

/** Clé d'identité d'un élève, comparée comme en base : lower(btrim(...)) */
export function cleStricte(prenom: string, nom: string, telephone: string): string {
  return `${prenom.trim().toLowerCase()}|${nom.trim().toLowerCase()}|${telephone}`;
}
/** Même clé sans accents ni ponctuation : pour avertir d'un doublon probable */
export function cleSouple(prenom: string, nom: string, telephone: string): string {
  return `${normaliser(prenom)}|${normaliser(nom)}|${telephone}`;
}

export interface Entete<T extends TypeFeuille> {
  ligne: number;
  positions: ReturnType<typeof reconnaitreEntetes<T>>;
}

/** Ligne d'en-tête : la première des 10 premières lignes qui contient les colonnes requises */
export function trouverEntete<T extends TypeFeuille>(type: T, feuille: FeuilleBrute): Entete<T> | null {
  for (let i = 0; i < Math.min(10, feuille.lignes.length); i++) {
    const positions = reconnaitreEntetes(type, feuille.lignes[i]);
    if ((COLONNES_REQUISES[type] as string[]).every((c) => (positions as Record<string, number | undefined>)[c] !== undefined)) {
      return { ligne: i, positions };
    }
  }
  return null;
}

/** Lignes de données sous l'en-tête, avec leur numéro de ligne Excel ; les lignes vides sont sautées */
export function lignesDeDonnees<T extends TypeFeuille>(feuille: FeuilleBrute, entete: Entete<T>) {
  const cols = Object.values(entete.positions) as number[];
  const resultat: { numero: number; cellule: (col: keyof typeof entete.positions) => Cellule }[] = [];
  for (let i = entete.ligne + 1; i < feuille.lignes.length; i++) {
    const ligne = feuille.lignes[i];
    if (cols.every((c) => texteCellule(ligne[c] ?? null) === "")) continue;
    resultat.push({
      numero: i + 1,
      cellule: (col) => {
        const p = (entete.positions as Record<string, number | undefined>)[col as string];
        return p === undefined ? null : (ligne[p] ?? null);
      },
    });
  }
  return resultat;
}

export interface FeuillesTriees {
  feuillesClasses: FeuilleBrute[];
  feuillesArticles: FeuilleBrute[];
  feuillesEleves: { feuille: FeuilleBrute; classeParDefaut: string | null; entete: Entete<"eleves"> }[];
}

/** Range chaque feuille selon son nom et ses colonnes ; les problèmes vont dans `erreursGlobales` et `avertissements` */
export function trierFeuilles(classeur: ClasseurBrut, erreursGlobales: string[], avertissements: string[]): FeuillesTriees {
  const feuillesClasses: FeuilleBrute[] = [];
  const feuillesArticles: FeuilleBrute[] = [];
  const feuillesEleves: { feuille: FeuilleBrute; classeParDefaut: string | null; entete: Entete<"eleves"> }[] = [];
  for (const f of classeur.feuilles) {
    if (f.tronquee) erreursGlobales.push(`La feuille « ${f.nom} » dépasse ${MAX_ELEVES} lignes : découpez le fichier en plusieurs imports.`);
    const type = typeFeuille(f.nom);
    if (type === "ignoree") continue;
    if (type === "classes") feuillesClasses.push(f);
    else if (type === "articles") feuillesArticles.push(f);
    else {
      const entete = trouverEntete("eleves", f);
      if (!entete) {
        if (type === "eleves") erreursGlobales.push(`Feuille « ${f.nom} » : colonnes « Prénom » et « Nom » introuvables.`);
        else avertissements.push(`Feuille « ${f.nom} » ignorée : colonnes « Prénom » et « Nom » introuvables.`);
        continue;
      }
      // Feuille par classe : sans colonne Classe, le nom de la feuille donne la classe
      const classeParDefaut = type === "autre" && entete.positions.classe === undefined ? texteCellule(f.nom, 40) : null;
      if (type === "eleves" && entete.positions.classe === undefined) {
        erreursGlobales.push(`Feuille « ${f.nom} » : colonne « Classe » introuvable (ou nommez chaque feuille comme sa classe).`);
        continue;
      }
      feuillesEleves.push({ feuille: f, classeParDefaut, entete });
    }
  }
  if (feuillesEleves.length === 0 && erreursGlobales.length === 0) {
    erreursGlobales.push("Aucune feuille d'élèves trouvée : il faut au moins les colonnes « Prénom » et « Nom ».");
  }
  return { feuillesClasses, feuillesArticles, feuillesEleves };
}
