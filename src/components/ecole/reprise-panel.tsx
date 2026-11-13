"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, School, Users } from "lucide-react";
import { cn, formatFCFA } from "@/lib/utils";
import { formatDate, formatPeriode } from "@/lib/dates";
import { LIBELLE_NIVEAU, LIBELLE_STATUT_INSCRIPTION } from "@/lib/libelles";
import { Badge, Bouton, Carte, Kpi, Message } from "@/components/ui";
import type { ApercuReprise, EleveApercu } from "@/lib/reprise-validation";
import { cleDe, decouper, TAILLE_LOT, type CleEleve, type RefusLigne } from "@/lib/reprise-lots";
import { analyserFichierReprise, importerClassesReprise, importerLotReprise, type ResultatClasses } from "@/app/ecole/actions/import";

type Filtre = "tous" | "erreur" | "a_creer" | "deja_present";

const ETAT_ELEVE: Record<EleveApercu["etat"], { libelle: string; ton: "vert" | "rouge" | "gris" }> = {
  a_creer: { libelle: "À créer", ton: "vert" },
  deja_present: { libelle: "Déjà présent", ton: "gris" },
  erreur: { libelle: "Erreur", ton: "rouge" },
};

const montant = (n: number | null) => (n === null ? "—" : formatFCFA(n));

const MODES_REPRISE = [
  ["especes", "Espèces"],
  ["virement", "Virement"],
  ["cheque", "Chèque"],
] as const;

/** Avancement de l'import des élèves ; conservé en entier si un lot échoue, pour reprendre sans rien perdre */
interface Avancement {
  lots: CleEleve[][];
  /** Index du prochain lot à envoyer */
  prochain: number;
  crees: number;
  ignores: number;
  montant: number;
  recus: number;
  refuses: RefusLigne[];
  /** Lignes du fichier laissées de côté (en erreur) au lancement */
  laissees: number;
  enCours: boolean;
  erreur: string | null;
  /** L'échec est survenu après l'envoi (coupure, réponse inattendue) : le lot a pu être écrit */
  incertain?: boolean;
}

export function ReprisePanel() {
  const [apercu, setApercu] = useState<ApercuReprise | null>(null);
  const [nomFichier, setNomFichier] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<Filtre>("tous");
  const [isPending, startTransition] = useTransition();
  const [creation, setCreation] = useState<{ message: string; data?: ResultatClasses; ok: boolean } | null>(null);
  const [avance, setAvance] = useState<Avancement | null>(null);
  const [laisseDeCote, setLaisseDeCote] = useState(false);
  const [mode, setMode] = useState<(typeof MODES_REPRISE)[number][0]>("especes");
  // Fichier analysé, renvoyé tel quel au serveur pour la création (le serveur le relit, il ne croit pas l'aperçu)
  const fichierRef = useRef<File | null>(null);
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
    setCreation(null);
    setAvance(null);
    setLaisseDeCote(false);
    startTransition(async () => {
      const r = await analyserFichierReprise(formData);
      if (!r.success || !r.data) setMessage(r.message ?? "Lecture du fichier impossible.");
      else {
        fichierRef.current = fichier;
        setApercu(r.data);
        setNomFichier(fichier.name);
        setFiltre(r.data.compteurs.erreurs > 0 ? "erreur" : "tous");
      }
    });
  }

  function creerClasses() {
    const fichier = fichierRef.current;
    if (!fichier || !apercu) return;
    const n = apercu.compteurs.classesNouvelles;
    if (!window.confirm(`${n > 1 ? `Créer ${n} classes avec leurs articles` : "Créer 1 classe avec ses articles"} dans FayJàng ? Les classes déjà présentes ne sont pas modifiées.`)) return;
    const formData = new FormData();
    formData.append("fichier", fichier);
    setCreation(null);
    startTransition(async () => {
      const r = await importerClassesReprise(formData);
      setCreation({ message: r.message ?? (r.success ? "Classes créées." : "Création impossible."), data: r.data, ok: r.success && !r.data?.echecs.length });
      if (!r.success) return;
      // Aperçu recalculé : les classes créées deviennent « déjà présentes » et leurs élèves sont chiffrés
      const a = await analyserFichierReprise(formData);
      if (a.success && a.data) setApercu(a.data);
    });
  }

  /** Envoie les lots un par un à partir de `depuis`. Un lot en échec arrête la boucle ; le compte rendu reste affiché. */
  async function importerLots(depart: Avancement) {
    const fichier = fichierRef.current;
    if (!fichier) return;
    let a: Avancement = { ...depart, enCours: true, erreur: null, incertain: false };
    setAvance(a);
    while (a.prochain < a.lots.length) {
      const formData = new FormData();
      formData.append("fichier", fichier);
      formData.append("mode", mode);
      formData.append("cles", JSON.stringify(a.lots[a.prochain]));
      try {
        const r = await importerLotReprise(formData);
        if (!r.success || !r.data) {
          a = { ...a, enCours: false, erreur: r.message ?? "Ce lot n'a pas pu être importé.", incertain: r.incertain === true };
          break;
        }
        a = {
          ...a,
          prochain: a.prochain + 1,
          crees: a.crees + r.data.crees,
          ignores: a.ignores + r.data.ignores,
          montant: a.montant + r.data.montant,
          recus: a.recus + r.data.recus,
          refuses: [...a.refuses, ...r.data.refuses],
        };
        setAvance(a);
      } catch {
        // Connexion coupée : le lot en cours a pu être écrit ou non, le rejeu ignore les élèves déjà créés
        a = { ...a, enCours: false, incertain: true, erreur: "Connexion interrompue pendant l'envoi. Cliquez sur « Reprendre » : les élèves déjà créés seront ignorés." };
        break;
      }
    }
    a = { ...a, enCours: false };
    setAvance(a);
    // Aperçu recalculé : les élèves créés deviennent « déjà présents »
    try {
      const formData = new FormData();
      formData.append("fichier", fichier);
      const n = await analyserFichierReprise(formData);
      if (n.success && n.data) setApercu(n.data);
    } catch {
      /* l'aperçu sera rafraîchi au prochain envoi du fichier */
    }
  }

  function lancerImport() {
    if (!apercu) return;
    const aCreer = apercu.eleves.filter((e) => e.etat === "a_creer");
    const n = aCreer.length;
    const erreurs = apercu.compteurs.erreurs;
    if (erreurs > 0 && !laisseDeCote) return;
    const libelleMode = MODES_REPRISE.find(([id]) => id === mode)?.[1].toLowerCase();
    if (
      !window.confirm(
        `Importer ${n} élève${n > 1 ? "s" : ""} dans FayJàng ? Chaque élève ayant déjà versé reçoit un reçu « Reprise de l'existant » (${libelleMode}). Les élèves déjà présents ne sont pas modifiés.`
      )
    ) {
      return;
    }
    void importerLots({
      lots: decouper(aCreer.map(cleDe), TAILLE_LOT),
      prochain: 0, crees: 0, ignores: 0, montant: 0, recus: 0, refuses: [], laissees: erreurs, enCours: true, erreur: null,
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
              Les montants ci-dessous sont calculés comme FayJàng les affichera après l&apos;import.
            </p>
          </Carte>

          {(avance || (apercu.erreursGlobales.length === 0 && apercu.compteurs.classesNouvelles === 0 && apercu.compteurs.aCreer > 0)) && (
            <Carte className="space-y-3">
              <h2 className="text-sm font-extrabold text-neutral-900">Importer les élèves</h2>
              {!avance && (
                <>
                  <p className="text-xs text-neutral-600">
                    {apercu.compteurs.aCreer} élève{apercu.compteurs.aCreer > 1 ? "s" : ""} seront créés par lots de {TAILLE_LOT}, avec leur parent, leur inscription,
                    leurs articles et un reçu « Reprise de l&apos;existant » pour ce qu&apos;ils ont déjà versé. Si l&apos;envoi s&apos;arrête, vous pourrez reprendre :
                    les élèves déjà créés sont ignorés.
                  </p>
                  <label className="block text-xs font-bold text-neutral-700">
                    Mode de paiement des reçus de reprise
                    <select
                      value={mode}
                      onChange={(e) => setMode(e.target.value as typeof mode)}
                      className="mt-1 block w-full sm:w-64 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-normal"
                    >
                      {MODES_REPRISE.map(([id, libelle]) => (
                        <option key={id} value={id}>
                          {libelle}
                        </option>
                      ))}
                    </select>
                    <span className="block text-[11px] font-normal text-neutral-500 mt-1">
                      Wave, Orange Money et Free Money ne sont pas proposés : ils exigent la référence de chaque transaction, qu&apos;un total repris n&apos;a pas.
                    </span>
                  </label>
                  {apercu.compteurs.erreurs > 0 && (
                    <label className="flex items-start gap-2 text-xs text-neutral-700">
                      <input type="checkbox" checked={laisseDeCote} onChange={(e) => setLaisseDeCote(e.target.checked)} className="mt-0.5" />
                      <span>
                        {apercu.compteurs.erreurs > 1 ? (
                          <>
                            Je laisse de côté les <b>{apercu.compteurs.erreurs}</b> lignes en erreur : elles ne seront pas importées.
                          </>
                        ) : (
                          <>Je laisse de côté la ligne en erreur : elle ne sera pas importée.</>
                        )}
                      </span>
                    </label>
                  )}
                  <Bouton onClick={lancerImport} disabled={isPending || (apercu.compteurs.erreurs > 0 && !laisseDeCote)}>
                    <Users className="w-4 h-4" /> Importer {apercu.compteurs.aCreer} élève{apercu.compteurs.aCreer > 1 ? "s" : ""}
                  </Bouton>
                </>
              )}
              {avance && <SuiviImport avance={avance} onReprendre={() => void importerLots(avance)} />}
            </Carte>
          )}

          {(apercu.classes.length > 0 || creation) && (
            <Carte className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold text-neutral-900">Classes ({apercu.classes.length})</h2>
                {apercu.compteurs.classesNouvelles > 0 && apercu.erreursGlobales.length === 0 && (
                  <Bouton onClick={creerClasses} disabled={isPending}>
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
        </>
      )}
    </>
  );
}

function SuiviImport({ avance, onReprendre }: { avance: Avancement; onReprendre: () => void }) {
  const total = avance.lots.length;
  const fini = avance.prochain >= total && !avance.erreur;
  const pct = total === 0 ? 100 : Math.round((avance.prochain / total) * 100);
  return (
    <div className="space-y-3">
      {!fini && (
        <div>
          <div className="flex justify-between text-[11px] text-neutral-600 mb-1">
            <span>
              Lot {Math.min(avance.prochain + (avance.enCours ? 1 : 0), total)} sur {total}
            </span>
            <span>{pct} %</span>
          </div>
          <div className="h-2 rounded-full bg-neutral-100 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-jang-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {avance.enCours && (
        <p className="text-xs text-neutral-600 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Import en cours, ne fermez pas cette page.
        </p>
      )}
      {avance.erreur && (
        <Message ok={false}>
          <p className="font-bold">
            {avance.incertain
              ? `Le lot ${avance.prochain + 1} sur ${total} n'a pas pu être confirmé.`
              : `Le lot ${avance.prochain + 1} sur ${total} n'a pas été importé.`}
          </p>
          <p>{avance.erreur}</p>
          <p className="mt-1">
            {avance.incertain
              ? "Ce lot a peut-être été enregistré. Vous pouvez reprendre sans risque : les élèves déjà créés seront ignorés, aucun reçu ne sera créé en double."
              : "Rien n'a été enregistré pour ce lot. Corrigez le problème, puis reprenez."}
          </p>
        </Message>
      )}
      {avance.erreur && !avance.enCours && (
        <Bouton onClick={onReprendre}>
          <Loader2 className="w-4 h-4" /> Reprendre
        </Bouton>
      )}
      {(fini || avance.erreur || avance.crees > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="Élèves créés" valeur={String(avance.crees)} ton="vert" />
          <Kpi label="Ignorés" valeur={String(avance.ignores)} detail="déjà présents" />
          <Kpi label="Total encaissé" valeur={formatFCFA(avance.montant)} detail={`${avance.recus} reçu${avance.recus > 1 ? "s" : ""} de reprise`} />
          <Kpi label="Laissées de côté" valeur={String(avance.laissees + avance.refuses.length)} detail="lignes non importées" ton={avance.laissees + avance.refuses.length ? "rouge" : undefined} />
        </div>
      )}
      {avance.refuses.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-bold text-red-700">{avance.refuses.length} ligne(s) refusée(s) au moment de l&apos;import</summary>
          <ul className="mt-1 space-y-0.5 text-[11px] text-red-700">
            {avance.refuses.slice(0, 100).map((r, i) => (
              <li key={i}>
                Ligne {r.ligne} : {r.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      {fini && <Message ok>Import terminé. Retrouvez les élèves dans l&apos;onglet « Élèves » de l&apos;Espace École.</Message>}
    </div>
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
