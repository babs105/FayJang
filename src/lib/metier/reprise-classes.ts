// Reprise de l'existant, création des classes : de l'aperçu aux appels de enregistrer_classe (bloc v1.9).
// Seules les classes « nouvelles » de l'aperçu sont créées ; une classe déjà présente n'est jamais modifiée (DO3).
import { lireArticles } from "@/lib/metier/classe-catalogue";
import { normaliser } from "@/lib/validation/reprise-colonnes";
import type { ApercuReprise, ClasseACreer } from "@/types/reprise";

/**
 * Classes à créer, chacune avec son catalogue (articles « nouveaux » du fichier, dans l'ordre du fichier).
 * Le catalogue repasse par lireArticles, la validation du formulaire de classe : `erreurs` liste les classes refusées.
 */
export function classesACreer(apercu: ApercuReprise): { classes: ClasseACreer[]; erreurs: { nom: string; message: string }[] } {
  const classes: ClasseACreer[] = [];
  const erreurs: { nom: string; message: string }[] = [];
  for (const c of apercu.classes) {
    if (c.etat !== "nouvelle") continue;
    if (!c.niveau || c.frais === null || c.mensualite === null) {
      erreurs.push({ nom: c.nom, message: "Classe incomplète (niveau, frais d'inscription ou mensualité)." });
      continue;
    }
    const cle = normaliser(c.nom);
    const articles = lireArticles(
      apercu.articles
        .filter((a) => a.etat === "nouveau" && a.nature && normaliser(a.classe) === cle)
        .map((a) => ({
          libelle: a.libelle,
          nature: a.nature!,
          prix_unitaire: a.prix ?? "",
          quantite_defaut: a.nature === "mensuel" ? 1 : a.quantite,
          obligatoire: a.obligatoire,
        }))
    );
    if (typeof articles === "string") {
      erreurs.push({ nom: c.nom, message: articles });
      continue;
    }
    classes.push({ nom: c.nom, niveau: c.niveau, frais: c.frais, mensualite: c.mensualite, dernierMois: c.dernierMois, articles });
  }
  return { classes, erreurs };
}
