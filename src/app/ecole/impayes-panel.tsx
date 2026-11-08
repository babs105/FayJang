"use client";

import { useMemo, useState } from "react";
import { MessageCircle } from "lucide-react";
import { formatFCFA } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { lienWhatsApp, messageRelance } from "@/lib/whatsapp";
import { Carte, Kpi, champ } from "@/components/ui";
import type { DonneesEcole } from "./ecole-dashboard-client";

export function ImpayesPanel({ eleves, classes, ecole, ouvrirEleve }: DonneesEcole & { ouvrirEleve: (id: string) => void }) {
  const [classe, setClasse] = useState("");
  const [minMois, setMinMois] = useState(0);
  const [relances, setRelances] = useState<Set<string>>(new Set());

  const liste = useMemo(
    () =>
      eleves
        .filter((e) => e.situation && e.situation.arriere > 0)
        .filter((e) => !classe || e.inscription?.classe_id === classe)
        .filter((e) => e.situation!.moisEnRetard >= minMois)
        .sort((a, b) => b.situation!.arriere - a.situation!.arriere),
    [eleves, classe, minMois]
  );
  const total = liste.reduce((s, e) => s + e.situation!.arriere, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Kpi label="Élèves en retard" valeur={String(liste.length)} />
        <Kpi label="Total des arriérés" valeur={formatFCFA(total)} ton={total > 0 ? "rouge" : undefined} />
      </div>
      <div className="flex flex-wrap gap-2">
        <select value={classe} onChange={(e) => setClasse(e.target.value)} className={`${champ} w-auto`}>
          <option value="">Toutes les classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.nom}</option>
          ))}
        </select>
        <select value={minMois} onChange={(e) => setMinMois(Number(e.target.value))} className={`${champ} w-auto`}>
          <option value={0}>Tout retard</option>
          <option value={1}>1 mois et plus</option>
          <option value={2}>2 mois et plus</option>
          <option value={3}>3 mois et plus</option>
        </select>
      </div>
      <p className="text-[11px] text-neutral-500">
        Le bouton WhatsApp ouvre un message prêt à envoyer au parent, avec son lien de suivi. Rien n'est envoyé sans vous.
      </p>

      <Carte className="p-0 overflow-hidden">
        {liste.length === 0 ? (
          <p className="text-xs text-neutral-500 p-6 text-center">Aucun impayé avec ces filtres.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {liste.map((e) => (
              <li key={e.id} className="px-4 py-3 flex items-center gap-3">
                <button onClick={() => ouvrirEleve(e.id)} className="flex-1 min-w-0 text-left">
                  <p className="text-xs font-bold truncate">
                    {e.prenom} {e.nom} <span className="text-neutral-400 font-normal">· {e.inscription?.classe_nom}</span>
                    {e.inscription?.date_depart && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 text-[10px] font-bold">
                        {e.sexe === "F" ? "Partie" : "Parti"} le {formatDate(e.inscription.date_depart)}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-neutral-500 truncate">
                    {e.situation!.moisEnRetard} mois en retard · {e.parent ? `${e.parent.nom} · ${e.parent.telephone}` : "pas de parent"}
                  </p>
                </button>
                <span className="text-xs font-extrabold text-red-600 whitespace-nowrap">{formatFCFA(e.situation!.arriere)}</span>
                {e.parent && (
                  <a
                    href={lienWhatsApp(
                      e.parent.telephone,
                      messageRelance({ ecole: ecole.nom, parent: e.parent.nom, eleve: e.prenom, arriere: e.situation!.arriere, moisEnRetard: e.situation!.moisEnRetard, lienParent: e.parent.lien, dateDepart: e.inscription?.date_depart })
                    )}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setRelances(new Set(relances).add(e.id))}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold ${relances.has(e.id) ? "bg-neutral-100 text-neutral-500" : "bg-[#25D366] text-white"}`}
                  >
                    <MessageCircle className="w-3.5 h-3.5" /> {relances.has(e.id) ? "Relancé" : "Relancer"}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Carte>
    </div>
  );
}
