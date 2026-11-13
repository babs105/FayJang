// Reprise de l'existant : articles optionnels d'un élève (« Transport ; Cantine (03/2027) ; Tenue x3 »), avec la
// période de chaque service mensuel. Les problèmes vont dans les erreurs et avertissements de la ligne.
import { formatPeriode } from "@/lib/metier/dates";
import type { Cellule } from "@/lib/documents/reprise-lecture";
import { normaliser } from "@/lib/validation/reprise-colonnes";
import { MAX_ERREURS_LIGNE, MAX_OPTIONS_ELEVE, lireOption, lirePeriode, moisCellule, separerDebut } from "@/lib/validation/reprise-cellules";
import type { ArticleCatalogue, CatalogueClasse, ContexteReprise, OptionEleve } from "@/types/reprise";

export interface LigneOptions {
  catalogue: CatalogueClasse;
  /** Article du catalogue par libellé (comparaison normalisée) */
  chercher: (cat: { articles: ArticleCatalogue[] }, libelle: string) => ArticleCatalogue | undefined;
  moisAnnee: string[];
  ctx: ContexteReprise;
  /** Date de départ lue sur la ligne (AAAA-MM-JJ), ou null / "invalide" */
  depart: string | null;
  erreurs: string[];
  avert: string[];
}

export function lireOptionsEleve(optionsBrutes: string, { catalogue, chercher, moisAnnee, ctx, depart, erreurs, avert }: LigneOptions): OptionEleve[] {
  const moisImport = `${ctx.aujourdhui.slice(0, 7)}-01`;
  const moisDepart = typeof depart === "string" && depart !== "invalide" ? `${depart.slice(0, 7)}-01` : null;
  const lireDebut = (c: Cellule, origine: string): string | null => {
    const lu = moisCellule(c, moisAnnee);
    if (lu === null) return null;
    if (lu === "invalide") {
      erreurs.push(`${origine} : mois illisible (ex : 01/2027 ou janvier).`);
      return null;
    }
    if (!moisAnnee.includes(lu)) erreurs.push(`${origine} : le mois doit tomber dans l'année scolaire ${ctx.anneeScolaire}.`);
    else if (lu > moisImport) erreurs.push(`${origine} : le mois ne peut pas être après le mois de l'import.`);
    else if (moisDepart && lu > moisDepart) erreurs.push(`${origine} : le mois est après le départ de l'élève.`);
    else return lu;
    return null;
  };
  const lirePeriodeOption = (texte: string, origine: string): { debut: string; fin: string | null } | null => {
    const p = lirePeriode(texte, moisAnnee);
    if (p === "invalide") {
      erreurs.push(`${origine} : période illisible (ex : 11/2026, 11/2026-01/2027 ou novembre à janvier).`);
      return null;
    }
    const debut = lireDebut(p.debut, origine);
    if (!debut) return null;
    if (p.fin === null) return { debut, fin: null };
    if (!moisAnnee.includes(p.fin)) erreurs.push(`${origine} : la fin doit tomber dans l'année scolaire ${ctx.anneeScolaire}.`);
    else if (p.fin < debut) erreurs.push(`${origine} : la fin est avant le début.`);
    else if (p.fin > moisImport) erreurs.push(`${origine} : la fin ne peut pas être après le mois de l'import (un arrêt à venir se fait dans la fiche de l'élève).`);
    else if (moisDepart && p.fin > moisDepart) erreurs.push(`${origine} : la fin est après le départ de l'élève.`);
    else return { debut, fin: p.fin };
    return null;
  };

  // Articles optionnels (« Transport ; Cantine (03/2027) ; Tenue x3 »)
  const options: OptionEleve[] = [];
  if (optionsBrutes) {
    const vus = new Set<string>();
    const periodes = new Map<string, { libelle: string; propre: boolean }[]>();
    const pieces = optionsBrutes.split(";").map((s) => s.trim()).filter(Boolean);
    if (pieces.length > MAX_OPTIONS_ELEVE) erreurs.push(`Trop d'articles optionnels : ${MAX_OPTIONS_ELEVE} au maximum.`);
    for (const brut of pieces.slice(0, MAX_OPTIONS_ELEVE)) {
      if (erreurs.length >= MAX_ERREURS_LIGNE) break;
      // Le libellé complet passe d'abord : un article nommé « Pack x3 » ou « Bus (matin) » reste trouvable
      let article = chercher(catalogue, brut);
      let morceau = brut;
      let debutPropre: string | null = null;
      if (!article) {
        const { reste, debut } = separerDebut(brut);
        if (debut !== null) {
          morceau = reste;
          debutPropre = debut;
          article = chercher(catalogue, reste);
        }
      }
      let quantite: number | null = null;
      if (!article) {
        const lu = lireOption(morceau);
        article = chercher(catalogue, lu.libelle);
        quantite = lu.quantite;
      }
      let periode: { debut: string; fin: string | null } | null = null;
      if (article && debutPropre !== null) {
        if (article.nature !== "mensuel") {
          erreurs.push(`« ${brut} » : un frais unique n'a pas de mois de début.`);
          continue;
        }
        periode = lirePeriodeOption(debutPropre, `« ${brut} »`);
        if (!periode) continue;
      }
      if (!article) {
        erreurs.push(`Article « ${morceau} » absent du catalogue de ${catalogue.nom}.`);
        continue;
      }
      // Un service peut revenir plusieurs fois (arrêt puis reprise), chaque fois avec sa période ; un frais unique non
      const cleArticle = normaliser(article.libelle);
      if (vus.has(cleArticle) && article.nature === "unique") {
        erreurs.push(`Article « ${article.libelle} » cité deux fois.`);
        continue;
      }
      vus.add(cleArticle);
      if (quantite !== null && article.nature === "mensuel") {
        erreurs.push(`« ${morceau} » : un service mensuel n'a pas de quantité.`);
        continue;
      }
      if (quantite !== null && (quantite < 1 || quantite > 99)) {
        erreurs.push(`« ${morceau} » : quantité de 1 à 99.`);
        continue;
      }
      if (article.obligatoire && quantite === null && !periode) {
        avert.push(`« ${article.libelle} » est obligatoire : il est ajouté d'office.`);
      }
      if (article.nature === "mensuel") {
        const liste = periodes.get(cleArticle) ?? [];
        liste.push({ libelle: article.libelle, propre: periode !== null });
        periodes.set(cleArticle, liste);
      }
      options.push({
        libelle: article.libelle,
        quantite,
        debut: article.nature === "mensuel" ? (periode?.debut ?? null) : null,
        fin: article.nature === "mensuel" ? (periode?.fin ?? null) : null,
      });
    }
    // Service cité plusieurs fois : chaque citation porte sa période, sans chevauchement, seule la dernière ouverte
    for (const [cle, liste] of periodes) {
      if (liste.length < 2) continue;
      const libelle = liste[0].libelle;
      if (liste.some((x) => !x.propre)) {
        erreurs.push(`« ${libelle} » cité plusieurs fois : donnez sa période à chaque fois, ex : « ${libelle} (11/2026-12/2026) ; ${libelle} (02/2027) ».`);
        continue;
      }
      const tri = options.filter((o) => normaliser(o.libelle) === cle).sort((a, b) => (a.debut! < b.debut! ? -1 : 1));
      for (let k = 1; k < tri.length; k++) {
        const prec = tri[k - 1];
        if (prec.fin === null || prec.fin >= tri[k].debut!) {
          erreurs.push(`« ${libelle} » : les périodes se chevauchent (${formatPeriode(prec)} et ${formatPeriode(tri[k])}).`);
          break;
        }
      }
    }
  }
  return options;
}
