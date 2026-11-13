// Reprise de l'existant : contrôle de forme du fichier (classes, articles, élèves), puis chiffrage de chaque élève
// (reprise-repartition.ts). Produit l'aperçu ligne par ligne affiché à l'école avant tout import. N'écrit rien.
// Feuilles : reprise-feuilles.ts ; classes et articles : reprise-catalogue.ts ; options d'un élève : reprise-options.ts.
import { moisScolaires } from "@/lib/metier/dates";
import type { ClasseurBrut } from "@/lib/documents/reprise-lecture";
import { normaliser } from "@/lib/validation/reprise-colonnes";
import { repartirReprise } from "@/lib/metier/reprise-repartition";
import {
  MAX_ELEVES,
  MAX_ERREURS_LIGNE,
  SEXES,
  STATUTS,
  choix,
  dateCellule,
  montantCellule,
  ressembleAUneFormule,
  telephoneCellule,
  texteCellule,
} from "@/lib/validation/reprise-cellules";
import { EXEMPLES, TELEPHONES_EXEMPLES, cleSouple, cleStricte, lignesDeDonnees, trierFeuilles } from "@/lib/validation/reprise-feuilles";
import { analyserArticles, analyserClasses } from "@/lib/validation/reprise-catalogue";
import { lireOptionsEleve } from "@/lib/validation/reprise-options";
import type { ApercuReprise, ArticleCatalogue, ContexteReprise, EleveApercu, RepartitionEleve } from "@/types/reprise";

export * from "@/lib/validation/reprise-cellules";

export function analyserReprise(classeur: ClasseurBrut, ctx: ContexteReprise): ApercuReprise {
  const erreursGlobales: string[] = [];
  const avertissements: string[] = [];
  const { feuillesClasses, feuillesArticles, feuillesEleves } = trierFeuilles(classeur, erreursGlobales, avertissements);
  const lues = analyserClasses(feuillesClasses, ctx, erreursGlobales, avertissements);
  const { classes, classesFichier, catalogues } = lues;
  const articles = analyserArticles(feuillesArticles, lues, erreursGlobales, avertissements);

  // Libellés normalisés une fois par catalogue (le catalogue ne change plus à partir d'ici)
  const index = new Map<unknown, Map<string, ArticleCatalogue>>();
  const chercher = (cat: { articles: ArticleCatalogue[] }, libelle: string) => {
    let m = index.get(cat);
    if (!m) {
      m = new Map(cat.articles.map((a) => [normaliser(a.libelle), a]));
      index.set(cat, m);
    }
    return m.get(normaliser(libelle));
  };
  const moisAnnee = moisScolaires(ctx.anneeScolaire, ctx.calendrier.mois_debut, ctx.calendrier.nb_mensualites);
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
      if ([prenom, nom, parent].some(ressembleAUneFormule)) erreurs.push("Un nom ne doit pas commencer par =, +, - ou @.");

      // Classe
      const catalogue = catalogues.get(normaliser(classeSaisie));
      if (!classeSaisie) erreurs.push("Classe manquante.");
      else if (!catalogue) {
        const enErreur = classesFichier.get(normaliser(classeSaisie))?.etat === "erreur";
        erreurs.push(enErreur ? `La classe « ${classeSaisie} » est en erreur dans la feuille « Classes ».` : `Classe « ${classeSaisie} » inconnue : ajoutez-la dans la feuille « Classes ».`);
      }

      // Montants (contrôle de forme ici ; la répartition est calculée plus bas)
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

      // Articles optionnels (« Transport ; Cantine (03/2027) ; Tenue x3 »), avec la période des services
      const options = catalogue
        ? lireOptionsEleve(texteCellule(cellule("articlesOptionnels"), 300), { catalogue, chercher, moisAnnee, ctx, depart, erreurs, avert })
        : [];


      if (catalogue?.ecart) erreurs.push(catalogue.ecart);

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

      // Chiffrage : seulement pour un élève qui sera créé et dont la ligne est valide
      let repartition: RepartitionEleve | null = null;
      if (!erreurs.length && !dejaPresent && catalogue?.tarifs) {
        const r = repartirReprise({
          anneeScolaire: ctx.anneeScolaire,
          aujourdhui: ctx.aujourdhui,
          ecole: ctx.calendrier,
          tarifs: catalogue.tarifs,
          reduction,
          catalogue: catalogue.articles,
          statut: statut ?? "active",
          dateDepart: typeof depart === "string" && depart !== "invalide" ? depart : null,
          verseScolarite: totalScolarite,
          verseArticles: totalArticles,
          options,
        });
        if (!r.ok) erreurs.push(r.erreur);
        else {
          repartition = { paiements: r.paiements, articles: r.articles, ...r.resume };
          avert.push(...r.avertissements);
        }
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
        erreurs: erreurs.slice(0, MAX_ERREURS_LIGNE),
        avertissements: avert,
        repartition,
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
    totaux: {
      arriere: aCreer.reduce((s, e) => s + (e.repartition?.arriere ?? 0), 0),
      resteAnnee: aCreer.reduce((s, e) => s + (e.repartition?.resteAnnee ?? 0), 0),
      verse: aCreer.reduce((s, e) => s + (e.repartition?.totalPaye ?? 0), 0),
    },
  };
}
