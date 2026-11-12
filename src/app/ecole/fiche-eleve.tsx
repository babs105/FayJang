"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Ban, ChevronDown, ChevronRight, Copy, FileText, MessageCircle, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { cn, formatFCFA } from "@/lib/utils";
import { formatDate, formatMois, formatMoisCourt } from "@/lib/dates";
import { LIBELLE_MODE, LIBELLE_STATUT_INSCRIPTION, MODES_PAIEMENT, libellePaiement } from "@/lib/libelles";
import { estRecuDeReprise } from "@/lib/reprise-recu";
import { regrouperParRecu, resumeRecu } from "@/lib/regrouper-recus";
import { lienWhatsApp, messageLienParent, messageRelance } from "@/lib/whatsapp";
import { Badge, Bouton, Label, Message, Modal, champ } from "@/components/ui";
import { cleAEnvoyer, signatureEncaissement, type TentativeEncaissement } from "@/lib/encaissement";
import { choixALinscription, lignesAEncaisser, paiementLibreAutorise, type LigneArticle, type StatutMois } from "@/lib/scolarite";
import type { StatutInscription } from "@/types/database";
import {
  ajouterArticleInscription,
  annulerPaiement,
  encaisserPaiement,
  modifierEleve,
  modifierInscription,
  regenererLienParent,
  retirerArticleInscription,
  supprimerEleve,
} from "./actions";
import { InscriptionModal } from "./eleves-panel";
import { MentionLectureSeule } from "./bandeau-abonnement";
import type { ClasseVue, EcoleVue, EleveVue, PaiementVue } from "./types";

const STYLE_MOIS: Record<StatutMois, string> = {
  paye: "bg-jang-50 border-jang-200 text-jang-700",
  partiel: "bg-amber-50 border-amber-200 text-amber-700",
  retard: "bg-red-50 border-red-200 text-red-700",
  a_venir: "bg-white border-neutral-200 text-neutral-500",
  non_du: "bg-neutral-50 border-neutral-100 text-neutral-300",
};

export function FicheEleve({
  eleve,
  ecole,
  classes,
  aujourdhui,
  paiements,
  lectureSeule,
  onClose,
}: {
  eleve: EleveVue;
  ecole: EcoleVue;
  classes: ClasseVue[];
  aujourdhui: string;
  paiements: PaiementVue[];
  /** Abonnement expiré ou suspendu : les gestes d'écriture hors argent sont retirés (encaisser et annuler : tranche 3) */
  lectureSeule: boolean;
  onClose: () => void;
}) {
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [inscriptionChoisie, setInscriptionChoisie] = useState(false);
  const [moisChoisis, setMoisChoisis] = useState<string[]>([]);
  const [articlesChoisis, setArticlesChoisis] = useState<string[]>([]);
  const [montant, setMontant] = useState("");
  const [mode, setMode] = useState("especes");
  const [reference, setReference] = useState("");
  const [libreCoche, setLibre] = useState(false);
  const [libelle, setLibelle] = useState("");
  const [inclureTranche, setInclureTranche] = useState(true);
  const [edition, setEdition] = useState(false);
  const [reinscription, setReinscription] = useState(false);
  const [statutChoisi, setStatutChoisi] = useState<StatutInscription>(eleve.inscription?.statut ?? "active");
  const [dateDepart, setDateDepart] = useState(eleve.inscription?.date_depart ?? aujourdhui);
  // Clé d'encaissement (idempotence) : une par formulaire, renouvelée selon cleAEnvoyer (succès, changement après refus)
  const cleEncaissement = useRef<string>(crypto.randomUUID());
  const derniereTentative = useRef<TentativeEncaissement | null>(null);
  // Posé de façon synchrone : isPending n'est pas encore à jour au second clic d'un double clic
  const envoiEnCours = useRef(false);
  const [recusOuverts, setRecusOuverts] = useState<Set<string>>(new Set());
  const recus = useMemo(() => regrouperParRecu(paiements), [paiements]);
  function basculerRecu(cle: string) {
    setRecusOuverts((prec) => {
      const suivant = new Set(prec);
      if (suivant.has(cle)) suivant.delete(cle);
      else suivant.add(cle);
      return suivant;
    });
  }
  const s = eleve.situation;
  const ins = eleve.inscription;
  // Élève parti : pas de paiement libre, même si la case était cochée avant le changement de statut
  const libre = libreCoche && (ins ? paiementLibreAutorise(ins.statut) : false);
  const classe = classes.find((c) => c.id === ins?.classe_id);

  function executer(action: () => Promise<{ success: boolean; message?: string }>, apres?: () => void) {
    setRetour(null);
    startTransition(async () => {
      const r = await action();
      setRetour({ ok: r.success, texte: r.message ?? (r.success ? "Enregistré." : "Opération impossible.") });
      if (r.success) apres?.();
    });
  }

  const basculer = (liste: string[], v: string) => (liste.includes(v) ? liste.filter((x) => x !== v) : [...liste, v]);
  function viderSelection() {
    setInscriptionChoisie(false);
    setMoisChoisis([]);
    setArticlesChoisis([]);
    setMontant("");
  }

  // Même calcul que le serveur (lignesAEncaisser) : lignes du reçu, tranche incluse, montant partiel
  const montantSaisi = montant.trim() ? Number(montant.replace(/\D/g, "")) : null;
  const rienChoisi = !inscriptionChoisie && moisChoisis.length === 0 && articlesChoisis.length === 0;
  const calcul =
    s && !libre && !rienChoisi
      ? lignesAEncaisser(s, {
          inscription: inscriptionChoisie,
          mois: moisChoisis,
          articles: articlesChoisis,
          montant: montantSaisi,
          inclure_tranche: inclureTranche,
        })
      : null;
  const apercu = calcul && "lignes" in calcul ? calcul : null;
  // La case « inclure la tranche » s'affiche dès qu'un mois choisi en porte une
  const trancheProposee =
    s && !libre && !montantSaisi && moisChoisis.length > 0
      ? lignesAEncaisser(s, { mois: moisChoisis, inclure_tranche: true })
      : null;
  const tranche = trancheProposee && "lignes" in trancheProposee ? trancheProposee.tranche : null;
  const totalSelection = libre ? montantSaisi ?? 0 : (apercu?.lignes.reduce((t, l) => t + l.montant, 0) ?? 0);
  const nbLignes = (inscriptionChoisie ? 1 : 0) + moisChoisis.length + articlesChoisis.length;
  const duInscription = s ? lignesAEncaisser(s, choixALinscription(s)) : null;
  const totalInscription = duInscription && "lignes" in duInscription ? duInscription.lignes.reduce((t, l) => t + l.montant, 0) : 0;

  function encaisser(e: React.FormEvent) {
    e.preventDefault();
    if (!ins || isPending || envoiEnCours.current) return;
    envoiEnCours.current = true;
    const contenu = libre
      ? { inscription_id: ins.id, mode, reference, libre: { libelle, montant } }
      : { inscription_id: ins.id, mode, reference, inscription: inscriptionChoisie, mois: moisChoisis, articles: articlesChoisis, montant, inclure_tranche: inclureTranche };
    const signature = signatureEncaissement(contenu);
    const cle = cleAEnvoyer(cleEncaissement.current, derniereTentative.current, signature, () => crypto.randomUUID());
    cleEncaissement.current = cle;
    setRetour(null);
    startTransition(async () => {
      try {
        const r = await encaisserPaiement({ ...contenu, cle });
        derniereTentative.current = { signature, issue: r.success ? "succes" : "echec_metier" };
        setRetour({ ok: r.success, texte: r.message ?? (r.success ? "Enregistré." : "Opération impossible.") });
        if (r.success) {
          cleEncaissement.current = crypto.randomUUID();
          derniereTentative.current = null;
          viderSelection();
          setReference("");
          setLibelle("");
          setLibre(false);
        }
      } catch {
        // Réponse perdue : l'encaissement a pu être enregistré. Renvoyer avec la même clé renvoie le même reçu sans doublon.
        derniereTentative.current = { signature, issue: "echec_reseau" };
        setRetour({
          ok: false,
          texte: "Connexion interrompue : on ne sait pas si l'encaissement a été enregistré. Cliquez de nouveau sur Encaisser : s'il l'est déjà, le même reçu sera confirmé sans doublon.",
        });
      } finally {
        envoiEnCours.current = false;
      }
    });
  }

  // Articles regroupés : frais uniques, puis un bloc par service mensuel
  const uniques = s?.articles.filter((a) => a.nature === "unique") ?? [];
  const services = new Map<string, LigneArticle[]>();
  for (const a of s?.articles ?? []) if (a.nature === "mensuel") services.set(a.article_id, [...(services.get(a.article_id) ?? []), a]);
  const optionsAjout = (classe?.articles ?? []).filter(
    (a) => a.nature === "unique" || ![...services.values()].some((l) => l[0]?.libelle.startsWith(a.libelle) && l.some((x) => x.reste > 0))
  );

  return (
    <Modal titre={`${eleve.prenom} ${eleve.nom}`} onClose={onClose} large>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
          <Badge ton="gris">Matricule {eleve.matricule}</Badge>
          {eleve.matricule_ancien && <Badge ton="gris">Ancien matricule {eleve.matricule_ancien}</Badge>}
          {ins ? (
            <>
              <Badge ton="bleu">{ins.classe_nom}</Badge>
              <Badge ton={ins.statut === "active" ? "vert" : "gris"}>{LIBELLE_STATUT_INSCRIPTION[ins.statut]}</Badge>
              {ins.reduction_mensuelle > 0 && <Badge ton="orange">Réduction {formatFCFA(ins.reduction_mensuelle)}/mois</Badge>}
            </>
          ) : (
            <Badge ton="orange">Pas inscrit en {ecole.annee_scolaire}</Badge>
          )}
          {eleve.derniere_modification && (
            <span className="text-neutral-500">Dernière modification : {formatDate(eleve.derniere_modification)}</span>
          )}
          {lectureSeule ? (
            <MentionLectureSeule className="ml-auto" />
          ) : (
            <button onClick={() => setEdition(true)} className="ml-auto flex items-center gap-1 font-bold text-neutral-600 hover:text-neutral-900">
              <Pencil className="w-3.5 h-3.5" /> Modifier la fiche
            </button>
          )}
          {paiements.length === 0 && !lectureSeule && (
            <button
              disabled={isPending}
              onClick={() =>
                confirm(`Supprimer définitivement ${eleve.prenom} ${eleve.nom} ? Cette action est irréversible.`) &&
                executer(() => supprimerEleve(eleve.id), onClose)
              }
              className="flex items-center gap-1 font-bold text-red-600 hover:text-red-700"
            >
              <Trash2 className="w-3.5 h-3.5" /> Supprimer
            </button>
          )}
        </div>

        {retour && <Message ok={retour.ok}>{retour.texte}</Message>}

        {!ins && (
          <div className="rounded-2xl border border-dashed border-neutral-300 p-4 text-center">
            <p className="text-xs text-neutral-600 mb-3">Cet élève n'a pas encore d'inscription pour {ecole.annee_scolaire}.</p>
            {lectureSeule ? (
              <MentionLectureSeule />
            ) : (
              <Bouton onClick={() => setReinscription(true)}>Réinscrire pour {ecole.annee_scolaire}</Bouton>
            )}
          </div>
        )}

        {ins && s && (
          <>
            {ins.statut !== "active" && (
              <div
                className={cn(
                  "rounded-xl border p-2.5 text-[11px]",
                  ins.date_depart ? "bg-neutral-50 border-neutral-200 text-neutral-700" : "bg-amber-50 border-amber-200 text-amber-800"
                )}
              >
                {ins.date_depart ? (
                  <>Parti le <b>{formatDate(ins.date_depart)}</b> : les mensualités sont dues jusqu'à {formatMois(ins.date_depart)} inclus.</>
                ) : (
                  <><b>Date de départ manquante</b> : indiquez-la ci-dessous pour calculer ce que doit cet élève.</>
                )}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <Resume label="Payé" valeur={formatFCFA(s.totalPaye)} ton="vert" />
              <Resume label="Arriéré" valeur={formatFCFA(s.arriere)} ton={s.arriere > 0 ? "rouge" : undefined} />
              <Resume label="Reste sur l'année" valeur={formatFCFA(s.resteAnnee)} />
            </div>

            {totalInscription > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 border border-amber-200 p-2.5">
                <p className="text-[11px] text-amber-800">
                  Reste dû à l'inscription : <b>{formatFCFA(totalInscription)}</b>
                </p>
                <Bouton
                  type="button"
                  variante="secondaire"
                  onClick={() => {
                    const c = choixALinscription(s);
                    setLibre(false);
                    setMontant("");
                    setInscriptionChoisie(!!c.inscription);
                    setMoisChoisis(c.mois ?? []);
                    setArticlesChoisis(c.articles ?? []);
                  }}
                >
                  Tout le dû à l'inscription
                </Bouton>
              </div>
            )}

            <div>
              <p className="text-xs font-bold text-neutral-700 mb-2">
                Mensualités {formatFCFA(Math.max(0, ins.mensualite - ins.reduction_mensuelle))} · échéance le {ecole.jour_echeance} du mois
                <span className="font-normal text-neutral-500"> — touchez ce qu'il faut encaisser</span>
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                <button
                  type="button"
                  disabled={s.inscriptionPayee >= s.inscriptionDue}
                  onClick={() => {
                    setLibre(false);
                    setInscriptionChoisie(!inscriptionChoisie);
                  }}
                  className={cn(
                    "rounded-xl border px-2 py-2 text-center transition",
                    s.inscriptionPayee >= s.inscriptionDue ? STYLE_MOIS.paye : s.inscriptionPayee > 0 ? STYLE_MOIS.partiel : STYLE_MOIS.retard,
                    inscriptionChoisie && "ring-2 ring-jang-600 ring-offset-1"
                  )}
                >
                  <p className="text-[11px] font-bold">Inscription</p>
                  <p className="text-[10px]">{formatFCFA(s.inscriptionPayee)} / {formatFCFA(s.inscriptionDue)}</p>
                </button>
                {s.mois.map((m) => {
                  const choisi = moisChoisis.includes(m.mois);
                  const payable = m.reste > 0;
                  return (
                    <button
                      key={m.mois}
                      type="button"
                      disabled={!payable}
                      onClick={() => {
                        setLibre(false);
                        setMoisChoisis(basculer(moisChoisis, m.mois));
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
                          disabled={a.reste === 0}
                          onClick={() => {
                            setLibre(false);
                            setArticlesChoisis(basculer(articlesChoisis, a.cle));
                          }}
                          className={cn(
                            "w-full rounded-xl border px-2 py-2 text-left transition",
                            STYLE_MOIS[a.statut],
                            articlesChoisis.includes(a.cle) && "ring-2 ring-jang-600 ring-offset-1"
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
                            disabled={l.reste === 0}
                            onClick={() => {
                              setLibre(false);
                              setArticlesChoisis(basculer(articlesChoisis, l.cle));
                            }}
                            className={cn(
                              "rounded-lg border px-1 py-1.5 text-center",
                              STYLE_MOIS[l.statut],
                              articlesChoisis.includes(l.cle) && "ring-2 ring-jang-600 ring-offset-1"
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

            <form onSubmit={encaisser} className="rounded-2xl bg-neutral-50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-extrabold text-neutral-900">Encaisser un paiement</p>
                {paiementLibreAutorise(ins.statut) && (
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-600">
                  <input
                    type="checkbox"
                    checked={libreCoche}
                    onChange={(e) => {
                      setLibre(e.target.checked);
                      if (e.target.checked) viderSelection();
                    }}
                  />
                  Paiement libre (hors catalogue)
                </label>
                )}
              </div>
              {(() => {
                const cible = s.mois.find((m) => m.tranches && m.reste > 0);
                if (!cible?.tranches || libre) return null;
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
                        viderSelection();
                        setMoisChoisis([cible.mois]);
                        setMontant(String(t.suggestion));
                      }}
                    >
                      Payer la tranche ({formatFCFA(t.suggestion)})
                    </Bouton>
                  </div>
                );
              })()}

              {libre ? (
                <div className="grid sm:grid-cols-3 gap-2">
                  <div className="sm:col-span-2">
                    <Label>Objet</Label>
                    <input value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="Sortie scolaire, fournitures..." className={champ} />
                  </div>
                  <div>
                    <Label>Montant</Label>
                    <input inputMode="numeric" value={montant} onChange={(e) => setMontant(e.target.value)} placeholder="FCFA" className={champ} />
                  </div>
                </div>
              ) : (
                <div className="text-xs text-neutral-600 space-y-1.5">
                  {rienChoisi ? (
                    <p>Touchez l'inscription, des mois ou des articles ci-dessus.</p>
                  ) : calcul && "erreur" in calcul ? (
                    <p className="text-red-600 font-bold">{calcul.erreur}</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {apercu?.lignes.map((l, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span>{l.libelle ?? (l.type === "inscription" ? "Frais d'inscription" : `Mensualité de ${formatMois(l.mois!)}`)}</span>
                          <span className="font-bold">{formatFCFA(l.montant)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {tranche && (
                    <label className="flex items-center gap-1.5 font-bold text-jang-700">
                      <input type="checkbox" checked={inclureTranche} onChange={(e) => setInclureTranche(e.target.checked)} />
                      Inclure la {tranche.libelle.charAt(0).toLowerCase() + tranche.libelle.slice(1)} (+{formatFCFA(tranche.montant)})
                    </label>
                  )}
                  <div className="sm:w-1/3">
                    <Label>Montant (vide = reste dû)</Label>
                    <input
                      inputMode="numeric"
                      value={montant}
                      onChange={(e) => setMontant(e.target.value)}
                      disabled={nbLignes > 1}
                      placeholder={nbLignes > 1 ? "Une seule ligne" : "Paiement partiel"}
                      className={champ}
                    />
                  </div>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-2">
                <div>
                  <Label>Mode</Label>
                  <select value={mode} onChange={(e) => setMode(e.target.value)} className={champ}>
                    {MODES_PAIEMENT.map((m) => (
                      <option key={m} value={m}>{LIBELLE_MODE[m]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Référence {mode === "especes" ? "(facultatif)" : ""}</Label>
                  <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="ex : n° de transaction" className={champ} />
                </div>
              </div>
              <Bouton type="submit" disabled={isPending || (libre ? !totalSelection || !libelle.trim() : !apercu)} className="w-full">
                {isPending ? "Enregistrement..." : `Encaisser ${totalSelection > 0 ? formatFCFA(totalSelection) : ""}`}
              </Bouton>
            </form>

            {!lectureSeule && (
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
            )}
          </>
        )}

        {eleve.parent && (
          <div className="rounded-2xl border border-neutral-200 p-4 space-y-2">
            <p className="text-xs font-extrabold">Parent : {eleve.parent.nom} · {eleve.parent.telephone}</p>
            <div className="flex flex-wrap gap-2">
              <a
                href={lienWhatsApp(eleve.parent.telephone, messageLienParent({ ecole: ecole.nom, parent: eleve.parent.nom, lienParent: eleve.parent.lien }))}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#25D366] text-white text-xs font-bold"
              >
                <MessageCircle className="w-4 h-4" /> Envoyer le lien parent
              </a>
              {s && s.arriere > 0 && (
                <a
                  href={lienWhatsApp(
                    eleve.parent.telephone,
                    messageRelance({ ecole: ecole.nom, parent: eleve.parent.nom, eleve: eleve.prenom, arriere: s.arriere, moisEnRetard: s.moisEnRetard, lienParent: eleve.parent.lien, dateDepart: ins?.statut !== "active" ? ins?.date_depart : null })
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold"
                >
                  <MessageCircle className="w-4 h-4" /> Relancer ({formatFCFA(s.arriere)})
                </a>
              )}
              <Bouton variante="secondaire" onClick={() => navigator.clipboard?.writeText(eleve.parent!.lien)}>
                <Copy className="w-4 h-4" /> Copier le lien
              </Bouton>
              <Bouton
                variante="secondaire"
                onClick={() => confirm("Créer un nouveau lien ? L'ancien ne fonctionnera plus.") && executer(() => regenererLienParent(eleve.parent!.id))}
              >
                <RefreshCw className="w-4 h-4" /> Nouveau lien
              </Bouton>
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-extrabold mb-2">Historique des paiements ({ecole.annee_scolaire})</p>
          {paiements.length === 0 ? (
            <p className="text-xs text-neutral-500">Aucun paiement.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 border border-neutral-100 rounded-2xl">
              {recus.map((r) => {
                const p = r.premiere;
                const detail = r.lignes.length > 1;
                const ouvert = recusOuverts.has(r.cle);
                return (
                  <li key={r.cle} className={cn(r.annule && "opacity-60")}>
                    <div className="px-3 py-2.5 flex items-center gap-3">
                      <div
                        className={cn("flex-1 min-w-0", detail && "cursor-pointer")}
                        onClick={detail ? () => basculerRecu(r.cle) : undefined}
                      >
                        <p className={cn("text-xs font-bold flex items-center gap-1", r.annule && "line-through")}>
                          {detail && (ouvert ? <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />)}
                          <span>
                            {resumeRecu(r.lignes)}
                            {" · "}
                            {formatFCFA(r.annule ? r.totalBrut : r.total)}
                          </span>
                        </p>
                        <p className="text-[11px] text-neutral-500">
                          {p.numero_recu} · {formatDate(p.paye_le)} · {LIBELLE_MODE[p.mode]}
                          {p.reference ? ` (${p.reference})` : ""}
                          {estRecuDeReprise(p.encaisse_par) && <> · <Badge ton="bleu">Reprise de l'existant</Badge></>}
                          {r.annule && <> · <Badge ton="rouge">Annulé</Badge>{r.motif_annulation ? ` ${r.motif_annulation}` : ""}</>}
                        </p>
                      </div>
                      <a href={`/ecole/recu/${p.id}`} target="_blank" className="p-1.5 rounded-lg hover:bg-neutral-100" title="Reçu PDF">
                        <FileText className="w-4 h-4 text-neutral-600" />
                      </a>
                      {!r.annule && (
                        <button
                          title="Annuler ce reçu"
                          className="p-1.5 rounded-lg hover:bg-red-50"
                          onClick={() => {
                            const nb = r.lignes.filter((l) => !l.annule).length;
                            const motif = prompt(
                              `Annuler le reçu ${p.numero_recu} ? Total annulé : ${formatFCFA(r.total)} (${nb} ligne${nb > 1 ? "s" : ""}). Le reçu entier sera annulé.\n\nMotif de l'annulation (obligatoire : erreur de saisie, chèque rejeté...) :`
                            );
                            if (motif?.trim()) executer(() => annulerPaiement(p.id, motif.trim()));
                          }}
                        >
                          <Ban className="w-4 h-4 text-red-500" />
                        </button>
                      )}
                    </div>
                    {detail && ouvert && (
                      <ul className="bg-neutral-50/60 px-3 pb-2 space-y-0.5">
                        {r.lignes.map((l) => (
                          <li key={l.id} className={cn("flex justify-between text-[11px] text-neutral-600 pl-5", l.annule && "opacity-60 line-through")}>
                            <span>{libellePaiement(l)}</span>
                            <span>{formatFCFA(l.montant)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {edition && !lectureSeule && <EditionEleve eleve={eleve} onClose={() => setEdition(false)} />}
      {reinscription && !lectureSeule && (
        <InscriptionModal classes={classes} ecole={ecole} eleve={eleve} onClose={() => setReinscription(false)} onInscrit={() => setReinscription(false)} />
      )}
    </Modal>
  );
}

function Resume({ label, valeur, ton }: { label: string; valeur: string; ton?: "vert" | "rouge" }) {
  return (
    <div className="rounded-2xl bg-neutral-50 p-3">
      <p className="text-[11px] text-neutral-500">{label}</p>
      <p className={cn("text-sm font-extrabold", ton === "vert" && "text-jang-700", ton === "rouge" && "text-red-600")}>{valeur}</p>
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

function EditionEleve({ eleve, onClose }: { eleve: EleveVue; onClose: () => void }) {
  const [f, setF] = useState({
    prenom: eleve.prenom,
    nom: eleve.nom,
    sexe: eleve.sexe ?? "",
    date_naissance: eleve.date_naissance ?? "",
    parent_nom: eleve.parent?.nom ?? "",
    parent_telephone: eleve.parent?.telephone ?? "",
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const maj = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal titre="Modifier la fiche" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await modifierEleve(eleve.id, f);
            if (r.success) onClose();
            else setErreur(r.message ?? "Modification impossible.");
          });
        }}
      >
        {erreur && <Message ok={false}>{erreur}</Message>}
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Prénom</Label><input value={f.prenom} onChange={maj("prenom")} className={champ} /></div>
          <div><Label>Nom</Label><input value={f.nom} onChange={maj("nom")} className={champ} /></div>
          <div>
            <Label>Sexe</Label>
            <select value={f.sexe} onChange={maj("sexe")} className={champ}>
              <option value="">—</option><option value="F">Fille</option><option value="M">Garçon</option>
            </select>
          </div>
          <div><Label>Date de naissance</Label><input type="date" value={f.date_naissance} onChange={maj("date_naissance")} className={champ} /></div>
          <div><Label>Parent</Label><input value={f.parent_nom} onChange={maj("parent_nom")} className={champ} /></div>
          <div><Label>Téléphone</Label><input value={f.parent_telephone} onChange={maj("parent_telephone")} className={champ} /></div>
        </div>
        <Bouton type="submit" disabled={isPending} className="w-full">{isPending ? "Enregistrement..." : "Enregistrer"}</Bouton>
      </form>
    </Modal>
  );
}
