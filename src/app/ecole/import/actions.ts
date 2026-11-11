"use server";

import { getEcoleId } from "@/lib/ecole-session";
import { createClientEcole } from "@/lib/supabase/server";
import { todayDakar } from "@/lib/config";
import { moisScolaires } from "@/lib/dates";
import { messageErreur } from "@/lib/erreurs";
import { verifierReglages } from "@/lib/scolarite";
import { normaliserTelephone } from "@/lib/telephone";
import { ErreurFichier, LIMITES, lireClasseur } from "@/lib/reprise-lecture";
import { analyserReprise, type ApercuReprise, type ContexteReprise } from "@/lib/reprise-validation";

export interface Resultat<T = undefined> {
  success: boolean;
  message?: string;
  data?: T;
}

const SESSION_EXPIREE = "Session expirée : reconnectez-vous à l'Espace École.";

/** Lit toutes les lignes d'une requête, page par page (PostgREST en renvoie 1000 au plus par appel) */
async function toutLire<T>(
  requete: (debut: number, fin: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const PAGE = 1000;
  const tout: T[] = [];
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await requete(debut, debut + PAGE - 1);
    if (error) throw error;
    tout.push(...(data ?? []));
    if (!data || data.length < PAGE || debut > 20 * PAGE) return tout;
  }
}

/**
 * Reprise de l'existant, étapes 1 et 2 : lit le fichier de l'école et renvoie l'aperçu ligne par ligne, chaque élève chiffré.
 * Lecture seule : rien n'est écrit en base, le fichier n'est pas conservé.
 */
export async function analyserFichierReprise(formData: FormData): Promise<Resultat<ApercuReprise>> {
  const ecoleId = await getEcoleId();
  if (!ecoleId) return { success: false, message: SESSION_EXPIREE };

  const fichier = formData.get("fichier");
  if (!(fichier instanceof File) || fichier.size === 0) return { success: false, message: "Choisissez un fichier Excel (.xlsx)." };
  if (fichier.size > LIMITES.octets) return { success: false, message: "Fichier trop lourd : 2 Mo au maximum." };

  try {
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
      toutLire((a, b) => supabase.from("classes").select("id, nom, frais_inscription, mensualite, mensualite_dernier_mois").eq("ecole_id", ecoleId).eq("annee_scolaire", annee).order("id").range(a, b)),
      toutLire((a, b) =>
        supabase.from("articles_classe").select("classe_id, libelle, nature, obligatoire, prix_unitaire, quantite_defaut").eq("ecole_id", ecoleId).order("ordre").order("id").range(a, b)
      ),
      toutLire((a, b) => supabase.from("inscriptions").select("eleve_id").eq("ecole_id", ecoleId).eq("annee_scolaire", annee).order("id").range(a, b)),
    ]);

    // Élèves déjà inscrits cette année, pour signaler ceux que le fichier contient déjà
    // (lecture de toute l'école puis filtre en mémoire : une liste de 2000 identifiants ne tient pas dans l'URL)
    const idsEleves = new Set(inscriptions.map((i) => i.eleve_id));
    const presents: ContexteReprise["eleves"] = [];
    if (idsEleves.size) {
      const [eleves, parents] = await Promise.all([
        toutLire((a, b) => supabase.from("eleves").select("id, prenom, nom, parent_id").eq("ecole_id", ecoleId).order("id").range(a, b)),
        toutLire((a, b) => supabase.from("parents").select("id, telephone").eq("ecole_id", ecoleId).order("id").range(a, b)),
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
    return { success: true, data: apercu };
  } catch (err) {
    if (err instanceof ErreurFichier) return { success: false, message: err.message };
    return { success: false, message: messageErreur("import/analyser", err, "Lecture du fichier impossible pour le moment, réessayez.") };
  }
}
