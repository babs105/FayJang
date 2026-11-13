import Link from "next/link";
import { formatDate } from "@/lib/metier/dates";
import { formatFCFA } from "@/lib/utils";
import { Badge } from "@/components/ui";
import type { EcoleAdmin } from "@/types/admin";

/** Badge de l'état d'abonnement : ce que vit l'école aujourd'hui, pas seulement le statut enregistré */
export function BadgeEtat({ ecole }: { ecole: EcoleAdmin }) {
  const a = ecole.abonnement;
  if (!a) return <Badge ton="gris">État inconnu</Badge>;
  if (a.etat === "lecture_seule") return <Badge ton="rouge">Lecture seule</Badge>;
  if (a.etat === "grace") return <Badge ton="orange">Délai de grâce{a.finGrace ? ` jusqu'au ${formatDate(a.finGrace)}` : ""}</Badge>;
  if (a.etat === "alerte") return <Badge ton="orange">Fin proche{a.fin ? ` : ${formatDate(a.fin)}` : ""}</Badge>;
  return <Badge ton="vert">Normal</Badge>;
}

/** Nom (lien vers la fiche), badges, et une ligne de résumé */
export function ResumeEcole({ ecole, lien = true }: { ecole: EcoleAdmin; lien?: boolean }) {
  return (
    <div>
      <p className="text-sm font-extrabold flex flex-wrap items-center gap-1.5">
        {lien ? (
          <Link href={`/admin/ecoles?id=${ecole.id}`} className="hover:underline">
            {ecole.nom}
          </Link>
        ) : (
          ecole.nom
        )}
        <BadgeEtat ecole={ecole} /> {!ecole.is_active && <Badge ton="rouge">Désactivée</Badge>}
      </p>
      <p className="text-[11px] text-neutral-500">
        {ecole.ville ?? "—"} · {ecole.plan} · {ecole.eleves} élèves en {ecole.annee_scolaire} · {formatFCFA(ecole.encaisse)} encaissés
        {ecole.statut_abonnement === "essai" && ecole.trial_ends_at && ` · essai jusqu'au ${formatDate(ecole.trial_ends_at)}`}
        {ecole.statut_abonnement === "actif" && ecole.abonnement_fin && ` · abonnée jusqu'au ${formatDate(ecole.abonnement_fin)}`}
      </p>
      {ecole.statut_abonnement === "actif" && !ecole.abonnement_fin && (
        <p className="text-[11px] font-bold text-amber-700">Actif sans date de fin : l&apos;école n&apos;expire jamais. Indiquez une date de fin.</p>
      )}
    </div>
  );
}
