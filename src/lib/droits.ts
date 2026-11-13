import type { RoleUtilisateur } from "@/types/database";

/**
 * Gestes réservés selon le rôle (D09) : annuler un reçu, classes et tarifs, paramètres de l'école, import, export
 * Excel, comptes. Source unique pour l'interface et les actions ; la base applique le même refus (sauf l'export).
 */
export type Droit = "annuler" | "classes" | "parametres" | "importer" | "exporter" | "utilisateurs";

const DROITS_CAISSIER: readonly Droit[] = [];

/** Le directeur peut tout ; le caissier seulement ce qui figure dans DROITS_CAISSIER (encaisser n'est pas un droit à part). */
export function peutFaire(role: RoleUtilisateur, droit: Droit): boolean {
  if (role === "directeur") return true;
  return DROITS_CAISSIER.includes(droit);
}
