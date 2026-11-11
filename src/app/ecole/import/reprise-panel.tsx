"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { cn, formatFCFA } from "@/lib/utils";
import { formatDate, formatMois } from "@/lib/dates";
import { LIBELLE_NIVEAU, LIBELLE_STATUT_INSCRIPTION } from "@/lib/libelles";
import { Badge, Bouton, Carte, Kpi, Message } from "@/components/ui";
import type { ApercuReprise, EleveApercu } from "@/lib/reprise-validation";
import { analyserFichierReprise } from "./actions";

type Filtre = "tous" | "erreur" | "a_creer" | "deja_present";

const ETAT_ELEVE: Record<EleveApercu["etat"], { libelle: string; ton: "vert" | "rouge" | "gris" }> = {
  a_creer: { libelle: "À créer", ton: "vert" },
  deja_present: { libelle: "Déjà présent", ton: "gris" },
  erreur: { libelle: "Erreur", ton: "rouge" },
};

const montant = (n: number | null) => (n === null ? "—" : formatFCFA(n));

export function ReprisePanel() {
  const [apercu, setApercu] = useState<ApercuReprise | null>(null);
  const [nomFichier, setNomFichier] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<Filtre>("tous");
  const [isPending, startTransition] = useTransition();
  // Avant le chargement de React, un envoi partirait en GET classique (nom du fichier dans l'URL, rien d'analysé)
  const [pret, setPret] = useState(false);
  useEffect(() => setPret(true), []);

  function analyser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const fichier = formData.get("fichier");
    if (!(fichier instanceof File) || fichier.size === 0) {
      setMessage("Choisissez un fichier Excel (.xlsx).");
      return;
    }
    setMessage(null);
    setApercu(null);
    startTransition(async () => {
      const r = await analyserFichierReprise(formData);
      if (!r.success || !r.data) setMessage(r.message ?? "Lecture du fichier impossible.");
      else {
        setApercu(r.data);
        setNomFichier(fichier.name);
        setFiltre(r.data.compteurs.erreurs > 0 ? "erreur" : "tous");
      }
    });
  }

  const eleves = useMemo(
    () => (apercu ? apercu.eleves.filter((e) => filtre === "tous" || e.etat === filtre) : []),
    [apercu, filtre]
  );

  return (
    <>
      <Carte className="space-y-4">
        <div>
          <h1 className="text-base font-extrabold text-neutral-900">Importer les élèves d&apos;une école existante</h1>
          <p className="text-xs text-neutral-600 mt-1">
            Remplissez le modèle Excel (une ligne par élève, avec ce qu&apos;il a déjà versé), puis déposez-le ici. FayJàng
            vérifie chaque ligne et affiche un aperçu : <b>rien n&apos;est enregistré à cette étape</b>.
          </p>
        </div>
        <ol className="text-xs text-neutral-600 space-y-1 list-decimal list-inside">
          <li>Vérifiez vos <b>Paramètres</b> (année, mois de rentrée, mensualités, tranches) : la répartition des montants en dépend.</li>
          <li>Téléchargez le modèle, lisez la feuille « Lisez-moi » et effacez les lignes d&apos;exemple.</li>
          <li>Déposez le fichier, corrigez les erreurs signalées dans Excel et déposez-le de nouveau.</li>
        </ol>
        <div className="flex flex-col sm:flex-row gap-2">
          <a
            href="/modele-import-ecole.xlsx"
            download
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-800"
          >
            <Download className="w-4 h-4" /> Télécharger le modèle
          </a>
          <form method="post" encType="multipart/form-data" onSubmit={analyser} className="flex flex-col sm:flex-row gap-2 flex-1">
            <label className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 text-xs text-neutral-600 cursor-pointer hover:bg-neutral-100 min-w-0">
              <FileSpreadsheet className="w-4 h-4 shrink-0 text-jang-600" />
              <input
                type="file"
                name="fichier"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="text-xs min-w-0 w-full file:mr-2 file:px-2 file:py-1 file:rounded-lg file:border-0 file:bg-white file:text-xs file:font-bold"
              />
            </label>
            <Bouton type="submit" disabled={isPending || !pret}>
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {isPending ? "Vérification…" : "Vérifier le fichier"}
            </Bouton>
          </form>
        </div>
        {message && <Message ok={false}>{message}</Message>}
      </Carte>

      {apercu && (
        <>
          <Carte className="space-y-3">
            <p className="text-xs text-neutral-500">
              Aperçu de <b className="text-neutral-800">{nomFichier}</b>. Aucune donnée n&apos;a été enregistrée.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi label="Élèves à créer" valeur={String(apercu.compteurs.aCreer)} detail={`${apercu.compteurs.parents} parent(s)`} ton="vert" />
              <Kpi label="Déjà présents" valeur={String(apercu.compteurs.dejaPresents)} detail="ignorés" />
              <Kpi label="Lignes en erreur" valeur={String(apercu.compteurs.erreurs)} ton={apercu.compteurs.erreurs ? "rouge" : undefined} />
              <Kpi label="Classes à créer" valeur={String(apercu.compteurs.classesNouvelles)} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Kpi
                label="Arriéré total de l'école"
                valeur={formatFCFA(apercu.totaux.arriere)}
                detail="à comparer à votre cahier de caisse"
                ton={apercu.totaux.arriere ? "rouge" : "vert"}
              />
              <Kpi label="Reste sur l'année" valeur={formatFCFA(apercu.totaux.resteAnnee)} detail="élèves à créer" />
              <Kpi label="Déjà versé" valeur={formatFCFA(apercu.totaux.verse)} detail="élèves à créer" />
            </div>
            {apercu.erreursGlobales.length > 0 && (
              <Message ok={false}>
                <p className="font-bold mb-1">Le fichier ne peut pas être importé :</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {apercu.erreursGlobales.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </Message>
            )}
            {apercu.avertissements.length > 0 && (
              <div className="p-3 rounded-2xl text-xs border bg-amber-50 border-amber-200 text-amber-800 space-y-0.5">
                {apercu.avertissements.map((a, i) => (
                  <p key={i} className="flex gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {a}
                  </p>
                ))}
              </div>
            )}
            <p className="text-[11px] text-neutral-500">
              Les montants ci-dessous sont calculés comme FayJàng les affichera après l&apos;import. Prochaine étape (bientôt) : l&apos;import lui-même.
            </p>
          </Carte>

          {apercu.classes.length > 0 && (
            <Carte className="space-y-2">
              <h2 className="text-sm font-extrabold text-neutral-900">Classes ({apercu.classes.length})</h2>
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
          )}

          {apercu.articles.length > 0 && (
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
          )}

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
                              e.options.length && `options : ${e.options.map((o) => (o.quantite ? `${o.libelle} ×${o.quantite}` : o.debut ? `${o.libelle} dès ${formatMois(o.debut)}` : o.libelle)).join(", ")}`,
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
        </>
      )}
    </>
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
