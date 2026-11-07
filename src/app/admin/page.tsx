import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminClient, type EcoleAdmin } from "./admin-client";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const supabase = createAdminClient();

  const [{ data: ecoles }, { data: inscriptions }, { data: paiements }] = await Promise.all([
    supabase
      .from("ecoles")
      .select("id, nom, slug, ville, responsable_nom, email_contact, telephone_contact, annee_scolaire, plan, statut_abonnement, trial_ends_at, abonnement_fin, is_active, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("inscriptions").select("ecole_id, annee_scolaire").eq("statut", "active"),
    supabase.from("paiements").select("ecole_id, montant").eq("annule", false),
  ]);

  const vue: EcoleAdmin[] = (ecoles ?? []).map((e) => ({
    ...e,
    eleves: (inscriptions ?? []).filter((i) => i.ecole_id === e.id && i.annee_scolaire === e.annee_scolaire).length,
    encaisse: (paiements ?? []).filter((p) => p.ecole_id === e.id).reduce((s, p) => s + p.montant, 0),
  }));

  return <AdminClient ecoles={vue} />;
}
