"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { formatFCFA } from "@/lib/utils";
import { formatDate } from "@/lib/metier/dates";
import { LIBELLE_STATUT_INSCRIPTION } from "@/lib/metier/libelles";
import { peutEcrire } from "@/lib/metier/abonnement";
import { Badge, Bouton, Carte, champ } from "@/components/ui";
import { MentionLectureSeule } from "./bandeau-abonnement";
import { InscriptionModal } from "./inscription-modal";
import type { DonneesEcole } from "./ecole-dashboard-client";

export function ElevesPanel({ eleves, classes, ecole, abonnement, ouvrirEleve }: DonneesEcole & { ouvrirEleve: (id: string) => void }) {
  const lectureSeule = !peutEcrire(abonnement.etat);
  const [recherche, setRecherche] = useState("");
  const [classeFiltre, setClasseFiltre] = useState("");
  const [nouveau, setNouveau] = useState(false);

  const liste = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return eleves.filter((e) => {
      if (classeFiltre === "_aucune" ? e.inscription : classeFiltre && e.inscription?.classe_id !== classeFiltre) return false;
      if (!q) return true;
      return `${e.prenom} ${e.nom} ${e.matricule} ${e.parent?.nom ?? ""} ${e.parent?.telephone ?? ""}`.toLowerCase().includes(q);
    });
  }, [eleves, recherche, classeFiltre]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-neutral-400" />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Nom, matricule, parent, téléphone..."
            className={`${champ} pl-9`}
          />
        </div>
        <select value={classeFiltre} onChange={(e) => setClasseFiltre(e.target.value)} className={`${champ} sm:w-48`}>
          <option value="">Toutes les classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.nom}</option>
          ))}
          <option value="_aucune">Non réinscrits</option>
        </select>
        {lectureSeule ? (
          <MentionLectureSeule className="self-center" />
        ) : (
          <Bouton onClick={() => setNouveau(true)} disabled={classes.length === 0}>
            <Plus className="w-4 h-4" /> Nouvelle inscription
          </Bouton>
        )}
      </div>

      <Carte className="p-0 overflow-hidden">
        {liste.length === 0 ? (
          <p className="text-xs text-neutral-500 p-6 text-center">
            {eleves.length === 0 ? "Aucun élève pour l'instant : faites la première inscription." : "Aucun élève ne correspond."}
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 text-neutral-500 text-left">
              <tr>
                <th className="px-4 py-2.5 font-bold">Élève</th>
                <th className="px-4 py-2.5 font-bold hidden md:table-cell">Classe</th>
                <th className="px-4 py-2.5 font-bold hidden md:table-cell">Parent</th>
                <th className="px-4 py-2.5 font-bold text-right">Arriéré</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {liste.map((e) => (
                <tr key={e.id} onClick={() => ouvrirEleve(e.id)} className="hover:bg-neutral-50 cursor-pointer">
                  <td className="px-4 py-2.5">
                    <p className="font-bold text-neutral-900">{e.prenom} {e.nom}</p>
                    <p className="text-[11px] text-neutral-500">
                      {e.matricule}
                      <span className="md:hidden"> · {e.inscription?.classe_nom ?? "non réinscrit"}</span>
                    </p>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    {e.inscription ? (
                      <span className="flex items-center gap-1.5">
                        {e.inscription.classe_nom}
                        {e.inscription.statut !== "active" && (
                          <Badge ton="gris">
                            {LIBELLE_STATUT_INSCRIPTION[e.inscription.statut]}
                            {e.inscription.date_depart ? ` le ${formatDate(e.inscription.date_depart)}` : ""}
                          </Badge>
                        )}
                      </span>
                    ) : (
                      <Badge ton="orange">Non réinscrit</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell text-neutral-600">
                    {e.parent ? `${e.parent.nom} · ${e.parent.telephone}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {e.situation && e.situation.arriere > 0 ? (
                      <span className="font-extrabold text-red-600">{formatFCFA(e.situation.arriere)}</span>
                    ) : e.situation ? (
                      <Badge ton="vert">À jour</Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Carte>
      <p className="text-[11px] text-neutral-500">{liste.length} élève(s) affiché(s)</p>

      {nouveau && !lectureSeule && <InscriptionModal classes={classes} ecole={ecole} onClose={() => setNouveau(false)} onInscrit={(id) => { setNouveau(false); ouvrirEleve(id); }} />}
    </div>
  );
}
