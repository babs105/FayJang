import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Lock, Upload } from "lucide-react";
import { getSessionEcole } from "@/lib/ecole-session";
import { createClientEcole } from "@/lib/supabase/server";
import { ReprisePanel } from "./reprise-panel";
import { lireAbonnementEcole } from "@/lib/abonnement-ecole";
import { MESSAGE_LECTURE_SEULE, peutEcrire } from "@/lib/abonnement";

export const dynamic = "force-dynamic";
// Les Server Actions de cette page lisent le fichier et écrivent un lot : marge pour un gros fichier
export const maxDuration = 60;

/** Reprise de l'existant : l'école dépose le fichier Excel de ses élèves et voit l'aperçu avant import */
export default async function ImportPage() {
  const session = await getSessionEcole();
  if (!session) redirect("/ecole/login");
  const { ecoleId } = session;

  const supabase = createClientEcole(session);
  const { data: ecole } = await supabase.from("ecoles").select("nom, annee_scolaire").eq("id", ecoleId).maybeSingle();
  if (!ecole) redirect("/ecole/login");
  // Lecture seule (abonnement expiré ou suspendu) : refus annoncé avant l'envoi du fichier ; les actions refusent aussi
  const abonnement = await lireAbonnementEcole(supabase, "ecole/import");
  const lectureSeule = abonnement !== null && !peutEcrire(abonnement.etat);

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-100 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/ecole" className="p-2 rounded-xl hover:bg-neutral-100" aria-label="Retour à l'Espace École">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-9 h-9 bg-jang-600 text-white rounded-xl flex items-center justify-center shrink-0">
            <Upload className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-neutral-900 truncate">Reprise de l&apos;existant</p>
            <p className="text-[11px] text-neutral-500 truncate">
              {ecole.nom} · Année {ecole.annee_scolaire}
            </p>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        {lectureSeule ? (
          <div role="status" className="p-4 rounded-3xl border bg-red-50 border-red-200 text-red-900 text-xs flex gap-3">
            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              <b>{MESSAGE_LECTURE_SEULE}</b> L&apos;import reprendra dès que l&apos;abonnement sera réglé.
            </p>
          </div>
        ) : (
          <ReprisePanel />
        )}
      </main>
    </div>
  );
}
