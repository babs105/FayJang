"use client";

// Fiche élève : le parent, son lien magique et les messages WhatsApp (lien, relance des impayés).
import { Copy, MessageCircle, RefreshCw } from "lucide-react";
import { formatFCFA } from "@/lib/utils";
import { lienWhatsApp, messageLienParent, messageRelance } from "@/lib/metier/whatsapp";
import { Bouton } from "@/components/ui";
import { regenererLienParent } from "@/app/ecole/actions/parents";
import type { EcoleVue, EleveVue } from "@/types/ecole";
import type { Situation } from "@/types/commun";

type Executer = (action: () => Promise<{ success: boolean; message?: string }>, apres?: () => void) => void;

export function BlocParent({
  eleve,
  ecole,
  s,
  ins,
  executer,
}: {
  eleve: EleveVue & { parent: NonNullable<EleveVue["parent"]> };
  ecole: EcoleVue;
  s: Situation | null;
  ins: EleveVue["inscription"];
  executer: Executer;
}) {
  return (
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
  );
}
