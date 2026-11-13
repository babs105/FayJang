// Reprise de l'existant : feuilles « Classes » et « Articles », et catalogue de chaque classe utilisable par les élèves.
import type { FeuilleBrute } from "@/lib/documents/reprise-lecture";
import { normaliser } from "@/lib/validation/reprise-colonnes";
import {
  MAX_ARTICLES_CLASSE,
  MAX_CLASSES,
  NATURES,
  NIVEAUX,
  OUI_NON,
  choix,
  montantCellule,
  ressembleAUneFormule,
  texteCellule,
} from "@/lib/validation/reprise-cellules";
import { lignesDeDonnees, trouverEntete } from "@/lib/validation/reprise-feuilles";
import type { ArticleApercu, CatalogueClasse, ClasseApercu, ContexteReprise } from "@/types/reprise";

export interface ClassesLues {
  classes: ClasseApercu[];
  /** Classes du fichier, par nom normalisé (la première ligne en cas de doublon) */
  classesFichier: Map<string, ClasseApercu>;
  /** Classes déjà en base, par nom normalisé */
  classesBase: Map<string, ContexteReprise["classes"][number]>;
  /** Classes utilisables par les élèves : nouvelles sans erreur du fichier + classes déjà en base */
  catalogues: Map<string, CatalogueClasse>;
}

/** Feuille « Classes », puis catalogue de chaque classe utilisable (sans articles pour une classe nouvelle) */
export function analyserClasses(feuillesClasses: FeuilleBrute[], ctx: ContexteReprise, erreursGlobales: string[], avertissements: string[]): ClassesLues {
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
      else if (ressembleAUneFormule(nom)) erreurs.push("Le nom de la classe ne doit pas commencer par =, +, - ou @.");
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

  // Une classe déjà en base garde ses tarifs : si le fichier en donne d'autres, ses élèves sont refusés (décision DO3-A)
  const catalogues = new Map<string, CatalogueClasse>();
  for (const [cle, c] of classesBase) {
    const tarifs = { frais: c.frais, mensualite: c.mensualite, dernierMois: c.dernierMois };
    const fichier = classesFichier.get(cle);
    // Seules les valeurs données par le fichier sont comparées ; une case vide ne contredit pas la classe
    const differe =
      !!fichier &&
      ((fichier.frais !== null && fichier.frais !== c.frais) ||
        (fichier.mensualite !== null && fichier.mensualite !== c.mensualite) ||
        (fichier.dernierMois !== null && fichier.dernierMois !== (c.dernierMois ?? c.mensualite)));
    catalogues.set(cle, {
      nom: c.nom,
      articles: c.articles,
      tarifs,
      ecart: differe ? `Les tarifs du fichier diffèrent de la classe ${c.nom} de FayJàng : corrigez le fichier ou la classe.` : null,
    });
  }
  for (const c of classes) {
    if (c.etat !== "nouvelle") continue;
    const tarifs = c.frais !== null && c.mensualite !== null ? { frais: c.frais, mensualite: c.mensualite, dernierMois: c.dernierMois } : null;
    catalogues.set(normaliser(c.nom), { nom: c.nom, articles: [], tarifs, ecart: null });
  }
  return { classes, classesFichier, classesBase, catalogues };
}

/** Feuille « Articles » : remplit le catalogue des classes nouvelles (celui d'une classe déjà en base est conservé) */
export function analyserArticles(feuillesArticles: FeuilleBrute[], lues: ClassesLues, erreursGlobales: string[], avertissements: string[]): ArticleApercu[] {
  const { classesBase, classesFichier, catalogues } = lues;
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
      else if (ressembleAUneFormule(libelle)) erreurs.push("Le libellé ne doit pas commencer par =, +, - ou @.");
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
      // Au-delà du plafond, l'erreur globale suffit : le catalogue ne grossit plus (borne de calcul des élèves)
      const cat = catalogues.get(cleClasse);
      if (article.etat === "nouveau" && nature && cat && cat.articles.length <= MAX_ARTICLES_CLASSE) {
        cat.articles.push({
          libelle, nature, obligatoire: article.obligatoire, prix: article.prix ?? 0, quantiteDefaut: article.quantite,
        });
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
  return articles;
}
