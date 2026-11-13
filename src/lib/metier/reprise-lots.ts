// Reprise de l'existant, tranche 5 : préparation des lots d'import. Module pur, sans accès à la base.
// Le navigateur n'envoie que des CLÉS de lignes (feuille + numéro de ligne) ; tout le reste (identité, montants,
// articles, classe) vient de l'analyse du fichier refaite par le serveur, avec les tarifs lus en base. La base
// (fonction importer_reprise) plafonne ensuite chaque montant d'après les tarifs de la classe.
import type { EleveApercu } from "@/lib/validation/reprise-validation";

/** Nombre maximal d'élèves par appel à la base (borne aussi la durée d'une transaction). Ne pas dépasser 25 :
 *  importer_reprise refuse au-delà et garde le verrou du compteur de reçus de l'école pendant tout le lot. */
export const TAILLE_LOT = 25;

/** Découpe une liste en paquets de `taille` au plus, dans l'ordre */
export function decouper<T>(liste: T[], taille = TAILLE_LOT): T[][] {
  const lots: T[][] = [];
  for (let i = 0; i < liste.length; i += taille) lots.push(liste.slice(i, i + taille));
  return lots;
}

/** Ligne d'élève du fichier, désignée sans aucun montant */
export interface CleEleve {
  feuille: string;
  ligne: number;
}

export const cleDe = (e: Pick<EleveApercu, "feuille" | "ligne">): CleEleve => ({ feuille: e.feuille, ligne: e.ligne });

/**
 * Lit les clés reçues du navigateur. Refuse tout ce qui n'est pas exactement { feuille, ligne } : un montant, un
 * identifiant ou un ecole_id glissé dans la requête fait échouer l'appel au lieu d'être ignoré en silence.
 */
export function lireCles(brut: unknown): CleEleve[] | string {
  if (!Array.isArray(brut)) return "Lot d'import illisible.";
  if (brut.length < 1 || brut.length > TAILLE_LOT) return `Un lot contient de 1 à ${TAILLE_LOT} élèves.`;
  const vues = new Set<string>();
  const cles: CleEleve[] = [];
  for (const c of brut) {
    if (typeof c !== "object" || c === null || Array.isArray(c)) return "Lot d'import illisible.";
    const champs = Object.keys(c);
    if (champs.length !== 2 || !champs.includes("feuille") || !champs.includes("ligne")) return "Lot d'import refusé : seules les lignes du fichier sont acceptées.";
    const { feuille, ligne } = c as Record<string, unknown>;
    if (typeof feuille !== "string" || feuille.length === 0 || feuille.length > 200) return "Lot d'import illisible.";
    if (typeof ligne !== "number" || !Number.isInteger(ligne) || ligne < 1 || ligne > 1_000_000) return "Lot d'import illisible.";
    const k = `${feuille}\u0000${ligne}`;
    if (vues.has(k)) return "Lot d'import illisible : ligne répétée.";
    vues.add(k);
    cles.push({ feuille, ligne });
  }
  return cles;
}

/** Classe lue en base */
export interface ClasseBase {
  id: string;
  nom: string;
}
/** Article du catalogue lu en base */
export interface ArticleBase {
  id: string;
  classe_id: string;
  libelle: string;
}

/** Élève tel que la fonction SQL importer_reprise le reçoit (JSONB) */
export interface EleveSql {
  ligne: number;
  prenom: string;
  nom: string;
  parent_nom: string;
  telephone: string;
  sexe: "M" | "F" | null;
  date_naissance: string | null;
  matricule_ancien: string | null;
  classe_id: string;
  reduction: number;
  statut: string;
  date_depart: string | null;
  /** Les tarifs, libellés et natures sont relus par la base dans le catalogue : seul l'identifiant et le choix passent */
  articles: { article_classe_id: string; quantite: number; mois_debut: string | null; mois_fin: string | null }[];
  /** article_index : position (à partir de 0) dans `articles` ci-dessus, jamais un identifiant */
  paiements: { type: string; mois: string | null; article_index: number | null; montant: number; libelle: string | null }[];
}

export interface RefusLigne {
  ligne: number;
  message: string;
}

/**
 * Transforme des élèves « à créer » en entrée SQL. Un élève dont la classe n'existe pas en base, ou dont un article ne se
 * retrouve pas de façon certaine dans le catalogue de sa classe, est refusé (jamais envoyé).
 */
export function construireLot(
  eleves: EleveApercu[],
  classes: ClasseBase[],
  catalogue: ArticleBase[]
): { lot: EleveSql[]; refuses: RefusLigne[] } {
  const lot: EleveSql[] = [];
  const refuses: RefusLigne[] = [];
  for (const e of eleves) {
    const refus = (message: string) => refuses.push({ ligne: e.ligne, message });
    if (e.etat !== "a_creer" || !e.repartition) {
      refus("Ligne non importable.");
      continue;
    }
    const classe = classes.filter((c) => c.nom === e.classe);
    if (classe.length !== 1) {
      refus(`La classe « ${e.classe} » n'existe pas encore dans FayJàng : créez-la d'abord.`);
      continue;
    }
    const classeId = classe[0].id;
    const articles: EleveSql["articles"] = [];
    let ambigu: string | null = null;
    for (const a of e.repartition.articles) {
      const trouves = catalogue.filter((c) => c.classe_id === classeId && c.libelle === a.libelle);
      if (trouves.length !== 1) {
        ambigu = a.libelle;
        break;
      }
      articles.push({ article_classe_id: trouves[0].id, quantite: a.quantite, mois_debut: a.moisDebut, mois_fin: a.moisFin });
    }
    if (ambigu !== null) {
      refus(`L'article « ${ambigu} » n'est pas retrouvé de façon unique dans le catalogue de la classe.`);
      continue;
    }
    if (!e.telephone) {
      refus("Téléphone du parent manquant.");
      continue;
    }
    lot.push({
      ligne: e.ligne,
      prenom: e.prenom,
      nom: e.nom,
      parent_nom: e.parent,
      telephone: e.telephone,
      sexe: e.sexe,
      date_naissance: e.dateNaissance,
      matricule_ancien: e.matriculeAncien,
      classe_id: classeId,
      reduction: e.reduction ?? 0,
      statut: e.statut,
      date_depart: e.dateDepart,
      articles,
      // Le rang d'un article dans `articles` est celui de ArticlePrevu (un service repris : une position par période)
      paiements: e.repartition.paiements.map((p) => ({
        type: p.type,
        mois: p.mois,
        article_index: p.articleIndex,
        montant: p.montant,
        // Article : libellé du reçu (« Tenue × 2 », « Transport — novembre 2026 »), comme encaisser_paiement
        libelle: p.type === "autre" ? p.libelle : p.libelleTranche,
      })),
    });
  }
  return { lot, refuses };
}

/** Une ligne du retour de importer_reprise */
export interface ResultatEleveReprise {
  ligne: number;
  statut: "cree" | "ignore";
  eleve_id: string | null;
  numero_recu: string | null;
  montant: number;
}

/** Compte rendu d'un lot, renvoyé au navigateur (sans nom ni téléphone) */
export interface ResultatLotReprise {
  crees: number;
  ignores: number;
  /** Total encaissé en reprise sur ce lot, en FCFA */
  montant: number;
  /** Nombre de reçus « Reprise de l'existant » émis */
  recus: number;
  refuses: RefusLigne[];
}

/** Lit le retour JSONB de la base ; null si la forme est inattendue */
export function lireRetour(brut: unknown): ResultatEleveReprise[] | null {
  if (!Array.isArray(brut)) return null;
  const sortie: ResultatEleveReprise[] = [];
  for (const r of brut) {
    if (typeof r !== "object" || r === null) return null;
    const { ligne, statut, eleve_id, numero_recu, montant } = r as Record<string, unknown>;
    if (typeof ligne !== "number" || (statut !== "cree" && statut !== "ignore") || typeof montant !== "number") return null;
    sortie.push({
      ligne,
      statut,
      eleve_id: typeof eleve_id === "string" ? eleve_id : null,
      numero_recu: typeof numero_recu === "string" ? numero_recu : null,
      montant,
    });
  }
  return sortie;
}

/** Additionne les lignes d'un retour */
export function resumerRetour(lignes: ResultatEleveReprise[]): Pick<ResultatLotReprise, "crees" | "ignores" | "montant" | "recus"> {
  return {
    crees: lignes.filter((l) => l.statut === "cree").length,
    ignores: lignes.filter((l) => l.statut === "ignore").length,
    montant: lignes.reduce((s, l) => s + l.montant, 0),
    recus: lignes.filter((l) => l.numero_recu !== null).length,
  };
}
