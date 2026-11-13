import { RIEN_A_ENCAISSER, choixALinscription, lignesAEncaisser, situationInscription } from "@/lib/metier/scolarite";
import type { Classe, Ecole } from "@/types/database";
import type { ArticleCalcul, CalendrierEcole } from "@/types/commun";
import type { ArticleCatalogue, ArticleCatalogueTarif, ArticleRetenu, ChoixArticle, LignePaiementInscription } from "@/types/ecole";

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

/**
 * Lignes du reçu d'inscription : frais d'inscription, mensualités exigibles dès l'inscription (1er et/ou dernier
 * mois, réglage de l'école) et frais uniques retenus, nets de la réduction. Calcul sur une inscription virtuelle
 * (tarifs de la classe, aucun paiement) avec le même code que l'encaissement depuis la fiche. La base ne recalcule
 * pas : elle vérifie seulement que chaque ligne ne dépasse pas le dû. Les services mensuels (transport…) ne sont
 * pas encaissés à l'inscription. Si rien n'est dû : erreur avec `rienAEncaisser: true`.
 */
export function lignesPaiementInscription(entree: {
  classe: Pick<Classe, "frais_inscription" | "mensualite" | "mensualite_dernier_mois">;
  reduction: number;
  ecole: CalendrierEcole & Pick<Ecole, "annee_scolaire">;
  aujourdhui: string;
  catalogue: ArticleCatalogueTarif[];
  articles: ArticleRetenu[];
  /** Début des services mensuels (YYYY-MM-01), null s'il n'y en a pas */
  moisDebutServices: string | null;
}): { lignes: LignePaiementInscription[]; total: number } | { erreur: string; rienAEncaisser?: true } {
  const { classe, reduction, ecole, aujourdhui, catalogue, articles, moisDebutServices } = entree;
  const virtuels: ArticleCalcul[] = [];
  for (const retenu of articles) {
    const a = catalogue.find((c) => c.id === retenu.article_classe_id);
    if (!a) return { erreur: "Article introuvable pour cette classe." };
    virtuels.push({
      id: a.id,
      libelle: a.libelle,
      nature: a.nature,
      prix_unitaire: a.prix_unitaire,
      quantite: retenu.quantite,
      obligatoire: a.obligatoire,
      mois_debut: a.nature === "mensuel" ? moisDebutServices : null,
      mois_fin: null,
    });
  }
  const inscription = {
    annee_scolaire: ecole.annee_scolaire,
    frais_inscription: classe.frais_inscription,
    mensualite: classe.mensualite,
    mensualite_dernier_mois: classe.mensualite_dernier_mois,
    reduction_mensuelle: reduction,
    statut: "active" as const,
  };
  const situation = situationInscription(inscription, [], ecole, aujourdhui, virtuels);
  const calcul = lignesAEncaisser(situation, choixALinscription(situation));
  // Rien n'est dû à l'inscription : ce n'est pas un refus, l'appelant inscrit sans reçu
  if ("erreur" in calcul) return calcul.erreur === RIEN_A_ENCAISSER ? { erreur: calcul.erreur, rienAEncaisser: true } : { erreur: calcul.erreur };
  const lignes = calcul.lignes.map((l) => ({
    type: l.type,
    mois: l.mois,
    article_classe_id: l.article_id,
    montant: l.montant,
    // La base refuse un libellé de plus de 120 caractères (libellé du catalogue sans plafond)
    libelle: l.libelle ? l.libelle.slice(0, 120) : l.libelle,
  }));
  return { lignes, total: lignes.reduce((t, l) => t + l.montant, 0) };
}
