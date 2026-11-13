import { redirect } from "next/navigation";
import { isAdmin } from "@/serveur/admin-session";
import { RUBRIQUES_ABONNEMENT, rubriqueAbonnement } from "@/lib/admin-ecoles";
import { Carte } from "@/components/ui";
import { AlerteTotaux, EnteteAdmin, ErreurLecture } from "@/components/admin/entete";
import { ResumeEcole } from "@/components/admin/etat-ecole";
import { ActionsAbonnement } from "@/components/admin/actions-abonnement";
import { listerEcoles } from "../actions/ecoles";

export const dynamic = "force-dynamic";

/** Qui a payé, qui est en fin proche, en grâce, expiré ou suspendu : rangé par urgence */
export default async function AdminAbonnementsPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const r = await listerEcoles();

  return (
    <div className="min-h-screen bg-neutral-50">
      <EnteteAdmin actif="abonnements" />
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {!r.success || !r.data ? (
          <ErreurLecture message={r.message} />
        ) : (
          <>
            {!r.data.totauxDisponibles && <AlerteTotaux />}
            {RUBRIQUES_ABONNEMENT.map(({ cle, titre }) => {
              const ecoles = r.data!.ecoles.filter((e) => rubriqueAbonnement(e) === cle);
              if (ecoles.length === 0) return null;
              return (
                <section key={cle} className="space-y-3">
                  <h2 className="text-xs font-extrabold uppercase tracking-wide text-neutral-600">
                    {titre} ({ecoles.length})
                  </h2>
                  {ecoles.map((e) => (
                    <Carte key={e.id} className="space-y-3">
                      <ResumeEcole ecole={e} />
                      <ActionsAbonnement key={`${e.plan}-${e.abonnement_fin}`} ecole={e} />
                    </Carte>
                  ))}
                </section>
              );
            })}
          </>
        )}
      </main>
    </div>
  );
}
