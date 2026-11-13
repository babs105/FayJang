"use client";

import { useState, useTransition } from "react";
import { formatFCFA } from "@/lib/utils";
import { LIBELLE_MODE, MODES_PAIEMENT } from "@/lib/metier/libelles";
import { Bouton, Label, Message, Modal, champ } from "@/components/ui";
import { inscrireEleve } from "@/app/ecole/actions/inscriptions";
import type { ClasseVue, EcoleVue, EleveVue } from "@/types/ecole";

/** Inscription d'un nouvel élève, ou réinscription d'un élève existant (eleve fourni) */
export function InscriptionModal({
  classes,
  ecole,
  eleve,
  onClose,
  onInscrit,
}: {
  classes: ClasseVue[];
  ecole: EcoleVue;
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

  // Articles de la classe : obligatoires toujours pris, optionnels à cocher ; quantité modifiable (frais uniques)
  const [choixArticles, setChoixArticles] = useState<Record<string, { pris: boolean; quantite: string }>>({});
  const choix = (id: string, defaut: { pris: boolean; quantite: number }) =>
    choixArticles[`${f.classe_id}:${id}`] ?? { pris: defaut.pris, quantite: String(defaut.quantite) };
  const majChoix = (id: string, v: { pris: boolean; quantite: string }) => setChoixArticles({ ...choixArticles, [`${f.classe_id}:${id}`]: v });
  const articles = (classe?.articles ?? []).map((a) => {
    const c = choix(a.id, { pris: a.obligatoire, quantite: a.quantite_defaut });
    const pris = a.obligatoire || c.pris;
    const quantite = a.nature === "unique" ? Math.max(0, Math.floor(Number(c.quantite) || 0)) : 1;
    return { ...a, pris, quantite, saisie: c };
  });

  // Ce qui sera dû dès l'inscription (le serveur refait le calcul avant d'encaisser)
  const reduction = Math.max(0, Number(String(f.reduction_mensuelle).replace(/\s/g, "")) || 0);
  const du: { libelle: string; montant: number }[] = [];
  if (classe) {
    if (classe.frais_inscription > 0) du.push({ libelle: "Frais d'inscription", montant: classe.frais_inscription });
    if (ecole.premier_mois_a_linscription) du.push({ libelle: "1er mois", montant: Math.max(0, classe.mensualite - reduction) });
    if (ecole.dernier_mois_a_linscription && ecole.nb_mensualites > 1)
      du.push({ libelle: "Dernier mois", montant: Math.max(0, (classe.mensualite_dernier_mois ?? classe.mensualite) - reduction) });
    for (const a of articles) {
      if (a.pris && a.nature === "unique" && a.quantite > 0)
        du.push({ libelle: a.quantite > 1 ? `${a.libelle} × ${a.quantite}` : a.libelle, montant: a.prix_unitaire * a.quantite });
    }
  }
  const totalDu = du.reduce((t, l) => t + l.montant, 0);
  const services = articles.filter((a) => a.pris && a.nature === "mensuel");

  function valider(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    startTransition(async () => {
      const r = await inscrireEleve({
        ...f,
        payer_inscription: f.payer_inscription && totalDu > 0,
        eleve_id: eleve?.id,
        articles: articles.filter((a) => a.pris).map((a) => ({ article_classe_id: a.id, quantite: a.quantite })),
      });
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
            {classe.mensualite_dernier_mois !== null && classe.mensualite_dernier_mois !== classe.mensualite && (
              <> · Dernier mois <b>{formatFCFA(classe.mensualite_dernier_mois)}</b></>
            )}
          </p>
        )}

        {articles.length > 0 && (
          <div className="rounded-2xl border border-neutral-200 p-3 space-y-2">
            <p className="text-xs font-extrabold">Articles et services</p>
            {articles.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={a.pris}
                  disabled={a.obligatoire}
                  onChange={(e) => majChoix(a.id, { ...a.saisie, pris: e.target.checked })}
                />
                <span className="flex-1">
                  {a.libelle}
                  {a.obligatoire ? <span className="text-neutral-400"> (obligatoire)</span> : null}
                  <span className="block text-[11px] text-neutral-500">
                    {formatFCFA(a.prix_unitaire)}
                    {a.nature === "mensuel" ? " / mois, dû chaque mois" : " l'unité"}
                  </span>
                </span>
                {a.nature === "unique" && a.pris && (
                  <input
                    inputMode="numeric"
                    value={a.saisie.quantite}
                    onChange={(e) => majChoix(a.id, { ...a.saisie, quantite: e.target.value })}
                    className={`${champ} w-16 text-center`}
                    title="Quantité"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {classe && totalDu > 0 && (
          <div className="rounded-2xl border border-neutral-200 p-3 space-y-2">
            <p className="text-xs font-extrabold">Dû à l'inscription</p>
            <ul className="text-[11px] text-neutral-600 space-y-0.5">
              {du.map((l) => (
                <li key={l.libelle} className="flex justify-between">
                  <span>{l.libelle}</span>
                  <span className="font-semibold">{formatFCFA(l.montant)}</span>
                </li>
              ))}
              <li className="flex justify-between border-t border-neutral-100 pt-1 text-xs text-neutral-900">
                <b>Total</b>
                <b>{formatFCFA(totalDu)}</b>
              </li>
            </ul>
            {services.length > 0 && (
              <p className="text-[11px] text-neutral-500">
                En plus chaque mois : {services.map((a) => `${a.libelle} ${formatFCFA(a.prix_unitaire)}`).join(", ")}.
              </p>
            )}
            <label className="flex items-center gap-2 text-xs font-bold">
              <input type="checkbox" checked={f.payer_inscription} onChange={maj("payer_inscription")} />
              Encaisser maintenant ({formatFCFA(totalDu)}, un seul reçu)
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
