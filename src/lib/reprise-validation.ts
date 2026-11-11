// Reprise de l'existant : contrôle de forme du fichier (classes, articles, élèves), sans aucun calcul d'argent.
// Produit l'aperçu ligne par ligne affiché à l'école avant tout import. N'écrit rien.
import { normaliserTelephone } from "@/lib/telephone";
import type { Cellule, ClasseurBrut, FeuilleBrute } from "@/lib/reprise-lecture";
import { COLONNES_REQUISES, normaliser, reconnaitreEntetes, typeFeuille, type TypeFeuille } from "@/lib/reprise-colonnes";
import type { NatureArticle, Niveau, StatutInscription } from "@/types/database";

export const MAX_ELEVES = 2000;
export const MAX_CLASSES = 200;
/** Plafond du catalogue d'une classe (même borne que enregistrer_classe, bloc v1.9) */
export const MAX_ARTICLES_CLASSE = 30;
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

/** Un texte qui commence par =, + ou @ deviendrait une formule dans un export Excel : refusé */
export function ressembleAUneFormule(s: string): boolean {
  return /^[=+@]/.test(s);
}

const SEXES: Record<string, "M" | "F"> = {
  m: "M", masculin: "M", g: "M", garcon: "M", h: "M", homme: "M",
  f: "F", feminin: "F", fille: "F", femme: "F",
};
const STATUTS: Record<string, StatutInscription> = {
  "": "active", active: "active", actif: "active", inscrit: "active", inscrite: "active",
  abandon: "abandon", abandonne: "abandon", abandonnee: "abandon",
  transfert: "transfert", transfere: "transfert", transferee: "transfert",
};
const NIVEAUX: Record<string, Niveau> = {
  prescolaire: "prescolaire", maternelle: "prescolaire", preelementaire: "prescolaire",
  elementaire: "elementaire", primaire: "elementaire",
  moyen: "moyen", college: "moyen",
  secondaire: "secondaire", lycee: "secondaire",
};
const NATURES: Record<string, NatureArticle> = {
  unique: "unique", "frais unique": "unique", "une fois": "unique",
  mensuel: "mensuel", mensuelle: "mensuel", "par mois": "mensuel", "service mensuel": "mensuel",
};
const OUI_NON: Record<string, boolean> = { oui: true, o: true, x: true, vrai: true, "1": true, non: false, n: false, faux: false, "0": false };

function choix<T>(table: Record<string, T>, c: Cellule): T | undefined {
  return table[normaliser(texteCellule(c))];
}

/** « Tenue x3 » → { libelle: "Tenue", quantite: 3 } ; sans suffixe : quantite null */
export function lireOption(brut: string): { libelle: string; quantite: number | null } {
  const m = /^(.*?)\s*[x×*]\s*(\d{1,3})$/i.exec(brut.trim());
  if (m && m[1].trim()) return { libelle: m[1].trim(), quantite: Number(m[2]) };
  return { libelle: brut.trim(), quantite: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Aperçu

export interface ContexteReprise {
  anneeScolaire: string;
  /** Date de l'import (Dakar), AAAA-MM-JJ */
  aujourdhui: string;
  /** Premier mois de l'année scolaire, AAAA-MM-01 */
  premierMois: string;
  /** Classes déjà présentes pour l'année, avec leur catalogue */
  classes: { nom: string; articles: ArticleCatalogue[] }[];
  /** Élèves déjà inscrits cette année (téléphone du parent normalisé) */
  eleves: { prenom: string; nom: string; telephone: string }[];
}

export interface ArticleCatalogue {
  libelle: string;
  nature: NatureArticle;
  obligatoire: boolean;
}

export interface ClasseApercu {
  ligne: number;
  nom: string;
  niveau: Niveau | null;
  frais: number | null;
  mensualite: number | null;
  dernierMois: number | null;
  etat: "nouvelle" | "existante" | "erreur";
  erreurs: string[];
}

export interface ArticleApercu {
  ligne: number;
  classe: string;
  libelle: string;
  nature: NatureArticle | null;
  prix: number | null;
  quantite: number;
  obligatoire: boolean;
  etat: "nouveau" | "ignore" | "erreur";
  erreurs: string[];
}

export interface OptionEleve {
  libelle: string;
  quantite: number | null;
}

export interface EleveApercu {
  feuille: string;
  ligne: number;
  prenom: string;
  nom: string;
  classe: string;
  parent: string;
  telephone: string | null;
  sexe: "M" | "F" | null;
  dateNaissance: string | null;
  matriculeAncien: string | null;
  statut: StatutInscription;
  dateDepart: string | null;
  reduction: number | null;
  totalScolarite: number | null;
  totalArticles: number | null;
  options: OptionEleve[];
  etat: "a_creer" | "deja_present" | "erreur";
  erreurs: string[];
  avertissements: string[];
}

export interface ApercuReprise {
  /** Problèmes qui empêchent tout import (feuille manquante, fichier trop long…) */
  erreursGlobales: string[];
  avertissements: string[];
  classes: ClasseApercu[];
  articles: ArticleApercu[];
  eleves: EleveApercu[];
  compteurs: { aCreer: number; dejaPresents: number; erreurs: number; parents: number; classesNouvelles: number };
}

/** Élèves d'exemple du modèle : à effacer avant l'import */
const EXEMPLES = new Set(
  [
    ["awa", "diop"], ["ibrahima", "diop"], ["fatou", "ndiaye"], ["moussa", "fall"],
    ["khady", "sarr"], ["ndeye", "gueye"], ["mariama", "ba"], ["cheikh", "mbaye"],
  ].map(([p, n]) => `${p}|${n}`)
);
const TELEPHONES_EXEMPLES = new Set(["+221771234567", "+221787654321", "+221762223344", "+221701112233", "+221779998877", "+221784445566", "+221775556677"]);

/** Clé d'identité d'un élève, comparée comme en base : lower(btrim(...)) */
function cleStricte(prenom: string, nom: string, telephone: string): string {
  return `${prenom.trim().toLowerCase()}|${nom.trim().toLowerCase()}|${telephone}`;
}
/** Même clé sans accents ni ponctuation : pour avertir d'un doublon probable */
function cleSouple(prenom: string, nom: string, telephone: string): string {
  return `${normaliser(prenom)}|${normaliser(nom)}|${telephone}`;
}

interface Entete<T extends TypeFeuille> {
  ligne: number;
  positions: ReturnType<typeof reconnaitreEntetes<T>>;
}

/** Ligne d'en-tête : la première des 10 premières lignes qui contient les colonnes requises */
function trouverEntete<T extends TypeFeuille>(type: T, feuille: FeuilleBrute): Entete<T> | null {
  for (let i = 0; i < Math.min(10, feuille.lignes.length); i++) {
    const positions = reconnaitreEntetes(type, feuille.lignes[i]);
    if ((COLONNES_REQUISES[type] as string[]).every((c) => (positions as Record<string, number | undefined>)[c] !== undefined)) {
      return { ligne: i, positions };
    }
  }
  return null;
}

/** Lignes de données sous l'en-tête, avec leur numéro de ligne Excel ; les lignes vides sont sautées */
function lignesDeDonnees<T extends TypeFeuille>(feuille: FeuilleBrute, entete: Entete<T>) {
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

export function analyserReprise(classeur: ClasseurBrut, ctx: ContexteReprise): ApercuReprise {
  const erreursGlobales: string[] = [];
  const avertissements: string[] = [];

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

  // ----- Classes -----
  const classesBase = new Map(ctx.classes.map((c) => [normaliser(c.nom), c]));
  const classes: ClasseApercu[] = [];
  const classesFichier = new Map<string, ClasseApercu>();
  for (const f of feuillesClasses) {
    const entete = trouverEntete("classes", f);
    if (!entete) {
      erreursGlobales.push(`Feuille « ${f.nom} » : colonnes « Classe », « Frais d'inscription » et « Mensualité » introuvables.`);
      continue;
    }
    for (const { numero, cellule } of lignesDeDonnees(f, entete)) {
      const erreurs: string[] = [];
      const nom = texteCellule(cellule("classe"), 60);
      if (!nom) erreurs.push("Nom de la classe manquant.");
      else if (nom.length > 40) erreurs.push("Nom de la classe trop long (40 caractères au maximum).");
      else if (ressembleAUneFormule(nom)) erreurs.push("Le nom de la classe ne doit pas commencer par =, + ou @.");
      const niveauBrut = texteCellule(cellule("niveau"));
      const niveau = choix(NIVEAUX, cellule("niveau")) ?? null;
      const frais = montantCellule(cellule("frais"));
      const mensualite = montantCellule(cellule("mensualite"));
      const dernier = montantCellule(cellule("dernierMois"));
      const existante = nom ? classesBase.has(normaliser(nom)) : false;
      if (!existante) {
        if (!niveau) erreurs.push(niveauBrut ? `Niveau « ${niveauBrut} » inconnu (préscolaire, élémentaire, moyen ou secondaire).` : "Niveau manquant.");
        if (frais === null || frais === "invalide") erreurs.push("Frais d'inscription manquants ou invalides (nombre entier en FCFA).");
        if (mensualite === null || mensualite === "invalide") erreurs.push("Mensualité manquante ou invalide (nombre entier en FCFA).");
        if (dernier === "invalide") erreurs.push("Mensualité du dernier mois invalide.");
      }
      if (nom && classesFichier.has(normaliser(nom))) erreurs.push(`Classe en double (ligne ${classesFichier.get(normaliser(nom))!.ligne}).`);
      const classe: ClasseApercu = {
        ligne: numero,
        nom,
        niveau,
        frais: typeof frais === "number" ? frais : null,
        mensualite: typeof mensualite === "number" ? mensualite : null,
        dernierMois: typeof dernier === "number" ? dernier : null,
        etat: erreurs.length ? "erreur" : existante ? "existante" : "nouvelle",
        erreurs,
      };
      classes.push(classe);
      if (nom && !classesFichier.has(normaliser(nom))) classesFichier.set(normaliser(nom), classe);
    }
  }
  if (classes.length > MAX_CLASSES) erreursGlobales.push(`Trop de classes : ${MAX_CLASSES} au maximum.`);
  const nbExistantes = classes.filter((c) => c.etat === "existante").length;
  if (nbExistantes > 0) {
    avertissements.push(
      `${nbExistantes} classe${nbExistantes > 1 ? "s" : ""} du fichier existe${nbExistantes > 1 ? "nt" : ""} déjà dans FayJàng : elle${nbExistantes > 1 ? "s" : ""} ne ser${nbExistantes > 1 ? "ont" : "a"} pas modifiée${nbExistantes > 1 ? "s" : ""}.`
    );
  }

  // Classes utilisables par les élèves : nouvelles sans erreur du fichier + classes déjà en base
  const catalogues = new Map<string, { nom: string; articles: ArticleCatalogue[] }>();
  for (const [cle, c] of classesBase) catalogues.set(cle, { nom: c.nom, articles: c.articles });
  for (const c of classes) if (c.etat === "nouvelle") catalogues.set(normaliser(c.nom), { nom: c.nom, articles: [] });

  // ----- Articles -----
  const articles: ArticleApercu[] = [];
  const vusArticles = new Map<string, number>();
  for (const f of feuillesArticles) {
    const entete = trouverEntete("articles", f);
    if (!entete) {
      erreursGlobales.push(`Feuille « ${f.nom} » : colonnes « Classe », « Libellé » et « Prix unitaire » introuvables.`);
      continue;
    }
    for (const { numero, cellule } of lignesDeDonnees(f, entete)) {
      const erreurs: string[] = [];
      const classe = texteCellule(cellule("classe"), 60);
      const libelle = texteCellule(cellule("libelle"), 80);
      const natureBrute = texteCellule(cellule("nature"));
      const nature = choix(NATURES, cellule("nature")) ?? null;
      const prix = montantCellule(cellule("prix"));
      const quantiteBrute = montantCellule(cellule("quantite"));
      const obligBrut = texteCellule(cellule("obligatoire"));
      const obligatoire = obligBrut === "" ? false : choix(OUI_NON, cellule("obligatoire"));

      const cleClasse = normaliser(classe);
      const enBase = classesBase.has(cleClasse);
      const dansFichier = classesFichier.get(cleClasse);
      if (!classe) erreurs.push("Classe manquante.");
      else if (!enBase && !dansFichier) erreurs.push(`Classe « ${classe} » inconnue : ajoutez-la dans la feuille « Classes ».`);
      else if (!enBase && dansFichier?.etat === "erreur") erreurs.push(`La classe « ${classe} » est en erreur dans la feuille « Classes ».`);
      if (!libelle) erreurs.push("Libellé manquant.");
      else if (libelle.length > 60) erreurs.push("Libellé trop long (60 caractères au maximum).");
      else if (ressembleAUneFormule(libelle)) erreurs.push("Le libellé ne doit pas commencer par =, + ou @.");
      if (!nature) erreurs.push(natureBrute ? `Nature « ${natureBrute} » inconnue (unique ou mensuel).` : "Nature manquante (unique ou mensuel).");
      if (prix === null || prix === "invalide" || prix > 99_999_999) erreurs.push("Prix unitaire manquant ou invalide (nombre entier en FCFA).");
      if (quantiteBrute === "invalide" || (typeof quantiteBrute === "number" && quantiteBrute > 99)) erreurs.push("Quantité par défaut invalide (0 à 99).");
      if (obligatoire === undefined) erreurs.push("« Obligatoire » doit valoir oui ou non.");
      const cle = `${cleClasse}|${normaliser(libelle)}`;
      if (libelle && vusArticles.has(cle)) erreurs.push(`Article en double dans cette classe (ligne ${vusArticles.get(cle)}).`);
      else if (libelle) vusArticles.set(cle, numero);

      const article: ArticleApercu = {
        ligne: numero,
        classe: catalogues.get(cleClasse)?.nom ?? classe,
        libelle,
        nature,
        prix: typeof prix === "number" ? prix : null,
        quantite: typeof quantiteBrute === "number" ? quantiteBrute : 1,
        obligatoire: obligatoire ?? false,
        etat: erreurs.length ? "erreur" : enBase ? "ignore" : "nouveau",
        erreurs,
      };
      articles.push(article);
      // Une classe déjà en base garde son catalogue : seul le fichier d'une classe nouvelle le remplit
      if (article.etat === "nouveau" && nature) {
        catalogues.get(cleClasse)?.articles.push({ libelle, nature, obligatoire: article.obligatoire });
      }
    }
  }
  if (articles.some((a) => a.etat === "ignore")) {
    avertissements.push("Les articles d'une classe déjà présente sont ignorés : son catalogue actuel est conservé.");
  }
  for (const [, c] of catalogues) {
    if (c.articles.length > MAX_ARTICLES_CLASSE) {
      erreursGlobales.push(`Classe « ${c.nom} » : ${MAX_ARTICLES_CLASSE} articles au maximum dans son catalogue.`);
    }
  }

  // ----- Élèves -----
  const eleves: EleveApercu[] = [];
  const presentsStricts = new Set(ctx.eleves.map((e) => cleStricte(e.prenom, e.nom, e.telephone)));
  const presentsSouples = new Set(ctx.eleves.map((e) => cleSouple(e.prenom, e.nom, e.telephone)));
  const vusEleves = new Map<string, number>();
  const vusMatricules = new Map<string, number>();
  const parentsParTelephone = new Map<string, { nom: string; ligne: number }>();
  let nbLignesEleves = 0;

  for (const { feuille, classeParDefaut, entete } of feuillesEleves) {
    for (const { numero, cellule } of lignesDeDonnees(feuille, entete)) {
      nbLignesEleves++;
      if (nbLignesEleves > MAX_ELEVES) break;
      const erreurs: string[] = [];
      const avert: string[] = [];

      const prenom = texteCellule(cellule("prenom"), 80);
      const nom = texteCellule(cellule("nom"), 80);
      const classeSaisie = classeParDefaut ?? texteCellule(cellule("classe"), 60);
      const parent = texteCellule(cellule("parent"), 100);
      const telBrut = texteCellule(cellule("telephone"), 40);
      const telephone = telephoneCellule(cellule("telephone"));

      if (!prenom) erreurs.push("Prénom manquant.");
      else if (prenom.length > 60) erreurs.push("Prénom trop long (60 caractères au maximum).");
      if (!nom) erreurs.push("Nom manquant.");
      else if (nom.length > 60) erreurs.push("Nom trop long (60 caractères au maximum).");
      if (!parent) erreurs.push("Nom du parent manquant.");
      else if (parent.length > 80) erreurs.push("Nom du parent trop long (80 caractères au maximum).");
      if (!telBrut) erreurs.push("Téléphone du parent manquant.");
      else if (!telephone) erreurs.push(`Téléphone du parent « ${telBrut} » invalide.`);
      if ([prenom, nom, parent].some(ressembleAUneFormule)) erreurs.push("Un nom ne doit pas commencer par =, + ou @.");

      // Classe
      const catalogue = catalogues.get(normaliser(classeSaisie));
      if (!classeSaisie) erreurs.push("Classe manquante.");
      else if (!catalogue) {
        const enErreur = classesFichier.get(normaliser(classeSaisie))?.etat === "erreur";
        erreurs.push(enErreur ? `La classe « ${classeSaisie} » est en erreur dans la feuille « Classes ».` : `Classe « ${classeSaisie} » inconnue : ajoutez-la dans la feuille « Classes ».`);
      }

      // Montants (contrôle de forme seulement : la répartition vient à l'étape suivante)
      const lireMontant = (col: "totalScolarite" | "totalArticles" | "reduction", libelle: string): number | null => {
        const m = montantCellule(cellule(col));
        if (m === "invalide") {
          erreurs.push(`${libelle} invalide : nombre entier en FCFA (ex : 75000).`);
          return null;
        }
        return m;
      };
      const totalScolarite = lireMontant("totalScolarite", "Total versé (scolarité)");
      const totalArticles = lireMontant("totalArticles", "Total versé (articles)");
      const reduction = lireMontant("reduction", "Réduction mensuelle");

      // Sexe, naissance
      const sexeBrut = texteCellule(cellule("sexe"));
      const sexe = sexeBrut ? (choix(SEXES, cellule("sexe")) ?? null) : null;
      if (sexeBrut && !sexe) erreurs.push(`Sexe « ${sexeBrut} » invalide (M ou F).`);
      const naissance = dateCellule(cellule("dateNaissance"));
      if (naissance === "invalide") erreurs.push("Date de naissance invalide (JJ/MM/AAAA).");
      else if (naissance && naissance > ctx.aujourdhui) erreurs.push("Date de naissance dans le futur.");

      // Matricule ancien
      const matricule = texteCellule(cellule("matriculeAncien"), 60) || null;
      if (matricule && matricule.length > 40) erreurs.push("Matricule ancien trop long (40 caractères au maximum).");
      if (matricule) {
        const cleM = matricule.toLowerCase();
        if (vusMatricules.has(cleM)) erreurs.push(`Matricule ancien déjà utilisé ligne ${vusMatricules.get(cleM)}.`);
        else vusMatricules.set(cleM, numero);
      }

      // Statut et départ
      const statutBrut = texteCellule(cellule("statut"));
      const statut = choix(STATUTS, cellule("statut"));
      const depart = dateCellule(cellule("dateDepart"));
      if (!statut) erreurs.push(`Statut « ${statutBrut} » inconnu (vide, abandon ou transfert).`);
      if (depart === "invalide") erreurs.push("Date de départ invalide (JJ/MM/AAAA).");
      else if (statut === "active" && depart) erreurs.push("Date de départ renseignée pour un élève actif : indiquez le statut abandon ou transfert.");
      else if (statut && statut !== "active") {
        if (!depart) erreurs.push("Date de départ obligatoire pour un abandon ou un transfert.");
        else if (depart > ctx.aujourdhui) erreurs.push("Date de départ dans le futur.");
        else if (depart < ctx.premierMois) erreurs.push(`Date de départ avant le début de l'année scolaire ${ctx.anneeScolaire}.`);
      }

      // Articles optionnels (« Transport ; Cantine ; Tenue x3 »)
      const options: OptionEleve[] = [];
      const optionsBrutes = texteCellule(cellule("articlesOptionnels"), 300);
      if (optionsBrutes && catalogue) {
        const vus = new Set<string>();
        for (const morceau of optionsBrutes.split(";").map((s) => s.trim()).filter(Boolean)) {
          // Le libellé complet passe d'abord : un article nommé « Pack x3 » reste trouvable
          let article = catalogue.articles.find((a) => normaliser(a.libelle) === normaliser(morceau));
          let quantite: number | null = null;
          if (!article) {
            const lu = lireOption(morceau);
            article = catalogue.articles.find((a) => normaliser(a.libelle) === normaliser(lu.libelle));
            quantite = lu.quantite;
          }
          if (!article) {
            erreurs.push(`Article « ${morceau} » absent du catalogue de ${catalogue.nom}.`);
            continue;
          }
          if (vus.has(normaliser(article.libelle))) {
            erreurs.push(`Article « ${article.libelle} » cité deux fois.`);
            continue;
          }
          vus.add(normaliser(article.libelle));
          if (quantite !== null && article.nature === "mensuel") {
            erreurs.push(`« ${morceau} » : un service mensuel n'a pas de quantité.`);
            continue;
          }
          if (quantite !== null && (quantite < 1 || quantite > 99)) {
            erreurs.push(`« ${morceau} » : quantité de 1 à 99.`);
            continue;
          }
          if (article.obligatoire && quantite === null) {
            avert.push(`« ${article.libelle} » est obligatoire : il est ajouté d'office.`);
          }
          options.push({ libelle: article.libelle, quantite });
        }
      }

      // Doublons et élèves déjà présents
      let dejaPresent = false;
      if (prenom && nom && telephone) {
        const cle = cleStricte(prenom, nom, telephone);
        if (EXEMPLES.has(`${normaliser(prenom)}|${normaliser(nom)}`) && TELEPHONES_EXEMPLES.has(telephone)) {
          erreurs.push("Ligne d'exemple du modèle : effacez-la avant l'import.");
        }
        if (vusEleves.has(cle)) erreurs.push(`Même élève que la ligne ${vusEleves.get(cle)} (même prénom, nom et téléphone du parent).`);
        else vusEleves.set(cle, numero);
        if (presentsStricts.has(cle)) dejaPresent = true;
        else if (presentsSouples.has(cleSouple(prenom, nom, telephone))) {
          avert.push("Un élève très proche (accents ou ponctuation différents) existe déjà : vérifiez qu'il ne s'agit pas du même.");
        }
        // Même téléphone, autre nom de parent : le premier nom est gardé
        const connu = parentsParTelephone.get(telephone);
        if (connu && normaliser(connu.nom) !== normaliser(parent)) {
          avert.push(`Même téléphone que la ligne ${connu.ligne} avec un autre nom de parent (« ${connu.nom} ») : un seul parent sera créé.`);
        } else if (!connu && parent) parentsParTelephone.set(telephone, { nom: parent, ligne: numero });
      }

      eleves.push({
        feuille: feuille.nom,
        ligne: numero,
        prenom,
        nom,
        classe: catalogue?.nom ?? classeSaisie,
        parent,
        telephone,
        sexe,
        dateNaissance: typeof naissance === "string" && naissance !== "invalide" ? naissance : null,
        matriculeAncien: matricule,
        statut: statut ?? "active",
        dateDepart: typeof depart === "string" && depart !== "invalide" ? depart : null,
        reduction,
        totalScolarite,
        totalArticles,
        options,
        etat: erreurs.length ? "erreur" : dejaPresent ? "deja_present" : "a_creer",
        erreurs,
        avertissements: avert,
      });
    }
  }
  if (nbLignesEleves > MAX_ELEVES) erreursGlobales.push(`Trop d'élèves : ${MAX_ELEVES} au maximum par import. Découpez le fichier.`);
  if (feuillesEleves.length > 0 && eleves.length === 0 && nbLignesEleves === 0) {
    erreursGlobales.push("Aucun élève trouvé dans le fichier.");
  }

  const aCreer = eleves.filter((e) => e.etat === "a_creer");
  return {
    erreursGlobales,
    avertissements,
    classes,
    articles,
    eleves,
    compteurs: {
      aCreer: aCreer.length,
      dejaPresents: eleves.filter((e) => e.etat === "deja_present").length,
      erreurs: eleves.filter((e) => e.etat === "erreur").length,
      parents: new Set(aCreer.map((e) => e.telephone)).size,
      classesNouvelles: classes.filter((c) => c.etat === "nouvelle").length,
    },
  };
}
