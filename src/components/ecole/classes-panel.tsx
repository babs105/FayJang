"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { formatFCFA } from "@/lib/utils";
import { LIBELLE_NIVEAU, NIVEAUX } from "@/lib/metier/libelles";
import { Badge, Bouton, Carte, Label, Message, Modal, champ } from "@/components/ui";
import { archiverClasse, enregistrerClasse } from "@/app/ecole/actions/classes";
import { MentionLectureSeule } from "./bandeau-abonnement";
import { peutEcrire } from "@/lib/metier/abonnement";
import type { DonneesEcole } from "./ecole-dashboard-client";
import type { ClasseVue, SaisieArticle } from "@/types/ecole";

export function ClassesPanel({ classes, ecole, abonnement }: DonneesEcole) {
  const lectureSeule = !peutEcrire(abonnement.etat);
  const [edition, setEdition] = useState<ClasseVue | "nouvelle" | null>(null);
  const [isPending, startTransition] = useTransition();
  const [classeFiltre, setClasseFiltre] = useState("");
  // Si la classe filtrée n'est plus dans les props (données rafraîchies), on revient à « Toutes les classes »
  const filtre = classes.some((c) => c.id === classeFiltre) ? classeFiltre : "";
  const affichees = filtre ? classes.filter((c) => c.id === filtre) : classes;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-600">Classes et tarifs de l'année <b>{ecole.annee_scolaire}</b></p>
        {lectureSeule ? (
          <MentionLectureSeule />
        ) : (
          <Bouton onClick={() => setEdition("nouvelle")}>
            <Plus className="w-4 h-4" /> Nouvelle classe
          </Bouton>
        )}
      </div>

      {classes.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <select
            value={filtre}
            onChange={(e) => setClasseFiltre(e.target.value)}
            className={`${champ} sm:w-48`}
            aria-label="Filtrer par classe"
          >
            <option value="">Toutes les classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.nom}{c.is_active ? "" : " (archivée)"}</option>
            ))}
          </select>
          <p className="text-[11px] text-neutral-500">{affichees.length} classe(s) affichée(s)</p>
        </div>
      )}

      {classes.length === 0 ? (
        <Carte className="text-center py-10 text-xs text-neutral-500">
          Créez vos classes (ex : CI, CP, CE1... 6e, 5e...) avec leurs frais d'inscription et mensualités.
        </Carte>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {affichees.map((c) => (
            <Carte key={c.id} className={c.is_active ? "" : "opacity-60"}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-extrabold">{c.nom}</p>
                  <p className="text-[11px] text-neutral-500">{LIBELLE_NIVEAU[c.niveau]} · {c.effectif} élève(s)</p>
                </div>
                {!c.is_active && <Badge ton="gris">Archivée</Badge>}
                {c.is_active && !lectureSeule && (
                  <button onClick={() => setEdition(c)} className="p-1.5 rounded-lg hover:bg-neutral-100" title="Modifier">
                    <Pencil className="w-4 h-4 text-neutral-500" />
                  </button>
                )}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-neutral-50 p-2">
                  <p className="text-[11px] text-neutral-500">Inscription</p>
                  <p className="font-bold">{formatFCFA(c.frais_inscription)}</p>
                </div>
                <div className="rounded-xl bg-neutral-50 p-2">
                  <p className="text-[11px] text-neutral-500">Mensualité</p>
                  <p className="font-bold">{formatFCFA(c.mensualite)}</p>
                  {c.mensualite_dernier_mois !== null && c.mensualite_dernier_mois !== c.mensualite && (
                    <p className="text-[10px] text-neutral-500">Dernier mois : {formatFCFA(c.mensualite_dernier_mois)}</p>
                  )}
                </div>
              </div>
              {c.articles.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-[11px] text-neutral-600">
                  {c.articles.map((a) => (
                    <li key={a.id} className="flex justify-between gap-2">
                      <span>
                        {a.libelle}
                        {a.nature === "unique" && a.quantite_defaut > 1 ? ` × ${a.quantite_defaut}` : ""}
                        {!a.obligatoire && <span className="text-neutral-400"> (option)</span>}
                      </span>
                      <span className="font-semibold">
                        {formatFCFA(a.prix_unitaire * (a.nature === "unique" ? a.quantite_defaut : 1))}
                        {a.nature === "mensuel" ? "/mois" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {!lectureSeule && (
                <button
                  disabled={isPending}
                  onClick={() => startTransition(async () => void (await archiverClasse(c.id, !c.is_active)))}
                  className="mt-3 text-[11px] font-bold text-neutral-500 hover:text-neutral-900"
                >
                  {c.is_active ? "Archiver" : "Réactiver"}
                </button>
              )}
            </Carte>
          ))}
        </div>
      )}

      {edition && !lectureSeule && <ClasseModal classe={edition === "nouvelle" ? undefined : edition} onClose={() => setEdition(null)} />}
    </div>
  );
}

/** Préréglages proposés dans le catalogue d'une classe (prix à compléter par l'école) */
const PRESETS: Array<Omit<LigneArticle, "cle">> = [
  { libelle: "Tenue", nature: "unique", prix_unitaire: "", quantite_defaut: "2", obligatoire: true },
  { libelle: "Ensemble blouson", nature: "unique", prix_unitaire: "", quantite_defaut: "1", obligatoire: true },
  { libelle: "Jacket", nature: "unique", prix_unitaire: "", quantite_defaut: "1", obligatoire: true },
  { libelle: "Pensionnat", nature: "mensuel", prix_unitaire: "", quantite_defaut: "1", obligatoire: false },
  { libelle: "Transport", nature: "mensuel", prix_unitaire: "", quantite_defaut: "1", obligatoire: false },
];

type LigneArticle = SaisieArticle & { cle: number; prix_unitaire: string; quantite_defaut: string };

function ClasseModal({ classe, onClose }: { classe?: ClasseVue; onClose: () => void }) {
  const [f, setF] = useState({
    nom: classe?.nom ?? "",
    niveau: classe?.niveau ?? "elementaire",
    frais_inscription: String(classe?.frais_inscription ?? ""),
    mensualite: String(classe?.mensualite ?? ""),
    mensualite_dernier_mois: classe?.mensualite_dernier_mois != null ? String(classe.mensualite_dernier_mois) : "",
  });
  const [articles, setArticles] = useState<LigneArticle[]>(
    (classe?.articles ?? []).map((a, i) => ({
      cle: i,
      id: a.id,
      libelle: a.libelle,
      nature: a.nature,
      prix_unitaire: String(a.prix_unitaire),
      quantite_defaut: String(a.quantite_defaut),
      obligatoire: a.obligatoire,
    }))
  );
  const [erreur, setErreur] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const maj = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const majArticle = (cle: number, champs: Partial<LigneArticle>) =>
    setArticles((liste) => liste.map((a) => (a.cle === cle ? { ...a, ...champs } : a)));
  const ajouter = (a: Omit<LigneArticle, "cle">) => setArticles((liste) => [...liste, { ...a, cle: Date.now() + liste.length }]);
  const presents = new Set(articles.map((a) => a.libelle.toLowerCase()));

  return (
    <Modal titre={classe ? `Modifier ${classe.nom}` : "Nouvelle classe"} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await enregistrerClasse({ ...f, id: classe?.id, articles: articles.map(({ cle: _c, ...a }) => a) });
            if (r.success) onClose();
            else setErreur(r.message ?? "Enregistrement impossible.");
          });
        }}
      >
        {erreur && <Message ok={false}>{erreur}</Message>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Nom</Label>
            <input required value={f.nom} onChange={maj("nom")} placeholder="CM2 A" className={champ} />
          </div>
          <div>
            <Label>Niveau</Label>
            <select value={f.niveau} onChange={maj("niveau")} className={champ}>
              {NIVEAUX.map((n) => (
                <option key={n} value={n}>{LIBELLE_NIVEAU[n]}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Frais d'inscription (FCFA)</Label>
            <input required inputMode="numeric" value={f.frais_inscription} onChange={maj("frais_inscription")} placeholder="30000" className={champ} />
          </div>
          <div>
            <Label>Mensualité (FCFA)</Label>
            <input required inputMode="numeric" value={f.mensualite} onChange={maj("mensualite")} placeholder="25000" className={champ} />
          </div>
          <div className="col-span-2">
            <Label>Mensualité du dernier mois (FCFA)</Label>
            <input
              inputMode="numeric"
              value={f.mensualite_dernier_mois}
              onChange={maj("mensualite_dernier_mois")}
              placeholder={f.mensualite ? `Vide = ${f.mensualite}` : "Vide = même montant"}
              className={champ}
            />
          </div>
        </div>

        <div className="space-y-2 pt-1">
          <p className="text-xs font-extrabold">Articles et services</p>
          <p className="text-[11px] text-neutral-500">
            Frais unique : payé à l'inscription (prix × quantité). Mensuel : dû chaque mois, comme la mensualité.
            Les articles optionnels sont cochés ou non à l'inscription de chaque élève.
          </p>
          {articles.map((a) => (
            <div key={a.cle} className="rounded-xl border border-neutral-200 p-2 space-y-2">
              <div className="flex gap-2">
                <input
                  value={a.libelle}
                  onChange={(e) => majArticle(a.cle, { libelle: e.target.value })}
                  placeholder="Libellé"
                  className={`${champ} flex-1`}
                />
                <button type="button" onClick={() => setArticles((l) => l.filter((x) => x.cle !== a.cle))} className="p-2 rounded-lg hover:bg-neutral-100" title="Retirer">
                  <Trash2 className="w-4 h-4 text-neutral-500" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select value={a.nature} onChange={(e) => majArticle(a.cle, { nature: e.target.value })} className={champ}>
                  <option value="unique">Frais unique</option>
                  <option value="mensuel">Mensuel</option>
                </select>
                <input
                  inputMode="numeric"
                  value={a.prix_unitaire}
                  onChange={(e) => majArticle(a.cle, { prix_unitaire: e.target.value })}
                  placeholder={a.nature === "mensuel" ? "Prix / mois" : "Prix unitaire"}
                  className={champ}
                />
                {a.nature === "unique" ? (
                  <input
                    inputMode="numeric"
                    value={a.quantite_defaut}
                    onChange={(e) => majArticle(a.cle, { quantite_defaut: e.target.value })}
                    placeholder="Qté"
                    title="Quantité"
                    className={champ}
                  />
                ) : (
                  <span className="text-[11px] text-neutral-400 self-center">par mois</span>
                )}
              </div>
              <label className="flex items-center gap-2 text-[11px]">
                <input type="checkbox" checked={a.obligatoire} onChange={(e) => majArticle(a.cle, { obligatoire: e.target.checked })} />
                Obligatoire pour tous les élèves de la classe
              </label>
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.filter((p) => !presents.has(p.libelle.toLowerCase())).map((p) => (
              <button
                key={p.libelle}
                type="button"
                onClick={() => ajouter(p)}
                className="px-2.5 py-1 rounded-full border border-neutral-200 text-[11px] font-bold hover:bg-neutral-50"
              >
                + {p.libelle}
              </button>
            ))}
            <button
              type="button"
              onClick={() => ajouter({ libelle: "", nature: "unique", prix_unitaire: "", quantite_defaut: "1", obligatoire: true })}
              className="px-2.5 py-1 rounded-full border border-dashed border-neutral-300 text-[11px] font-bold hover:bg-neutral-50"
            >
              + Autre
            </button>
          </div>
        </div>

        {classe && <p className="text-[11px] text-neutral-500">Les nouveaux tarifs s'appliquent aux prochaines inscriptions.</p>}
        <Bouton type="submit" disabled={isPending} className="w-full">{isPending ? "Enregistrement..." : "Enregistrer"}</Bouton>
      </form>
    </Modal>
  );
}
