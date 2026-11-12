import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { LectureTropLongue, TAILLE_PAGE, toutLire } from "@/lib/lecture-paginee";
import { todayDakar } from "@/lib/dates";
import { lireSituationAbonnement, type SituationAbonnement } from "@/lib/abonnement";
import { AdminClient, type EcoleAdmin } from "./admin-client";

/** Toutes les écoles réunies : plafond plus haut que pour une seule école */
const MAX_LIGNES_ADMIN = 500_000;

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const supabase = createAdminClient();

  const { data: ecoles } = await supabase
    .from("ecoles")
    .select("id, nom, slug, ville, responsable_nom, email_contact, telephone_contact, annee_scolaire, plan, statut_abonnement, trial_ends_at, abonnement_fin, is_active, created_at")
    .order("created_at", { ascending: false });

  // Lecture complète, page par page : une requête simple est coupée à 1000 lignes et les totaux seraient faux
  // sans erreur. En cas d'échec, on affiche les écoles sans totaux plutôt que des chiffres incomplets.
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
      const { data, error } = await supabase.rpc("situation_abonnement", {
        p_statut: e.statut_abonnement,
        p_trial_ends_at: e.trial_ends_at,
        p_abonnement_fin: e.abonnement_fin,
        p_jour: jour,
      });
      if (error) console.error("[admin] état de l'abonnement :", error.code ?? "erreur");
      return error ? null : lireSituationAbonnement(data);
    })
  );

  const vue: EcoleAdmin[] = (ecoles ?? []).map((e, i) => ({
    ...e,
    eleves: eleves.get(e.id) ?? 0,
    encaisse: encaisse.get(e.id) ?? 0,
    abonnement: situations[i],
  }));

  return <AdminClient ecoles={vue} totauxDisponibles={totauxDisponibles} />;
}
