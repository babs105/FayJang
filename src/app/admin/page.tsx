import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/securite/admin-session";
import { formatFCFA } from "@/lib/utils";
import { Carte, Kpi } from "@/components/ui";
import { AlerteTotaux, EnteteAdmin, ErreurLecture } from "@/components/admin/entete";
import { ResumeEcole } from "@/components/admin/etat-ecole";
import { ExportBouton } from "@/components/admin/export-bouton";
import { statsGlobales } from "./actions/stats";

export const dynamic = "force-dynamic";

/** Tableau de bord de la console : nombre d'écoles, abonnements, écoles en retard */
export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const r = await statsGlobales();

  return (
    <div className="min-h-screen bg-neutral-50">
      <EnteteAdmin actif="tableau" />
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        {!r.success || !r.data ? (
          <ErreurLecture message={r.message} />
        ) : (
          <>
            {!r.data.totauxDisponibles && <AlerteTotaux />}
            <div className="flex justify-end">
              <ExportBouton />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi label="Écoles" valeur={String(r.data.stats.ecoles)} detail={`${r.data.stats.desactivees} désactivée(s)`} />
              <Kpi label="Abonnées" valeur={String(r.data.stats.abonnees)} ton="vert" detail={`${r.data.stats.enEssai} en essai`} />
              <Kpi label="En retard" valeur={String(r.data.stats.enRetard)} ton={r.data.stats.enRetard ? "rouge" : undefined} detail={`${r.data.stats.finProche} fin dans 7 jours`} />
              <Kpi label="Élèves suivis" valeur={String(r.data.stats.eleves)} detail={`${formatFCFA(r.data.stats.encaisse)} encaissés`} />
            </div>
            <Carte className="space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-xs font-extrabold">Écoles en retard (délai de grâce ou lecture seule)</p>
                <Link href="/admin/abonnements" className="text-[11px] font-bold text-jang-700">
                  Voir les abonnements
                </Link>
              </div>
              {r.data.enRetard.length === 0 ? (
                <p className="text-xs text-neutral-500">Aucune école en retard.</p>
              ) : (
                r.data.enRetard.map((e) => <ResumeEcole key={e.id} ecole={e} />)
              )}
            </Carte>
          </>
        )}
      </main>
    </div>
  );
}
