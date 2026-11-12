import { AlertTriangle, Lock } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { SituationAbonnement } from "@/lib/abonnement";
import type { EcoleVue } from "./types";

/**
 * Bandeau d'abonnement de l'Espace École : alerte (7 jours avant la fin), délai de grâce (7 jours après),
 * lecture seule ensuite. Rien ne s'affiche tant que l'abonnement est loin de sa fin.
 */
export function BandeauAbonnement({
  ecole,
  abonnement,
  numeroWave,
}: {
  ecole: Pick<EcoleVue, "slug" | "statut_abonnement">;
  abonnement: SituationAbonnement;
  numeroWave: string | null;
}) {
  const { etat, fin, finGrace, joursRestants } = abonnement;
  if (etat === "normal") return null;

  const quoi = ecole.statut_abonnement === "essai" ? "Votre essai gratuit" : "Votre abonnement";
  const reglement = numeroWave
    ? ` Règlement par Wave au ${numeroWave}, en indiquant l'identifiant ${ecole.slug}.`
    : " Contactez FayJàng pour régler votre abonnement.";

  let titre: string;
  let detail: string;
  if (etat === "alerte") {
    const quand = joursRestants === 0 ? "aujourd'hui" : joursRestants === 1 ? "demain" : `dans ${joursRestants} jours`;
    titre = `${quoi} se termine ${quand}${fin ? ` (le ${formatDate(fin)})` : ""}.`;
    detail = `${ecole.statut_abonnement === "essai" ? "Abonnez-vous" : "Pensez à le renouveler"} pour continuer à encaisser.${reglement}`;
  } else if (etat === "grace") {
    titre = `${quoi} est terminé${fin ? ` depuis le ${formatDate(fin)}` : ""}.`;
    detail = `Tout fonctionne encore${finGrace ? ` jusqu'au ${formatDate(finGrace)} inclus` : ""}. Ensuite, l'Espace École passera en lecture seule.${reglement}`;
  } else {
    titre = ecole.statut_abonnement === "suspendu" ? "Abonnement suspendu : l'Espace École est en lecture seule." : "Abonnement expiré : l'Espace École est en lecture seule.";
    detail = `Vous pouvez consulter vos données, télécharger les reçus et l'export, et relancer les parents. Encaisser, inscrire, modifier et importer sont suspendus.${reglement}`;
  }

  const Icone = etat === "lecture_seule" ? Lock : AlertTriangle;
  return (
    <div
      role="status"
      className={cn(
        "p-4 rounded-3xl border text-xs flex gap-3",
        etat === "alerte" ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-red-50 border-red-200 text-red-900"
      )}
    >
      <Icone className="w-4 h-4 shrink-0 mt-0.5" />
      <p>
        <b>{titre}</b> {detail}
      </p>
    </div>
  );
}

/** Remplace un bouton d'écriture quand l'Espace École est en lecture seule (abonnement expiré ou suspendu) */
export function MentionLectureSeule({ className }: { className?: string }) {
  return (
    <p className={cn("inline-flex items-center gap-1 text-[11px] font-bold text-red-700", className)}>
      <Lock className="w-3.5 h-3.5 shrink-0" /> Lecture seule : abonnement expiré ou suspendu
    </p>
  );
}
