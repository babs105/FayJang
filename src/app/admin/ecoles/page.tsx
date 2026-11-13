import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { isAdmin } from "@/serveur/admin-session";
import { formatDate } from "@/lib/dates";
import { Carte } from "@/components/ui";
import { AlerteTotaux, EnteteAdmin, ErreurLecture } from "@/components/admin/entete";
import { ResumeEcole } from "@/components/admin/etat-ecole";
import { CreerEcole } from "@/components/admin/creer-ecole";
import { ActionsEcole } from "@/components/admin/actions-ecole";
import { listerEcoles, voirEcole } from "../actions/ecoles";

export const dynamic = "force-dynamic";

/** Liste des écoles ; avec ?id=, fiche d'une école et ses actions */
export default async function AdminEcolesPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { id } = await searchParams;

  return (
    <div className="min-h-screen bg-neutral-50">
      <EnteteAdmin actif="ecoles" />
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">{id ? <Fiche id={id} /> : <Liste />}</main>
    </div>
  );
}

async function Liste() {
  const r = await listerEcoles();
  if (!r.success || !r.data) return <ErreurLecture message={r.message} />;
  return (
    <>
      <CreerEcole />
      {!r.data.totauxDisponibles && <AlerteTotaux />}
      <p className="text-xs text-neutral-500">{r.data.ecoles.length} école(s), la plus récente d&apos;abord.</p>
      <div className="space-y-3">
        {r.data.ecoles.map((e) => (
          <Carte key={e.id}>
            <ResumeEcole ecole={e} />
          </Carte>
        ))}
      </div>
    </>
  );
}

async function Fiche({ id }: { id: string }) {
  const r = await voirEcole(id);
  return (
    <>
      <Link href="/admin/ecoles" className="text-xs font-bold text-neutral-600 inline-flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> Toutes les écoles
      </Link>
      {!r.success || !r.data ? (
        <ErreurLecture message={r.message} />
      ) : (
        <>
          {!r.data.totauxDisponibles && <AlerteTotaux />}
          <Carte className="space-y-2">
            <ResumeEcole ecole={r.data.ecole} lien={false} />
            <p className="text-[11px] text-neutral-500">
              Identifiant {r.data.ecole.slug} · {r.data.ecole.responsable_nom} · {r.data.ecole.email_contact} · {r.data.ecole.telephone_contact} · inscrite le{" "}
              {formatDate(r.data.ecole.created_at)}
            </p>
          </Carte>
          <ActionsEcole key={r.data.ecole.id} ecole={r.data.ecole} />
        </>
      )}
    </>
  );
}
