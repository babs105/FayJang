"use client";

import { ArrowRight } from "lucide-react";
import { formatFCFA } from "@/lib/utils";
import { formatDate, formatMois } from "@/lib/dates";
import { LIBELLE_MODE } from "@/lib/libelles";
import { regrouperParRecu, resumeRecu } from "@/lib/regrouper-recus";
import { Carte, Kpi } from "@/components/ui";
import type { DonneesEcole, Onglet } from "./ecole-dashboard-client";

export function TableauPanel({
  eleves,
  paiements,
  aujourdhui,
  classes,
  ouvrirEleve,
  allerA,
}: DonneesEcole & { ouvrirEleve: (id: string) => void; allerA: (o: Onglet) => void }) {
  const inscrits = eleves.filter((e) => e.inscription?.statut === "active");
  const valides = paiements.filter((p) => !p.annule);
  // 8 derniers reçus (un encaissement de plusieurs lignes compte pour un seul)
  const derniersRecus = regrouperParRecu(valides).slice(0, 8);
  const moisCourant = aujourdhui.slice(0, 7);
  const encaisseMois = valides.filter((p) => p.paye_le.slice(0, 7) === moisCourant).reduce((s, p) => s + p.montant, 0);
  const encaisseJour = valides.filter((p) => p.paye_le === aujourdhui).reduce((s, p) => s + p.montant, 0);
  const encaisseAnnee = valides.reduce((s, p) => s + p.montant, 0);
  const totalEchu = eleves.reduce((s, e) => s + (e.situation?.totalEchu ?? 0), 0);
  const arrieres = eleves.reduce((s, e) => s + (e.situation?.arriere ?? 0), 0);
  const recouvre = totalEchu > 0 ? Math.round(((totalEchu - arrieres) / totalEchu) * 100) : 100;
  const nbEnRetard = eleves.filter((e) => (e.situation?.arriere ?? 0) > 0).length;

  const parMode = new Map<string, number>();
  for (const p of valides.filter((p) => p.paye_le.slice(0, 7) === moisCourant)) {
    parMode.set(p.mode, (parMode.get(p.mode) ?? 0) + p.montant);
  }
  const top = [...eleves].filter((e) => (e.situation?.arriere ?? 0) > 0).sort((a, b) => b.situation!.arriere - a.situation!.arriere).slice(0, 6);

  if (classes.length === 0) {
    return (
      <Carte className="text-center py-10">
        <p className="text-sm font-bold text-neutral-900">Aucune classe pour cette année</p>
        <p className="text-xs text-neutral-500 mt-1">Créez vos classes et leurs tarifs pour commencer les inscriptions.</p>
        <button onClick={() => allerA("classes")} className="mt-4 text-xs font-bold text-jang-700">
          Créer les classes →
        </button>
      </Carte>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Élèves inscrits" valeur={String(inscrits.length)} detail={`${classes.filter((c) => c.is_active).length} classes`} />
        <Kpi label={`Encaissé · ${formatMois(`${moisCourant}-01`)}`} valeur={formatFCFA(encaisseMois)} detail={`Aujourd'hui : ${formatFCFA(encaisseJour)}`} ton="vert" />
        <Kpi label="Taux de recouvrement" valeur={`${recouvre} %`} detail={`${formatFCFA(encaisseAnnee)} encaissés sur l'année`} />
        <Kpi label="Arriérés" valeur={formatFCFA(arrieres)} detail={`${nbEnRetard} élève${nbEnRetard > 1 ? "s" : ""} en retard`} ton={arrieres > 0 ? "rouge" : undefined} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Carte className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-extrabold">Derniers paiements</h3>
            <button onClick={() => allerA("paiements")} className="text-xs font-bold text-jang-700 flex items-center gap-1">
              Tout voir <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {derniersRecus.length === 0 ? (
            <p className="text-xs text-neutral-500">Aucun paiement encaissé pour l'instant.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {derniersRecus.map((r) => {
                const p = r.premiere;
                return (
                <li key={r.cle}>
                  <button onClick={() => ouvrirEleve(p.eleve_id)} className="w-full py-2 flex items-center justify-between gap-3 text-left">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-neutral-900 truncate">{p.eleve_nom}</p>
                      <p className="text-[11px] text-neutral-500">
                        {resumeRecu(r.lignes)} ·{" "}
                        {LIBELLE_MODE[p.mode]} · {formatDate(p.paye_le)}
                      </p>
                    </div>
                    <span className="text-xs font-extrabold text-jang-700 whitespace-nowrap">{formatFCFA(r.total)}</span>
                  </button>
                </li>
                );
              })}
            </ul>
          )}
        </Carte>

        <div className="space-y-4">
          <Carte>
            <h3 className="text-sm font-extrabold mb-3">Encaissements du mois par mode</h3>
            {parMode.size === 0 ? (
              <p className="text-xs text-neutral-500">Rien encaissé ce mois-ci.</p>
            ) : (
              <ul className="space-y-2">
                {[...parMode.entries()].sort((a, b) => b[1] - a[1]).map(([mode, total]) => (
                  <li key={mode}>
                    <div className="flex justify-between text-xs">
                      <span>{LIBELLE_MODE[mode as keyof typeof LIBELLE_MODE]}</span>
                      <b>{formatFCFA(total)}</b>
                    </div>
                    <div className="h-1.5 bg-neutral-100 rounded-full mt-1">
                      <div className="h-1.5 bg-jang-500 rounded-full" style={{ width: `${Math.round((total / encaisseMois) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Carte>

          <Carte>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-extrabold">Plus gros arriérés</h3>
              <button onClick={() => allerA("impayes")} className="text-xs font-bold text-jang-700">Relancer</button>
            </div>
            {top.length === 0 ? (
              <p className="text-xs text-neutral-500">Aucun impayé. Bravo !</p>
            ) : (
              <ul className="space-y-1.5">
                {top.map((e) => (
                  <li key={e.id}>
                    <button onClick={() => ouvrirEleve(e.id)} className="w-full flex justify-between text-xs hover:text-jang-700">
                      <span className="truncate">{e.prenom} {e.nom} <span className="text-neutral-400">· {e.inscription?.classe_nom}</span></span>
                      <b className="text-red-600 whitespace-nowrap">{formatFCFA(e.situation!.arriere)}</b>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Carte>
        </div>
      </div>
    </div>
  );
}
