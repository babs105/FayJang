"use client";

// Fiche élève : mensualités, articles et services à cocher pour l'encaissement, et ajout d'un article du catalogue.
import { Plus, Trash2 } from "lucide-react";
import { cn, formatFCFA } from "@/lib/utils";
import { formatMoisCourt } from "@/lib/metier/dates";
import { ajouterArticleInscription, retirerArticleInscription } from "@/app/ecole/actions/articles";
import type { ClasseVue, EcoleVue, EleveVue } from "@/types/ecole";
import { basculer, type Encaissement } from "./use-encaissement";
import type { LigneArticle, Situation, StatutMois } from "@/types/commun";

export const STYLE_MOIS: Record<StatutMois, string> = {
  paye: "bg-jang-50 border-jang-200 text-jang-700",
  partiel: "bg-amber-50 border-amber-200 text-amber-700",
  retard: "bg-red-50 border-red-200 text-red-700",
  a_venir: "bg-white border-neutral-200 text-neutral-500",
  non_du: "bg-neutral-50 border-neutral-100 text-neutral-300",
};

type Executer = (action: () => Promise<{ success: boolean; message?: string }>, apres?: () => void) => void;

export function SelectionEncaissement({
  s,
  ins,
  ecole,
  classe,
  aujourdhui,
  lectureSeule,
  isPending,
  enc,
  executer,
}: {
  s: Situation;
  ins: NonNullable<EleveVue["inscription"]>;
  ecole: EcoleVue;
  classe: ClasseVue | undefined;
  aujourdhui: string;
  lectureSeule: boolean;
  isPending: boolean;
  enc: Encaissement;
  executer: Executer;
}) {
  // Articles regroupés : frais uniques, puis un bloc par service mensuel
  const uniques = s.articles.filter((a) => a.nature === "unique");
  const services = new Map<string, LigneArticle[]>();
  for (const a of s.articles) if (a.nature === "mensuel") services.set(a.article_id, [...(services.get(a.article_id) ?? []), a]);
  const optionsAjout = (classe?.articles ?? []).filter(
    (a) => a.nature === "unique" || ![...services.values()].some((l) => l[0]?.libelle.startsWith(a.libelle) && l.some((x) => x.reste > 0))
  );

  return (
    <>
    <div>
      <p className="text-xs font-bold text-neutral-700 mb-2">
        Mensualités {formatFCFA(Math.max(0, ins.mensualite - ins.reduction_mensuelle))} · échéance le {ecole.jour_echeance} du mois
        <span className="font-normal text-neutral-500"> — touchez ce qu'il faut encaisser</span>
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        <button
          type="button"
          disabled={lectureSeule || s.inscriptionPayee >= s.inscriptionDue}
          onClick={() => {
            enc.setLibre(false);
            enc.setInscriptionChoisie(!enc.inscriptionChoisie);
          }}
          className={cn(
            "rounded-xl border px-2 py-2 text-center transition",
            s.inscriptionPayee >= s.inscriptionDue ? STYLE_MOIS.paye : s.inscriptionPayee > 0 ? STYLE_MOIS.partiel : STYLE_MOIS.retard,
            enc.inscriptionChoisie && "ring-2 ring-jang-600 ring-offset-1"
          )}
        >
          <p className="text-[11px] font-bold">Inscription</p>
          <p className="text-[10px]">{formatFCFA(s.inscriptionPayee)} / {formatFCFA(s.inscriptionDue)}</p>
        </button>
        {s.mois.map((m) => {
          const choisi = enc.moisChoisis.includes(m.mois);
          const payable = m.reste > 0;
          return (
            <button
              key={m.mois}
              type="button"
              disabled={lectureSeule || !payable}
              onClick={() => {
                enc.setLibre(false);
                enc.setMoisChoisis(basculer(enc.moisChoisis, m.mois));
              }}
              className={cn(
                "rounded-xl border px-2 py-2 text-center transition",
                STYLE_MOIS[m.statut],
                choisi && "ring-2 ring-jang-600 ring-offset-1",
                payable && "hover:shadow-sm"
              )}
            >
              <p className="text-[11px] font-bold capitalize">{formatMoisCourt(m.mois)} {m.mois.slice(2, 4)}</p>
              <p className="text-[10px]">
                {m.statut === "paye" ? "Payé" : m.statut === "non_du" ? "—" : m.paye > 0 ? `reste ${formatFCFA(m.reste)}` : m.statut === "retard" ? "En retard" : "À venir"}
              </p>
              {m.aLinscription && m.reste > 0 && <p className="text-[9px] font-bold">à l'inscription</p>}
              {m.tranches && m.reste > 0 && (
                <p className="text-[9px] font-bold">
                  {m.tranches.total} tranches · {m.tranches.echues}/{m.tranches.total} échue{m.tranches.echues > 1 ? "s" : ""}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>

    {(uniques.length > 0 || services.size > 0 || optionsAjout.length > 0) && (
      <div>
        <p className="text-xs font-bold text-neutral-700 mb-2">Articles et services</p>
        {uniques.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
            {uniques.map((a) => (
              <div key={a.cle} className="relative">
                <button
                  type="button"
                  disabled={lectureSeule || a.reste === 0}
                  onClick={() => {
                    enc.setLibre(false);
                    enc.setArticlesChoisis(basculer(enc.articlesChoisis, a.cle));
                  }}
                  className={cn(
                    "w-full rounded-xl border px-2 py-2 text-left transition",
                    STYLE_MOIS[a.statut],
                    enc.articlesChoisis.includes(a.cle) && "ring-2 ring-jang-600 ring-offset-1"
                  )}
                >
                  <p className="text-[11px] font-bold pr-5">{a.libelle}</p>
                  <p className="text-[10px]">{a.reste === 0 ? (a.du === 0 ? "—" : "Payé") : `${formatFCFA(a.reste)} à payer`}</p>
                </button>
                {a.paye === 0 && a.du > 0 && !lectureSeule && (
                  <button
                    type="button"
                    title="Retirer cet article"
                    onClick={() => confirm(`Retirer « ${a.libelle} » pour cet élève ?`) && executer(() => retirerArticleInscription(a.article_id))}
                    className="absolute top-1 right-1 p-1 rounded hover:bg-white/70"
                  >
                    <Trash2 className="w-3 h-3 text-neutral-400" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {[...services.entries()].map(([id, lignes]) => {
          const nom = lignes[0].libelle.split(" — ")[0];
          const enCours = lignes[lignes.length - 1].mois! >= `${aujourdhui.slice(0, 7)}-01`;
          return (
            <div key={id} className="mb-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] font-bold">{nom} <span className="font-normal text-neutral-500">(mensuel)</span></p>
                {enCours && !lectureSeule && (
                  <button
                    type="button"
                    onClick={() => confirm(`Arrêter « ${nom} » ? Les mois déjà payés restent.`) && executer(() => retirerArticleInscription(id))}
                    className="text-[11px] font-bold text-neutral-500 hover:text-red-600"
                  >
                    Arrêter
                  </button>
                )}
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                {lignes.map((l) => (
                  <button
                    key={l.cle}
                    type="button"
                    disabled={lectureSeule || l.reste === 0}
                    onClick={() => {
                      enc.setLibre(false);
                      enc.setArticlesChoisis(basculer(enc.articlesChoisis, l.cle));
                    }}
                    className={cn(
                      "rounded-lg border px-1 py-1.5 text-center",
                      STYLE_MOIS[l.statut],
                      enc.articlesChoisis.includes(l.cle) && "ring-2 ring-jang-600 ring-offset-1"
                    )}
                  >
                    <p className="text-[10px] font-bold capitalize">{formatMoisCourt(l.mois!)}</p>
                    <p className="text-[9px]">{l.reste === 0 ? "✓" : formatFCFA(l.reste)}</p>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {ins.statut === "active" && !lectureSeule && optionsAjout.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {optionsAjout.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={isPending}
                onClick={() => executer(() => ajouterArticleInscription(ins.id, a.id))}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-neutral-200 text-[11px] font-bold hover:bg-neutral-50"
              >
                <Plus className="w-3 h-3" /> {a.libelle} ({formatFCFA(a.prix_unitaire)}
                {a.nature === "mensuel" ? "/mois" : ""})
              </button>
            ))}
          </div>
        )}
      </div>
    )}
    </>
  );
}
