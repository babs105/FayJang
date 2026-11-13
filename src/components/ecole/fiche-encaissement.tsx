"use client";

// Fiche élève : formulaire d'encaissement (lignes choisies ou paiement libre, tranche, mode et référence).
import { formatFCFA } from "@/lib/utils";
import { formatDate, formatMois } from "@/lib/metier/dates";
import { LIBELLE_MODE, MODES_PAIEMENT } from "@/lib/metier/libelles";
import { paiementLibreAutorise, type Situation } from "@/lib/metier/scolarite";
import { Bouton, Label, champ } from "@/components/ui";
import type { EleveVue } from "@/types/ecole";
import type { Encaissement } from "./use-encaissement";

export function FormulaireEncaissement({
  s,
  ins,
  isPending,
  enc,
}: {
  s: Situation;
  ins: NonNullable<EleveVue["inscription"]>;
  isPending: boolean;
  enc: Encaissement;
}) {
  return (
    <form onSubmit={enc.encaisser} className="rounded-2xl bg-neutral-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-extrabold text-neutral-900">Encaisser un paiement</p>
        {paiementLibreAutorise(ins.statut) && (
        <label className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-600">
          <input
            type="checkbox"
            checked={enc.libreCoche}
            onChange={(e) => {
              enc.setLibre(e.target.checked);
              if (e.target.checked) enc.viderSelection();
            }}
          />
          Paiement libre (hors catalogue)
        </label>
        )}
      </div>
      {(() => {
        const cible = s.mois.find((m) => m.tranches && m.reste > 0);
        if (!cible?.tranches || enc.libre) return null;
        const t = cible.tranches;
        return (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white border border-jang-100 p-2.5">
            <p className="text-[11px] text-neutral-700">
              <b className="capitalize">{formatMois(cible.mois)}</b> payé par tranches de {formatFCFA(t.montant)} :{" "}
              {formatFCFA(cible.paye)} versés sur {formatFCFA(cible.du)}
              {cible.resteEchu > 0 ? (
                <span className="text-red-600 font-bold"> · {formatFCFA(cible.resteEchu)} en retard</span>
              ) : t.prochaine ? (
                <span className="text-neutral-500"> · prochaine échéance le {formatDate(t.prochaine)}</span>
              ) : null}
            </p>
            <Bouton
              type="button"
              variante="secondaire"
              onClick={() => {
                enc.viderSelection();
                enc.setMoisChoisis([cible.mois]);
                enc.setMontant(String(t.suggestion));
              }}
            >
              Payer la tranche ({formatFCFA(t.suggestion)})
            </Bouton>
          </div>
        );
      })()}

      {enc.libre ? (
        <div className="grid sm:grid-cols-3 gap-2">
          <div className="sm:col-span-2">
            <Label>Objet</Label>
            <input value={enc.libelle} onChange={(e) => enc.setLibelle(e.target.value)} placeholder="Sortie scolaire, fournitures..." className={champ} />
          </div>
          <div>
            <Label>Montant</Label>
            <input inputMode="numeric" value={enc.montant} onChange={(e) => enc.setMontant(e.target.value)} placeholder="FCFA" className={champ} />
          </div>
        </div>
      ) : (
        <div className="text-xs text-neutral-600 space-y-1.5">
          {enc.rienChoisi ? (
            <p>Touchez l'inscription, des mois ou des articles ci-dessus.</p>
          ) : enc.calcul && "erreur" in enc.calcul ? (
            <p className="text-red-600 font-bold">{enc.calcul.erreur}</p>
          ) : (
            <ul className="space-y-0.5">
              {enc.apercu?.lignes.map((l, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>{l.libelle ?? (l.type === "inscription" ? "Frais d'inscription" : `Mensualité de ${formatMois(l.mois!)}`)}</span>
                  <span className="font-bold">{formatFCFA(l.montant)}</span>
                </li>
              ))}
            </ul>
          )}
          {enc.tranche && (
            <label className="flex items-center gap-1.5 font-bold text-jang-700">
              <input type="checkbox" checked={enc.inclureTranche} onChange={(e) => enc.setInclureTranche(e.target.checked)} />
              Inclure la {enc.tranche.libelle.charAt(0).toLowerCase() + enc.tranche.libelle.slice(1)} (+{formatFCFA(enc.tranche.montant)})
            </label>
          )}
          <div className="sm:w-1/3">
            <Label>Montant (vide = reste dû)</Label>
            <input
              inputMode="numeric"
              value={enc.montant}
              onChange={(e) => enc.setMontant(e.target.value)}
              disabled={enc.nbLignes > 1}
              placeholder={enc.nbLignes > 1 ? "Une seule ligne" : "Paiement partiel"}
              className={champ}
            />
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <Label>Mode</Label>
          <select value={enc.mode} onChange={(e) => enc.setMode(e.target.value)} className={champ}>
            {MODES_PAIEMENT.map((m) => (
              <option key={m} value={m}>{LIBELLE_MODE[m]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Référence {enc.mode === "especes" ? "(facultatif)" : ""}</Label>
          <input value={enc.reference} onChange={(e) => enc.setReference(e.target.value)} placeholder="ex : n° de transaction" className={champ} />
        </div>
      </div>
      <Bouton type="submit" disabled={isPending || (enc.libre ? !enc.totalSelection || !enc.libelle.trim() : !enc.apercu)} className="w-full">
        {isPending ? "Enregistrement..." : `Encaisser ${enc.totalSelection > 0 ? formatFCFA(enc.totalSelection) : ""}`}
      </Bouton>
    </form>
  );
}
