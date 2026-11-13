"use client";

// Fiche élève : en-tête, situation (payé, arriéré, reste) et assemblage des blocs. Sélection et encaissement :
// fiche-selection.tsx, fiche-encaissement.tsx (état dans use-encaissement.ts) ; statut : fiche-statut.tsx ;
// parent : fiche-parent.tsx ; reçus : fiche-recus.tsx ; modification de l'identité : fiche-edition.tsx.
import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { cn, formatFCFA } from "@/lib/utils";
import { formatDate, formatMois } from "@/lib/metier/dates";
import { LIBELLE_STATUT_INSCRIPTION } from "@/lib/metier/libelles";
import { Badge, Bouton, Message, Modal } from "@/components/ui";
import { supprimerEleve } from "@/app/ecole/actions/eleves";
import type { ClasseVue, EcoleVue, EleveVue, PaiementVue } from "@/types/ecole";
import { InscriptionModal } from "./inscription-modal";
import { MentionLectureSeule } from "./bandeau-abonnement";
import { useEncaissement, type Retour } from "./use-encaissement";
import { SelectionEncaissement } from "./fiche-selection";
import { FormulaireEncaissement } from "./fiche-encaissement";
import { StatutInscriptionEleve } from "./fiche-statut";
import { BlocParent } from "./fiche-parent";
import { HistoriquePaiements } from "./fiche-recus";
import { EditionEleve } from "./fiche-edition";

export function FicheEleve({
  eleve,
  ecole,
  classes,
  aujourdhui,
  paiements,
  lectureSeule,
  peutAnnuler,
  onClose,
}: {
  eleve: EleveVue;
  ecole: EcoleVue;
  classes: ClasseVue[];
  aujourdhui: string;
  paiements: PaiementVue[];
  /** Abonnement expiré ou suspendu : les gestes d'écriture hors argent sont retirés (encaisser et annuler : tranche 3) */
  lectureSeule: boolean;
  /** Droit d'annuler un reçu (directeur seulement) */
  peutAnnuler: boolean;
  onClose: () => void;
}) {
  const [retour, setRetour] = useState<Retour>(null);
  const [isPending, startTransition] = useTransition();
  const [edition, setEdition] = useState(false);
  const [reinscription, setReinscription] = useState(false);
  const s = eleve.situation;
  const ins = eleve.inscription;
  const classe = classes.find((c) => c.id === ins?.classe_id);
  const enc = useEncaissement({ s, ins, isPending, startTransition, setRetour });

  function executer(action: () => Promise<{ success: boolean; message?: string }>, apres?: () => void) {
    setRetour(null);
    startTransition(async () => {
      const r = await action();
      setRetour({ ok: r.success, texte: r.message ?? (r.success ? "Enregistré." : "Opération impossible.") });
      if (r.success) apres?.();
    });
  }

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

            {enc.totalInscription > 0 && !lectureSeule && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 border border-amber-200 p-2.5">
                <p className="text-[11px] text-amber-800">
                  Reste dû à l'inscription : <b>{formatFCFA(enc.totalInscription)}</b>
                </p>
                <Bouton type="button" variante="secondaire" onClick={enc.choisirDuInscription}>
                  Tout le dû à l'inscription
                </Bouton>
              </div>
            )}

            <SelectionEncaissement s={s} ins={ins} ecole={ecole} classe={classe} aujourdhui={aujourdhui} lectureSeule={lectureSeule} isPending={isPending} enc={enc} executer={executer} />

            {lectureSeule ? (
              <div className="rounded-2xl bg-neutral-50 p-4 space-y-1">
                <MentionLectureSeule />
                <p className="text-[11px] text-neutral-600">
                  Aucun paiement ne peut être saisi ni annulé. Les reçus existants restent téléchargeables ; l'encaissement reprend dès que l'abonnement est rétabli.
                </p>
              </div>
            ) : (
              <FormulaireEncaissement s={s} ins={ins} isPending={isPending} enc={enc} />
            )}

            {!lectureSeule && <StatutInscriptionEleve ins={ins} aujourdhui={aujourdhui} isPending={isPending} executer={executer} />}
          </>
        )}

        {eleve.parent && <BlocParent eleve={{ ...eleve, parent: eleve.parent }} ecole={ecole} s={s} ins={ins} executer={executer} />}

        <HistoriquePaiements ecole={ecole} paiements={paiements} lectureSeule={lectureSeule} peutAnnuler={peutAnnuler} executer={executer} />
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
