"use client";

import { useState, useTransition } from "react";
import { LogOut } from "lucide-react";
import { formatFCFA } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { Badge, Bouton, Carte, Kpi, champ } from "@/components/ui";
import type { Ecole, PlanId, StatutAbonnement } from "@/types/database";
import { logoutAdminAction, modifierAbonnement } from "./actions";

export type EcoleAdmin = Pick<
  Ecole,
  "id" | "nom" | "slug" | "ville" | "responsable_nom" | "email_contact" | "telephone_contact" | "annee_scolaire" | "plan" | "statut_abonnement" | "trial_ends_at" | "abonnement_fin" | "is_active" | "created_at"
> & { eleves: number; encaisse: number };

export function AdminClient({ ecoles }: { ecoles: EcoleAdmin[] }) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-neutral-900 text-white px-4 py-3 flex justify-between items-center">
        <p className="text-sm font-extrabold">Console JàngPay</p>
        <form action={logoutAdminAction}>
          <button className="text-xs flex items-center gap-1 opacity-80 hover:opacity-100"><LogOut className="w-4 h-4" /> Quitter</button>
        </form>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Écoles" valeur={String(ecoles.length)} />
          <Kpi label="Abonnées" valeur={String(ecoles.filter((e) => e.statut_abonnement === "actif").length)} ton="vert" />
          <Kpi label="En essai" valeur={String(ecoles.filter((e) => e.statut_abonnement === "essai").length)} />
          <Kpi label="Élèves suivis" valeur={String(ecoles.reduce((s, e) => s + e.eleves, 0))} />
        </div>
        <div className="space-y-3">
          {ecoles.map((e) => <LigneEcole key={e.id} ecole={e} />)}
        </div>
      </main>
    </div>
  );
}

function LigneEcole({ ecole }: { ecole: EcoleAdmin }) {
  const [f, setF] = useState({
    plan: ecole.plan,
    statut_abonnement: ecole.statut_abonnement,
    abonnement_fin: ecole.abonnement_fin ?? "",
    is_active: ecole.is_active,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Carte className="space-y-3">
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <p className="text-sm font-extrabold">{ecole.nom} {!ecole.is_active && <Badge ton="rouge">Désactivée</Badge>}</p>
          <p className="text-[11px] text-neutral-500">
            {ecole.slug} · {ecole.ville ?? "—"} · {ecole.responsable_nom} · {ecole.email_contact} · {ecole.telephone_contact}
          </p>
          <p className="text-[11px] text-neutral-500">
            Inscrite le {formatDate(ecole.created_at)} · {ecole.eleves} élèves en {ecole.annee_scolaire} · {formatFCFA(ecole.encaisse)} encaissés
            {ecole.statut_abonnement === "essai" && ecole.trial_ends_at && ` · essai jusqu'au ${formatDate(ecole.trial_ends_at)}`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value as PlanId })} className={`${champ} w-auto`}>
          <option value="essai">Essai</option><option value="standard">Standard</option><option value="premium">Premium</option>
        </select>
        <select value={f.statut_abonnement} onChange={(e) => setF({ ...f, statut_abonnement: e.target.value as StatutAbonnement })} className={`${champ} w-auto`}>
          <option value="essai">Essai</option><option value="actif">Actif</option><option value="expire">Expiré</option><option value="suspendu">Suspendu</option>
        </select>
        <input type="date" value={f.abonnement_fin} onChange={(e) => setF({ ...f, abonnement_fin: e.target.value })} className={`${champ} w-auto`} />
        <label className="text-xs flex items-center gap-1.5">
          <input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active
        </label>
        <Bouton
          variante="sombre"
          disabled={isPending}
          onClick={() => startTransition(async () => setMessage((await modifierAbonnement(ecole.id, f)).message ?? null))}
        >
          Enregistrer
        </Bouton>
        {message && <span className="text-[11px] text-neutral-500">{message}</span>}
      </div>
    </Carte>
  );
}
