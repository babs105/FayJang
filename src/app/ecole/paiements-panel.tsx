"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, FileText } from "lucide-react";
import { cn, formatFCFA } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { LIBELLE_MODE, MODES_PAIEMENT, libellePaiement } from "@/lib/libelles";
import { regrouperParRecu, resumeRecu } from "@/lib/regrouper-recus";
import { Badge, Carte, champ } from "@/components/ui";
import { peutFaire } from "@/lib/droits";
import type { DonneesEcole } from "./ecole-dashboard-client";
import { estRecuDeReprise } from "@/lib/reprise-recu";

export function PaiementsPanel({ paiements, aujourdhui, utilisateur, ouvrirEleve }: DonneesEcole & { ouvrirEleve: (id: string) => void }) {
  const [periode, setPeriode] = useState<"jour" | "mois" | "annee">("mois");
  const [mode, setMode] = useState("");
  const [annules, setAnnules] = useState(false);
  const [ouverts, setOuverts] = useState<Set<string>>(new Set());

  const liste = useMemo(
    () =>
      paiements.filter((p) => {
        if (!annules && p.annule) return false;
        if (mode && p.mode !== mode) return false;
        // Un reçu de reprise (versements antérieurs à FayJàng, daté du jour de l'import) n'est pas la caisse
        // du jour ni du mois : il n'apparaît que dans « Toute l'année »
        if (periode !== "annee" && estRecuDeReprise(p.encaisse_par)) return false;
        if (periode === "jour") return p.paye_le === aujourdhui;
        if (periode === "mois") return p.paye_le.slice(0, 7) === aujourdhui.slice(0, 7);
        return true;
      }),
    [paiements, periode, mode, annules, aujourdhui]
  );
  // Une ligne par reçu (lot) : un encaissement de 3 mois n'apparaît qu'une fois
  const recus = useMemo(() => regrouperParRecu(liste), [liste]);
  const total = recus.reduce((s, r) => s + r.total, 0);

  function basculer(cle: string) {
    setOuverts((prec) => {
      const suivant = new Set(prec);
      if (suivant.has(cle)) suivant.delete(cle);
      else suivant.add(cle);
      return suivant;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex bg-white border border-neutral-200 rounded-xl p-0.5">
          {(["jour", "mois", "annee"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriode(p)}
              className={cn("px-3 py-2 text-xs font-bold rounded-lg", periode === p ? "bg-jang-600 text-white" : "text-neutral-600")}
            >
              {p === "jour" ? "Aujourd'hui" : p === "mois" ? "Ce mois" : "Toute l'année"}
            </button>
          ))}
        </div>
        <select value={mode} onChange={(e) => setMode(e.target.value)} className={`${champ} w-auto`}>
          <option value="">Tous les modes</option>
          {MODES_PAIEMENT.map((m) => (
            <option key={m} value={m}>{LIBELLE_MODE[m]}</option>
          ))}
        </select>
        <label className="text-xs flex items-center gap-1.5 text-neutral-600">
          <input type="checkbox" checked={annules} onChange={(e) => setAnnules(e.target.checked)} /> Afficher les annulés
        </label>
        {peutFaire(utilisateur.role, "exporter") && (
          <a href="/ecole/export" className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold bg-neutral-900 text-white">
            <Download className="w-4 h-4" /> Export Excel
          </a>
        )}
      </div>

      <Carte className="flex justify-between items-center py-4">
        <span className="text-xs text-neutral-600">{recus.filter((r) => !r.annule).length} reçu(s)</span>
        <span className="text-lg font-extrabold text-jang-700">{formatFCFA(total)}</span>
      </Carte>

      <Carte className="p-0 overflow-hidden">
        {liste.length === 0 ? (
          <p className="text-xs text-neutral-500 p-6 text-center">Aucun paiement sur cette période.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 text-neutral-500 text-left">
              <tr>
                <th className="px-4 py-2.5 font-bold">Reçu</th>
                <th className="px-4 py-2.5 font-bold">Élève</th>
                <th className="px-4 py-2.5 font-bold hidden md:table-cell">Objet</th>
                <th className="px-4 py-2.5 font-bold hidden md:table-cell">Mode</th>
                <th className="px-4 py-2.5 font-bold text-right">Montant</th>
                <th className="px-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {recus.map((r) => {
                const p = r.premiere;
                const detail = r.lignes.length > 1;
                const ouvert = ouverts.has(r.cle);
                return (
                  <Fragment key={r.cle}>
                    <tr className={cn(r.annule && "opacity-50", detail && "cursor-pointer hover:bg-neutral-50")} onClick={detail ? () => basculer(r.cle) : undefined}>
                      <td className="px-4 py-2.5">
                        <p className="font-bold flex items-center gap-1 whitespace-nowrap">
                          {detail && (ouvert ? <ChevronDown className="w-3.5 h-3.5 text-neutral-400" /> : <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />)}
                          {p.numero_recu}
                        </p>
                        <p className="text-[11px] text-neutral-500">{formatDate(p.paye_le)}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            ouvrirEleve(p.eleve_id);
                          }}
                          className="font-bold hover:text-jang-700 text-left"
                        >
                          {p.eleve_nom}
                        </button>
                        <p className="text-[11px] text-neutral-500">{p.classe_nom}</p>
                        <p className="text-[11px] text-neutral-500 md:hidden">{resumeRecu(r.lignes)}</p>
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        {resumeRecu(r.lignes)}
                        {estRecuDeReprise(p.encaisse_par) && <span className="ml-1"><Badge ton="gris">Reprise de l&apos;existant</Badge></span>}
                        {p.encaisse_par && !estRecuDeReprise(p.encaisse_par) && <p className="text-[11px] text-neutral-500">Encaissé par {p.encaisse_par}</p>}
                        {r.annule && <span className="ml-1"><Badge ton="rouge">Annulé</Badge></span>}
                        {r.annule && r.motif_annulation && <p className="text-[11px] text-neutral-500">{r.motif_annulation}{r.premiere.annule_par ? ` · annulé par ${r.premiere.annule_par}` : ""}</p>}
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        {LIBELLE_MODE[p.mode]}
                        {p.reference && <span className="text-neutral-400"> · {p.reference}</span>}
                      </td>
                      <td className={cn("px-4 py-2.5 text-right font-extrabold", r.annule && "line-through")}>
                        {formatFCFA(r.annule ? r.totalBrut : r.total)}
                      </td>
                      <td className="px-2">
                        <a
                          href={`/ecole/recu/${p.id}`}
                          target="_blank"
                          onClick={(e) => e.stopPropagation()}
                          className="p-1.5 inline-block rounded-lg hover:bg-neutral-100"
                          title="Reçu PDF"
                        >
                          <FileText className="w-4 h-4 text-neutral-600" />
                        </a>
                      </td>
                    </tr>
                    {detail &&
                      ouvert &&
                      r.lignes.map((l) => (
                        <tr key={l.id} className={cn("bg-neutral-50/60 text-neutral-600", l.annule && "opacity-50")}>
                          <td className="px-4 py-1.5" />
                          <td className="px-4 py-1.5 md:hidden">{libellePaiement(l)}</td>
                          <td className="px-4 py-1.5 hidden md:table-cell" />
                          <td className="px-4 py-1.5 hidden md:table-cell" colSpan={2}>{libellePaiement(l)}</td>
                          <td className={cn("px-4 py-1.5 text-right", l.annule && "line-through")}>{formatFCFA(l.montant)}</td>
                          <td />
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Carte>
    </div>
  );
}
