import type { NatureArticle } from "@/types/database";

/** Ligne du catalogue d'une classe, telle que lue dans articles_classe */
export type ArticleCatalogue = {
  id: string;
  libelle: string;
  nature: NatureArticle;
  quantite_defaut: number;
  obligatoire: boolean;
};

/** Article coché dans le formulaire d'inscription (quantité saisie pour un frais unique) */
export type ChoixArticle = { article_classe_id?: string; quantite?: string | number };

/** Article retenu pour l'élève, envoyé à la fonction SQL inscrire_eleve (qui recopie prix et libellé) */
export type ArticleRetenu = { article_classe_id: string; quantite: number };

/**
 * Articles retenus à l'inscription : les obligatoires toujours, les optionnels s'ils sont cochés.
 * Un frais unique prend la quantité saisie (sinon celle par défaut) et disparaît à 0 ; un service mensuel
 * compte pour 1. Message d'erreur si une quantité est invalide ou si un obligatoire est mis à 0.
 * La base revérifie (classe, obligatoires, quantités) : cette fonction sert aux messages et à l'import.
 */
export function selectionnerArticles(
  catalogue: ArticleCatalogue[],
  choix: ChoixArticle[] | undefined
): { articles: ArticleRetenu[] } | { erreur: string } {
  const coches = new Map((Array.isArray(choix) ? choix.slice(0, 50) : []).map((a) => [a?.article_classe_id, a?.quantite]));
  const articles: ArticleRetenu[] = [];
  for (const a of catalogue) {
    if (!a.obligatoire && !coches.has(a.id)) continue;
    const saisie = coches.get(a.id);
    const q = a.nature === "unique" && saisie !== undefined ?Number(saisie) : a.quantite_defaut;
    if (!Number.isInteger(q) || q < 0 || q > 99) return { erreur: `Quantité invalide pour « ${a.libelle} ».` };
    if (a.obligatoire && a.nature === "unique" && q < 1 && a.quantite_defaut > 0) {
      return { erreur: `« ${a.libelle} » est obligatoire pour cette classe.` };
    }
    if (a.nature === "unique" && q === 0) continue;
    articles.push({ article_classe_id: a.id, quantite: a.nature === "mensuel" ? 1 : q });
  }
  return { articles };
}
