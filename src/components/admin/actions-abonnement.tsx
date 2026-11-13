"use client";

import { useState, useTransition } from "react";
import { Bouton, champ } from "@/components/ui";
import type { EcoleAdmin } from "@/lib/metier/admin-ecoles";
import type { PlanId } from "@/types/database";
import { changerOffre, prolongerAbonnement, suspendreAbonnement } from "@/app/admin/actions/abonnements";

/** Actions rapides d'une ligne de la page Abonnements : prolonger, suspendre, changer d'offre */
export function ActionsAbonnement({ ecole }: { ecole: EcoleAdmin }) {
  const [fin, setFin] = useState(ecole.abonnement_fin ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const lancer = (action: () => Promise<{ message?: string }>) => startTransition(async () => setMessage((await action()).message ?? null));

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <input type="date" value={fin} onChange={(e) => setFin(e.target.value)} className={`${champ} w-auto`} aria-label="Nouvelle date de fin" />
      <Bouton variante="sombre" disabled={isPending || !fin} onClick={() => lancer(() => prolongerAbonnement(ecole.id, fin))}>
        Prolonger
      </Bouton>
      {ecole.statut_abonnement !== "suspendu" && (
        <Bouton
          variante="danger"
          disabled={isPending}
          onClick={() => confirm(`Suspendre l'abonnement de ${ecole.nom} ? L'école passe en lecture seule.`) && lancer(() => suspendreAbonnement(ecole.id))}
        >
          Suspendre
        </Bouton>
      )}
      <select
        value={ecole.plan}
        disabled={isPending}
        onChange={(e) => lancer(() => changerOffre(ecole.id, e.target.value as PlanId))}
        className={`${champ} w-auto`}
        aria-label="Offre"
      >
        <option value="essai">Essai</option>
        <option value="standard">Standard</option>
        <option value="premium">Premium</option>
      </select>
      {message && <span className="text-[11px] text-neutral-500">{message}</span>}
    </div>
  );
}
