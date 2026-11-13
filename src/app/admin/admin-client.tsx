"use client";

import { useState, useTransition } from "react";
import { LogOut } from "lucide-react";
import { formatFCFA } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { Badge, Bouton, Carte, Kpi, champ } from "@/components/ui";
import type { SituationAbonnement } from "@/lib/abonnement";
import type { Ecole, PlanId, StatutAbonnement } from "@/types/database";
import { logoutAdminAction, modifierAbonnement, reinitialiserMotDePasseDirecteur } from "./actions";
import { MOT_DE_PASSE_MIN } from "@/lib/mot-de-passe";

export type EcoleAdmin = Pick<
  Ecole,
  "id" | "nom" | "slug" | "ville" | "responsable_nom" | "email_contact" | "telephone_contact" | "annee_scolaire" | "plan" | "statut_abonnement" | "trial_ends_at" | "abonnement_fin" | "is_active" | "created_at"
> & {
  eleves: number;
  encaisse: number;
  /** État calculé par la base (normal, alerte, grâce, lecture seule) ; null si la lecture a échoué */
  abonnement: SituationAbonnement | null;
};

/** Badge de l'état d'abonnement : ce que vit l'école aujourd'hui, pas seulement le statut enregistré */
function BadgeEtat({ ecole }: { ecole: EcoleAdmin }) {
  const a = ecole.abonnement;
  if (!a) return <Badge ton="gris">État inconnu</Badge>;
  if (a.etat === "lecture_seule") return <Badge ton="rouge">Lecture seule</Badge>;
  if (a.etat === "grace") return <Badge ton="orange">Délai de grâce{a.finGrace ? ` jusqu'au ${formatDate(a.finGrace)}` : ""}</Badge>;
  if (a.etat === "alerte") return <Badge ton="orange">Fin proche{a.fin ? ` : ${formatDate(a.fin)}` : ""}</Badge>;
  return <Badge ton="vert">Normal</Badge>;
}

export function AdminClient({ ecoles, totauxDisponibles = true }: { ecoles: EcoleAdmin[]; totauxDisponibles?: boolean }) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-neutral-900 text-white px-4 py-3 flex justify-between items-center">
        <p className="text-sm font-extrabold">Console FayJàng</p>
        <form action={logoutAdminAction}>
          <button className="text-xs flex items-center gap-1 opacity-80 hover:opacity-100"><LogOut className="w-4 h-4" /> Quitter</button>
        </form>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        {!totauxDisponibles && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl p-3">
            Les totaux (élèves, encaissé) n&apos;ont pas pu être lus : ils sont affichés à zéro. Rechargez la page.
          </p>
        )}
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
  const [reinit, setReinit] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Carte className="space-y-3">
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <p className="text-sm font-extrabold flex flex-wrap items-center gap-1.5">
            {ecole.nom} <BadgeEtat ecole={ecole} /> {!ecole.is_active && <Badge ton="rouge">Désactivée</Badge>}
          </p>
          <p className="text-[11px] text-neutral-500">
            {ecole.slug} · {ecole.ville ?? "—"} · {ecole.responsable_nom} · {ecole.email_contact} · {ecole.telephone_contact}
          </p>
          <p className="text-[11px] text-neutral-500">
            Inscrite le {formatDate(ecole.created_at)} · {ecole.eleves} élèves en {ecole.annee_scolaire} · {formatFCFA(ecole.encaisse)} encaissés
            {ecole.statut_abonnement === "essai" && ecole.trial_ends_at && ` · essai jusqu'au ${formatDate(ecole.trial_ends_at)}`}
            {ecole.statut_abonnement === "actif" && ecole.abonnement_fin && ` · abonnée jusqu'au ${formatDate(ecole.abonnement_fin)}`}
          </p>
          {ecole.statut_abonnement === "actif" && !ecole.abonnement_fin && (
            <p className="text-[11px] font-bold text-amber-700">
              Actif sans date de fin : l&apos;école n&apos;expire jamais. Indiquez une date de fin et enregistrez.
            </p>
          )}
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
        <Bouton variante="secondaire" disabled={isPending} onClick={() => setReinit(reinit === null ? "" : null)}>
          Mot de passe du directeur
        </Bouton>
        {message && <span className="text-[11px] text-neutral-500">{message}</span>}
      </div>
      {reinit !== null && (
        <form
          className="flex flex-wrap gap-2 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const r = await reinitialiserMotDePasseDirecteur(ecole.id, reinit);
              setMessage(r.message ?? null);
              if (r.success) setReinit(null);
            });
          }}
        >
          <input
            type="password"
            autoComplete="new-password"
            placeholder={`Nouveau mot de passe provisoire (${MOT_DE_PASSE_MIN} min.)`}
            value={reinit}
            onChange={(e) => setReinit(e.target.value)}
            className={`${champ} w-auto`}
          />
          <Bouton type="submit" variante="sombre" disabled={isPending || reinit.trim().length < MOT_DE_PASSE_MIN}>
            Réinitialiser
          </Bouton>
        </form>
      )}
    </Carte>
  );
}
