// Colle de l'import (reprise de l'existant) : session, lecture complète et analyse du fichier contre la base.
// PAS de "use server" : rien ici ne doit devenir un point d'entrée appelable du navigateur.
import "server-only";
import { getSessionEcole, type SessionEcole } from "@/lib/securite/ecole-session";
import { createClientEcole } from "@/lib/supabase/server";
import { refusLectureSeule } from "@/lib/securite/abonnement-ecole";
import { peutFaire } from "@/lib/securite/droits";
import { todayDakar } from "@/lib/config";
import { moisScolaires } from "@/lib/metier/dates";
import { ErreurAffichable } from "@/lib/securite/erreurs";
import { LectureTropLongue, TAILLE_PAGE, toutLire as toutLirePartage } from "@/lib/metier/lecture-paginee";
import { verifierReglages } from "@/lib/metier/scolarite";
import { normaliserTelephone } from "@/lib/validation/telephone";
import { LIMITES, lireClasseur } from "@/lib/documents/reprise-lecture";
import { analyserReprise } from "@/lib/validation/reprise-validation";
import { SESSION_EXPIREE, type Resultat } from "./_commun";
import type { ApercuReprise, ArticleBase, ClasseBase, ContexteReprise } from "@/types/reprise";


/**
 * Session de la reprise : l'école connectée, refusée en lecture seule (abonnement expiré ou suspendu) dès
 * l'analyse du fichier, pour ne pas lui faire préparer un import qui sera refusé. Renvoie le message de refus, ou l'id.
 */
export async function sessionReprise(): Promise<string | { ecoleId: string; utilisateur: SessionEcole }> {
  const utilisateur = await getSessionEcole();
  if (!utilisateur) return SESSION_EXPIREE;
  // D09 : la reprise de l'existant est réservée au directeur (importer_reprise refuse aussi en base)
  if (!peutFaire(utilisateur.role, "importer")) return "Réservé au directeur de l'école.";
  return (await refusLectureSeule(createClientEcole(utilisateur), "ecole/actions/import")) ?? { ecoleId: utilisateur.ecoleId, utilisateur };
}

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
export interface AnalyseComplete {
  apercu: ApercuReprise;
  classesBase: ClasseBase[];
  catalogueBase: ArticleBase[];
}

/** Lit le fichier et l'analyse contre l'état actuel de la base (classes, catalogues, élèves déjà inscrits) */
export async function analyser(utilisateur: SessionEcole, formData: FormData): Promise<Resultat<ApercuReprise>> {
  const r = await analyserComplet(utilisateur, formData);
  return r.success && r.data ? { success: true, data: r.data.apercu } : { success: false, message: r.message };
}

/**
 * `lirePresents` : lit les élèves déjà inscrits (toute l'école) pour les signaler dans l'aperçu. L'import d'un lot s'en
 * passe : importer_reprise écarte lui-même les doublons en base (statut « ignore »), et chaque lot évite ainsi de relire
 * tous les élèves et parents de l'école.
 */
export async function analyserComplet(utilisateur: SessionEcole, formData: FormData, lirePresents = true): Promise<Resultat<AnalyseComplete>> {
  const { ecoleId } = utilisateur;
  const fichier = formData.get("fichier");
  if (!(fichier instanceof File) || fichier.size === 0) return { success: false, message: "Choisissez un fichier Excel (.xlsx)." };
  if (fichier.size > LIMITES.octets) return { success: false, message: "Fichier trop lourd : 2 Mo au maximum." };

  const supabase = createClientEcole(utilisateur);
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
