"use client";

// Fiche élève : modification de l'identité de l'élève et de son parent.
import { useState, useTransition } from "react";
import { Bouton, Label, Message, Modal, champ } from "@/components/ui";
import { modifierEleve } from "@/app/ecole/actions/eleves";
import type { EleveVue } from "@/types/ecole";

export function EditionEleve({ eleve, onClose }: { eleve: EleveVue; onClose: () => void }) {
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
