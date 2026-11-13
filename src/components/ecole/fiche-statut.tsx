"use client";

// Fiche élève : statut de l'inscription (départ, date de départ) et réduction mensuelle.
import { useState } from "react";
import type { StatutInscription } from "@/types/database";
import { Bouton, champ } from "@/components/ui";
import { modifierInscription } from "@/app/ecole/actions/inscriptions";
import type { EleveVue } from "@/types/ecole";

type Executer = (action: () => Promise<{ success: boolean; message?: string }>, apres?: () => void) => void;

export function StatutInscriptionEleve({
  ins,
  aujourdhui,
  isPending,
  executer,
}: {
  ins: NonNullable<EleveVue["inscription"]>;
  aujourdhui: string;
  isPending: boolean;
  executer: Executer;
}) {
  const [statutChoisi, setStatutChoisi] = useState<StatutInscription>(ins.statut);
  const [dateDepart, setDateDepart] = useState(ins.date_depart ?? aujourdhui);
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <select
        value={statutChoisi}
        onChange={(e) => setStatutChoisi(e.target.value as StatutInscription)}
        className={`${champ} w-auto`}
        aria-label="Statut de l'inscription"
      >
        <option value="active">Inscrit</option>
        <option value="abandon">Abandon</option>
        <option value="transfert">Transféré</option>
      </select>
      {statutChoisi !== "active" && (
        <input
          type="date"
          value={dateDepart}
          max={aujourdhui}
          onChange={(e) => setDateDepart(e.target.value)}
          className={`${champ} w-auto`}
          aria-label="Date de départ"
        />
      )}
      {(statutChoisi !== ins.statut || (statutChoisi !== "active" && dateDepart !== (ins.date_depart ?? ""))) && (
        <Bouton
          variante="secondaire"
          disabled={isPending || (statutChoisi !== "active" && !dateDepart)}
          onClick={() =>
            executer(() =>
              modifierInscription(ins.id, {
                statut: statutChoisi,
                date_depart: statutChoisi === "active" ? null : dateDepart,
              })
            )
          }
        >
          Appliquer le statut
        </Bouton>
      )}
      <ReductionEditable valeur={ins.reduction_mensuelle} onSave={(v) => executer(() => modifierInscription(ins.id, { reduction_mensuelle: v }))} />
    </div>
  );
}

function ReductionEditable({ valeur, onSave }: { valeur: number; onSave: (v: string) => void }) {
  const [v, setV] = useState(String(valeur || ""));
  return (
    <div className="flex gap-1.5">
      <input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} placeholder="Réduction/mois" className={`${champ} w-36`} />
      <Bouton variante="secondaire" onClick={() => onSave(v || "0")}>Appliquer</Bouton>
    </div>
  );
}
