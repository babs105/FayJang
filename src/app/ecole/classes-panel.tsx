"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";
import { formatFCFA } from "@/lib/utils";
import { LIBELLE_NIVEAU, NIVEAUX } from "@/lib/libelles";
import { Badge, Bouton, Carte, Label, Message, Modal, champ } from "@/components/ui";
import { archiverClasse, enregistrerClasse } from "./actions";
import type { DonneesEcole } from "./ecole-dashboard-client";
import type { ClasseVue } from "./types";

export function ClassesPanel({ classes, ecole }: DonneesEcole) {
  const [edition, setEdition] = useState<ClasseVue | "nouvelle" | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-600">Classes et tarifs de l'année <b>{ecole.annee_scolaire}</b></p>
        <Bouton onClick={() => setEdition("nouvelle")}>
          <Plus className="w-4 h-4" /> Nouvelle classe
        </Bouton>
      </div>

      {classes.length === 0 ? (
        <Carte className="text-center py-10 text-xs text-neutral-500">
          Créez vos classes (ex : CI, CP, CE1... 6e, 5e...) avec leurs frais d'inscription et mensualités.
        </Carte>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {classes.map((c) => (
            <Carte key={c.id} className={c.is_active ? "" : "opacity-60"}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-extrabold">{c.nom}</p>
                  <p className="text-[11px] text-neutral-500">{LIBELLE_NIVEAU[c.niveau]} · {c.effectif} élève(s)</p>
                </div>
                {!c.is_active && <Badge ton="gris">Archivée</Badge>}
                {c.is_active && (
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
                </div>
              </div>
              <button
                disabled={isPending}
                onClick={() => startTransition(async () => void (await archiverClasse(c.id, !c.is_active)))}
                className="mt-3 text-[11px] font-bold text-neutral-500 hover:text-neutral-900"
              >
                {c.is_active ? "Archiver" : "Réactiver"}
              </button>
            </Carte>
          ))}
        </div>
      )}

      {edition && <ClasseModal classe={edition === "nouvelle" ? undefined : edition} onClose={() => setEdition(null)} />}
    </div>
  );
}

function ClasseModal({ classe, onClose }: { classe?: ClasseVue; onClose: () => void }) {
  const [f, setF] = useState({
    nom: classe?.nom ?? "",
    niveau: classe?.niveau ?? "elementaire",
    frais_inscription: String(classe?.frais_inscription ?? ""),
    mensualite: String(classe?.mensualite ?? ""),
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const maj = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal titre={classe ? `Modifier ${classe.nom}` : "Nouvelle classe"} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await enregistrerClasse({ ...f, id: classe?.id });
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
        </div>
        {classe && <p className="text-[11px] text-neutral-500">Les nouveaux tarifs s'appliquent aux prochaines inscriptions.</p>}
        <Bouton type="submit" disabled={isPending} className="w-full">{isPending ? "Enregistrement..." : "Enregistrer"}</Bouton>
      </form>
    </Modal>
  );
}
