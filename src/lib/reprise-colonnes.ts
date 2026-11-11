// Reprise de l'existant : reconnaissance des feuilles et des en-têtes du fichier Excel d'une école.
// Les en-têtes sont comparés sans casse, sans accents, sans astérisque ni ponctuation.

/** Texte comparable : minuscules, sans accents, ponctuation et espaces réduits à un seul espace */
export function normaliser(valeur: unknown): string {
  return String(valeur ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type ColonneClasse = "classe" | "niveau" | "frais" | "mensualite" | "dernierMois";
export type ColonneArticle = "classe" | "libelle" | "nature" | "prix" | "quantite" | "obligatoire";
export type ColonneEleve =
  | "prenom"
  | "nom"
  | "classe"
  | "parent"
  | "telephone"
  | "totalScolarite"
  | "articlesOptionnels"
  | "totalArticles"
  | "reduction"
  | "sexe"
  | "dateNaissance"
  | "matriculeAncien"
  | "statut"
  | "dateDepart";

/** Variantes acceptées pour chaque colonne (déjà normalisées) */
const VARIANTES_CLASSE: Record<ColonneClasse, string[]> = {
  classe: ["classe", "classes", "nom de la classe", "nom classe"],
  niveau: ["niveau", "cycle"],
  frais: ["frais d inscription", "frais inscription", "inscription", "droits d inscription", "frais"],
  mensualite: ["mensualite", "mensualites", "scolarite mensuelle", "montant mensuel"],
  dernierMois: ["mensualite dernier mois", "mensualite du dernier mois", "dernier mois"],
};

const VARIANTES_ARTICLE: Record<ColonneArticle, string[]> = {
  classe: ["classe", "classes"],
  libelle: ["libelle", "article", "articles", "designation", "nom de l article"],
  nature: ["nature", "type"],
  prix: ["prix unitaire", "prix", "tarif", "montant"],
  quantite: ["quantite par defaut", "quantite", "qte"],
  obligatoire: ["obligatoire", "obligatoire oui non"],
};

const VARIANTES_ELEVE: Record<ColonneEleve, string[]> = {
  prenom: ["prenom", "prenoms", "prenom de l eleve", "prenom eleve"],
  nom: ["nom", "nom de l eleve", "nom eleve", "nom de famille"],
  classe: ["classe", "classes"],
  parent: ["nom du parent", "nom parent", "parent", "tuteur", "nom du tuteur", "parent tuteur", "nom du parent tuteur"],
  telephone: [
    "telephone du parent",
    "telephone parent",
    "tel parent",
    "telephone",
    "tel",
    "contact",
    "contact parent",
    "numero",
    "numero du parent",
    "portable",
    "whatsapp",
  ],
  totalScolarite: [
    "total verse scolarite",
    "total verse",
    "montant verse",
    "montant paye",
    "deja paye",
    "deja verse",
    "total paye",
    "verse",
    "scolarite versee",
  ],
  articlesOptionnels: ["articles optionnels", "options", "articles", "services"],
  totalArticles: ["total verse articles", "articles verses", "verse articles", "montant articles"],
  reduction: ["reduction mensuelle", "reduction", "remise", "remise mensuelle"],
  sexe: ["sexe", "genre"],
  dateNaissance: ["date de naissance", "date naissance", "naissance", "ne le", "nee le"],
  matriculeAncien: ["matricule ancien", "ancien matricule", "matricule", "n matricule", "numero matricule"],
  statut: ["statut", "situation"],
  dateDepart: ["date de depart", "date depart", "depart", "date de sortie"],
};

/** Colonnes de contrôle du modèle, calculées dans Excel : jamais lues */
const COLONNES_IGNOREES = ["total du scolarite calcule", "reste scolarite calcule", "total de l annee calcule"];

function index<K extends string>(variantes: Record<K, string[]>): Map<string, K> {
  const m = new Map<string, K>();
  for (const [cle, liste] of Object.entries(variantes) as [K, string[]][]) for (const v of liste) m.set(v, cle);
  return m;
}

const INDEX = {
  classes: index(VARIANTES_CLASSE),
  articles: index(VARIANTES_ARTICLE),
  eleves: index(VARIANTES_ELEVE),
};

export type TypeFeuille = keyof typeof INDEX;

/** Colonne reconnue pour un en-tête, ou null */
export function colonneDe<T extends TypeFeuille>(type: T, entete: unknown): ColonnesDe<T> | null {
  const n = normaliser(entete);
  if (!n || COLONNES_IGNOREES.includes(n)) return null;
  return (INDEX[type].get(n) as ColonnesDe<T> | undefined) ?? null;
}

type ColonnesDe<T extends TypeFeuille> = T extends "classes" ? ColonneClasse : T extends "articles" ? ColonneArticle : ColonneEleve;

/** Position (0-based) de chaque colonne reconnue ; la première occurrence l'emporte */
export function reconnaitreEntetes<T extends TypeFeuille>(type: T, entetes: unknown[]): Partial<Record<ColonnesDe<T>, number>> {
  const positions: Partial<Record<ColonnesDe<T>, number>> = {};
  entetes.forEach((e, i) => {
    const col = colonneDe(type, e);
    if (col && positions[col] === undefined) positions[col] = i;
  });
  return positions;
}

/** Colonnes indispensables pour qu'une ligne soit reconnue comme en-tête */
export const COLONNES_REQUISES: { [T in TypeFeuille]: ColonnesDe<T>[] } = {
  classes: ["classe", "frais", "mensualite"],
  articles: ["classe", "libelle", "prix"],
  eleves: ["prenom", "nom"],
};

/** Feuilles du modèle qui ne contiennent pas de données */
const FEUILLES_IGNOREES = ["lisez moi", "lisez moi d abord", "cas d exemple", "cas d exemples", "listes", "aide"];

/** Rôle d'une feuille d'après son nom ; « autre » = à reconnaître par ses en-têtes (feuille par classe) */
export function typeFeuille(nom: string): TypeFeuille | "ignoree" | "autre" {
  const n = normaliser(nom);
  if (FEUILLES_IGNOREES.includes(n)) return "ignoree";
  if (n === "classes" || n === "classe") return "classes";
  if (n === "articles" || n === "catalogue" || n === "articles et services") return "articles";
  if (n === "eleves" || n === "eleve" || n === "liste des eleves") return "eleves";
  return "autre";
}
