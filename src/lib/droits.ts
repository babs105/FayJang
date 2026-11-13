import type { RoleUtilisateur } from "@/types/database";

/** Gestes réservés selon le rôle (D09). Source unique pour l'interface et les actions ; la base applique le même refus. */
export type Droit = "annuler";

const DROITS_CAISSIER: readonly Droit[] = [];

/** Le directeur peut tout ; le caissier seulement ce qui figure dans DROITS_CAISSIER (encaisser n'est pas un droit à part). */
export function peutFaire(role: RoleUtilisateur, droit: Droit): boolean {
  if (role === "directeur") return true;
  return DROITS_CAISSIER.includes(droit);
}
