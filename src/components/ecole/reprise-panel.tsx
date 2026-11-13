"use client";

// Onglet Importer : dépôt du fichier, aperçu (rien n'est enregistré), création des classes puis import des élèves par lots.
// Tableaux de l'aperçu : reprise-tableaux.tsx ; suivi de l'import : reprise-suivi.tsx.
import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Users } from "lucide-react";
import { formatFCFA } from "@/lib/utils";
import { Bouton, Carte, Kpi, Message } from "@/components/ui";
import type { ApercuReprise } from "@/lib/validation/reprise-validation";
import { cleDe, decouper, TAILLE_LOT } from "@/lib/metier/reprise-lots";
import { analyserFichierReprise, importerClassesReprise, importerLotReprise } from "@/app/ecole/actions/import";
import { CarteArticles, CarteClasses, CarteEleves, type Creation, type Filtre } from "./reprise-tableaux";
import { MODES_REPRISE, SuiviImport, type Avancement } from "./reprise-suivi";

export function ReprisePanel() {
  const [apercu, setApercu] = useState<ApercuReprise | null>(null);
  const [nomFichier, setNomFichier] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<Filtre>("tous");
  const [isPending, startTransition] = useTransition();
  const [creation, setCreation] = useState<Creation>(null);
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

          {(apercu.classes.length > 0 || creation) && <CarteClasses apercu={apercu} creation={creation} isPending={isPending} onCreer={creerClasses} />}
          {apercu.articles.length > 0 && <CarteArticles apercu={apercu} />}
          <CarteEleves apercu={apercu} filtre={filtre} setFiltre={setFiltre} />
        </>
      )}
    </>
  );
}
