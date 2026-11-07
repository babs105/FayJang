"use client";

import { useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";
import { cn, formatFCFA } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { LIBELLE_MODE, MODES_PAIEMENT, libellePaiement } from "@/lib/libelles";
import { Badge, Carte, champ } from "@/components/ui";
import type { DonneesEcole } from "./ecole-dashboard-client";

export function PaiementsPanel({ paiements, aujourdhui, ouvrirEleve }: DonneesEcole & { ouvrirEleve: (id: string) => void }) {
  const [periode, setPeriode] = useState<"jour" | "mois" | "annee">("mois");
  const [mode, setMode] = useState("");
  const [annules, setAnnules] = useState(false);

  const liste = useMemo(
    () =>
      paiements.filter((p) => {
        if (!annules && p.annule) return false;
        if (mode && p.mode !== mode) return false;
        if (periode === "jour") return p.paye_le === aujourdhui;
        if (periode === "mois") return p.paye_le.slice(0, 7) === aujourdhui.slice(0, 7);
        return true;
      }),
    [paiements, periode, mode, annules, aujourdhui]
  );
  const total = liste.filter((p) => !p.annule).reduce((s, p) => s + p.montant, 0);

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
        <a href="/ecole/export" className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold bg-neutral-900 text-white">
          <Download className="w-4 h-4" /> Export Excel
        </a>
      </div>

      <Carte className="flex justify-between items-center py-4">
        <span className="text-xs text-neutral-600">{liste.filter((p) => !p.annule).length} paiement(s)</span>
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
              {liste.map((p) => (
                <tr key={p.id} className={cn(p.annule && "opacity-50")}>
                  <td className="px-4 py-2.5">
                    <p className="font-bold">{p.numero_recu}</p>
                    <p className="text-[11px] text-neutral-500">{formatDate(p.paye_le)}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => ouvrirEleve(p.eleve_id)} className="font-bold hover:text-jang-700 text-left">{p.eleve_nom}</button>
                    <p className="text-[11px] text-neutral-500">{p.classe_nom}</p>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    {libellePaiement(p)}
                    {p.annule && <span className="ml-1"><Badge ton="rouge">Annulé</Badge></span>}
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    {LIBELLE_MODE[p.mode]}
                    {p.reference && <span className="text-neutral-400"> · {p.reference}</span>}
                  </td>
                  <td className={cn("px-4 py-2.5 text-right font-extrabold", p.annule && "line-through")}>{formatFCFA(p.montant)}</td>
                  <td className="px-2">
                    <a href={`/ecole/recu/${p.id}`} target="_blank" className="p-1.5 inline-block rounded-lg hover:bg-neutral-100" title="Reçu PDF">
                      <FileText className="w-4 h-4 text-neutral-600" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Carte>
    </div>
  );
}
