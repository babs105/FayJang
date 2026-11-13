"use client";

import { useState, useTransition } from "react";
import { Bouton, Carte, Label, champ } from "@/components/ui";
import { MOT_DE_PASSE_MIN } from "@/lib/securite/mot-de-passe";
import type { PlanId, StatutAbonnement } from "@/types/database";
import { reactiverEcole, reinitialiserMotDePasseDirecteur, suspendreEcole } from "@/app/admin/actions/ecoles";
import { modifierAbonnement } from "@/app/admin/actions/abonnements";
import type { EcoleAdmin } from "@/types/admin";

/** Actions de la fiche d'une école : activer / désactiver, mot de passe du directeur, correction de l'abonnement */
export function ActionsEcole({ ecole }: { ecole: EcoleAdmin }) {
  const [message, setMessage] = useState<string | null>(null);
  const [reinit, setReinit] = useState("");
  const [f, setF] = useState({
    plan: ecole.plan,
    statut_abonnement: ecole.statut_abonnement,
    abonnement_fin: ecole.abonnement_fin ?? "",
    is_active: ecole.is_active,
  });
  const [isPending, startTransition] = useTransition();
  const lancer = (action: () => Promise<{ success: boolean; message?: string }>, apres?: () => void) =>
    startTransition(async () => {
      const r = await action();
      setMessage(r.message ?? null);
      if (r.success) apres?.();
    });

  return (
    <div className="space-y-3">
      {message && <p className="text-xs text-neutral-700 bg-white border border-neutral-200 rounded-2xl p-3">{message}</p>}

      <Carte className="space-y-2">
        <p className="text-xs font-extrabold">Accès de l&apos;école</p>
        <p className="text-[11px] text-neutral-500">Désactivée, l&apos;école ne peut plus se connecter et les liens parents ne s&apos;ouvrent plus.</p>
        {ecole.is_active ? (
          <Bouton variante="danger" disabled={isPending} onClick={() => confirm(`Désactiver ${ecole.nom} ?`) && lancer(() => suspendreEcole(ecole.id))}>
            Désactiver l&apos;école
          </Bouton>
        ) : (
          <Bouton variante="sombre" disabled={isPending} onClick={() => lancer(() => reactiverEcole(ecole.id))}>
            Réactiver l&apos;école
          </Bouton>
        )}
      </Carte>

      <Carte className="space-y-2">
        <p className="text-xs font-extrabold">Mot de passe du directeur</p>
        <form
          className="flex flex-wrap gap-2 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            lancer(() => reinitialiserMotDePasseDirecteur(ecole.id, reinit), () => setReinit(""));
          }}
        >
          <input
            type="password"
            autoComplete="new-password"
            placeholder={`Mot de passe provisoire (${MOT_DE_PASSE_MIN} min.)`}
            value={reinit}
            onChange={(e) => setReinit(e.target.value)}
            className={`${champ} w-auto`}
          />
          <Bouton type="submit" variante="sombre" disabled={isPending || reinit.trim().length < MOT_DE_PASSE_MIN}>
            Réinitialiser
          </Bouton>
        </form>
      </Carte>

      <Carte className="space-y-2">
        <p className="text-xs font-extrabold">Correction manuelle de l&apos;abonnement</p>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <Label>Offre</Label>
            <select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value as PlanId })} className={`${champ} w-auto`}>
              <option value="essai">Essai</option>
              <option value="standard">Standard</option>
              <option value="premium">Premium</option>
            </select>
          </div>
          <div>
            <Label>Statut</Label>
            <select value={f.statut_abonnement} onChange={(e) => setF({ ...f, statut_abonnement: e.target.value as StatutAbonnement })} className={`${champ} w-auto`}>
              <option value="essai">Essai</option>
              <option value="actif">Actif</option>
              <option value="expire">Expiré</option>
              <option value="suspendu">Suspendu</option>
            </select>
          </div>
          <div>
            <Label>Fin de l&apos;abonnement</Label>
            <input type="date" value={f.abonnement_fin} onChange={(e) => setF({ ...f, abonnement_fin: e.target.value })} className={`${champ} w-auto`} />
          </div>
          <label className="text-xs flex items-center gap-1.5 pb-2.5">
            <input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active
          </label>
          <Bouton variante="sombre" disabled={isPending} onClick={() => lancer(() => modifierAbonnement(ecole.id, f))}>
            Enregistrer
          </Bouton>
        </div>
      </Carte>
    </div>
  );
}
