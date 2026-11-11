import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Upload } from "lucide-react";
import { getEcoleId } from "@/lib/ecole-session";
import { createClientEcole } from "@/lib/supabase/server";
import { ReprisePanel } from "./reprise-panel";

export const dynamic = "force-dynamic";
// Les Server Actions de cette page lisent le fichier et écrivent un lot : marge pour un gros fichier
export const maxDuration = 60;

/** Reprise de l'existant : l'école dépose le fichier Excel de ses élèves et voit l'aperçu avant import */
export default async function ImportPage() {
  const ecoleId = await getEcoleId();
  if (!ecoleId) redirect("/ecole/login");

  const supabase = createClientEcole(ecoleId);
  const { data: ecole } = await supabase.from("ecoles").select("nom, annee_scolaire").eq("id", ecoleId).maybeSingle();
  if (!ecole) redirect("/ecole/login");

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
        <ReprisePanel />
      </main>
    </div>
  );
}
