"use server";

// Actions de l'onglet Importer (reprise de l'existant) ; la session et l'analyse du fichier sont dans _import.ts
import { revalidatePath } from "next/cache";
import { createClientEcole } from "@/lib/supabase/server";
import { messageErreur } from "@/lib/securite/erreurs";
import { ErreurFichier } from "@/lib/documents/reprise-lecture";
import { classesACreer } from "@/lib/metier/reprise-classes";
import { construireLot, lireCles, lireRetour, resumerRetour } from "@/lib/metier/reprise-lots";
import type { Json } from "@/types/database";
import type { Resultat } from "./_commun";
import { analyser, analyserComplet, sessionReprise } from "./_import";
import type { ApercuReprise, RefusLigne, ResultatLotReprise } from "@/types/reprise";

/**
 * Reprise de l'existant, étapes 1 et 2 : lit le fichier de l'école et renvoie l'aperçu ligne par ligne, chaque élève chiffré.
 * Lecture seule : rien n'est écrit en base, le fichier n'est pas conservé.
 */
export async function analyserFichierReprise(formData: FormData): Promise<Resultat<ApercuReprise>> {
  const session = await sessionReprise();
  if (typeof session === "string") return { success: false, message: session };
  const { utilisateur } = session;
  try {
    return await analyser(utilisateur, formData);
  } catch (err) {
    if (err instanceof ErreurFichier) return { success: false, message: err.message };
    return { success: false, message: messageErreur("import/analyser", err, "Lecture du fichier impossible pour le moment, réessayez.") };
  }
}

export interface ResultatClasses {
  creees: string[];
  dejaPresentes: string[];
  echecs: { nom: string; message: string }[];
}

/**
 * Reprise de l'existant, étape 3 : crée les classes nouvelles du fichier avec leur catalogue.
 * Le serveur relit et réanalyse le fichier (il ne croit pas l'aperçu du navigateur). Une classe = un appel à
 * enregistrer_classe, atomique ; une classe déjà présente n'est ni créée ni modifiée. Rejouer ne crée rien de plus.
 */
export async function importerClassesReprise(formData: FormData): Promise<Resultat<ResultatClasses>> {
  const session = await sessionReprise();
  if (typeof session === "string") return { success: false, message: session };
  const { utilisateur } = session;

  let apercu: ApercuReprise;
  try {
    const r = await analyser(utilisateur, formData);
    if (!r.success || !r.data) return { success: false, message: r.message };
    apercu = r.data;
  } catch (err) {
    if (err instanceof ErreurFichier) return { success: false, message: err.message };
    return { success: false, message: messageErreur("import/classes", err, "Lecture du fichier impossible pour le moment, réessayez.") };
  }
  if (apercu.erreursGlobales.length) return { success: false, message: `Le fichier ne peut pas être importé : ${apercu.erreursGlobales[0]}` };

  const { classes, erreurs } = classesACreer(apercu);
  const resultat: ResultatClasses = {
    creees: [],
    dejaPresentes: apercu.classes.filter((c) => c.etat === "existante").map((c) => c.nom),
    echecs: erreurs,
  };
  if (classes.length === 0) {
    return { success: true, message: "Aucune classe à créer.", data: resultat };
  }

  const supabase = createClientEcole(utilisateur);
  try {
    for (const c of classes) {
      try {
        const { error } = await supabase.rpc("enregistrer_classe", {
          p_classe_id: null,
          p_nom: c.nom,
          p_niveau: c.niveau,
          p_frais_inscription: c.frais,
          p_mensualite: c.mensualite,
          p_mensualite_dernier_mois: c.dernierMois,
          p_articles: c.articles,
        });
        // Créée entre l'aperçu et ce clic (autre poste) : comptée comme déjà présente, jamais modifiée
        if (error?.code === "23505") resultat.dejaPresentes.push(c.nom);
        else if (error) resultat.echecs.push({ nom: c.nom, message: messageErreur("import/classes", error) });
        else resultat.creees.push(c.nom);
      } catch (err) {
        // Une panne réseau sur une classe ne fait pas perdre le compte rendu des autres (S13 du backlog)
        resultat.echecs.push({ nom: c.nom, message: messageErreur("import/classes", err) });
      }
    }
  } finally {
    if (resultat.creees.length) revalidatePath("/ecole");
  }

  const n = resultat.creees.length;
  return {
    success: true,
    message: n ? `${n} classe${n > 1 ? "s" : ""} créée${n > 1 ? "s" : ""}.` : "Aucune classe créée.",
    data: resultat,
  };
}

const MODES_REPRISE = ["especes", "virement", "cheque"] as const;

/**
 * Reprise de l'existant, étape 4 : importe un lot de 25 élèves au plus (parent, élève, inscription, articles, et un reçu
 * « Reprise de l'existant » par élève ayant déjà versé).
 *
 * Le navigateur renvoie le fichier et les CLÉS (feuille, ligne) des élèves du lot : aucun montant, aucun identifiant.
 * Le serveur relit le fichier, refait l'aperçu avec les tarifs de la base et la date du jour (todayDakar), puis envoie
 * le résultat à la fonction SQL importer_reprise, qui relit les tarifs de la classe et plafonne chaque montant.
 * Le lot est atomique : au moindre problème, rien n'est écrit pour ces 25 élèves. Rejouer un lot (ou tout le fichier)
 * ignore les élèves déjà créés.
 */
export async function importerLotReprise(formData: FormData): Promise<Resultat<ResultatLotReprise>> {
  const session = await sessionReprise();
  if (typeof session === "string") return { success: false, message: session };
  const { utilisateur } = session;

  const mode = formData.get("mode");
  if (typeof mode !== "string" || !(MODES_REPRISE as readonly string[]).includes(mode)) {
    return { success: false, message: "Choisissez le mode de paiement : espèces, virement ou chèque." };
  }
  let brut: unknown;
  try {
    brut = JSON.parse(String(formData.get("cles") ?? ""));
  } catch {
    return { success: false, message: "Lot d'import illisible." };
  }
  const cles = lireCles(brut);
  if (typeof cles === "string") return { success: false, message: cles };

  let resultat: ResultatLotReprise | null = null;
  // Vrai dès que le lot part vers la base : avant, rien n'a pu être écrit
  let envoye = false;
  try {
    const r = await analyserComplet(utilisateur, formData, false);
    if (!r.success || !r.data) return { success: false, message: r.message };
    const { apercu, classesBase, catalogueBase } = r.data;
    if (apercu.erreursGlobales.length) return { success: false, message: `Le fichier ne peut pas être importé : ${apercu.erreursGlobales[0]}` };

    // Les lignes demandées, retrouvées dans l'aperçu que le serveur vient de calculer
    const parCle = new Map(apercu.eleves.map((e) => [`${e.feuille}\u0000${e.ligne}`, e]));
    const refuses: RefusLigne[] = [];
    let dejaPresents = 0;
    const aCreer = [];
    for (const c of cles) {
      const e = parCle.get(`${c.feuille}\u0000${c.ligne}`);
      if (!e) refuses.push({ ligne: c.ligne, message: "Ligne introuvable dans le fichier." });
      else if (e.etat === "deja_present") dejaPresents++;
      else if (e.etat === "erreur") refuses.push({ ligne: e.ligne, message: e.erreurs[0] ?? "Ligne en erreur." });
      else aCreer.push(e);
    }
    const { lot, refuses: refusConstruction } = construireLot(aCreer, classesBase, catalogueBase);
    refuses.push(...refusConstruction);

    resultat = { crees: 0, ignores: dejaPresents, montant: 0, recus: 0, refuses };
    if (lot.length > 0) {
      const supabase = createClientEcole(utilisateur);
      envoye = true;
      const { data, error } = await supabase.rpc("importer_reprise", { p_eleves: lot as unknown as Json, p_mode: mode });
      // Refus explicite de la base : la fonction est atomique, rien n'est écrit pour ce lot
      if (error) return { success: false, message: messageErreur("import/lot", error, "Import du lot impossible pour le moment, réessayez.") };
      const lignes = lireRetour(data);
      if (!lignes) return { success: false, incertain: true, message: "Réponse inattendue de la base : vérifiez la liste des élèves avant de reprendre." };
      const somme = resumerRetour(lignes);
      resultat = { ...somme, ignores: somme.ignores + dejaPresents, refuses };
    }
    return { success: true, data: resultat };
  } catch (err) {
    if (err instanceof ErreurFichier) return { success: false, message: err.message };
    return { success: false, incertain: envoye, message: messageErreur("import/lot", err, "Import du lot impossible pour le moment, réessayez.") };
  } finally {
    // Une exception après l'écriture ne doit pas laisser l'écran sur d'anciennes données ; rien à rafraîchir sinon
    if (envoye) revalidatePath("/ecole");
  }
}
