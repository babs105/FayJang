"use client";

// Importer : tableaux de l'aperçu (classes, articles, élèves chiffrés), affichés avant tout enregistrement.
import { useMemo } from "react";
import { AlertTriangle, Loader2, School } from "lucide-react";
import { cn, formatFCFA } from "@/lib/utils";
import { formatDate, formatPeriode } from "@/lib/metier/dates";
import { LIBELLE_NIVEAU, LIBELLE_STATUT_INSCRIPTION } from "@/lib/metier/libelles";
import { Badge, Bouton, Carte, Message } from "@/components/ui";
import type { ResultatClasses } from "@/app/ecole/actions/import";
import type { ApercuReprise, EleveApercu } from "@/types/reprise";

export type Filtre = "tous" | "erreur" | "a_creer" | "deja_present";

const ETAT_ELEVE: Record<EleveApercu["etat"], { libelle: string; ton: "vert" | "rouge" | "gris" }> = {
  a_creer: { libelle: "À créer", ton: "vert" },
  deja_present: { libelle: "Déjà présent", ton: "gris" },
  erreur: { libelle: "Erreur", ton: "rouge" },
};

const montant = (n: number | null) => (n === null ? "—" : formatFCFA(n));

export type Creation = { message: string; data?: ResultatClasses; ok: boolean } | null;

export function CarteClasses({ apercu, creation, isPending, onCreer }: { apercu: ApercuReprise; creation: Creation; isPending: boolean; onCreer: () => void }) {
  return (
    <Carte className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold text-neutral-900">Classes ({apercu.classes.length})</h2>
        {apercu.compteurs.classesNouvelles > 0 && apercu.erreursGlobales.length === 0 && (
          <Bouton onClick={onCreer} disabled={isPending}>
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <School className="w-4 h-4" />}
            Créer {apercu.compteurs.classesNouvelles} classe{apercu.compteurs.classesNouvelles > 1 ? "s" : ""}
          </Bouton>
        )}
      </div>
      {apercu.compteurs.classesNouvelles > 0 && (
        <p className="text-[11px] text-neutral-500">
          Première étape de l&apos;import : les classes et leurs articles. Les élèves viendront ensuite.
        </p>
      )}
      {creation && (
        <Message ok={creation.ok}>
          <p className="font-bold">{creation.message}</p>
          {creation.data && creation.data.dejaPresentes.length > 0 && (
            <p>Déjà présentes, non modifiées : {creation.data.dejaPresentes.join(", ")}.</p>
          )}
          {creation.data?.echecs.map((e, i) => (
            <p key={i}>
              {e.nom} : {e.message}
            </p>
          ))}
        </Message>
      )}
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full text-xs">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="py-1.5 pr-3 font-bold">Ligne</th>
              <th className="py-1.5 pr-3 font-bold">Classe</th>
              <th className="py-1.5 pr-3 font-bold">Niveau</th>
              <th className="py-1.5 pr-3 font-bold text-right">Inscription</th>
              <th className="py-1.5 pr-3 font-bold text-right">Mensualité</th>
              <th className="py-1.5 pr-3 font-bold text-right">Dernier mois</th>
              <th className="py-1.5 font-bold">État</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {apercu.classes.map((c) => (
              <tr key={c.ligne} className="align-top">
                <td className="py-1.5 pr-3 text-neutral-400">{c.ligne}</td>
                <td className="py-1.5 pr-3 font-bold text-neutral-800">{c.nom || "—"}</td>
                <td className="py-1.5 pr-3">{c.niveau ? LIBELLE_NIVEAU[c.niveau] : "—"}</td>
                <td className="py-1.5 pr-3 text-right">{montant(c.frais)}</td>
                <td className="py-1.5 pr-3 text-right">{montant(c.mensualite)}</td>
                <td className="py-1.5 pr-3 text-right">{montant(c.dernierMois)}</td>
                <td className="py-1.5">
                  {c.etat === "nouvelle" && <Badge ton="vert">À créer</Badge>}
                  {c.etat === "existante" && <Badge ton="gris">Déjà présente</Badge>}
                  {c.etat === "erreur" && <Erreurs liste={c.erreurs} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Carte>
  );
}

export function CarteArticles({ apercu }: { apercu: ApercuReprise }) {
  return (
    <Carte className="space-y-2">
      <h2 className="text-sm font-extrabold text-neutral-900">Articles et services ({apercu.articles.length})</h2>
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full text-xs">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="py-1.5 pr-3 font-bold">Ligne</th>
              <th className="py-1.5 pr-3 font-bold">Classe</th>
              <th className="py-1.5 pr-3 font-bold">Article</th>
              <th className="py-1.5 pr-3 font-bold">Nature</th>
              <th className="py-1.5 pr-3 font-bold text-right">Prix</th>
              <th className="py-1.5 pr-3 font-bold">Obligatoire</th>
              <th className="py-1.5 font-bold">État</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {apercu.articles.map((a) => (
              <tr key={a.ligne} className="align-top">
                <td className="py-1.5 pr-3 text-neutral-400">{a.ligne}</td>
                <td className="py-1.5 pr-3">{a.classe || "—"}</td>
                <td className="py-1.5 pr-3 font-bold text-neutral-800">
                  {a.libelle || "—"}
                  {a.nature === "unique" && a.quantite !== 1 ? ` ×${a.quantite}` : ""}
                </td>
                <td className="py-1.5 pr-3">{a.nature === "mensuel" ? "Par mois" : a.nature === "unique" ? "Unique" : "—"}</td>
                <td className="py-1.5 pr-3 text-right">{montant(a.prix)}</td>
                <td className="py-1.5 pr-3">{a.obligatoire ? "Oui" : "Non"}</td>
                <td className="py-1.5">
                  {a.etat === "nouveau" && <Badge ton="vert">À créer</Badge>}
                  {a.etat === "ignore" && <Badge ton="gris">Ignoré</Badge>}
                  {a.etat === "erreur" && <Erreurs liste={a.erreurs} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Carte>
  );
}

export function CarteEleves({ apercu, filtre, setFiltre }: { apercu: ApercuReprise; filtre: Filtre; setFiltre: (f: Filtre) => void }) {
  const eleves = useMemo(() => apercu.eleves.filter((e) => filtre === "tous" || e.etat === filtre), [apercu, filtre]);
  return (
  <Carte className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-extrabold text-neutral-900">Élèves ({apercu.eleves.length})</h2>
      <div className="flex gap-1 flex-wrap">
        {(
          [
            ["tous", `Tous (${apercu.eleves.length})`],
            ["erreur", `Erreurs (${apercu.compteurs.erreurs})`],
            ["a_creer", `À créer (${apercu.compteurs.aCreer})`],
            ["deja_present", `Déjà présents (${apercu.compteurs.dejaPresents})`],
          ] as [Filtre, string][]
        ).map(([id, libelle]) => (
          <button
            key={id}
            onClick={() => setFiltre(id)}
            className={cn(
              "px-2.5 py-1 rounded-full text-[11px] font-bold border",
              filtre === id ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-600 border-neutral-200"
            )}
          >
            {libelle}
          </button>
        ))}
      </div>
    </div>
    {eleves.length === 0 ? (
      <p className="text-xs text-neutral-500">Aucune ligne dans ce filtre.</p>
    ) : (
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full text-xs">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="py-1.5 pr-3 font-bold">Ligne</th>
              <th className="py-1.5 pr-3 font-bold">Élève</th>
              <th className="py-1.5 pr-3 font-bold">Classe</th>
              <th className="py-1.5 pr-3 font-bold">Parent</th>
              <th className="py-1.5 pr-3 font-bold text-right">Versé scolarité</th>
              <th className="py-1.5 pr-3 font-bold text-right">Versé articles</th>
              <th className="py-1.5 pr-3 font-bold">Paiements prévus</th>
              <th className="py-1.5 pr-3 font-bold text-right">Arriéré</th>
              <th className="py-1.5 pr-3 font-bold text-right">Reste sur l&apos;année</th>
              <th className="py-1.5 font-bold">État</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {eleves.slice(0, 500).map((e) => (
              <tr key={`${e.feuille}-${e.ligne}`} className="align-top">
                <td className="py-1.5 pr-3 text-neutral-400 whitespace-nowrap">
                  {e.ligne}
                  <span className="block text-[10px]">{e.feuille}</span>
                </td>
                <td className="py-1.5 pr-3">
                  <p className="font-bold text-neutral-800">{`${e.prenom} ${e.nom}`.trim() || "—"}</p>
                  <p className="text-[11px] text-neutral-500">
                    {[
                      e.sexe,
                      e.dateNaissance && `né(e) le ${formatDate(e.dateNaissance)}`,
                      e.matriculeAncien && `matricule ${e.matriculeAncien}`,
                      e.statut !== "active" && `${LIBELLE_STATUT_INSCRIPTION[e.statut]}${e.dateDepart ? ` le ${formatDate(e.dateDepart)}` : ""}`,
                      e.reduction && `réduction ${formatFCFA(e.reduction)}/mois`,
                      e.options.length && `options : ${e.options.map((o) => (o.quantite ? `${o.libelle} ×${o.quantite}` : o.debut ? `${o.libelle} ${formatPeriode(o)}` : o.libelle)).join(", ")}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{e.classe || "—"}</td>
                <td className="py-1.5 pr-3">
                  <p>{e.parent || "—"}</p>
                  <p className="text-[11px] text-neutral-500">{e.telephone ?? ""}</p>
                </td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">{montant(e.totalScolarite)}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">{montant(e.totalArticles)}</td>
                <td className="py-1.5 pr-3 min-w-[170px]">
                  {e.repartition ? (
                    e.repartition.paiements.length === 0 ? (
                      <span className="text-neutral-400">Aucun</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-jang-700 font-bold">
                          {e.repartition.paiements.length} paiement{e.repartition.paiements.length > 1 ? "s" : ""}
                        </summary>
                        <ul className="mt-1 space-y-0.5 text-[11px] text-neutral-600">
                          {e.repartition.paiements.map((p, i) => (
                            <li key={i} className="flex justify-between gap-3">
                              <span>{p.libelle}</span>
                              <span className="whitespace-nowrap">{formatFCFA(p.montant)}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )
                  ) : (
                    "—"
                  )}
                </td>
                <td className={cn("py-1.5 pr-3 text-right whitespace-nowrap font-bold", e.repartition?.arriere ? "text-red-700" : "text-neutral-800")}>
                  {montant(e.repartition?.arriere ?? null)}
                </td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">{montant(e.repartition?.resteAnnee ?? null)}</td>
                <td className="py-1.5 min-w-[180px]">
                  {e.etat === "erreur" ? <Erreurs liste={e.erreurs} /> : <Badge ton={ETAT_ELEVE[e.etat].ton}>{ETAT_ELEVE[e.etat].libelle}</Badge>}
                  {e.avertissements.map((a, i) => (
                    <p key={i} className="text-[11px] text-amber-700 mt-1">{a}</p>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {eleves.length > 500 && (
          <p className="text-[11px] text-neutral-500 mt-2">500 premières lignes affichées sur {eleves.length}.</p>
        )}
      </div>
    )}
  </Carte>
  );
}

function Erreurs({ liste }: { liste: string[] }) {
  return (
    <ul className="text-[11px] text-red-700 space-y-0.5">
      {liste.map((e, i) => (
        <li key={i} className="flex gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {e}
        </li>
      ))}
    </ul>
  );
}
