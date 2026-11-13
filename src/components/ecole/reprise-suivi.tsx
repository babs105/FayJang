"use client";

// Importer : suivi de l'import des élèves lot par lot (progression, reprise après un échec, compte rendu).
import { Loader2 } from "lucide-react";
import { formatFCFA } from "@/lib/utils";
import { Bouton, Kpi, Message } from "@/components/ui";
import type { CleEleve, RefusLigne } from "@/types/reprise";

export const MODES_REPRISE = [
  ["especes", "Espèces"],
  ["virement", "Virement"],
  ["cheque", "Chèque"],
] as const;

/** Avancement de l'import des élèves ; conservé en entier si un lot échoue, pour reprendre sans rien perdre */
export interface Avancement {
  lots: CleEleve[][];
  /** Index du prochain lot à envoyer */
  prochain: number;
  crees: number;
  ignores: number;
  montant: number;
  recus: number;
  refuses: RefusLigne[];
  /** Lignes du fichier laissées de côté (en erreur) au lancement */
  laissees: number;
  enCours: boolean;
  erreur: string | null;
  /** L'échec est survenu après l'envoi (coupure, réponse inattendue) : le lot a pu être écrit */
  incertain?: boolean;
}

export function SuiviImport({ avance, onReprendre }: { avance: Avancement; onReprendre: () => void }) {
  const total = avance.lots.length;
  const fini = avance.prochain >= total && !avance.erreur;
  const pct = total === 0 ? 100 : Math.round((avance.prochain / total) * 100);
  return (
    <div className="space-y-3">
      {!fini && (
        <div>
          <div className="flex justify-between text-[11px] text-neutral-600 mb-1">
            <span>
              Lot {Math.min(avance.prochain + (avance.enCours ? 1 : 0), total)} sur {total}
            </span>
            <span>{pct} %</span>
          </div>
          <div className="h-2 rounded-full bg-neutral-100 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-jang-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {avance.enCours && (
        <p className="text-xs text-neutral-600 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Import en cours, ne fermez pas cette page.
        </p>
      )}
      {avance.erreur && (
        <Message ok={false}>
          <p className="font-bold">
            {avance.incertain
              ? `Le lot ${avance.prochain + 1} sur ${total} n'a pas pu être confirmé.`
              : `Le lot ${avance.prochain + 1} sur ${total} n'a pas été importé.`}
          </p>
          <p>{avance.erreur}</p>
          <p className="mt-1">
            {avance.incertain
              ? "Ce lot a peut-être été enregistré. Vous pouvez reprendre sans risque : les élèves déjà créés seront ignorés, aucun reçu ne sera créé en double."
              : "Rien n'a été enregistré pour ce lot. Corrigez le problème, puis reprenez."}
          </p>
        </Message>
      )}
      {avance.erreur && !avance.enCours && (
        <Bouton onClick={onReprendre}>
          <Loader2 className="w-4 h-4" /> Reprendre
        </Bouton>
      )}
      {(fini || avance.erreur || avance.crees > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="Élèves créés" valeur={String(avance.crees)} ton="vert" />
          <Kpi label="Ignorés" valeur={String(avance.ignores)} detail="déjà présents" />
          <Kpi label="Total encaissé" valeur={formatFCFA(avance.montant)} detail={`${avance.recus} reçu${avance.recus > 1 ? "s" : ""} de reprise`} />
          <Kpi label="Laissées de côté" valeur={String(avance.laissees + avance.refuses.length)} detail="lignes non importées" ton={avance.laissees + avance.refuses.length ? "rouge" : undefined} />
        </div>
      )}
      {avance.refuses.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-bold text-red-700">{avance.refuses.length} ligne(s) refusée(s) au moment de l&apos;import</summary>
          <ul className="mt-1 space-y-0.5 text-[11px] text-red-700">
            {avance.refuses.slice(0, 100).map((r, i) => (
              <li key={i}>
                Ligne {r.ligne} : {r.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      {fini && <Message ok>Import terminé. Retrouvez les élèves dans l&apos;onglet « Élèves » de l&apos;Espace École.</Message>}
    </div>
  );
}
