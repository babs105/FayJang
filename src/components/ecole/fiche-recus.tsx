"use client";

// Fiche élève : historique des paiements, un reçu par ligne (détail dépliable), PDF et annulation.
import { useMemo, useState } from "react";
import { Ban, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { cn, formatFCFA } from "@/lib/utils";
import { formatDate } from "@/lib/metier/dates";
import { LIBELLE_MODE, libellePaiement } from "@/lib/metier/libelles";
import { estRecuDeReprise } from "@/lib/metier/reprise-recu";
import { regrouperParRecu, resumeRecu } from "@/lib/metier/regrouper-recus";
import { Badge } from "@/components/ui";
import { annulerPaiement } from "@/app/ecole/actions/encaissement";
import type { EcoleVue, PaiementVue } from "@/types/ecole";

type Executer = (action: () => Promise<{ success: boolean; message?: string }>, apres?: () => void) => void;

export function HistoriquePaiements({
  ecole,
  paiements,
  lectureSeule,
  peutAnnuler,
  executer,
}: {
  ecole: EcoleVue;
  paiements: PaiementVue[];
  lectureSeule: boolean;
  peutAnnuler: boolean;
  executer: Executer;
}) {
  const [recusOuverts, setRecusOuverts] = useState<Set<string>>(new Set());
  const recus = useMemo(() => regrouperParRecu(paiements), [paiements]);
  function basculerRecu(cle: string) {
    setRecusOuverts((prec) => {
      const suivant = new Set(prec);
      if (suivant.has(cle)) suivant.delete(cle);
      else suivant.add(cle);
      return suivant;
    });
  }
  return (
    <div>
      <p className="text-xs font-extrabold mb-2">Historique des paiements ({ecole.annee_scolaire})</p>
      {paiements.length === 0 ? (
        <p className="text-xs text-neutral-500">Aucun paiement.</p>
      ) : (
        <ul className="divide-y divide-neutral-100 border border-neutral-100 rounded-2xl">
          {recus.map((r) => {
            const p = r.premiere;
            const detail = r.lignes.length > 1;
            const ouvert = recusOuverts.has(r.cle);
            return (
              <li key={r.cle} className={cn(r.annule && "opacity-60")}>
                <div className="px-3 py-2.5 flex items-center gap-3">
                  <div
                    className={cn("flex-1 min-w-0", detail && "cursor-pointer")}
                    onClick={detail ? () => basculerRecu(r.cle) : undefined}
                  >
                    <p className={cn("text-xs font-bold flex items-center gap-1", r.annule && "line-through")}>
                      {detail && (ouvert ? <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />)}
                      <span>
                        {resumeRecu(r.lignes)}
                        {" · "}
                        {formatFCFA(r.annule ? r.totalBrut : r.total)}
                      </span>
                    </p>
                    <p className="text-[11px] text-neutral-500">
                      {p.numero_recu} · {formatDate(p.paye_le)} · {LIBELLE_MODE[p.mode]}
                      {p.reference ? ` (${p.reference})` : ""}
                      {estRecuDeReprise(p.encaisse_par) && <> · <Badge ton="bleu">Reprise de l'existant</Badge></>}
                      {p.encaisse_par && !estRecuDeReprise(p.encaisse_par) && ` · Encaissé par ${p.encaisse_par}`}
                      {r.annule && <> · <Badge ton="rouge">Annulé</Badge>{r.motif_annulation ? ` ${r.motif_annulation}` : ""}{p.annule_par ? ` · annulé par ${p.annule_par}` : ""}</>}
                    </p>
                  </div>
                  <a href={`/ecole/recu/${p.id}`} target="_blank" className="p-1.5 rounded-lg hover:bg-neutral-100" title="Reçu PDF">
                    <FileText className="w-4 h-4 text-neutral-600" />
                  </a>
                  {!r.annule && !lectureSeule && peutAnnuler && (
                    <button
                      title="Annuler ce reçu"
                      className="p-1.5 rounded-lg hover:bg-red-50"
                      onClick={() => {
                        const nb = r.lignes.filter((l) => !l.annule).length;
                        const motif = prompt(
                          `Annuler le reçu ${p.numero_recu} ? Total annulé : ${formatFCFA(r.total)} (${nb} ligne${nb > 1 ? "s" : ""}). Le reçu entier sera annulé.\n\nMotif de l'annulation (obligatoire : erreur de saisie, chèque rejeté...) :`
                        );
                        if (motif?.trim()) executer(() => annulerPaiement(p.id, motif.trim()));
                      }}
                    >
                      <Ban className="w-4 h-4 text-red-500" />
                    </button>
                  )}
                </div>
                {detail && ouvert && (
                  <ul className="bg-neutral-50/60 px-3 pb-2 space-y-0.5">
                    {r.lignes.map((l) => (
                      <li key={l.id} className={cn("flex justify-between text-[11px] text-neutral-600 pl-5", l.annule && "opacity-60 line-through")}>
                        <span>{libellePaiement(l)}</span>
                        <span>{formatFCFA(l.montant)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
