// Colle des Server Actions de la console SuperAdmin : session ADMIN, sans rapport avec la session d'une école.
// PAS de "use server" ici : ces fonctions ne doivent jamais devenir des points d'entrée appelables du navigateur.
import "server-only";
import { revalidatePath } from "next/cache";
import { isAdmin } from "@/serveur/admin-session";
import { createAdminClient } from "@/serveur/supabase/admin";
import { LectureTropLongue, TAILLE_PAGE, toutLire } from "@/lib/lecture-paginee";
import { todayDakar } from "@/lib/dates";
import { lireSituationAbonnement, type SituationAbonnement } from "@/lib/abonnement";
import type { EcoleAdmin } from "@/lib/admin-ecoles";

export type ResultatAdmin<T = undefined> = { success: boolean; message?: string; data?: T };

export const SESSION_EXPIREE = "Session expirée.";

/** Client admin (contourne la RLS) si la session SuperAdmin est valide, sinon null : à appeler en tête de chaque action */
export async function clientAdmin() {
  if (!(await isAdmin())) return null;
  return createAdminClient();
}

type ClientAdmin = ReturnType<typeof createAdminClient>;

/** Toutes les écoles réunies : plafond plus haut que pour une seule école */
const MAX_LIGNES_ADMIN = 500_000;

const COLONNES_ECOLE =
  "id, nom, slug, ville, responsable_nom, email_contact, telephone_contact, annee_scolaire, plan, statut_abonnement, trial_ends_at, abonnement_fin, is_active, created_at";

/**
 * Écoles avec leurs totaux (élèves inscrits cette année, encaissé) et leur état d'abonnement calculé par la base.
 * Totaux lus en entier, page par page : en cas d'échec, `totauxDisponibles` est faux et les totaux valent zéro
 * (on n'affiche pas des chiffres incomplets).
 */
export async function chargerEcoles(supabase: ClientAdmin): Promise<{ ecoles: EcoleAdmin[]; totauxDisponibles: boolean }> {
  const { data: ecoles, error } = await supabase.from("ecoles").select(COLONNES_ECOLE).order("created_at", { ascending: false });
  if (error) throw error;

  const eleves = new Map<string, number>();
  const encaisse = new Map<string, number>();
  let totauxDisponibles = true;
  try {
    const [inscriptions, paiements] = await Promise.all([
      toutLire(
        (apres) => supabase.from("inscriptions").select("id, ecole_id, annee_scolaire").eq("statut", "active").gt("id", apres).order("id").limit(TAILLE_PAGE),
        MAX_LIGNES_ADMIN
      ),
      toutLire(
        (apres) => supabase.from("paiements").select("id, ecole_id, montant").eq("annule", false).gt("id", apres).order("id").limit(TAILLE_PAGE),
        MAX_LIGNES_ADMIN
      ),
    ]);
    const anneeDe = new Map((ecoles ?? []).map((e) => [e.id, e.annee_scolaire]));
    for (const i of inscriptions) if (anneeDe.get(i.ecole_id) === i.annee_scolaire) eleves.set(i.ecole_id, (eleves.get(i.ecole_id) ?? 0) + 1);
    for (const p of paiements) encaisse.set(p.ecole_id, (encaisse.get(p.ecole_id) ?? 0) + p.montant);
  } catch (err) {
    totauxDisponibles = false;
    console.error("[admin] totaux :", err instanceof LectureTropLongue ? "trop de lignes" : ((err as { code?: string })?.code ?? "erreur"));
  }

  // État de l'abonnement de chaque école, calculé par la base (situation_abonnement, bloc v1.20 : la règle n'existe
  // que là). Un appel par école : la console liste peu d'écoles. En échec, l'état est affiché « inconnu ».
  const jour = todayDakar();
  const situations = await Promise.all(
    (ecoles ?? []).map(async (e): Promise<SituationAbonnement | null> => {
      const { data, error: erreur } = await supabase.rpc("situation_abonnement", {
        p_statut: e.statut_abonnement,
        p_trial_ends_at: e.trial_ends_at,
        p_abonnement_fin: e.abonnement_fin,
        p_jour: jour,
      });
      if (erreur) console.error("[admin] état de l'abonnement :", erreur.code ?? "erreur");
      return erreur ? null : lireSituationAbonnement(data);
    })
  );

  return {
    ecoles: (ecoles ?? []).map((e, i) => ({ ...e, eleves: eleves.get(e.id) ?? 0, encaisse: encaisse.get(e.id) ?? 0, abonnement: situations[i] })),
    totauxDisponibles,
  };
}

/** Met à jour des champs d'une école ; message d'échec lisible, journal sans donnée sensible */
export async function majEcole(
  supabase: ClientAdmin,
  ecoleId: string,
  champs: Parameters<ReturnType<ClientAdmin["from"]>["update"]>[0],
  journal: string,
  succes: string
): Promise<ResultatAdmin> {
  const { data, error } = await supabase.from("ecoles").update(champs as never).eq("id", ecoleId).select("id");
  if (error) {
    console.error(`[admin] ${journal} :`, error.code);
    return { success: false, message: "Enregistrement impossible." };
  }
  if (!data?.length) return { success: false, message: "École introuvable." };
  revalidatePath("/admin", "layout");
  return { success: true, message: succes };
}
