"use client";

import { useState, useTransition } from "react";
import { Ban, Copy, FileText, MessageCircle, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { cn, formatFCFA } from "@/lib/utils";
import { formatDate, formatMois, formatMoisCourt } from "@/lib/dates";
import { LIBELLE_MODE, LIBELLE_STATUT_INSCRIPTION, MODES_PAIEMENT, libellePaiement } from "@/lib/libelles";
import { lienWhatsApp, messageLienParent, messageRelance } from "@/lib/whatsapp";
import { Badge, Bouton, Label, Message, Modal, champ } from "@/components/ui";
import { trancheAvecMois, type StatutMois } from "@/lib/scolarite";
import type { StatutInscription, TypePaiement } from "@/types/database";
import { annulerPaiement, encaisserPaiement, modifierEleve, modifierInscription, regenererLienParent, supprimerEleve } from "./actions";
import { InscriptionModal } from "./eleves-panel";
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
  paiements,
  onClose,
}: {
  eleve: EleveVue;
  ecole: EcoleVue;
  classes: ClasseVue[];
  paiements: PaiementVue[];
  onClose: () => void;
}) {
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<TypePaiement>("mensualite");
  const [moisChoisis, setMoisChoisis] = useState<string[]>([]);
  const [montant, setMontant] = useState("");
  const [mode, setMode] = useState("especes");
  const [reference, setReference] = useState("");
  const [libelle, setLibelle] = useState("");
  const [inclureTranche, setInclureTranche] = useState(true);
  const [edition, setEdition] = useState(false);
  const [reinscription, setReinscription] = useState(false);
  const s = eleve.situation;
  const ins = eleve.inscription;

  function executer(action: () => Promise<{ success: boolean; message?: string }>, apres?: () => void) {
    setRetour(null);
    startTransition(async () => {
      const r = await action();
      setRetour({ ok: r.success, texte: r.message ?? (r.success ? "Enregistré." : "Opération impossible.") });
      if (r.success) apres?.();
    });
  }

  function basculerMois(m: string) {
    setMoisChoisis((l) => (l.includes(m) ? l.filter((x) => x !== m) : [...l, m]));
  }

  // Même calcul que le serveur : la tranche du dernier mois due avec les mois choisis, sur le même reçu
  const trancheIncluse =
    type === "mensualite" && !montant && s
      ? trancheAvecMois(s, moisChoisis.filter((m) => (s.mois.find((l) => l.mois === m)?.reste ?? 0) > 0))
      : null;
  const totalSelection =
    type === "mensualite"
      ? montant
        ? Number(montant.replace(/\D/g, ""))
        : moisChoisis.reduce((t, m) => t + (s?.mois.find((l) => l.mois === m)?.reste ?? 0), 0) +
          (trancheIncluse && inclureTranche ? trancheIncluse.montant : 0)
      : type === "inscription"
        ? montant
          ? Number(montant.replace(/\D/g, ""))
          : Math.max(0, (s?.inscriptionDue ?? 0) - (s?.inscriptionPayee ?? 0))
        : Number(montant.replace(/\D/g, "")) || 0;

  function encaisser(e: React.FormEvent) {
    e.preventDefault();
    if (!ins) return;
    executer(
      () => encaisserPaiement({ inscription_id: ins.id, type, mois: moisChoisis, montant, mode, reference, libelle, inclure_tranche: inclureTranche }),
      () => {
        setMoisChoisis([]);
        setMontant("");
        setReference("");
        setLibelle("");
      }
    );
  }

  return (
    <Modal titre={`${eleve.prenom} ${eleve.nom}`} onClose={onClose} large>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
          <Badge ton="gris">Matricule {eleve.matricule}</Badge>
          {ins ? (
            <>
              <Badge ton="bleu">{ins.classe_nom}</Badge>
              <Badge ton={ins.statut === "active" ? "vert" : "gris"}>{LIBELLE_STATUT_INSCRIPTION[ins.statut]}</Badge>
              {ins.reduction_mensuelle > 0 && <Badge ton="orange">Réduction {formatFCFA(ins.reduction_mensuelle)}/mois</Badge>}
            </>
          ) : (
            <Badge ton="orange">Pas inscrit en {ecole.annee_scolaire}</Badge>
          )}
          <button onClick={() => setEdition(true)} className="ml-auto flex items-center gap-1 font-bold text-neutral-600 hover:text-neutral-900">
            <Pencil className="w-3.5 h-3.5" /> Modifier la fiche
          </button>
          {paiements.length === 0 && (
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
            <Bouton onClick={() => setReinscription(true)}>Réinscrire pour {ecole.annee_scolaire}</Bouton>
          </div>
        )}

        {ins && s && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Resume label="Payé" valeur={formatFCFA(s.totalPaye)} ton="vert" />
              <Resume label="Arriéré" valeur={formatFCFA(s.arriere)} ton={s.arriere > 0 ? "rouge" : undefined} />
              <Resume label="Reste sur l'année" valeur={formatFCFA(s.resteAnnee)} />
            </div>

            <div>
              <p className="text-xs font-bold text-neutral-700 mb-2">
                Mensualités {formatFCFA(Math.max(0, ins.mensualite - ins.reduction_mensuelle))} · échéance le {ecole.jour_echeance} du mois
                <span className="font-normal text-neutral-500"> — touchez les mois à encaisser</span>
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                <div className={cn("rounded-xl border px-2 py-2 text-center", s.inscriptionPayee >= s.inscriptionDue ? STYLE_MOIS.paye : s.inscriptionPayee > 0 ? STYLE_MOIS.partiel : STYLE_MOIS.retard)}>
                  <p className="text-[11px] font-bold">Inscription</p>
                  <p className="text-[10px]">{formatFCFA(s.inscriptionPayee)} / {formatFCFA(s.inscriptionDue)}</p>
                </div>
                {s.mois.map((m) => {
                  const choisi = moisChoisis.includes(m.mois);
                  const payable = m.reste > 0;
                  return (
                    <button
                      key={m.mois}
                      type="button"
                      disabled={!payable}
                      onClick={() => {
                        setType("mensualite");
                        basculerMois(m.mois);
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

            <form onSubmit={encaisser} className="rounded-2xl bg-neutral-50 p-4 space-y-3">
              <p className="text-xs font-extrabold text-neutral-900">Encaisser un paiement</p>
              {(() => {
                const dernier = s.mois.find((m) => m.tranches && m.reste > 0);
                if (!dernier?.tranches) return null;
                const t = dernier.tranches;
                return (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white border border-jang-100 p-2.5">
                    <p className="text-[11px] text-neutral-700">
                      <b className="capitalize">{formatMois(dernier.mois)}</b> payé par tranches de {formatFCFA(t.montant)} :{" "}
                      {formatFCFA(dernier.paye)} versés sur {formatFCFA(dernier.du)}
                      {dernier.resteEchu > 0 ? (
                        <span className="text-red-600 font-bold"> · {formatFCFA(dernier.resteEchu)} en retard</span>
                      ) : t.prochaine ? (
                        <span className="text-neutral-500"> · prochaine échéance le {formatDate(t.prochaine)}</span>
                      ) : null}
                    </p>
                    <Bouton
                      type="button"
                      variante="secondaire"
                      onClick={() => {
                        setType("mensualite");
                        setMoisChoisis([dernier.mois]);
                        setMontant(String(t.suggestion));
                      }}
                    >
                      Payer la tranche ({formatFCFA(t.suggestion)})
                    </Bouton>
                  </div>
                );
              })()}
              <div className="grid sm:grid-cols-3 gap-2">
                <div>
                  <Label>Objet</Label>
                  <select value={type} onChange={(e) => setType(e.target.value as TypePaiement)} className={champ}>
                    <option value="mensualite">Mensualité(s)</option>
                    <option value="inscription">Frais d'inscription</option>
                    <option value="autre">Autre (tenue, transport...)</option>
                  </select>
                </div>
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
              <div className="grid sm:grid-cols-3 gap-2">
                {type === "autre" && (
                  <div className="sm:col-span-2">
                    <Label>Libellé</Label>
                    <input value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="Tenue scolaire" className={champ} />
                  </div>
                )}
                {type === "mensualite" && (
                  <div className="sm:col-span-2 text-xs text-neutral-600 self-end pb-2">
                    {moisChoisis.length === 0
                      ? "Sélectionnez un ou plusieurs mois ci-dessus."
                      : `Mois : ${[...moisChoisis].sort().map(formatMois).join(", ")}`}
                    {trancheIncluse && (
                      <label className="mt-1.5 flex items-center gap-1.5 font-bold text-jang-700">
                        <input type="checkbox" checked={inclureTranche} onChange={(e) => setInclureTranche(e.target.checked)} />
                        Inclure la {trancheIncluse.libelle.charAt(0).toLowerCase() + trancheIncluse.libelle.slice(1)} (+{formatFCFA(trancheIncluse.montant)})
                      </label>
                    )}
                  </div>
                )}
                {type === "inscription" && <div className="sm:col-span-2" />}
                <div>
                  <Label>Montant {type !== "autre" ? "(vide = reste dû)" : ""}</Label>
                  <input
                    inputMode="numeric"
                    value={montant}
                    onChange={(e) => setMontant(e.target.value)}
                    disabled={type === "mensualite" && moisChoisis.length > 1}
                    placeholder={type === "autre" ? "FCFA" : "Paiement partiel"}
                    className={champ}
                  />
                </div>
              </div>
              <Bouton type="submit" disabled={isPending || (type === "mensualite" && moisChoisis.length === 0)} className="w-full">
                {isPending ? "Enregistrement..." : `Encaisser ${totalSelection > 0 ? formatFCFA(totalSelection) : ""}`}
              </Bouton>
            </form>

            <div className="flex flex-wrap gap-2 text-xs">
              <select
                value={ins.statut}
                onChange={(e) => executer(() => modifierInscription(ins.id, { statut: e.target.value as StatutInscription }))}
                className={`${champ} w-auto`}
              >
                <option value="active">Inscrit</option>
                <option value="abandon">Abandon</option>
                <option value="transfert">Transféré</option>
              </select>
              <ReductionEditable valeur={ins.reduction_mensuelle} onSave={(v) => executer(() => modifierInscription(ins.id, { reduction_mensuelle: v }))} />
            </div>
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
                    messageRelance({ ecole: ecole.nom, parent: eleve.parent.nom, eleve: eleve.prenom, arriere: s.arriere, moisEnRetard: s.moisEnRetard, lienParent: eleve.parent.lien })
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
              {paiements.map((p) => (
                <li key={p.id} className={cn("px-3 py-2.5 flex items-center gap-3", p.annule && "opacity-60")}>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-xs font-bold", p.annule && "line-through")}>
                      {libellePaiement(p)}
                      {" · "}
                      {formatFCFA(p.montant)}
                    </p>
                    <p className="text-[11px] text-neutral-500">
                      {p.numero_recu} · {formatDate(p.paye_le)} · {LIBELLE_MODE[p.mode]}
                      {p.reference ? ` (${p.reference})` : ""}
                      {p.annule && ` · annulé : ${p.motif_annulation}`}
                    </p>
                  </div>
                  <a href={`/ecole/recu/${p.id}`} target="_blank" className="p-1.5 rounded-lg hover:bg-neutral-100" title="Reçu PDF">
                    <FileText className="w-4 h-4 text-neutral-600" />
                  </a>
                  {!p.annule && (
                    <button
                      title="Annuler ce paiement"
                      className="p-1.5 rounded-lg hover:bg-red-50"
                      onClick={() => {
                        const motif = prompt("Motif de l'annulation (erreur de saisie, chèque rejeté...) :");
                        if (motif) executer(() => annulerPaiement(p.id, motif));
                      }}
                    >
                      <Ban className="w-4 h-4 text-red-500" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {edition && <EditionEleve eleve={eleve} onClose={() => setEdition(false)} />}
      {reinscription && (
        <InscriptionModal classes={classes} eleve={eleve} onClose={() => setReinscription(false)} onInscrit={() => setReinscription(false)} />
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
