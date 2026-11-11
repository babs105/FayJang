"use server";

import { revalidatePath } from "next/cache";
import { getEcoleId } from "@/lib/ecole-session";
import { createClientEcole } from "@/lib/supabase/server";
import { todayDakar } from "@/lib/config";
import { moisScolaires } from "@/lib/dates";
import { ErreurAffichable, messageErreur } from "@/lib/erreurs";
import { LectureTropLongue, TAILLE_PAGE, toutLire as toutLirePartage } from "@/lib/lecture-paginee";
import { verifierReglages } from "@/lib/scolarite";
import { normaliserTelephone } from "@/lib/telephone";
import { ErreurFichier, LIMITES, lireClasseur } from "@/lib/reprise-lecture";
import { classesACreer } from "@/lib/reprise-classes";
import { analyserReprise, type ApercuReprise, type ContexteReprise } from "@/lib/reprise-validation";
import {
  construireLot,
  lireCles,
  lireRetour,
  resumerRetour,
  type ArticleBase,
  type ClasseBase,
  type RefusLigne,
  type ResultatLotReprise,
} from "@/lib/reprise-lots";
import type { Json } from "@/types/database";

export interface Resultat<T = undefined> {
  success: boolean;
  message?: string;
  data?: T;
}

const SESSION_EXPIREE = "Session expirée : reconnectez-vous à l'Espace École.";

/** Lecture complète partagée (curseur sur l'id) ; au-delà de ~21 000 lignes, refus lisible plutôt qu'une liste tronquée */
async function toutLire<T extends { id: string }>(
  requete: (apresId: string) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  try {
    return await toutLirePartage(requete, 21 * TAILLE_PAGE);
  } catch (err) {
    // Une liste tronquée fausserait la détection des doublons : on refuse plutôt que de continuer (S7 du backlog)
    if (err instanceof LectureTropLongue) throw new ErreurAffichable("Trop de données dans l'école pour cet import : contactez le support.");
    throw err;
  }
}

/** Aperçu du fichier, avec les classes et le catalogue lus en base (identifiants nécessaires à l'écriture) */
interface AnalyseComplete {
  apercu: ApercuReprise;
  classesBase: ClasseBase[];
  catalogueBase: ArticleBase[];
}

/** Lit le fichier et l'analyse contre l'état actuel de la base (classes, catalogues, élèves déjà inscrits) */
async function analyser(ecoleId: string, formData: FormData): Promise<Resultat<ApercuReprise>> {
  const r = await analyserComplet(ecoleId, formData);
  return r.success && r.data ? { success: true, data: r.data.apercu } : { success: false, message: r.message };
}

/**
 * `lirePresents` : lit les élèves déjà inscrits (toute l'école) pour les signaler dans l'aperçu. L'import d'un lot s'en
 * passe : importer_reprise écarte lui-même les doublons en base (statut « ignore »), et chaque lot évite ainsi de relire
 * tous les élèves et parents de l'école.
 */
async function analyserComplet(ecoleId: string, formData: FormData, lirePresents = true): Promise<Resultat<AnalyseComplete>> {
  const fichier = formData.get("fichier");
  if (!(fichier instanceof File) || fichier.size === 0) return { success: false, message: "Choisissez un fichier Excel (.xlsx)." };
  if (fichier.size > LIMITES.octets) return { success: false, message: "Fichier trop lourd : 2 Mo au maximum." };

  const supabase = createClientEcole(ecoleId);
  const { data: ecole, error: erreurEcole } = await supabase
    .from("ecoles")
    .select("annee_scolaire, mois_debut, nb_mensualites, jour_echeance, tranches_dernier_mois, mois_debut_tranches, nb_tranches, rang_mois_tranches, premier_mois_a_linscription, dernier_mois_a_linscription")
    .eq("id", ecoleId)
    .single();
  if (erreurEcole) throw erreurEcole;

  // Les règles de répartition dépendent des Paramètres : ils doivent être cohérents avant l'import
  const reglages = verifierReglages(ecole.annee_scolaire, ecole);
  if (reglages) return { success: false, message: `Réglez d'abord vos Paramètres : ${reglages}` };

  const classeur = await lireClasseur(new Uint8Array(await fichier.arrayBuffer()));

  const annee = ecole.annee_scolaire;
  const [classes, catalogue, inscriptions] = await Promise.all([
    toutLire((apres) => supabase.from("classes").select("id, nom, frais_inscription, mensualite, mensualite_dernier_mois, is_active").eq("ecole_id", ecoleId).eq("annee_scolaire", annee).gt("id", apres).order("id").limit(TAILLE_PAGE)),
    toutLire((apres) =>
      supabase.from("articles_classe").select("id, classe_id, libelle, nature, obligatoire, prix_unitaire, quantite_defaut, ordre").eq("ecole_id", ecoleId).gt("id", apres).order("id").limit(TAILLE_PAGE)
    ),
    lirePresents
      ? toutLire((apres) => supabase.from("inscriptions").select("id, eleve_id").eq("ecole_id", ecoleId).eq("annee_scolaire", annee).gt("id", apres).order("id").limit(TAILLE_PAGE))
      : Promise.resolve([] as { id: string; eleve_id: string }[]),
  ]);
  // Lecture par curseur (ordre des id) : le catalogue reprend son ordre d'affichage, celui de l'aperçu et de la répartition
  catalogue.sort((x, y) => x.ordre - y.ordre || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  // Élèves déjà inscrits cette année, pour signaler ceux que le fichier contient déjà
  // (lecture de toute l'école puis filtre en mémoire : une liste de 2000 identifiants ne tient pas dans l'URL)
  const idsEleves = new Set(inscriptions.map((i) => i.eleve_id));
  const presents: ContexteReprise["eleves"] = [];
  if (lirePresents && idsEleves.size) {
    const [eleves, parents] = await Promise.all([
      toutLire((apres) => supabase.from("eleves").select("id, prenom, nom, parent_id").eq("ecole_id", ecoleId).gt("id", apres).order("id").limit(TAILLE_PAGE)),
      toutLire((apres) => supabase.from("parents").select("id, telephone").eq("ecole_id", ecoleId).gt("id", apres).order("id").limit(TAILLE_PAGE)),
    ]);
    const telephones = new Map(parents.map((p) => [p.id, normaliserTelephone(p.telephone)]));
    for (const e of eleves) {
      if (!idsEleves.has(e.id)) continue;
      const telephone = e.parent_id ? telephones.get(e.parent_id) : null;
      if (telephone) presents.push({ prenom: e.prenom, nom: e.nom, telephone });
    }
  }

  const mois = moisScolaires(annee, ecole.mois_debut, ecole.nb_mensualites);
  const apercu = analyserReprise(classeur, {
    anneeScolaire: annee,
    aujourdhui: todayDakar(),
    premierMois: mois[0],
    calendrier: ecole,
    classes: classes.map((c) => ({
      nom: c.nom,
      frais: c.frais_inscription,
      mensualite: c.mensualite,
      dernierMois: c.mensualite_dernier_mois,
      articles: catalogue
        .filter((a) => a.classe_id === c.id)
        .map((a) => ({ libelle: a.libelle, nature: a.nature, obligatoire: a.obligatoire, prix: a.prix_unitaire, quantiteDefaut: a.quantite_defaut })),
    })),
    eleves: presents,
  });
  return {
    success: true,
    data: {
      apercu,
      // Seules les classes actives reçoivent des élèves (comme inscrire_eleve)
      classesBase: classes.filter((c) => c.is_active).map((c) => ({ id: c.id, nom: c.nom })),
      catalogueBase: catalogue.map((a) => ({ id: a.id, classe_id: a.classe_id, libelle: a.libelle })),
    },
  };
}

/**
 * Reprise de l'existant, étapes 1 et 2 : lit le fichier de l'école et renvoie l'aperçu ligne par ligne, chaque élève chiffré.
 * Lecture seule : rien n'est écrit en base, le fichier n'est pas conservé.
 */
export async function analyserFichierReprise(formData: FormData): Promise<Resultat<ApercuReprise>> {
  const ecoleId = await getEcoleId();
  if (!ecoleId) return { success: false, message: SESSION_EXPIREE };
  try {
    return await analyser(ecoleId, formData);
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
  const ecoleId = await getEcoleId();
  if (!ecoleId) return { success: false, message: SESSION_EXPIREE };

  let apercu: ApercuReprise;
  try {
    const r = await analyser(ecoleId, formData);
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

  const supabase = createClientEcole(ecoleId);
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
  const ecoleId = await getEcoleId();
  if (!ecoleId) return { success: false, message: SESSION_EXPIREE };

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
  try {
    const r = await analyserComplet(ecoleId, formData, false);
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
      const supabase = createClientEcole(ecoleId);
      const { data, error } = await supabase.rpc("importer_reprise", { p_eleves: lot as unknown as Json, p_mode: mode });
      if (error) return { success: false, message: messageErreur("import/lot", error, "Import du lot impossible pour le moment, réessayez.") };
      const lignes = lireRetour(data);
      if (!lignes) return { success: false, message: "Réponse inattendue de la base : vérifiez la liste des élèves avant de reprendre." };
      const somme = resumerRetour(lignes);
      resultat = { ...somme, ignores: somme.ignores + dejaPresents, refuses };
    }
    return { success: true, data: resultat };
  } catch (err) {
    if (err instanceof ErreurFichier) return { success: false, message: err.message };
    return { success: false, message: messageErreur("import/lot", err, "Import du lot impossible pour le moment, réessayez.") };
  } finally {
    // Une exception après l'écriture ne doit pas laisser l'écran sur d'anciennes données
    revalidatePath("/ecole");
  }
}
