"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Search } from "lucide-react";
import { formatFCFA } from "@/lib/utils";
import { LIBELLE_MODE, LIBELLE_STATUT_INSCRIPTION, MODES_PAIEMENT } from "@/lib/libelles";
import { Badge, Bouton, Carte, Label, Message, Modal, champ } from "@/components/ui";
import { inscrireEleve } from "./actions";
import type { DonneesEcole } from "./ecole-dashboard-client";
import type { ClasseVue, EleveVue } from "./types";

export function ElevesPanel({ eleves, classes, ouvrirEleve }: DonneesEcole & { ouvrirEleve: (id: string) => void }) {
  const [recherche, setRecherche] = useState("");
  const [classeFiltre, setClasseFiltre] = useState("");
  const [nouveau, setNouveau] = useState(false);

  const liste = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return eleves.filter((e) => {
      if (classeFiltre === "_aucune" ? e.inscription : classeFiltre && e.inscription?.classe_id !== classeFiltre) return false;
      if (!q) return true;
      return `${e.prenom} ${e.nom} ${e.matricule} ${e.parent?.nom ?? ""} ${e.parent?.telephone ?? ""}`.toLowerCase().includes(q);
    });
  }, [eleves, recherche, classeFiltre]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-neutral-400" />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Nom, matricule, parent, téléphone..."
            className={`${champ} pl-9`}
          />
        </div>
        <select value={classeFiltre} onChange={(e) => setClasseFiltre(e.target.value)} className={`${champ} sm:w-48`}>
          <option value="">Toutes les classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.nom}</option>
          ))}
          <option value="_aucune">Non réinscrits</option>
        </select>
        <Bouton onClick={() => setNouveau(true)} disabled={classes.length === 0}>
          <Plus className="w-4 h-4" /> Nouvelle inscription
        </Bouton>
      </div>

      <Carte className="p-0 overflow-hidden">
        {liste.length === 0 ? (
          <p className="text-xs text-neutral-500 p-6 text-center">
            {eleves.length === 0 ? "Aucun élève pour l'instant : faites la première inscription." : "Aucun élève ne correspond."}
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 text-neutral-500 text-left">
              <tr>
                <th className="px-4 py-2.5 font-bold">Élève</th>
                <th className="px-4 py-2.5 font-bold hidden md:table-cell">Classe</th>
                <th className="px-4 py-2.5 font-bold hidden md:table-cell">Parent</th>
                <th className="px-4 py-2.5 font-bold text-right">Arriéré</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {liste.map((e) => (
                <tr key={e.id} onClick={() => ouvrirEleve(e.id)} className="hover:bg-neutral-50 cursor-pointer">
                  <td className="px-4 py-2.5">
                    <p className="font-bold text-neutral-900">{e.prenom} {e.nom}</p>
                    <p className="text-[11px] text-neutral-500">
                      {e.matricule}
                      <span className="md:hidden"> · {e.inscription?.classe_nom ?? "non réinscrit"}</span>
                    </p>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    {e.inscription ? (
                      <span className="flex items-center gap-1.5">
                        {e.inscription.classe_nom}
                        {e.inscription.statut !== "active" && <Badge ton="gris">{LIBELLE_STATUT_INSCRIPTION[e.inscription.statut]}</Badge>}
                      </span>
                    ) : (
                      <Badge ton="orange">Non réinscrit</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell text-neutral-600">
                    {e.parent ? `${e.parent.nom} · ${e.parent.telephone}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {e.situation && e.situation.arriere > 0 ? (
                      <span className="font-extrabold text-red-600">{formatFCFA(e.situation.arriere)}</span>
                    ) : e.situation ? (
                      <Badge ton="vert">À jour</Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Carte>
      <p className="text-[11px] text-neutral-500">{liste.length} élève(s) affiché(s)</p>

      {nouveau && <InscriptionModal classes={classes} onClose={() => setNouveau(false)} onInscrit={(id) => { setNouveau(false); ouvrirEleve(id); }} />}
    </div>
  );
}

/** Inscription d'un nouvel élève, ou réinscription d'un élève existant (eleve fourni) */
export function InscriptionModal({
  classes,
  eleve,
  onClose,
  onInscrit,
}: {
  classes: ClasseVue[];
  eleve?: EleveVue;
  onClose: () => void;
  onInscrit: (eleveId: string) => void;
}) {
  const actives = classes.filter((c) => c.is_active);
  const [f, setF] = useState({
    prenom: "",
    nom: "",
    sexe: "",
    date_naissance: "",
    parent_nom: "",
    parent_telephone: "",
    classe_id: actives[0]?.id ?? "",
    reduction_mensuelle: "",
    payer_inscription: true,
    mode: "especes",
    reference: "",
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const classe = actives.find((c) => c.id === f.classe_id);
  const maj = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  function valider(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    startTransition(async () => {
      const r = await inscrireEleve({ ...f, eleve_id: eleve?.id });
      if (r.success && r.data) onInscrit(r.data.eleveId);
      else setErreur(r.message ?? "Inscription impossible.");
    });
  }

  return (
    <Modal titre={eleve ? `Réinscrire ${eleve.prenom} ${eleve.nom}` : "Nouvelle inscription"} onClose={onClose}>
      <form onSubmit={valider} className="space-y-3">
        {erreur && <Message ok={false}>{erreur}</Message>}
        {!eleve && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Prénom</Label>
                <input required value={f.prenom} onChange={maj("prenom")} className={champ} />
              </div>
              <div>
                <Label>Nom</Label>
                <input required value={f.nom} onChange={maj("nom")} className={champ} />
              </div>
              <div>
                <Label>Sexe</Label>
                <select value={f.sexe} onChange={maj("sexe")} className={champ}>
                  <option value="">—</option>
                  <option value="F">Fille</option>
                  <option value="M">Garçon</option>
                </select>
              </div>
              <div>
                <Label>Date de naissance</Label>
                <input type="date" value={f.date_naissance} onChange={maj("date_naissance")} className={champ} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Parent / tuteur</Label>
                <input required value={f.parent_nom} onChange={maj("parent_nom")} placeholder="Mme Fatou Diop" className={champ} />
              </div>
              <div>
                <Label>Téléphone du parent</Label>
                <input required type="tel" value={f.parent_telephone} onChange={maj("parent_telephone")} placeholder="77 123 45 67" className={champ} />
              </div>
            </div>
            <p className="text-[11px] text-neutral-500">Un même téléphone regroupe les frères et sœurs sous un seul parent.</p>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Classe</Label>
            <select required value={f.classe_id} onChange={maj("classe_id")} className={champ}>
              {actives.map((c) => (
                <option key={c.id} value={c.id}>{c.nom}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Réduction / mois (FCFA)</Label>
            <input inputMode="numeric" value={f.reduction_mensuelle} onChange={maj("reduction_mensuelle")} placeholder="0" className={champ} />
          </div>
        </div>
        {classe && (
          <p className="text-[11px] text-neutral-600 bg-neutral-50 rounded-xl p-2.5">
            Inscription <b>{formatFCFA(classe.frais_inscription)}</b> · Mensualité <b>{formatFCFA(classe.mensualite)}</b>
          </p>
        )}

        {classe && classe.frais_inscription > 0 && (
          <div className="rounded-2xl border border-neutral-200 p-3 space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold">
              <input type="checkbox" checked={f.payer_inscription} onChange={maj("payer_inscription")} />
              Encaisser les frais d'inscription maintenant
            </label>
            {f.payer_inscription && (
              <div className="grid grid-cols-2 gap-2">
                <select value={f.mode} onChange={maj("mode")} className={champ}>
                  {MODES_PAIEMENT.map((m) => (
                    <option key={m} value={m}>{LIBELLE_MODE[m]}</option>
                  ))}
                </select>
                <input value={f.reference} onChange={maj("reference")} placeholder="Réf. transaction" className={champ} />
              </div>
            )}
          </div>
        )}

        <Bouton type="submit" disabled={isPending} className="w-full">
          {isPending ? "Inscription..." : eleve ? "Réinscrire" : "Inscrire l'élève"}
        </Bouton>
      </form>
    </Modal>
  );
}
