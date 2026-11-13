// Catalogue d'articles d'une classe (tenues, transport, fournitures) saisi dans l'onglet Classes.
// La base revérifie les formes et les plafonds dans enregistrer_classe (supabase/schema/05-migrations.sql, bloc v1.9).
import { estUuid, montant, texte } from "@/lib/validation/saisie";
import type { NatureArticle } from "@/types/database";

export interface SaisieArticle {
  /** Ligne existante du catalogue (mise à jour sur place) ; absent = nouvelle ligne */
  id?: string;
  libelle: string;
  nature: string;
  prix_unitaire: string | number;
  quantite_defaut?: string | number;
  obligatoire: boolean;
}

/** Ligne du catalogue prête pour la fonction enregistrer_classe (un `type` : supabase-js exige une signature d'index pour le JSON) */
export type LigneCatalogue = {
  id?: string;
  libelle: string;
  nature: NatureArticle;
  prix_unitaire: number;
  quantite_defaut: number;
  obligatoire: boolean;
  /** Position dans la saisie (les lignes vides comptent) */
  ordre: number;
};

export const MAX_ARTICLES_CLASSE = 30;

/** Catalogue saisi pour une classe ; message d'erreur si une ligne est invalide */
export function lireArticles(saisis: SaisieArticle[] | undefined): LigneCatalogue[] | string {
  if (saisis !== undefined && !Array.isArray(saisis)) return "Articles invalides.";
  if ((saisis ?? []).length > MAX_ARTICLES_CLASSE) return `${MAX_ARTICLES_CLASSE} articles au plus par classe.`;
  const lignes: LigneCatalogue[] = [];
  for (const [i, a] of (saisis ?? []).entries()) {
    if (!a || typeof a !== "object") return "Articles invalides.";
    const libelle = texte(a.libelle, 60);
    if (!libelle) continue;
    const nature: NatureArticle = a.nature === "mensuel" ? "mensuel" : "unique";
    const prix = montant(a.prix_unitaire);
    const quantite = nature === "mensuel" ? 1 : Number(a.quantite_defaut ?? 1);
    if (prix === null) return `Prix invalide pour « ${libelle} ».`;
    if (!Number.isInteger(quantite) || quantite < 0 || quantite > 99) return `Quantité invalide pour « ${libelle} ».`;
    // Un id mal formé ne désigne aucune ligne existante : la ligne est traitée comme nouvelle
    lignes.push({ id: estUuid(a.id) ? a.id : undefined, libelle, nature, prix_unitaire: prix, quantite_defaut: quantite, obligatoire: a.obligatoire === true, ordre: i });
  }
  // Un même id saisi deux fois : seule la première ligne garde le lien, l'autre devient une nouvelle ligne
  const vus = new Set<string>();
  for (const l of lignes) {
    if (!l.id) continue;
    const cle = l.id.toLowerCase();
    if (vus.has(cle)) l.id = undefined;
    else vus.add(cle);
  }
  return lignes;
}
